import { expect, test } from "bun:test";
import { arrange, cleanLayout, cleanWidgets, layoutText, movePath, parseLayoutText, webUrl } from "../src/dashboard";

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

const NUMBERS = ["cpu", "memory", "disk", "network", "temp"];

test("every block of the dashboard stands in exactly one place, or is put away", () => {
  const usual = { top: NUMBERS, left: [], main: [], side: ["attention", "activity"], bottom: [], hidden: [] };
  expect(cleanWidgets(null)).toEqual(usual);
  expect(cleanLayout({ groups: [] }).widgets).toEqual(usual);
  expect(cleanWidgets({ top: ["activity", "nope", "activity"], side: "x", bottom: ["cpu", "activity"], hidden: ["temp", "cpu", "group:a", "nope"] })).toEqual({ top: ["activity", "memory", "disk", "network"], left: [], main: [], side: ["attention"], bottom: ["cpu"], hidden: ["temp"] });
  // a layout saved while the numbers were one block, before the left column and before groups were blocks
  expect(cleanWidgets({ top: [], side: ["attention", "stats", "activity"], bottom: [] }, ["a", "b"])).toEqual({ ...usual, top: [], main: ["group:a", "group:b"], side: ["attention", ...NUMBERS, "activity"] });
});

test("groups of tiles are blocks too: anywhere, once, and never lost", () => {
  const layout = cleanLayout({
    groups: [{ id: "main", title: "", items: [] }, { id: "net", title: "Network", items: [] }, { id: "media", title: "Media", items: [] }],
    widgets: { top: ["group:net", "cpu"], left: ["activity", "group:gone", "group:net"], main: [], side: ["group:main"], bottom: ["attention"], hidden: ["memory", "disk", "network", "temp", "group:media"] },
  });
  expect(layout.widgets).toEqual({ top: ["group:net", "cpu"], left: ["activity"], main: ["group:media"], side: ["group:main"], bottom: ["attention"], hidden: ["memory", "disk", "network", "temp"] });
  // arranging keeps the places, and a group that had to be made gets one
  expect(arrange(layout, [], []).widgets).toEqual(layout.widgets);
  expect(arrange(cleanLayout(null), ["memos"], []).widgets.main).toEqual(["group:main"]);
  expect(movePath(layout, "/a", "/b").widgets).toEqual(layout.widgets);
});

test("the layout goes to text and back unchanged; text that is not a layout is refused", () => {
  const layout = cleanLayout({
    groups: [{ id: "main", title: "", items: [{ type: "app", name: "memos" }, { type: "link", id: "r", title: "Router: home", url: "http://192.168.1.1/", icon: "" }, { type: "folder", id: "f", title: "Tools", items: [{ type: "files", path: "/DATA/Media" }] }, { type: "builtin", id: "add" }] }],
    widgets: { top: ["cpu"], side: ["group:main"], hidden: ["temp"] },
  });
  const text = layoutText(layout);
  expect(text).toContain("title: \"Router: home\"");
  expect(text).toContain("  left: []\n");
  expect(text).toContain("  hidden:\n    - temp\n");
  expect(parseLayoutText(text)).toEqual(layout);
  // an edit by hand: a link added, a tile that is nothing dropped
  const edited = parseLayoutText(text.replace("groups:", "groups:\n  - id: links\n    title: Links\n    items:\n      - type: link\n        url: https://example.com\n      - type: nothing"));
  expect(edited.groups[0]).toMatchObject({ id: "links", title: "Links", items: [{ type: "link", title: "example.com", url: "https://example.com/" }] });
  expect(edited.widgets.main).toEqual(["group:links"]);
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
