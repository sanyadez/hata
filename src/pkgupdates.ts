/**
 * Newer versions of the system's own packages: asking the package manager which installed packages
 * have one, and installing them. Shared by Hata and the client of a machine, so it has no side effects
 * and imports nothing of Hata's state.
 *
 * The package lists are refreshed first (`apt-get update`) — that downloads lists, never a package.
 * What is offered is what the update itself would install (`apt-get -s upgrade --with-new-pkgs`):
 * packages that would have to remove others are held back by apt and not offered.
 *
 * The update runs as a unit of its own under systemd when it can: Docker's or a library's package may
 * restart services, Hata's own among them, and a package manager killed half-way leaves the system
 * broken. Its output goes to a file that is read as it grows, its exit code to another.
 *
 * Pure and tested: reading what apt and dnf print.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATH, pieces, run, runLogged } from "./packages";

export interface Upgradable {
  name: string;
  /** The installed version; "" — the package is new, pulled in by another one */
  from: string;
  to: string;
  /** It comes from the distribution's security updates */
  security: boolean;
}

export interface PackageUpdates {
  /** The package manager asked: apt-get, dnf; "" — this system has none Hata knows */
  manager: string;
  /** When the lists were last checked; 0 — never */
  at: number;
  list: Upgradable[];
  /** The system asks to be restarted after an update (a new kernel, a new C library) */
  reboot: boolean;
  /** What went wrong at the last check; "" — nothing */
  error: string;
  /** The command that installs them all, as shown next to the button */
  command: string;
}

/**
 * The packages `apt-get -s upgrade` would install:
 * `Inst libc6 [2.41-12] (2.41-12+deb13u1 Debian:13.2/stable, Debian-Security:13/stable-security [amd64])`
 */
export function parseAptSimulation(text: string): Upgradable[] {
  const out: Upgradable[] = [];
  for (const line of text.split("\n")) {
    const m = /^Inst (\S+)(?: \[([^\]]*)\])? \((\S+) ([^)]*)\)/.exec(line);
    if (m) out.push({ name: m[1]!, from: m[2] ?? "", to: m[3]!, security: /security/i.test(m[4]!) });
  }
  return out;
}

/** What `dnf -q check-update` lists: `bash.x86_64   5.2.26-3.fc40   updates` (the installed version is not said) */
export function parseDnfCheck(text: string): Upgradable[] {
  const out: Upgradable[] = [];
  for (const line of text.split("\n")) {
    // a blank line ends the list; "Obsoleting Packages" follows it
    if (/^Obsoleting/i.test(line)) break;
    const m = /^(\S+)\.([\w-]+)\s+(\S+)\s+(\S+)\s*$/.exec(line);
    if (m) out.push({ name: m[1]!, from: "", to: m[3]!, security: false });
  }
  return out;
}

const APT_OPTIONS = ["-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold", "-o", "DPkg::Lock::Timeout=120"];

const managerOf = (): string => (Bun.which("apt-get", { PATH }) ? "apt-get" : Bun.which("dnf", { PATH }) ? "dnf" : "");

/** The command the "Update" button runs: every package (`packages` empty), or the ones named */
export function upgradeCommand(packages: string[] = []): string[] {
  const manager = managerOf();
  if (manager === "apt-get") return packages.length ? ["apt-get", "-y", ...APT_OPTIONS, "install", "--only-upgrade", ...packages] : ["apt-get", "-y", ...APT_OPTIONS, "upgrade", "--with-new-pkgs"];
  if (manager === "dnf") return ["dnf", "-y", "upgrade", ...packages];
  return [];
}

/** The command shown next to the button: without the options that only keep it from asking */
export const shownCommand = (packages: string[] = []): string => {
  const manager = managerOf();
  if (manager === "apt-get") return packages.length ? `apt-get install --only-upgrade ${packages.join(" ")}` : "apt-get upgrade --with-new-pkgs";
  if (manager === "dnf") return ["dnf upgrade", ...packages].join(" ");
  return "";
};

const ENV = { DEBIAN_FRONTEND: "noninteractive", NEEDRESTART_MODE: "l", NEEDRESTART_SUSPEND: "1" };

const lastLines = (text: string): string => text.trim().split("\n").slice(-3).join("\n");

/** Refreshes the lists and asks which packages have a newer version */
export async function checkPackages(): Promise<PackageUpdates> {
  const manager = managerOf();
  const result: PackageUpdates = { manager, at: Date.now(), list: [], reboot: existsSync("/run/reboot-required") || existsSync("/var/run/reboot-required"), error: "", command: shownCommand() };
  if (manager === "apt-get") {
    const fresh = await run(["apt-get", "-q", ...APT_OPTIONS, "update"], 5 * 60_000, ENV);
    // a list that could not be fetched leaves the old one: what it says is still said
    if (fresh.code !== 0) result.error = lastLines(fresh.err || fresh.out) || `apt-get update exited with ${fresh.code}`;
    const asked = await run(["apt-get", "-s", ...APT_OPTIONS, "upgrade", "--with-new-pkgs"], 2 * 60_000, ENV);
    if (asked.code !== 0) result.error = lastLines(asked.err || asked.out) || `apt-get exited with ${asked.code}`;
    else result.list = parseAptSimulation(asked.out);
  } else if (manager === "dnf") {
    const asked = await run(["dnf", "-q", "check-update"], 5 * 60_000);
    // 100 — there are updates, 0 — none
    if (asked.code === 100 || asked.code === 0) result.list = parseDnfCheck(asked.out);
    else result.error = lastLines(asked.err || asked.out) || `dnf exited with ${asked.code}`;
  }
  return result;
}

/**
 * Installs the newer versions — of every package, or of the ones named — and hands over what the
 * package manager prints. Throws with its last words when it fails.
 */
export async function upgradePackages(packages: string[], log: (line: string) => void): Promise<void> {
  if (packages.some((name) => !/^[a-z0-9][a-z0-9+._-]*(:[a-z0-9]+)?$/i.test(name))) throw new Error("Not a package name");
  const cmd = upgradeCommand(packages);
  if (!cmd.length) throw new Error("No known package manager was found.");
  log("$ " + shownCommand(packages));
  const systemd = Bun.which("systemd-run", { PATH }) && existsSync("/run/systemd/system");
  if (!systemd) {
    const done = await runLogged(cmd, log, 60 * 60_000, ENV);
    if (done.code !== 0) throw new Error(lastLines(done.err || done.out) || `${cmd[0]} exited with ${done.code}`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "hata-upgrade-"));
  const out = join(dir, "log");
  try {
    const unit = `hata-upgrade-${Date.now()}`;
    const env = Object.entries({ ...ENV, PATH }).map(([k, v]) => `--setenv=${k}=${v}`);
    const started = await run(["systemd-run", "--unit", unit, "--collect", "--quiet", ...env, "/bin/sh", "-c", '"$@" >"$0" 2>&1; echo $? >"$0.code"', out, ...cmd]);
    if (started.code !== 0) throw new Error(lastLines(started.err) || "systemd-run failed");
    let shown = 0;
    let said: string[] = [];
    const follow = () => {
      let text = "";
      try {
        text = readFileSync(out, "utf8");
      } catch {
        return;
      }
      const cut = text.lastIndexOf("\n");
      if (cut < shown) return;
      for (const piece of pieces(text.slice(shown, cut + 1))) if (!piece.progress) (log(piece.line), said.push(piece.line));
      said = said.slice(-5);
      shown = cut + 1;
    };
    // the unit runs on its own; it is looked at until it has written its exit code
    for (;;) {
      await Bun.sleep(1000);
      follow();
      if (existsSync(out + ".code")) break;
      const state = (await run(["systemctl", "is-active", unit], 5000)).out.trim();
      if (state !== "active" && state !== "activating" && !existsSync(out + ".code")) {
        await Bun.sleep(1000);
        if (!existsSync(out + ".code")) throw new Error(`The update stopped without finishing (${state})`);
      }
    }
    follow();
    const exit = Number(readFileSync(out + ".code", "utf8").trim());
    if (exit !== 0) throw new Error(said.slice(-3).join("\n") || `${cmd[0]} exited with ${exit}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
