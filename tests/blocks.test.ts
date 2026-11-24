/**
 * The page is made of the design system's blocks (01-core.js: pageHead, uiCard, uiRow, uiTable, uiField, uiNotice …),
 * not of markup of its own. Every class a part writes must be a block's (`ui-…`) or one of the few utilities of the
 * system below (type, tone, layout of a column, the kinds of a button). None is left (2026-11-24): a new piece that no
 * block fits is a new block in 01-core.js, made general and named for what it is.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { APP_DIR, appParts } from "./uiparts";

import { UTILITIES } from "./uiclasses";

export { UTILITIES };

/** The classes of a part that are neither a block's nor a utility */
export function ownClasses(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/(?:class|cls): "([^"]*)"/g)) found.push(...m[1].split(/\s+/));
  for (const m of text.matchAll(/(?:class|cls): `([^`]*)`/g)) found.push(...m[1].replace(/\$\{[^}]*\}/g, " ").split(/\s+/));
  // classes put on or asked of an element while the page runs, and the variants of an icon
  for (const m of text.matchAll(/classList\.(?:add|toggle|remove|replace|contains)\(\s*"([^"]*)"/g)) found.push(m[1]);
  for (const m of text.matchAll(/\.className\s*=\s*"([^"]*)"/g)) found.push(...m[1].split(/\s+/));
  for (const m of text.matchAll(/\bicon\(\s*[^,()]+,\s*"([^"]*)"/g)) found.push(...m[1].split(/\s+/));
  return found.filter((c) => c && !c.startsWith("ui-") && !UTILITIES.has(c));
}

test("no part draws anything of its own", () => {
  const over: string[] = [];
  for (const part of appParts()) {
    const own = ownClasses(readFileSync(`${APP_DIR}/${part}`, "utf8"));
    if (own.length) over.push(`${part}: ${[...new Set(own)].join(", ")} — make it with the blocks of 01-core.js`);
  }
  expect(over).toEqual([]);
});
