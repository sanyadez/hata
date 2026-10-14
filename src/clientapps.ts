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
export async function logs(args: { name?: unknown; tail?: unknown; follow?: unknown; service?: unknown }, channel: Channel): Promise<void> {
  const name = nameOf(args.name);
  const dir = join(APPS_DIR, name);
  if (!existsSync(join(dir, "compose.yml"))) fail("app.notFound");
  const tail = Math.min(5000, Math.max(0, Number(args.tail) || 200));
  // without `follow` — the tail with timestamps, and the stream ends: what an agent reads
  const follow = args.follow !== false;
  const service = typeof args.service === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args.service) ? [args.service] : [];
  const proc = Bun.spawn({ cmd: composeCmd(name, dir, ["logs", "--no-color", ...(follow ? ["--follow"] : ["--timestamps"]), "--tail", String(tail), ...service]), cwd: dir, stdout: "pipe", stderr: "ignore" });
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

// --- Snapshots: the archive is kept by Hata ------------------------------------------------------------

const tarPath = (path: string) => path.replace(/^\/+/, "");

async function running(name: string): Promise<{ any: boolean; images: string[] }> {
  const out = Bun.spawnSync(["docker", "ps", "-a", "--filter", `label=com.docker.compose.project=${name}`, "--format", "{{.State}} {{.Image}}"]);
  const lines = out.stdout.toString().split("\n").filter(Boolean);
  return { any: lines.some((l) => l.startsWith("running") || l.startsWith("restarting")), images: [...new Set(lines.map((l) => l.split(" ")[1] ?? ""))].filter(Boolean) };
}

const quietly = async (name: string, command: string) => {
  const dir = join(APPS_DIR, name);
  if (!existsSync(join(dir, "compose.yml"))) return;
  const proc = Bun.spawn({ cmd: composeCmd(name, dir, command === "up" ? ["up", "-d", "--remove-orphans"] : [command]), cwd: dir, stdout: "ignore", stderr: "pipe" });
  const said = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) fail("machine.composeFailed", { message: said.trim().split("\n").pop() || `docker compose ${command} failed` });
};

/**
 * An app's snapshot as a tar.gz stream: its folder here, its own data folder and its named volumes,
 * owners by number. The app is stopped while it is read and started again whatever happens.
 */
export async function snapshot(args: { name?: unknown; root?: unknown }, channel: Channel): Promise<{ paths: string[]; images: string[] }> {
  const name = nameOf(args.name);
  const dir = join(APPS_DIR, name);
  if (!existsSync(join(dir, "compose.yml"))) fail("app.notFound");
  const data = join(resolve(String(args.root ?? "/DATA")), "AppData", name);
  const volumes = Bun.spawnSync(["docker", "volume", "ls", "--filter", `label=com.docker.compose.project=${name}`, "--format", "{{.Mountpoint}}"]).stdout.toString().split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/"));
  const paths = [dir, data, ...volumes].filter((p) => existsSync(p));
  const state = await running(name);
  if (state.any) await quietly(name, "stop");
  try {
    const proc = Bun.spawn(["tar", "--numeric-owner", "--exclude=.hata-trash", "-czf", "-", "-C", "/", ...paths.map(tarPath)], { stdout: "pipe", stderr: "pipe" });
    channel.signal.addEventListener("abort", () => proc.kill());
    const errors = new Response(proc.stderr).text();
    for await (const chunk of proc.stdout) await channel.send(chunk);
    const code = await proc.exited;
    // 1 is "a file changed while it was read": the archive is complete
    if (code > 1) fail("files.failed", { code: (await errors).trim().split("\n").pop() || `tar exited with ${code}` });
  } finally {
    if (state.any) await quietly(name, "up").catch(() => {});
  }
  return { paths, images: state.images };
}

/**
 * Puts an app back from a snapshot Hata sends: the archive is kept aside first and checked to hold only
 * the snapshot's own paths; then the app is stopped, those paths are replaced and the app is started.
 */
export async function restore(args: { name?: unknown; paths?: unknown }, channel: Channel): Promise<void> {
  const name = nameOf(args.name);
  const paths = Array.isArray(args.paths) ? args.paths.filter((p): p is string => typeof p === "string" && p.startsWith("/")).map((p) => resolve(p)) : [];
  // what a snapshot of this app may hold: its folder, a data folder named after it, Docker's volumes of it
  const allowed = (p: string) => p === join(APPS_DIR, name) || /\/AppData\/[^/]+$/.test(p) && p.endsWith("/" + name) || /^\/var\/lib\/docker\/volumes\/[^/]+\/_data$/.test(p) || /\/volumes\/[^/]+\/_data$/.test(p);
  if (!paths.length || paths.some((p) => !allowed(p))) fail("backup.badArchive");
  const file = join("/var/tmp", `hata-restore-${name}-${process.pid}.tar.gz`);
  const out = Bun.file(file).writer();
  try {
    for (let chunk = await channel.read(); chunk; chunk = await channel.read()) out.write(chunk);
    await out.end();
    const listing = Bun.spawnSync(["tar", "-tzf", file]);
    if (listing.exitCode !== 0) fail("backup.badArchive");
    const roots = paths.map(tarPath);
    const stray = listing.stdout.toString().split("\n").filter((m) => m && !roots.some((r) => m === r || m === r + "/" || m.startsWith(r + "/")));
    if (stray.length) fail("backup.badArchive");
    await quietly(name, "stop").catch(() => {});
    for (const path of paths) rmSync(path, { recursive: true, force: true });
    const tar = Bun.spawnSync(["tar", "--numeric-owner", "-xzpf", file, "-C", "/"]);
    if (tar.exitCode !== 0) fail("files.failed", { code: tar.stderr.toString().trim().split("\n").pop() || "tar failed" });
    await quietly(name, "up");
  } finally {
    rmSync(file, { force: true });
  }
}
