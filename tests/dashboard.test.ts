import { expect, test } from "bun:test";
import { arrange, cleanBlocks, cleanLayout, layoutText, movePath, parseLayoutText, webUrl } from "../src/dashboard";

const link = (title: string, url = "https://example.com/") => ({ type: "link", id: title.toLowerCase(), title, url, icon: "" });

test("a link points to the web and nowhere else", () => {
  expect(webUrl("http://192.168.1.1")).toBe("http://192.168.1.1/");
  expect(webUrl(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "example.com", "", null, 5]) expect(webUrl(bad)).toBe("");
});

test("what does not fit a layout is dropped", () => {
  const layout = cleanLayout({
    groups: [
      { id: "main", title: "  Home   media ", items: [{ type: "app", name: "jellyfin" }, { type: "app", name: "Bad Name" }, link("Router", "http://192.168.1.1"), link("Evil", "javascript:alert(1)"), { type: "files", path: "relative" }, { type: "widget" }, "text"] },
      "not a group",
      { title: "Second", items: "none" },
    ],
  });
  expect(layout.groups.map((g) => g.title)).toEqual(["Home media", "Second"]);
  expect(layout.groups[0]!.items).toEqual([{ type: "app", name: "jellyfin" }, { type: "link", id: "router", title: "Router", url: "http://192.168.1.1/", icon: "" }]);
  expect(layout.groups[1]!.id).toMatch(/^[a-z0-9-]+$/);
  expect(cleanLayout(null).groups).toEqual([]);
  expect(cleanLayout({ groups: {} }).groups).toEqual([]);
});

test("an app is on the dashboard once, ids are unique, a link without a title takes its host", () => {
  const layout = cleanLayout({
    groups: [
      { id: "a", title: "", items: [{ type: "app", name: "memos" }, { type: "folder", id: "a", title: "Tools", items: [{ type: "app", name: "memos" }, { type: "app", name: "gitea" }, { type: "folder", id: "x", items: [] }] }] },
      { id: "a", title: "", items: [{ type: "app", name: "gitea" }, { type: "link", id: "a", url: "https://example.com/x", title: "" }, { type: "folder", id: "empty", title: "Empty", items: [{ type: "app", name: "memos" }] }] },
    ],
  });
  const folder = layout.groups[0]!.items[1]!;
  expect(folder).toMatchObject({ type: "folder", title: "Tools", items: [{ type: "app", name: "gitea" }] });
  // the second group lost the repeated app and the folder that held nothing else
  expect(layout.groups[1]!.items).toHaveLength(1);
  expect(layout.groups[1]!.items[0]).toMatchObject({ type: "link", title: "example.com" });
  const ids = [layout.groups[0]!.id, layout.groups[1]!.id, (folder as { id: string }).id, (layout.groups[1]!.items[0] as { id: string }).id];
  expect(new Set(ids).size).toBe(4);
  expect(ids[0]).toBe("a");
});

test("arranging: what is gone is left out, what is new comes last in the first group", () => {
  const layout = cleanLayout({
    groups: [
      { id: "main", title: "", items: [{ type: "app", name: "gone" }, { type: "app", name: "memos" }, link("Router")] },
      { id: "media", title: "Media", items: [{ type: "folder", id: "f", title: "Video", items: [{ type: "app", name: "jellyfin" }, { type: "app", name: "hidden" }] }, { type: "folder", id: "g", title: "Gone", items: [{ type: "app", name: "gone2" }] }, { type: "files", path: "/DATA/Media" }, { type: "files", path: "/DATA/Unpinned" }] },
    ],
  });
  const seen = arrange(layout, ["jellyfin", "memos", "new"], ["/DATA/Media", "/DATA/Photos"]);
  expect(seen.groups[0]!.items).toEqual([{ type: "app", name: "memos" }, link("Router") as never, { type: "app", name: "new" }, { type: "files", path: "/DATA/Photos" }]);
  expect(seen.groups[1]!.items).toEqual([{ type: "folder", id: "f", title: "Video", items: [{ type: "app", name: "jellyfin" }] }, { type: "files", path: "/DATA/Media" }]);
  // the saved layout is not touched: an app that comes back takes its old place
  expect(layout.groups[0]!.items).toHaveLength(3);
});

test("arranging an empty layout gives one group with everything", () => {
  expect(arrange(cleanLayout(null), ["b", "a"], ["/x"])).toMatchObject({ groups: [{ id: "main", title: "", items: [{ type: "app", name: "b" }, { type: "app", name: "a" }, { type: "files", path: "/x" }] }] });
  // a member sees the links and their own apps
  const layout = cleanLayout({ groups: [{ id: "main", title: "", items: [link("Router"), { type: "files", path: "/DATA" }, { type: "app", name: "private" }] }] });
  expect(arrange(layout, [], []).groups[0]!.items).toEqual([link("Router") as never]);
});

test("a pinned folder keeps its place when it is renamed and leaves when it is removed", () => {
  const layout = cleanLayout({ groups: [{ id: "main", title: "", items: [{ type: "files", path: "/DATA/Media" }, { type: "folder", id: "f", title: "", items: [{ type: "files", path: "/DATA/Media/Films" }, { type: "files", path: "/DATA/Mediator" }] }] }] });
  const renamed = movePath(layout, "/DATA/Media", "/DATA/Video");
  expect(renamed.groups[0]!.items).toEqual([{ type: "files", path: "/DATA/Video" }, { type: "folder", id: "f", title: "", items: [{ type: "files", path: "/DATA/Video/Films" }, { type: "files", path: "/DATA/Mediator" }] }]);
  const removed = movePath(layout, "/DATA/Media", null);
  expect(removed.groups[0]!.items).toEqual([{ type: "folder", id: "f", title: "", items: [{ type: "files", path: "/DATA/Mediator" }] }]);
});

const at = (blocks: { id: string; x: number; y: number; w: number }[], id: string) => blocks.find((block) => block.id === id);

test("a board nobody arranged: the numbers in a row, groups down the left, the lists down the right", () => {
  const { blocks, hidden } = cleanBlocks(null, ["main", "more"]);
  expect(hidden).toEqual([]);
  expect(blocks.map((block) => block.id).sort()).toEqual(["activity", "attention", "cpu", "disk", "group:main", "group:more", "memory", "network", "temp"]);
  // the row of numbers fills the twelve columns
  const numbers = blocks.filter((block) => block.y === 0).sort((a, b) => a.x - b.x);
  expect(numbers.map((block) => block.id)).toEqual(["cpu", "memory", "disk", "network", "temp"]);
  expect(numbers.reduce((sum, block) => sum + block.w, 0)).toBe(12);
  expect(at(blocks, "group:main")).toEqual({ id: "group:main", x: 0, y: 1, w: 8 });
  expect(at(blocks, "attention")).toMatchObject({ x: 8, w: 4 });
  expect(at(blocks, "activity")!.y).toBeGreaterThan(at(blocks, "attention")!.y);
});

test("every block is on the board once, within the grid, or put away", () => {
  const { blocks, hidden } = cleanBlocks(
    { blocks: [{ id: "cpu", x: 10, y: 3, w: 9 }, { id: "cpu", x: 0, y: 0, w: 2 }, { id: "nope", x: 0, y: 0, w: 2 }, { id: "attention", x: -4, y: 2.6, w: 1 }, { id: "group:a", x: "1", y: null, w: 40 }, "text"], hidden: ["temp", "cpu", "group:a", "nope"] },
    ["a", "b"],
  );
  expect(at(blocks, "cpu")).toEqual({ id: "cpu", x: 3, y: 3, w: 9 });
  expect(at(blocks, "attention")).toEqual({ id: "attention", x: 0, y: 3, w: 3 });
  expect(at(blocks, "group:a")).toEqual({ id: "group:a", x: 0, y: 0, w: 12 });
  expect(hidden).toEqual(["temp"]);
  // what was named nowhere comes under everything else, each in a row of its own
  const added = ["memory", "disk", "network", "activity", "group:b"].map((id) => at(blocks, id)!);
  expect(added.every((block) => block.y > 3)).toBe(true);
  expect(new Set(added.map((block) => block.y)).size).toBe(added.length);
  expect(at(blocks, "group:b")!.w).toBe(12);
  expect(blocks.filter((block) => block.id === "cpu")).toHaveLength(1);
});

test("a layout saved while blocks stood in five places comes onto the grid", () => {
  const { blocks, hidden } = cleanBlocks({ widgets: { top: ["stats"], left: ["activity"], main: ["group:a", "group:b"], side: ["attention"], bottom: [], hidden: [] } }, ["a", "b"]);
  expect(hidden).toEqual([]);
  expect(blocks.filter((block) => block.y === 0).map((block) => block.id)).toEqual(["cpu", "memory", "disk", "network", "temp"]);
  expect(at(blocks, "activity")).toMatchObject({ x: 0, w: 3 });
  expect(at(blocks, "group:a")).toMatchObject({ x: 3, w: 6 });
  expect(at(blocks, "group:b")!.y).toBeGreaterThan(at(blocks, "group:a")!.y);
  expect(at(blocks, "attention")).toMatchObject({ x: 9, w: 3 });
  // a hidden one stays hidden
  expect(cleanBlocks({ widgets: { top: ["cpu"], hidden: ["temp"] } }).hidden).toEqual(["temp"]);
});

test("groups: placed once, never lost; tiles standing by themselves are gone with their last tile", () => {
  const layout = cleanLayout({
    groups: [{ id: "main", title: "", items: [] }, { id: "lone", title: "", bare: true, items: [{ type: "app", name: "memos" }] }, { id: "empty", title: "", bare: true, items: [] }],
    blocks: [{ id: "group:lone", x: 4, y: 2, w: 2 }, { id: "group:empty", x: 0, y: 0, w: 2 }, { id: "group:gone", x: 0, y: 0, w: 2 }],
  });
  expect(layout.groups.map((group) => group.id)).toEqual(["main", "lone"]);
  expect(layout.groups[1]!.bare).toBe(true);
  expect(at(layout.blocks, "group:lone")).toEqual({ id: "group:lone", x: 4, y: 2, w: 2 });
  expect(at(layout.blocks, "group:main")).toBeDefined();
  expect(at(layout.blocks, "group:empty")).toBeUndefined();
  // arranging keeps the places; what is new goes to the group with a heading, not to the lone tiles
  const seen = arrange(layout, ["memos", "new"], []);
  expect(seen.blocks).toEqual(layout.blocks);
  expect(seen.groups[0]!.items).toEqual([{ type: "app", name: "new" }]);
  expect(seen.groups[1]!.items).toEqual([{ type: "app", name: "memos" }]);
  // with only lone tiles on the board a home for new things is made
  const lone = cleanLayout({ groups: [{ id: "main", title: "", bare: true, items: [{ type: "app", name: "memos" }] }] });
  const made = arrange(lone, ["memos", "new"], []);
  expect(made.groups).toHaveLength(2);
  expect(made.groups[1]).toMatchObject({ title: "", items: [{ type: "app", name: "new" }] });
  expect(at(made.blocks, "group:" + made.groups[1]!.id)).toBeDefined();
  expect(movePath(layout, "/a", "/b").blocks).toEqual(layout.blocks);
});

test("the layout goes to text and back unchanged; text that is not a layout is refused", () => {
  const layout = cleanLayout({
    groups: [{ id: "main", title: "", items: [{ type: "app", name: "memos" }, { type: "link", id: "r", title: "Router: home", url: "http://192.168.1.1/", icon: "" }, { type: "folder", id: "f", title: "Tools", items: [{ type: "files", path: "/DATA/Media" }] }, { type: "builtin", id: "add" }] }],
    blocks: [{ id: "cpu", x: 0, y: 0, w: 4 }, { id: "group:main", x: 4, y: 0, w: 8 }],
    hidden: ["temp"],
  });
  const text = layoutText(layout);
  expect(text).toContain("title: \"Router: home\"");
  expect(text).toContain("hidden:\n  - temp\n");
  expect(parseLayoutText(text)).toEqual(layout);
  // an edit by hand: a link added, a tile that is nothing dropped
  const edited = parseLayoutText(text.replace("groups:", "groups:\n  - id: links\n    title: Links\n    items:\n      - type: link\n        url: https://example.com\n      - type: nothing"));
  expect(edited.groups[0]).toMatchObject({ id: "links", title: "Links", items: [{ type: "link", title: "example.com", url: "https://example.com/" }] });
  expect(at(edited.blocks, "group:links")).toBeDefined();
  for (const bad of ["", "just text", "- a\n- b", "groups: 5", "groups: [\n"]) expect(() => parseLayoutText(bad)).toThrow();
});

test("Hata's own tiles are always there for those who have them, wherever they were put", () => {
  // never arranged: after everything else, "Add" last
  expect(arrange(cleanLayout(null), ["memos"], ["/x"], ["store", "add"]).groups[0]!.items).toEqual([{ type: "app", name: "memos" }, { type: "files", path: "/x" }, { type: "builtin", id: "store" }, { type: "builtin", id: "add" }]);
  const layout = cleanLayout({
    groups: [
      { id: "main", title: "", items: [{ type: "builtin", id: "store" }, { type: "app", name: "memos" }, { type: "builtin", id: "add" }] },
      { id: "more", title: "More", items: [{ type: "builtin", id: "store" }, { type: "builtin", id: "nope" }, { type: "folder", id: "f", title: "", items: [{ type: "builtin", id: "add" }, { type: "app", name: "gitea" }] }] },
    ],
  });
  // named once, unknown ones dropped, "Add" does not live in a folder
  expect(layout.groups[1]!.items).toEqual([{ type: "folder", id: "f", title: "", items: [{ type: "app", name: "gitea" }] }]);
  // a new app comes before an "Add" that closes the first group
  expect(arrange(layout, ["memos", "gitea", "new"], [], ["store", "add"]).groups[0]!.items).toEqual([{ type: "builtin", id: "store" }, { type: "app", name: "memos" }, { type: "app", name: "new" }, { type: "builtin", id: "add" }]);
  // a member has the store and no "Add", a guest neither
  expect(arrange(layout, ["memos"], [], ["store"]).groups[0]!.items).toEqual([{ type: "builtin", id: "store" }, { type: "app", name: "memos" }]);
  expect(arrange(layout, ["memos"], []).groups[0]!.items).toEqual([{ type: "app", name: "memos" }]);
  // moved elsewhere, "Add" stays where it was put
  const moved = cleanLayout({ groups: [{ id: "main", title: "", items: [{ type: "builtin", id: "add" }, { type: "app", name: "memos" }] }] });
  expect(arrange(moved, ["memos", "new"], [], ["store", "add"]).groups[0]!.items).toEqual([{ type: "builtin", id: "add" }, { type: "app", name: "memos" }, { type: "app", name: "new" }, { type: "builtin", id: "store" }]);
});

test("a number of the system may stand among the tiles, and then it is nowhere else", () => {
  const layout = cleanLayout({
    groups: [{ id: "main", title: "", items: [{ type: "app", name: "memos" }, { type: "widget", id: "cpu" }, { type: "widget", id: "cpu" }, { type: "widget", id: "attention" }, { type: "folder", id: "f", title: "", items: [{ type: "widget", id: "disk" }, { type: "app", name: "gitea" }] }] }],
    blocks: [{ id: "cpu", x: 0, y: 0, w: 2 }, { id: "memory", x: 2, y: 0, w: 2 }],
    hidden: ["cpu", "network"],
  });
  // once among the tiles; the lists are not tiles; a folder holds no numbers
  expect(layout.groups[0]!.items).toEqual([{ type: "app", name: "memos" }, { type: "widget", id: "cpu" }, { type: "folder", id: "f", title: "", items: [{ type: "app", name: "gitea" }] }]);
  expect(at(layout.blocks, "cpu")).toBeUndefined();
  expect(at(layout.blocks, "memory")).toBeDefined();
  expect(layout.hidden).toEqual(["network"]);
  // it is there for everyone, like a link, and survives the text form
  const seen = arrange(layout, [], []);
  expect(seen.groups[0]!.items).toEqual([{ type: "widget", id: "cpu" }]);
  expect(at(seen.blocks, "cpu")).toBeUndefined();
  expect(parseLayoutText(layoutText(layout))).toEqual(layout);
});
