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

/**
 * What a program prints, cut into lines the way a terminal would show them: a counter that rewrites
 * itself (`12/3727`, `34.5%`) is `progress`, the rest are lines to keep.
 */
export function pieces(text: string): { line: string; progress: boolean }[] {
  return text
    .split(/[\r\n\x08\x01\x02]+/)
    .map((piece) => piece.replace(/[\x00-\x1f\x7f]/g, "").trimEnd())
    .filter((piece) => piece.trim())
    .map((line) => ({ line, progress: /^\s*\d+\/\d+$/.test(line) || /\d(\.\d+)?%\s*$/.test(line) }));
}

/**
 * Runs a system program to its end and hands over what it prints as it comes; a counter is passed on
 * every couple of seconds. `reword` may put a line in other words, or drop it (null).
 */
export async function runLogged(cmd: string[], log: (line: string) => void, timeout = 30_000, env: Record<string, string> = {}, reword: (line: string) => string | null = (line) => line): Promise<Ran> {
  let proc;
  try {
    proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout, env: { ...process.env, PATH, LC_ALL: "C", ...env } });
  } catch (e) {
    return { code: -1, out: "", err: e instanceof Error ? e.message : String(e) };
  }
  let told = 0;
  const read = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
    const kept: string[] = [];
    const decoder = new TextDecoder();
    let rest = "";
    const take = (text: string) => {
      for (const piece of pieces(text)) {
        const line = reword(piece.line);
        if (line === null) continue;
        if (piece.progress || line !== piece.line) {
          // a counter: said now and then, never kept
          if (Date.now() - told < 2000) continue;
          told = Date.now();
          log("  " + line.trim());
        } else {
          kept.push(line);
          if (kept.length > 400) kept.shift();
          log(line);
        }
      }
    };
    for await (const chunk of stream) {
      rest += decoder.decode(chunk, { stream: true });
      // the last piece may be half a line still
      const cut = Math.max(rest.lastIndexOf("\n"), rest.lastIndexOf("\r"), rest.lastIndexOf("\b"));
      if (cut < 0) continue;
      take(rest.slice(0, cut + 1));
      rest = rest.slice(cut + 1);
    }
    take(rest);
    return kept.join("\n");
  };
  const [out, err, code] = await Promise.all([read(proc.stdout), read(proc.stderr), proc.exited]);
  return { code, out, err };
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

/** The package manager of this system, as the name of its program; "" when it is not one we know */
export const packageManager = (): string => installer()?.[0] ?? "";

/** The command the "Install" button runs, shown next to it; empty when this system's package manager is not one we know */
export const installCommand = (pkg: string): string => {
  const found = installer();
  return found ? [found[0], ...found[1], pkg].join(" ") : "";
};

/** Installs a package with the system's package manager; returns what went wrong, or null */
/** How each package manager takes a package away, leaving its settings and what depends on nothing else */
const REMOVERS: Record<string, string[]> = {
  "apt-get": ["remove", "-y"],
  dnf: ["remove", "-y"],
  yum: ["remove", "-y"],
  zypper: ["--non-interactive", "remove"],
  pacman: ["-R", "--noconfirm"],
  apk: ["del"],
};

/** The command the "Remove" button runs; empty when this system's package manager is not one we know */
export const removeCommand = (pkgs: string[]): string => {
  const manager = packageManager();
  return manager && pkgs.length ? [manager, ...REMOVERS[manager]!, ...pkgs].join(" ") : "";
};

/** Removes packages; null when it worked, otherwise what the package manager said */
export async function removePackages(pkgs: string[]): Promise<string | null> {
  const manager = packageManager();
  if (!manager || !pkgs.length) return "No known package manager was found.";
  const result = await run([Bun.which(manager, { PATH })!, ...REMOVERS[manager]!, ...pkgs], 5 * 60_000, { DEBIAN_FRONTEND: "noninteractive" });
  return result.code === 0 ? null : (result.err.trim() || result.out.trim()).split("\n").slice(-3).join("\n") || `${manager} exited with ${result.code}`;
}

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
