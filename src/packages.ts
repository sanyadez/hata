/**
 * System packages a feature of Hata needs (smartmontools, Samba): which command installs one on this
 * system, and running it. Nothing here is called on Hata's own initiative — only for an "Install"
 * button that says what the package is and shows this very command.
 */
export const PATH = `${process.env.PATH ?? ""}:/usr/sbin:/sbin`;

export interface Ran {
  code: number;
  out: string;
  err: string;
}

/** Runs a system program to its end; `input` is what it reads */
export async function run(cmd: string[], timeout = 30_000, env: Record<string, string> = {}, input?: string): Promise<Ran> {
  try {
    const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe", stdin: input === undefined ? "ignore" : new Blob([input]), timeout, env: { ...process.env, PATH, LC_ALL: "C", ...env } });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, out, err };
  } catch (e) {
    return { code: -1, out: "", err: e instanceof Error ? e.message : String(e) };
  }
}

const INSTALLERS: [string, string[]][] = [
  ["apt-get", ["install", "-y", "--no-install-recommends"]],
  ["dnf", ["install", "-y"]],
  ["yum", ["install", "-y"]],
  ["zypper", ["--non-interactive", "install"]],
  ["pacman", ["-S", "--noconfirm", "--needed"]],
  ["apk", ["add"]],
];

const installer = () => INSTALLERS.find(([manager]) => Bun.which(manager, { PATH }));

/** The command the "Install" button runs, shown next to it; empty when this system's package manager is not one we know */
export const installCommand = (pkg: string): string => {
  const found = installer();
  return found ? [found[0], ...found[1], pkg].join(" ") : "";
};

/** Installs a package with the system's package manager; returns what went wrong, or null */
export async function installPackage(pkg: string): Promise<string | null> {
  const found = installer();
  if (!found) return `No known package manager was found. Install the ${pkg} package by hand.`;
  const [manager, args] = found;
  const bin = Bun.which(manager, { PATH })!;
  const env = { DEBIAN_FRONTEND: "noninteractive" };
  let result = await run([bin, ...args, pkg], 5 * 60_000, env);
  // a package list that was never fetched, or is too old to hold the file
  if (result.code !== 0 && manager === "apt-get") {
    await run([bin, "update"], 3 * 60_000, env);
    result = await run([bin, ...args, pkg], 5 * 60_000, env);
  }
  return result.code === 0 ? null : (result.err.trim() || result.out.trim()).split("\n").slice(-3).join("\n") || `${manager} exited with ${result.code}`;
}
