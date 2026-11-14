/**
 * Checks the types of the source: `bun run typecheck`.
 *
 * Hata has no packages, and this adds none to it: the compiler and Bun's type declarations are put into a
 * folder outside the repository (kept between runs) and only read from there. Nothing of them reaches
 * the binary. The versions are pinned here and moved by hand.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOOLS = { typescript: "7.0.2", "@types/bun": "1.4.4" };

const root = join(import.meta.dir, "..");
const tag = Object.entries(TOOLS).map(([name, version]) => `${name.replace(/\W/g, "")}-${version}`).join("_");
const home = join(process.env.HATA_TYPECHECK_DIR || join(homedir(), ".cache", "hata-typecheck"), tag);
const tsc = join(home, "node_modules", ".bin", "tsc");

if (!existsSync(tsc)) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "package.json"), JSON.stringify({ name: "hata-typecheck", private: true }));
  const wanted = Object.entries(TOOLS).map(([name, version]) => `${name}@${version}`);
  const add = Bun.spawnSync([process.execPath, "add", "--exact", "--ignore-scripts", ...wanted], { cwd: home, stdio: ["ignore", "inherit", "inherit"] });
  if (add.exitCode !== 0) process.exit(add.exitCode ?? 1);
}

const run = Bun.spawnSync([tsc, "-p", join(root, "tsconfig.json"), "--typeRoots", join(home, "node_modules", "@types")], { cwd: root, stdio: ["ignore", "inherit", "inherit"] });
if (run.exitCode === 0) console.log("Types are fine.");
process.exit(run.exitCode ?? 1);
