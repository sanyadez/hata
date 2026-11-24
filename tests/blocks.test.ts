/**
 * The page is made of the design system's blocks (01-core.js: uiCard, uiRow, uiTable, uiState, uiNotice …), not of
 * markup of its own. What was drawn by hand before the blocks is counted here part by part, and the count may only
 * go down: a new card, row or mark is made with a block. When a part is moved onto the blocks, lower its numbers.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { APP_DIR, appParts } from "./uiparts";

const KINDS: Record<string, RegExp> = {
  // a card put together by hand instead of uiCard
  card: /h\(\s*"(?:section|div|form|p)",\s*\{[^}]*class: "card(?: [^"]*)?"/g,
  // a row of a list or a pair of facts by hand instead of uiRow / uiFacts / uiSetting
  row: /class: "(?:tool|kv|hidden-item|snapshot|pve-row|bt-found-row|music-row)"/g,
  // a state, a chip, an icon in a frame or a banner by hand instead of uiState / uiTag / uiLead / uiNotice
  mark: /class: "(?:chip|state|badge-icon|banner)(?: [^"]*)?"/g,
};

/** What is left of the hand-made, part by part (2026-11-24). Only ever lowered. */
const LEFT: Record<string, Record<string, number>> = {
  "01-core.js": { card: 2, row: 1, mark: 1 },
  "02-home.js": { card: 0, row: 0, mark: 1 },
  "03-app.js": { card: 7, row: 0, mark: 1 },
  "04-machines.js": { card: 9, row: 1, mark: 7 },
  "05-house.js": { card: 16, row: 2, mark: 7 },
  "06-proxmox.js": { card: 5, row: 1, mark: 7 },
  "07-machine.js": { card: 13, row: 2, mark: 5 },
  "08-work.js": { card: 1, row: 0, mark: 0 },
  "09-backups.js": { card: 4, row: 1, mark: 0 },
  "10-files.js": { card: 7, row: 0, mark: 5 },
  "11-settings.js": { card: 6, row: 0, mark: 11 },
  "12-tv.js": { card: 19, row: 5, mark: 19 },
  "13-network.js": { card: 9, row: 5, mark: 20 },
  "14-domains.js": { card: 7, row: 0, mark: 1 },
  "15-storage.js": { card: 2, row: 8, mark: 27 },
  "16-people.js": { card: 7, row: 0, mark: 7 },
  "17-start.js": { card: 0, row: 0, mark: 1 },
};

test("no part draws more cards, rows or marks by hand than it did", () => {
  const over: string[] = [];
  for (const part of appParts()) {
    const text = readFileSync(`${APP_DIR}/${part}`, "utf8");
    for (const [kind, re] of Object.entries(KINDS)) {
      const n = (text.match(re) ?? []).length;
      const left = LEFT[part]?.[kind] ?? 0;
      if (n > left) over.push(`${part}: ${n} ${kind}s drawn by hand, ${left} allowed — make it with the blocks of 01-core.js`);
    }
  }
  expect(over).toEqual([]);
});
