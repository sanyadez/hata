import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The states of the design system, held for the whole style sheet: a hover lives only where there is one
 * (`@media (hover: hover)`), nothing disabled is faded with opacity, the accent never appears on a hover, a hover
 * neither moves nor lifts, and the ring of focus is taken away only where something else shows it.
 */
const css = readFileSync(`${import.meta.dir}/../src/ui/app.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selector: string;
  body: string;
  /** the @-rules it stands in, outermost first */
  within: string[];
}

function rules(text: string, within: string[] = []): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}" && --depth === 0) break;
    }
    const inner = text.slice(open + 1, end);
    const at = prelude.slice(prelude.lastIndexOf(";") + 1).trim();
    if (at.startsWith("@")) out.push(...rules(inner, [...within, at]));
    else out.push({ selector: at, body: inner, within });
    i = end + 1;
  }
  return out;
}

const all = rules(css);
const hoverMedia = (r: Rule) => r.within.some((at) => /^@media\s*\(hover:\s*hover\)/.test(at));

test("the style sheet is read whole", () => {
  expect(all.length).toBeGreaterThan(1500);
});

test("every :hover is inside @media (hover: hover)", () => {
  expect(all.filter((r) => /:hover\b/.test(r.selector) && !hoverMedia(r)).map((r) => r.selector)).toEqual([]);
});

test("nothing disabled is faded with opacity", () => {
  expect(all.filter((r) => /:disabled|\[disabled\]/.test(r.selector) && /(^|[;\s])opacity\s*:/.test(r.body)).map((r) => r.selector)).toEqual([]);
});

test("a hover takes no accent, moves nothing, lifts nothing", () => {
  const bad = all.filter((r) => /:hover\b/.test(r.selector) && !/\.tv-stage\b/.test(r.selector) && (/var\(--accent\)/.test(r.body) || /(^|[;\s])(transform|filter|scale|translate)\s*:(?!\s*none)/.test(r.body) || /box-shadow\s*:(?!\s*none)/.test(r.body)));
  expect(bad.map((r) => r.selector)).toEqual([]);
});

test("the ring of focus is taken away only where something else shows focus", () => {
  // fields (a border and a halo), menu items (a fill), the search boxes whose frame shows it, windows and frames
  const allowed = /input|select|textarea|\.select-btn|menu-item|role="option"|dialog|\.search\b|\.add-find|\.house-search|\.tv-preview/;
  expect(all.filter((r) => /outline\s*:\s*(none|0)\b/.test(r.body) && !allowed.test(r.selector)).map((r) => r.selector)).toEqual([]);
});

test("the current place is never marked with the colour of a hover", () => {
  const current = all.filter((r) => /\.(active|selected|current)\b|\[aria-(selected|current)/.test(r.selector.replace(/:not\([^)]*\)/g, "")) && !/:hover\b/.test(r.selector) && !/\.seg-pill|\.tab\b|\.file-table|tr\./.test(r.selector));
  expect(current.filter((r) => /background(-color)?\s*:\s*var\(--surface-2\)/.test(r.body)).map((r) => r.selector)).toEqual([]);
});
