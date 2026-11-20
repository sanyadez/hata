import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { appParts, appText } from "./uiparts";

const OTHERS = ["terminal.js", "screen.js", "sw.js", "link.js"];
const scripts = (): [string, string][] => [["app/*", appText()], ...OTHERS.map((file): [string, string] => [file, readFileSync(`${import.meta.dir}/../src/ui/${file}`, "utf8")])];

/**
 * A name declared twice at the top of a page's script is a SyntaxError in the browser — the whole page
 * stays blank — while Bun runs and bundles the file without a word. The scripts keep their top-level
 * declarations at the start of a line, so the names are read from there.
 */
test("no top-level name of the page's scripts is declared twice", async () => {
  // the parts of the main script share one scope: a name in two of them is declared twice too
  for (const [file, text] of scripts()) {
    const names = [...text.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
    const twice = names.filter((name, i) => names.indexOf(name) !== i);
    expect({ file, twice }).toEqual({ file, twice: [] });
  }
});

/** The scripts are served as text, so neither a run nor a build ever parses them: a slip shows only as a blank page */
test("the page's scripts parse", async () => {
  const transpiler = new Bun.Transpiler({ loader: "js" });
  for (const part of appParts()) expect(() => transpiler.transformSync(readFileSync(`${import.meta.dir}/../src/ui/app/${part}`, "utf8"))).not.toThrow();
  for (const [, text] of scripts().slice(1)) expect(() => transpiler.transformSync(text)).not.toThrow();
});

/** A name called at the top of a function body and declared nowhere is an error only when that page opens */
test("what the pages' main script calls by a plain name exists", async () => {
  const text = appText();
  const declared = new Set([...text.matchAll(/(?:function\*?|const|let|class|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!));
  for (const m of text.matchAll(/[({\[,]\s*([a-z]\w*)\s*:\s*(?=\()/g)) declared.add(m[1]!);
  for (const m of text.matchAll(/[(,]\s*([A-Za-z_$][\w$]*)\s*(?=[,)=])/g)) declared.add(m[1]!);
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]!);
  for (const m of text.matchAll(/\{\s*([^{}]*?)\s*\}\s*(?:=|\)\s*=>)/g)) for (const n of m[1]!.split(",")) declared.add(n.split(":").pop()!.trim().split(" ")[0]!);
  for (const m of text.matchAll(/\[\s*([^\[\]]*?)\s*\]\s*(?:=|of)/g)) for (const n of m[1]!.split(",")) declared.add(n.trim());
  const builtIn = new Set(Object.getOwnPropertyNames(globalThis).concat(["if", "for", "while", "switch", "catch", "return", "function", "typeof", "await", "import", "super", "confirm", "matchMedia", "requestAnimationFrame", "getComputedStyle", "alert", "prompt", "cancelAnimationFrame", "scrollTo", "constructor", "EventSource", "MutationObserver", "getSelection", "scrollBy", "XMLHttpRequest", "ResizeObserver", "FileReader", "IntersectionObserver", "MouseEvent", "createImageBitmap", "RTCPeerConnection", "MediaStream"]));
  // what stands after a dot, in a string or in a comment is not called by a plain name
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/`(?:[^`\\]|\\.)*`/g, '""').replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, '""');
  const called = new Set([...code.matchAll(/(?<![.\w$])([a-zA-Z_$][\w$]*)\(/g)].map((m) => m[1]!));
  expect([...called].filter((n) => !declared.has(n) && !builtIn.has(n))).toEqual([]);
});

/** The page loads every part, in the order of their numbers, and the server serves each of them */
test("the parts of the main script are loaded in order and served", () => {
  const html = readFileSync(`${import.meta.dir}/../src/ui/index.html`, "utf8");
  expect([...html.matchAll(/<script defer src="\/app\/([^"]+)"><\/script>/g)].map((m) => m[1])).toEqual(appParts());
  const server = readFileSync(`${import.meta.dir}/../src/server.ts`, "utf8");
  for (const part of appParts()) expect(server).toContain(`"/app/${part}"`);
  // each part runs in strict mode, as the module it once was did
  for (const part of appParts()) expect(readFileSync(`${import.meta.dir}/../src/ui/app/${part}`, "utf8")).toMatch(/^(\/\/.*\n)*"use strict";/);
});
