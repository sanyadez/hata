/**
 * `hata install` / `hata uninstall`: the systemd service. Installing is copying the binary and writing
 * one unit file — nothing else is put on the system.
 */
import { chmodSync, copyFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { serviceStateDir } from "./statedir";
import { COMPILED } from "./version";

const BIN = "/usr/local/bin/hata";
const UNIT = "/etc/systemd/system/hata.service";

const unit = (exec: string, stateDir: string) => `[Unit]
Description=Hata home server
Documentation=https://github.com/sanyadez/hata
After=network-online.target docker.service
Wants=network-online.target

[Service]
ExecStart=${exec}
Environment=HATA_DATA_DIR=${stateDir}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
`;

function systemctl(...args: string[]): boolean {
  return Bun.spawnSync({ cmd: ["systemctl", ...args], stdout: "inherit", stderr: "inherit" }).exitCode === 0;
}

function preflight(): string | null {
  if (process.platform !== "linux") return "The service can only be installed on Linux.";
  if (process.getuid?.() !== 0) return "This needs root: run it with sudo.";
  if (!Bun.which("systemctl")) return "systemd was not found on this machine.";
  return null;
}

function portFree(port: number): boolean {
  try {
    Bun.listen({ hostname: "0.0.0.0", port, socket: { data() {} } }).stop(true);
    return true;
  } catch {
    return false;
  }
}

/** Ports tried, in order, when the web UI's usual port is taken by something else */
const FALLBACK_PORTS = [8080, 8090, 8888, 9080];

/**
 * The port the service will listen on. An explicit `--port` wins; a running Hata keeps the port it has;
 * a new install takes 80, or the first free fallback when another web server (CasaOS, nginx) holds it.
 */
async function choosePort(args: string[]): Promise<number | string> {
  const { settings, updateSettings } = await import("./config");
  const at = args.indexOf("--port");
  if (at >= 0) {
    const port = Number(args[at + 1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "`--port` needs a number from 1 to 65535.";
    updateSettings({ port });
    return port;
  }
  const running = Bun.spawnSync({ cmd: ["systemctl", "is-active", "--quiet", "hata.service"] }).exitCode === 0;
  if (running || settings.port) return settings.port || 80;
  if (portFree(80)) return 80;
  const port = FALLBACK_PORTS.find(portFree);
  if (!port) return "Port 80 and the usual alternatives are taken: choose one with `hata install --port <number>`.";
  console.log(`Port 80 is taken by another program, so Hata will use port ${port}. Change it later with \`hata install --port <number>\`.`);
  updateSettings({ port });
  return port;
}

/** Points the installed service at another state folder; it takes effect on its next start */
export function rewriteUnit(stateDir: string): void {
  writeFileSync(UNIT, unit(BIN, stateDir));
  if (!systemctl("daemon-reload")) throw new Error("systemctl daemon-reload failed");
}

export async function installService(args: string[] = []): Promise<number> {
  const problem = preflight() ?? (COMPILED ? null : "Run `hata install` from the built binary (bun run build), not from source.");
  if (problem) {
    console.error(problem);
    return 1;
  }
  // the settings read and written here must be the service's own
  const stateDir = serviceStateDir();
  process.env.HATA_DATA_DIR = stateDir;
  const port = await choosePort(args);
  if (typeof port === "string") {
    console.error(port);
    return 1;
  }
  if (process.execPath !== BIN) {
    // copy next to the target and rename: the running service keeps its old file until it restarts
    copyFileSync(process.execPath, BIN + ".new");
    chmodSync(BIN + ".new", 0o755);
    renameSync(BIN + ".new", BIN);
  }
  writeFileSync(UNIT, unit(BIN, stateDir));
  if (!systemctl("daemon-reload") || !systemctl("enable", "hata.service") || !systemctl("restart", "hata.service")) return 1;
  console.log(`Hata is installed: ${BIN}, state in ${stateDir}.`);
  if (!Bun.which("docker")) console.log("Docker was not found: install Docker Engine with the compose plugin to run apps.");

  // the service prints the same address to its log; show it here so nobody has to look for it
  const { setupUrl, baseUrl } = await import("./server");
  const url = setupUrl();
  console.log(url ? `Open this address to create the administrator:\n  ${url}` : `Open ${baseUrl()}`);
  return 0;
}

export async function uninstallService(): Promise<number> {
  const problem = preflight();
  if (problem) {
    console.error(problem);
    return 1;
  }
  systemctl("disable", "--now", "hata.service");
  rmSync(UNIT, { force: true });
  systemctl("daemon-reload");
  rmSync(BIN, { force: true });
  console.log(`Hata is removed. Apps keep running; their compose files and the state stay in ${serviceStateDir()}, the users and keys in /etc/hata.`);
  return 0;
}
