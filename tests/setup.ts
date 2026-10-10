/** Preload for `bun test` (see bunfig.toml): an isolated state directory per run. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HATA_DATA_DIR = mkdtempSync(join(tmpdir(), "hata-test-"));

// the trash of the file manager looks at every disk of the machine: tests see only what they made
const { world } = await import("../src/trash");
world.mounts = () => [];
