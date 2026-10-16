/**
 * Builds the single-file binaries into dist/: `bun run build` — every target, `bun run build x64` — one.
 * The web UI and translations are imported by the server as text, so they end up inside the binary.
 * Each target gets two: Hata itself and the client of the machines it looks after (`src/client.ts`).
 *
 * A pre-release is built with `HATA_BUILD_VERSION=0.22.0-beta.1`: the binaries say that version, while
 * `src/version.ts` keeps the one being prepared (`0.22.0`), so a beta needs no commit of its own.
 */
import { mkdirSync } from "node:fs";
import { VERSION } from "../src/version";

const TARGETS: Record<string, string> = {
  x64: "bun-linux-x64",
  arm64: "bun-linux-arm64",
};

const build = process.env.HATA_BUILD_VERSION ?? "";
if (build && !(build.startsWith(VERSION + "-") && /^[0-9A-Za-z.-]+$/.test(build))) {
  console.error(`HATA_BUILD_VERSION must be ${VERSION}-<suffix>, the version in src/version.ts with a suffix`);
  process.exit(2);
}
const define = build ? ["--define", `HATA_BUILD_VERSION=${JSON.stringify(build)}`] : [];

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(TARGETS);
mkdirSync("dist", { recursive: true });

for (const name of names) {
  const target = TARGETS[name];
  if (!target) {
    console.error(`Unknown target "${name}". Known: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(2);
  }
  for (const [entry, outfile] of [["src/index.ts", `dist/hata-linux-${name}`], ["src/client.ts", `dist/hata-client-linux-${name}`]]) {
    const proc = Bun.spawnSync({
      cmd: ["bun", "build", "--compile", "--minify-syntax", `--target=${target}`, ...define, entry!, "--outfile", outfile!],
      stdout: "inherit",
      stderr: "inherit",
    });
    if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
    console.log(`${outfile}: ${(Bun.file(outfile!).size / 1024 / 1024).toFixed(1)} MB`);
  }
}
