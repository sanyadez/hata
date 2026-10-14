/**
 * Apps on a machine, as its client keeps them: a folder per app under `/var/lib/hata-client/apps` with
 * the compose file, its `.env` and Hata's `hata.yml` — the same three files as on Hata itself.
 *
 * Hata decides everything (the compose file is made from the store's form on Hata's side, with the
 * same code as for its own apps); here the files are written and `docker compose` is run — only the
 * commands in `COMMANDS`, never a command line Hata sends. The app's data lies under the machine's
 * data folder (`/DATA` unless Hata says otherwise); only folders inside it are made or removed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { composeCmd } from "./docker";
import { MuxError, type Channel } from "./mux";

export const APPS_DIR = process.env.HATA_CLIENT_APPS || "/var/lib/hata-client/apps";
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILES = ["compose.yml", ".env", "hata.yml"];

const fail = (code: string, detail: Record<string, string | number> = {}): never => {
  throw new MuxError(code, code, detail);
};

function nameOf(value: unknown): string {
  const name = String(value ?? "");
  if (!NAME_RE.test(name)) fail("app.badName");
  return name;
}

const read = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export interface MachineAppFiles {
  name: string;
  compose: string;
  env: string;
  hata: string | null;
}

/** Every app with its files, for Hata to read */
export function list(): MachineAppFiles[] {
  let names: string[] = [];
  try {
    names = readdirSync(APPS_DIR).filter((n) => NAME_RE.test(n)).sort();
  } catch {
    return [];
  }
  const out: MachineAppFiles[] = [];
  for (const name of names) {
    const compose = read(join(APPS_DIR, name, "compose.yml"));
    if (compose !== null) out.push({ name, compose, env: read(join(APPS_DIR, name, ".env")) ?? "", hata: read(join(APPS_DIR, name, "hata.yml")) });
  }
  return out;
}

/** Writes the files Hata gives; `fresh` refuses an app that is there already */
export function write(args: { name?: unknown; files?: unknown; fresh?: unknown }): void {
  const name = nameOf(args.name);
  const dir = join(APPS_DIR, name);
  if (args.fresh === true && existsSync(dir)) fail("app.exists");
  const files = (args.files ?? {}) as Record<string, unknown>;
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  for (const [file, text] of Object.entries(files)) {
    if (!FILES.includes(file)) fail("request.notFound");
    if (text === null) {
      rmSync(join(dir, file), { force: true });
      continue;
    }
    if (typeof text !== "string" || text.length > 512 * 1024) fail("app.badCompose");
    writeFileSync(join(dir, file + ".tmp"), text as string, { mode: file === ".env" ? 0o600 : 0o644 });
    renameSync(join(dir, file + ".tmp"), join(dir, file));
  }
}

/** The `docker compose` commands Hata may run, by name */
const COMMANDS: Record<string, string[]> = {
  config: ["config", "--quiet"],
  pull: ["pull"],
  up: ["up", "-d", "--remove-orphans"],
  stop: ["stop"],
  restart: ["restart"],
  down: ["down", "--remove-orphans"],
  downVolumes: ["down", "--remove-orphans", "--volumes"],
};

/** Runs one compose command of an app; what it prints goes to Hata as it comes, a failure ends in an error */
export async function compose(args: { name?: unknown; command?: unknown }, channel: Channel): Promise<void> {
  const name = nameOf(args.name);
  const dir = join(APPS_DIR, name);
  const command = COMMANDS[String(args.command)];
  if (!command) fail("request.notFound");
  if (!existsSync(join(dir, "compose.yml"))) fail("app.notFound");
  const proc = Bun.spawn({ cmd: composeCmd(name, dir, command!), cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
  channel.signal.addEventListener("abort", () => proc.kill());
  let last = "";
  const decoder = new TextDecoder();
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split(/\r?\n|\r/).filter((l) => l.trim());
      if (lines.length) last = lines[lines.length - 1]!;
      await channel.send(chunk).catch(() => {});
    }
  };
  await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  const code = await proc.exited;
  if (code !== 0) fail("machine.composeFailed", { message: last || `docker compose ${command!.join(" ")} exited with ${code}` });
}

/** The output of an app's containers: the tail, then what they write, until cancelled */
export async function logs(args: { name?: unknown; tail?: unknown }, channel: Channel): Promise<void> {
  const name = nameOf(args.name);
  const dir = join(APPS_DIR, name);
  if (!existsSync(join(dir, "compose.yml"))) fail("app.notFound");
  const tail = Math.min(5000, Math.max(0, Number(args.tail) || 200));
  const proc = Bun.spawn({ cmd: composeCmd(name, dir, ["logs", "--no-color", "--follow", "--tail", String(tail)]), cwd: dir, stdout: "pipe", stderr: "ignore" });
  channel.signal.addEventListener("abort", () => proc.kill());
  for await (const chunk of proc.stdout) await channel.send(chunk).catch(() => proc.kill());
  await proc.exited;
}

const inside = (path: string, parent: string) => path === parent || path.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/**
 * Makes the app's missing folders — only inside the data folder: devices and sockets are not ours.
 * What is made belongs to `owner` (PUID:PGID), the user the apps run as.
 */
export function folders(args: { paths?: unknown; root?: unknown; owner?: unknown }): void {
  const root = resolve(String(args.root ?? "/DATA"));
  if (root === "/") fail("files.badPath");
  const owner = /^\d{1,10}:\d{1,10}$/.test(String(args.owner ?? "")) ? String(args.owner) : "";
  for (const path of Array.isArray(args.paths) ? args.paths : []) {
    if (typeof path !== "string") continue;
    const abs = resolve(path);
    if (!inside(abs, root) || abs === root || existsSync(abs)) continue;
    // the data folder and AppData themselves stay root's
    mkdirSync(inside(abs, join(root, "AppData")) && abs !== join(root, "AppData") ? join(root, "AppData") : root, { recursive: true });
    const first = mkdirSync(abs, { recursive: true });
    if (first && owner && process.getuid?.() === 0) Bun.spawnSync(["chown", "-R", owner, "--", first]);
  }
}

/** Which of these ports something on the machine listens on already */
export async function ports(args: { ports?: unknown }): Promise<{ busy: number[] }> {
  const busy: number[] = [];
  for (const item of Array.isArray(args.ports) ? args.ports : []) {
    const port = Number(item?.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    try {
      if (item?.protocol === "udp") (await Bun.udpSocket({ port })).close();
      else Bun.listen({ hostname: "0.0.0.0", port, socket: { data() {} } }).stop(true);
    } catch {
      busy.push(port);
    }
  }
  return { busy };
}

/** Takes the app's folder away; `data` — its data folder too, which must lie in `<root>/AppData` */
export function remove(args: { name?: unknown; data?: unknown; root?: unknown }): void {
  const name = nameOf(args.name);
  rmSync(join(APPS_DIR, name), { recursive: true, force: true });
  if (typeof args.data === "string") {
    const data = resolve(args.data);
    const root = resolve(String(args.root ?? "/DATA"), "AppData");
    if (data !== join(root, name)) fail("files.protected");
    rmSync(data, { recursive: true, force: true });
  }
}
