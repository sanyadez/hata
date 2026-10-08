/**
 * `hata install` / `hata uninstall`: the systemd service. Installing is copying the binary and writing
 * one unit file — nothing else is put on the system.
 */
import { chmodSync, copyFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { COMPILED } from "./version";

const BIN = "/usr/local/bin/hata";
const UNIT = "/etc/systemd/system/hata.service";
const SERVICE_DATA_DIR = "/var/lib/hata";

const unit = (exec: string) => `[Unit]
Description=Hata home server
Documentation=https://github.com/sanyadez/hata
After=network-online.target docker.service
Wants=network-online.target

[Service]
ExecStart=${exec}
Environment=HATA_DATA_DIR=${SERVICE_DATA_DIR}
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

export async function installService(): Promise<number> {
  const problem = preflight() ?? (COMPILED ? null : "Run `hata install` from the built binary (bun run build), not from source.");
  if (problem) {
    console.error(problem);
    return 1;
  }
  if (process.execPath !== BIN) {
    // copy next to the target and rename: the running service keeps its old file until it restarts
    copyFileSync(process.execPath, BIN + ".new");
    chmodSync(BIN + ".new", 0o755);
    renameSync(BIN + ".new", BIN);
  }
  writeFileSync(UNIT, unit(BIN));
  if (!systemctl("daemon-reload") || !systemctl("enable", "hata.service") || !systemctl("restart", "hata.service")) return 1;
  console.log(`Hata is installed: ${BIN}, state in ${SERVICE_DATA_DIR}.`);
  if (!Bun.which("docker")) console.log("Docker was not found: install Docker Engine with the compose plugin to run apps.");

  // the service prints the same address to its log; show it here so nobody has to look for it
  const out = Bun.spawnSync({ cmd: [BIN, "setup-url"], env: { ...process.env, HATA_DATA_DIR: SERVICE_DATA_DIR } });
  const text = out.stdout.toString().trim();
  if (text) console.log(text.startsWith("http") ? `Open this address to create the administrator:\n  ${text}` : text);
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
  console.log(`Hata is removed. Apps keep running; their compose files and the state stay in ${SERVICE_DATA_DIR}.`);
  return 0;
}
