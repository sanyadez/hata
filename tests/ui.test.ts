import { expect, test } from "bun:test";

/**
 * A name declared twice at the top of a page's script is a SyntaxError in the browser — the whole page
 * stays blank — while Bun runs and bundles the file without a word. The scripts keep their top-level
 * declarations at the start of a line, so the names are read from there.
 */
test("no top-level name of the page's scripts is declared twice", async () => {
  for (const file of ["app.js", "terminal.js", "screen.js", "sw.js"]) {
    const text = await Bun.file(`${import.meta.dir}/../src/ui/${file}`).text();
    const names = [...text.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
    const twice = names.filter((name, i) => names.indexOf(name) !== i);
    expect({ file, twice }).toEqual({ file, twice: [] });
  }
});

/** The scripts are served as text, so neither a run nor a build ever parses them: a slip shows only as a blank page */
test("the page's scripts parse", async () => {
  const transpiler = new Bun.Transpiler({ loader: "js" });
  for (const file of ["app.js", "terminal.js", "screen.js", "sw.js"]) {
    const text = await Bun.file(`${import.meta.dir}/../src/ui/${file}`).text();
    expect(() => transpiler.transformSync(text)).not.toThrow();
  }
});

/** A name called at the top of a function body and declared nowhere is an error only when that page opens */
test("what the pages' main script calls by a plain name exists", async () => {
  const text = await Bun.file(`${import.meta.dir}/../src/ui/app.js`).text();
  const declared = new Set([...text.matchAll(/(?:function\*?|const|let|class|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!));
  for (const m of text.matchAll(/[({\[,]\s*([a-z]\w*)\s*:\s*(?=\()/g)) declared.add(m[1]!);
  for (const m of text.matchAll(/[(,]\s*([A-Za-z_$][\w$]*)\s*(?=[,)=])/g)) declared.add(m[1]!);
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]!);
  for (const m of text.matchAll(/\{\s*([^{}]*?)\s*\}\s*(?:=|\)\s*=>)/g)) for (const n of m[1]!.split(",")) declared.add(n.split(":").pop()!.trim().split(" ")[0]!);
  for (const m of text.matchAll(/\[\s*([^\[\]]*?)\s*\]\s*(?:=|of)/g)) for (const n of m[1]!.split(",")) declared.add(n.trim());
  const builtIn = new Set(Object.getOwnPropertyNames(globalThis).concat(["if", "for", "while", "switch", "catch", "return", "function", "typeof", "await", "import", "super", "confirm", "matchMedia", "requestAnimationFrame", "getComputedStyle", "alert", "prompt", "cancelAnimationFrame", "scrollTo", "constructor", "EventSource", "MutationObserver", "getSelection", "scrollBy", "XMLHttpRequest", "ResizeObserver", "FileReader", "IntersectionObserver", "MouseEvent"]));
  // what stands after a dot, in a string or in a comment is not called by a plain name
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/`(?:[^`\\]|\\.)*`/g, '""').replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, '""');
  const called = new Set([...code.matchAll(/(?<![.\w$])([a-zA-Z_$][\w$]*)\(/g)].map((m) => m[1]!));
  expect([...called].filter((n) => !declared.has(n) && !builtIn.has(n))).toEqual([]);
});
