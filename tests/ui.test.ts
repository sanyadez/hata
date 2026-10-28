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
