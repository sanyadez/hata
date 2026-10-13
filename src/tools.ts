/**
 * The programs of the system Hata relies on, in one list (Settings → System programs): what each is
 * for, whether it is installed and in which version, and the button that installs a missing one.
 *
 * Hata installs nothing by itself; every program here belongs to a feature that asks for it where it
 * is needed — this page only shows them all at once. A program is installed the same way as from its
 * feature's page, so whatever that does afterwards (restarting NetworkManager, setting Samba up) happens
 * here too.
 *
 * Pure and tested: reading a version out of what a program prints.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Job } from "./apps";
import { settings } from "./config";
import { installTool } from "./disks";
import { dockerInfo } from "./docker";
import { DOCKER_INSTALL_COMMAND, installDocker } from "./dockerinstall";
import { parseFstab, pools } from "./mounting";
import { record } from "./activity";
import { bus } from "./bus";
import { afterPackage, networkReport, type Nic } from "./network";
import { installCommand, installPackage, PATH, removeCommand, removePackages, run } from "./packages";
import { installSamba } from "./shares";

interface Spec {
  id: string;
  /** What people call it */
  name: string;
  /** The system package, as Debian names it */
  package: string;
  /** The program whose presence says the package is installed */
  bin: string;
  /** How the program is asked for its version */
  version: string[];
  /** The page of the feature that uses it */
  page: string;
  /** Part of the system itself, used by more than Hata: shown, never removed from here */
  base?: true;
  /** Every package that came with it, for taking it away whole */
  family?: string[];
}

const SPECS: Spec[] = [
  { id: "docker", name: "Docker Engine", package: "docker-ce", bin: "docker", version: ["docker", "--version"], page: "#/store", family: ["docker-ce", "docker-ce-cli", "containerd.io", "docker-buildx-plugin", "docker-compose-plugin", "docker-ce-rootless-extras", "docker-model-plugin", "docker.io", "docker-compose-v2"] },
  { id: "samba", name: "Samba", package: "samba", bin: "smbd", version: ["smbd", "--version"], page: "#/settings/shares" },
  { id: "smartmontools", name: "smartmontools", package: "smartmontools", bin: "smartctl", version: ["smartctl", "--version"], page: "#/settings/storage" },
  { id: "fdisk", name: "fdisk", package: "fdisk", bin: "sfdisk", version: ["sfdisk", "--version"], page: "#/settings/storage", base: true },
  { id: "e2fsprogs", name: "e2fsprogs", package: "e2fsprogs", bin: "mkfs.ext4", version: ["mkfs.ext4", "-V"], page: "#/settings/storage", base: true },
  { id: "dosfstools", name: "dosfstools", package: "dosfstools", bin: "mkfs.fat", version: ["mkfs.fat", "--help"], page: "#/settings/storage" },
  { id: "exfatprogs", name: "exfatprogs", package: "exfatprogs", bin: "mkfs.exfat", version: ["mkfs.exfat", "-V"], page: "#/settings/storage" },
  { id: "ntfs-3g", name: "ntfs-3g", package: "ntfs-3g", bin: "ntfs-3g", version: ["ntfs-3g", "--version"], page: "#/settings/storage" },
  { id: "mergerfs", name: "mergerfs", package: "mergerfs", bin: "mergerfs", version: ["mergerfs", "--version"], page: "#/settings/storage" },
  { id: "snapraid", name: "SnapRAID", package: "snapraid", bin: "snapraid", version: ["snapraid", "--version"], page: "#/settings/storage" },
  { id: "network-manager", name: "NetworkManager", package: "network-manager", bin: "nmcli", version: ["nmcli", "--version"], page: "#/settings/network" },
  { id: "wpasupplicant", name: "wpa_supplicant", package: "wpasupplicant", bin: "wpa_supplicant", version: ["wpa_supplicant", "-v"], page: "#/settings/network" },
  { id: "dnsmasq-base", name: "dnsmasq", package: "dnsmasq-base", bin: "dnsmasq", version: ["dnsmasq", "--version"], page: "#/settings/network" },
  { id: "openssh-client", name: "OpenSSH client", package: "openssh-client", bin: "sftp", version: ["ssh", "-V"], page: "#/backups", base: true },
];

export interface Tool {
  id: string;
  name: string;
  package: string;
  state: "installed" | "missing";
  /** The system does the same by itself (the kernel reads NTFS): said as a fact, the choice is the person's */
  builtIn: boolean;
  version: string;
  /** The command the button runs; "" — the package manager of this system is not one Hata knows */
  install: string;
  page: string;
  /** Something of Hata's is set up on top of it right now; null — not told */
  used: boolean | null;
  /** The command the "Remove" button runs; "" — it is not offered */
  remove: string;
  /**
   * Why it cannot be removed now: base — part of the system; a name — what of Hata's has to be turned
   * off first (shares, merged, array, network, wifi, hotspot, ntfs); "" — it can.
   */
  holds: string;
}

/** The version in what a program prints about itself: the first thing that looks like one; "" — none */
export function versionOf(text: string): string {
  const m = /(?:^|[\s,v(_])v?(\d+(?:\.\d+)+(?:[-+~.:\w]*\w)?)/m.exec(text);
  return m ? m[1]!.replace(/[,;)]+$/, "") : "";
}

const has = (bin: string): boolean => !!Bun.which(bin, { PATH });

async function versionFor(spec: Spec): Promise<string> {
  // the package's own version is the surest; a program built without one prints "vnone"
  if (spec.id !== "docker" && has("dpkg-query")) {
    const asked = await run(["dpkg-query", "-W", "-f=${Version}", spec.package], 5000);
    if (asked.code === 0 && asked.out.trim()) return asked.out.trim().replace(/^\d+:/, "");
  }
  const said = await run(spec.version, 5000);
  return versionOf(said.out + "\n" + said.err);
}

/** The kernel of this machine opens NTFS without help */
async function kernelReadsNtfs(): Promise<boolean> {
  return existsSync("/sys/module/ntfs3") || (await run(["modinfo", "-n", "ntfs3"], 5000)).code === 0;
}

function usedNow(id: string, docker: boolean): boolean | null {
  if (id === "docker") return docker;
  if (id === "samba") return settings.shares.length > 0;
  if (id === "snapraid") return settings.snapraid.parity !== "";
  if (id === "mergerfs") {
    try {
      return Object.keys(pools(parseFstab(readFileSync("/etc/fstab", "utf8")))).length > 0;
    } catch {
      return false;
    }
  }
  return null;
}

/** The packages of a program that this system really has, for the command that removes them */
async function packagesOf(spec: Spec): Promise<string[]> {
  const all = spec.family ?? [spec.package];
  if (!has("dpkg-query")) return spec.family ? all.slice(0, 5) : all;
  const found: string[] = [];
  for (const pkg of all) if (/install ok installed/.test((await run(["dpkg-query", "-W", "-f=${Status}", pkg], 5000)).out)) found.push(pkg);
  return found;
}

/** What of Hata's stands on a program right now, so that taking it away would break it */
function holdsOf(id: string, nics: Nic[]): string {
  if (id === "samba" && settings.shares.length > 0) return "shares";
  if (id === "snapraid" && settings.snapraid.parity !== "") return "array";
  if (id === "mergerfs" && usedNow("mergerfs", false)) return "merged";
  // an interface NetworkManager gave its address to goes down with it — and may be the way to this page
  if (id === "network-manager" && nics.some((nic) => nic.manager === "nm" && nic.addresses.length > 0)) return "network";
  if (id === "wpasupplicant" && nics.some((nic) => nic.wifi && (nic.wifi.ssid || nic.wifi.hotspot))) return "wifi";
  if (id === "dnsmasq-base" && nics.some((nic) => nic.shares !== null || nic.wifi?.hotspot)) return "hotspot";
  if (id === "ntfs-3g" && /\sfuseblk\s/.test(readText("/proc/mounts"))) return "ntfs";
  return "";
}

const readText = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

export async function toolsReport(): Promise<Tool[]> {
  const docker = await dockerInfo();
  const ntfs = await kernelReadsNtfs();
  const nics = (await networkReport().catch(() => null))?.nics ?? [];
  return Promise.all(
    SPECS.map(async (spec) => {
      const installed = has(spec.bin);
      let version = installed ? await versionFor(spec) : "";
      if (spec.id === "docker" && docker.compose) version = `${docker.version ?? version} · compose ${docker.compose}`;
      return {
        id: spec.id,
        name: spec.name,
        package: spec.package,
        state: installed ? ("installed" as const) : ("missing" as const),
        builtIn: spec.id === "ntfs-3g" && ntfs,
        version,
        install: spec.id === "docker" ? DOCKER_INSTALL_COMMAND : installCommand(spec.package),
        page: spec.page,
        used: installed ? usedNow(spec.id, docker.available) : null,
        remove: installed && !spec.base ? removeCommand(await packagesOf(spec)) : "",
        holds: !installed ? "" : spec.base ? "base" : holdsOf(spec.id, nics),
      };
    }),
  );
}

/**
 * Installs one of the programs, the way its own page would. Docker's installer runs as a job with a
 * log; the rest answer when they are done — a message when it failed, null when it worked.
 */
export async function installOne(id: string, user: string): Promise<{ job: Job } | { error: string | null }> {
  const spec = SPECS.find((s) => s.id === id);
  if (!spec) return { error: "not a program Hata installs" };
  if (spec.id === "docker") return { job: installDocker(user) };
  if (spec.id === "smartmontools") return { error: await installTool() };
  if (spec.id === "samba") {
    try {
      await installSamba();
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  const error = await installPackage(spec.package);
  if (!error) await afterPackage(spec.package);
  return { error };
}

/**
 * Removes one of the programs: the package goes, its settings and data stay (Docker's images, volumes
 * and the apps' data too). Refused for what is part of the system, and while something of Hata's
 * stands on it. Returns a code of `error.tools.*`, a message of the package manager, or null.
 */
export async function removeOne(id: string, user: string): Promise<{ code: string; message?: string } | null> {
  const spec = SPECS.find((s) => s.id === id);
  const tool = spec && (await toolsReport()).find((item) => item.id === id);
  if (!spec || !tool || tool.state !== "installed") return { code: "tools.notInstalled" };
  if (tool.holds) return { code: "tools.holds." + tool.holds };
  const packages = await packagesOf(spec);
  if (!tool.remove || !packages.length) return { code: "tools.notPackage" };
  const failed = await removePackages(packages);
  if (failed) return { code: "tools.removeFailed", message: failed };
  record("system.tool.removed", { user, detail: spec.name });
  bus.publish("apps");
  bus.publish("disks");
  return null;
}
