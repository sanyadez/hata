/**
 * Builds the single-file binaries into dist/: `bun run build` — every target, `bun run build x64` — one.
 * The web UI and translations are imported by the server as text, so they end up inside the binary.
 */
import { mkdirSync } from "node:fs";

const TARGETS: Record<string, string> = {
  x64: "bun-linux-x64",
  arm64: "bun-linux-arm64",
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(TARGETS);
mkdirSync("dist", { recursive: true });

for (const name of names) {
  const target = TARGETS[name];
  if (!target) {
    console.error(`Unknown target "${name}". Known: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(2);
  }
  const outfile = `dist/hata-linux-${name}`;
  const proc = Bun.spawnSync({
    cmd: ["bun", "build", "--compile", "--minify-syntax", `--target=${target}`, "src/index.ts", "--outfile", outfile],
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
  console.log(`${outfile}: ${(Bun.file(outfile).size / 1024 / 1024).toFixed(1)} MB`);
}
