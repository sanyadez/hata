/**
 * The page is made of the design system's blocks (01-core.js: pageHead, uiCard, uiRow, uiTable, uiField, uiNotice …),
 * not of markup of its own. Every class a part writes must be a block's (`ui-…`) or one of the few utilities of the
 * system below (type, tone, layout of a column, the kinds of a button). None is left (2026-11-24): a new piece that no
 * block fits is a new block in 01-core.js, made general and named for what it is.
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


test("no part draws anything of its own", () => {
  const over: string[] = [];
  for (const part of appParts()) {
    // 01-core.js is the system itself: the blocks and the frame of the page (the top bar, windows, menus, toasts)
    if (part === "01-core.js") continue;
    const own = ownClasses(readFileSync(`${APP_DIR}/${part}`, "utf8"));
    if (own.length) over.push(`${part}: ${[...new Set(own)].join(", ")} — make it with the blocks of 01-core.js`);
  }
  expect(over).toEqual([]);
});
