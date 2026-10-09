/**
 * Updating Hata itself: a newer release is found on GitHub, downloaded, checked against the release's
 * SHA256SUMS and put in place of the running binary; the service is restarted into it.
 *
 * The restart is watched from outside. Before the swap, the running binary is kept as `<binary>.previous`,
 * and that known-good copy is started as a transient systemd unit (`hata update-watch`): it restarts the
 * service and waits for the new version to say it is up. If it does not — the binary does not run on this
 * machine, or crashes at start — the previous binary is put back and started again.
 *
 * Nothing is installed without the administrator asking for it.
 */
import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { record } from "./activity";
import { DATA_DIR } from "./config";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { COMPILED, VERSION } from "./version";

const RELEASE_API = process.env.HATA_RELEASE_API ?? "https://api.github.com/repos/sanyadez/hata/releases/latest";
const SERVICE_BIN = "/usr/local/bin/hata";
const PREVIOUS_BIN = SERVICE_BIN + ".previous";
const CHECK_EVERY_MS = 12 * 3600 * 1000;
/** How long the new version has to come up before the previous one is put back */
const CONFIRM_WITHIN_MS = 60_000;
const STATE_FILE = join(DATA_DIR, "update.json");

// --- Versions (pure) --------------------------------------------------------------------------------

/** Compares two versions the semver way: negative when `a` is older; a pre-release is older than its release */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre = ""] = v.replace(/^v/, "").split("+")[0]!.split(/-(.*)/s);
    return { core: core.split(".").map((n) => Number(n) || 0), pre: pre ? pre.split(".") : [] };
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d) return d;
  }
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const [np, nq] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    const d = np && nq ? Number(p) - Number(q) : np !== nq ? (np ? -1 : 1) : p < q ? -1 : p > q ? 1 : 0;
    if (d) return d;
  }
  return 0;
}

/** The checksum SHA256SUMS lists for a file; "" when it has none */
export function checksumFor(sums: string, file: string): string {
  for (const line of sums.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && m[2] === file) return m[1]!;
  }
  return "";
}

// --- State ------------------------------------------------------------------------------------------

/** The last update that was started — written before the restart, read by the watcher and by the new version */
interface UpdateRecord {
  from: string;
  to: string;
  at: number;
  /** pending — restarted, not confirmed yet; done — the new version is up; rolledBack — the previous one was put back */
  status: "pending" | "done" | "rolledBack";
  user?: string;
  /** The rollback has been written to the activity log */
  reported?: boolean;
}

const readRecord = () => readJsonFile<UpdateRecord | null>(STATE_FILE, null);

export interface Release {
  version: string;
  /** The release's page */
  url: string;
  notes: string;
  publishedAt: string;
}

interface Found extends Release {
  assets: Record<string, string>;
}

let latest: Found | null = null;
let checkedAt = 0;
let checkError = "";
let stage: "" | "download" | "restart" = "";
let installError = "";

const FILE = `hata-linux-${process.arch}`;

/** Why this process cannot replace itself; "" — it can */
function unsupported(): string {
  if (!COMPILED) return "source";
  if (process.execPath !== SERVICE_BIN || process.getuid?.() !== 0 || !Bun.which("systemd-run")) return "notService";
  return "";
}

export interface UpdateStatus {
  current: string;
  latest: Release | null;
  available: boolean;
  /** "" — can be installed from here; otherwise why not: `source` (run from source), `notService` */
  unsupported: string;
  checkedAt: number;
  error: string;
  /** What an install started from here is doing right now */
  stage: string;
  last: UpdateRecord | null;
}

export function updateStatus(): UpdateStatus {
  const release = latest && { version: latest.version, url: latest.url, notes: latest.notes, publishedAt: latest.publishedAt };
  return { current: VERSION, latest: release, available: !!latest && compareVersions(latest.version, VERSION) > 0, unsupported: unsupported(), checkedAt, error: installError || checkError, stage, last: readRecord() };
}

/** The newer version, when there is one — for the hint on the home page */
export const availableUpdate = (): string | null => (latest && compareVersions(latest.version, VERSION) > 0 ? latest.version : null);

export async function checkForUpdate(): Promise<UpdateStatus> {
  try {
    const res = await fetch(RELEASE_API, { headers: { accept: "application/vnd.github+json", "user-agent": `hata/${VERSION}` }, signal: AbortSignal.timeout(15_000) });
    // no release published yet is not an error
    if (res.status === 404) latest = null;
    else if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    else {
      const data = (await res.json()) as { tag_name?: string; html_url?: string; body?: string; published_at?: string; assets?: { name: string; browser_download_url: string }[] };
      if (typeof data.tag_name !== "string") throw new Error("unexpected answer");
      latest = {
        version: data.tag_name.replace(/^v/, ""),
        url: /^https:\/\//.test(data.html_url ?? "") ? data.html_url! : "",
        notes: (data.body ?? "").slice(0, 4000),
        publishedAt: data.published_at ?? "",
        assets: Object.fromEntries((data.assets ?? []).map((a) => [a.name, a.browser_download_url])),
      };
    }
    checkError = "";
  } catch (e) {
    checkError = e instanceof Error ? e.message : String(e);
  }
  checkedAt = Date.now();
  return updateStatus();
}

export function scheduleUpdateChecks(): void {
  setTimeout(() => void checkForUpdate(), 30_000);
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}

/**
 * Called once the server is listening: an update that was waiting for this version is confirmed, and one
 * that was rolled back is put into the activity log by the version that came back.
 */
export function confirmUpdate(): void {
  const last = readRecord();
  if (last?.status === "rolledBack" && !last.reported) {
    writeJsonAtomic(STATE_FILE, { ...last, reported: true } satisfies UpdateRecord);
    record("system.update.failed", { user: last.user, detail: last.to });
  }
  if (last?.status !== "pending" || last.to !== VERSION) return;
  writeJsonAtomic(STATE_FILE, { ...last, status: "done" } satisfies UpdateRecord);
  record("system.update.done", { user: last.user, detail: VERSION });
  console.log(`Updated from ${last.from} to ${VERSION}`);
}

// --- Install ----------------------------------------------------------------------------------------

async function download(url: string, path: string): Promise<void> {
  const res = await fetch(url, { headers: { "user-agent": `hata/${VERSION}` }, signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok) throw new Error(`Download of ${url} failed: ${res.status}`);
  await Bun.write(path, res);
}

async function install(release: Found, user: string): Promise<void> {
  const [binary, sums] = [release.assets[FILE], release.assets.SHA256SUMS];
  if (!binary || !sums) throw new Error(`The release has no ${FILE} or no SHA256SUMS`);
  const fresh = SERVICE_BIN + ".download";
  try {
    stage = "download";
    const sumsText = await (await fetch(sums, { headers: { "user-agent": `hata/${VERSION}` }, signal: AbortSignal.timeout(30_000) })).text();
    const expected = checksumFor(sumsText, FILE);
    if (!expected) throw new Error(`SHA256SUMS has no entry for ${FILE}`);
    await download(binary, fresh);
    const hasher = new Bun.CryptoHasher("sha256");
    for await (const chunk of Bun.file(fresh).stream()) hasher.update(chunk);
    if (hasher.digest("hex") !== expected) throw new Error("The download is damaged: its checksum does not match SHA256SUMS");
    chmodSync(fresh, 0o755);
    // does it run here at all, and is it what the release says?
    const probe = Bun.spawnSync({ cmd: [fresh, "version"], stdout: "pipe", stderr: "pipe" });
    if (probe.exitCode !== 0 || probe.stdout.toString().trim() !== release.version) throw new Error("The downloaded binary does not run on this machine");

    stage = "restart";
    copyFileSync(SERVICE_BIN, PREVIOUS_BIN + ".new");
    chmodSync(PREVIOUS_BIN + ".new", 0o755);
    renameSync(PREVIOUS_BIN + ".new", PREVIOUS_BIN);
    writeJsonAtomic(STATE_FILE, { from: VERSION, to: release.version, at: Date.now(), status: "pending", user } satisfies UpdateRecord);
    renameSync(fresh, SERVICE_BIN);
    // the watcher runs outside our service, so restarting the service does not take it down
    const watcher = Bun.spawnSync({
      cmd: ["systemd-run", "--unit", `hata-update-${Date.now()}`, "--collect", "--quiet", `--setenv=HATA_DATA_DIR=${DATA_DIR}`, PREVIOUS_BIN, "update-watch"],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (watcher.exitCode !== 0) {
      renameSync(PREVIOUS_BIN, SERVICE_BIN);
      rmSync(STATE_FILE, { force: true });
      throw new Error(`Could not start the restart: ${watcher.stderr.toString().trim()}`);
    }
  } finally {
    rmSync(fresh, { force: true });
  }
}

/** Starts the install of the release found by the last check; progress is in `updateStatus().stage` */
export function startUpdate(user: string): string | null {
  if (unsupported()) return "update.unsupported";
  if (stage) return "update.running";
  const release = latest;
  if (!release || compareVersions(release.version, VERSION) <= 0) return "update.none";
  installError = "";
  stage = "download";
  void install(release, user).catch((e) => {
    stage = "";
    installError = e instanceof Error ? e.message : String(e);
    record("system.update.failed", { user, detail: installError.slice(0, 300) });
    console.error(`Update to ${release.version} failed: ${installError}`);
  });
  return null;
}

// --- The watcher (`hata update-watch`, run from the previous binary) --------------------------------

const systemctl = (...args: string[]) => Bun.spawnSync({ cmd: ["systemctl", ...args], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

export async function watchUpdate(): Promise<number> {
  const started = readRecord();
  if (started?.status !== "pending") return 0;
  systemctl("restart", "hata.service");
  const deadline = Date.now() + CONFIRM_WITHIN_MS;
  while (Date.now() < deadline) {
    await Bun.sleep(1000);
    // parsed by hand: a half-written or missing file must not be "repaired" from here
    try {
      if ((JSON.parse(readFileSync(STATE_FILE, "utf8")) as UpdateRecord).status === "done") return 0;
    } catch {}
  }
  console.error(`Hata ${started.to} did not come up within ${CONFIRM_WITHIN_MS / 1000} s: putting ${started.from} back`);
  if (!existsSync(PREVIOUS_BIN)) return 1;
  copyFileSync(PREVIOUS_BIN, SERVICE_BIN + ".new");
  chmodSync(SERVICE_BIN + ".new", 0o755);
  renameSync(SERVICE_BIN + ".new", SERVICE_BIN);
  writeJsonAtomic(STATE_FILE, { ...started, status: "rolledBack" } satisfies UpdateRecord);
  systemctl("restart", "hata.service");
  return 1;
}
