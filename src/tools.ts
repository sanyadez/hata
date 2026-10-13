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
import { afterPackage } from "./network";
import { installCommand, installPackage, PATH, run } from "./packages";
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
}

const SPECS: Spec[] = [
  { id: "docker", name: "Docker Engine", package: "docker-ce", bin: "docker", version: ["docker", "--version"], page: "#/store" },
  { id: "samba", name: "Samba", package: "samba", bin: "smbd", version: ["smbd", "--version"], page: "#/settings/shares" },
  { id: "smartmontools", name: "smartmontools", package: "smartmontools", bin: "smartctl", version: ["smartctl", "--version"], page: "#/settings/storage" },
  { id: "fdisk", name: "fdisk", package: "fdisk", bin: "sfdisk", version: ["sfdisk", "--version"], page: "#/settings/storage" },
  { id: "e2fsprogs", name: "e2fsprogs", package: "e2fsprogs", bin: "mkfs.ext4", version: ["mkfs.ext4", "-V"], page: "#/settings/storage" },
  { id: "ntfs-3g", name: "ntfs-3g", package: "ntfs-3g", bin: "ntfs-3g", version: ["ntfs-3g", "--version"], page: "#/settings/storage" },
  { id: "mergerfs", name: "mergerfs", package: "mergerfs", bin: "mergerfs", version: ["mergerfs", "--version"], page: "#/settings/storage" },
  { id: "snapraid", name: "SnapRAID", package: "snapraid", bin: "snapraid", version: ["snapraid", "--version"], page: "#/settings/storage" },
  { id: "network-manager", name: "NetworkManager", package: "network-manager", bin: "nmcli", version: ["nmcli", "--version"], page: "#/settings/network" },
  { id: "wpasupplicant", name: "wpa_supplicant", package: "wpasupplicant", bin: "wpa_supplicant", version: ["wpa_supplicant", "-v"], page: "#/settings/network" },
  { id: "dnsmasq-base", name: "dnsmasq", package: "dnsmasq-base", bin: "dnsmasq", version: ["dnsmasq", "--version"], page: "#/settings/network" },
  { id: "openssh-client", name: "OpenSSH client", package: "openssh-client", bin: "sftp", version: ["ssh", "-V"], page: "#/backups" },
];

export interface Tool {
  id: string;
  name: string;
  package: string;
  /** installed; missing; unneeded — this system does without it (the kernel reads NTFS by itself) */
  state: "installed" | "missing" | "unneeded";
  version: string;
  /** The command the button runs; "" — the package manager of this system is not one Hata knows */
  install: string;
  page: string;
  /** Something of Hata's is set up on top of it right now; null — not told */
  used: boolean | null;
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

export async function toolsReport(): Promise<Tool[]> {
  const docker = await dockerInfo();
  const ntfs = await kernelReadsNtfs();
  return Promise.all(
    SPECS.map(async (spec) => {
      const installed = has(spec.bin);
      let version = installed ? await versionFor(spec) : "";
      if (spec.id === "docker" && docker.compose) version = `${docker.version ?? version} · compose ${docker.compose}`;
      return {
        id: spec.id,
        name: spec.name,
        package: spec.package,
        state: installed ? ("installed" as const) : spec.id === "ntfs-3g" && ntfs ? ("unneeded" as const) : ("missing" as const),
        version,
        install: spec.id === "docker" ? DOCKER_INSTALL_COMMAND : installCommand(spec.package),
        page: spec.page,
        used: installed ? usedNow(spec.id, docker.available) : null,
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
