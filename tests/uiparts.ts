/** The parts of the page's main script (src/ui/app/), in the order the page loads them, and their text together */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const APP_DIR = join(import.meta.dir, "..", "src", "ui", "app");
export const appParts = (): string[] => readdirSync(APP_DIR).filter((name) => /^\d\d-[a-z]+\.js$/.test(name)).sort();
export const appText = (): string => appParts().map((name) => readFileSync(join(APP_DIR, name), "utf8")).join("\n");
