/**
 * The page is made of the design system's blocks (01-core.js: pageHead, uiCard, uiRow, uiTable, uiField, uiNotice …),
 * not of markup of its own. Every class a part writes must be a block's (`ui-…`) or one of the few utilities of the
 * system below (type, tone, layout of a column, the kinds of a button). What is left of the hand-made is counted
 * part by part and may only go down — to nothing: a new piece that no block fits is a new block in 01-core.js.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { APP_DIR, appParts } from "./uiparts";

/** The utilities of the system: words (small, muted, mono, error, strong, num), a line cut or kept whole, a column, the kinds of a button */
export const UTILITIES = new Set(
  "small muted mono clip grow stack stack-s wrap error strong num center sr-only btn primary danger ghost quiet icon-btn with-icon square link danger-text short wide whole".split(" "),
);

/** The classes of a part that are neither a block's nor a utility */
export function ownClasses(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/(?:class|cls): "([^"]*)"/g)) found.push(...m[1].split(/\s+/));
  for (const m of text.matchAll(/(?:class|cls): `([^`]*)`/g)) found.push(...m[1].replace(/\$\{[^}]*\}/g, " ").split(/\s+/));
  return found.filter((c) => c && !c.startsWith("ui-") && !UTILITIES.has(c));
}

/** What is left of the hand-made, part by part (2026-11-24). Only ever lowered, to 0. */
const LEFT: Record<string, number> = {
  "01-core.js": 84,
  "02-home.js": 122,
  "03-app.js": 81,
  "04-machines.js": 104,
  "05-house.js": 137,
  "06-proxmox.js": 101,
  "07-machine.js": 81,
  "08-work.js": 66,
  "09-backups.js": 40,
  "10-files.js": 147,
  "11-settings.js": 114,
  "12-tv.js": 340,
  "13-network.js": 109,
  "14-domains.js": 54,
  "15-storage.js": 181,
  "16-people.js": 172,
  "17-start.js": 1,
};

test("no part draws more of its own than it did", () => {
  const over: string[] = [];
  for (const part of appParts()) {
    const own = ownClasses(readFileSync(`${APP_DIR}/${part}`, "utf8"));
    const left = LEFT[part] ?? 0;
    if (own.length > left) over.push(`${part}: ${own.length} classes of its own, ${left} allowed — make it with the blocks of 01-core.js`);
  }
  expect(over).toEqual([]);
});
