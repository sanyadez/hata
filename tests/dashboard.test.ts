import { expect, test } from "bun:test";
import { arrange, cleanLayout, dropBlock, dropServer, GRID, haTiles, layoutText, movePath, parseLayoutText, webUrl } from "../src/dashboard";

const link = (title: string, url = "https://example.com/") => ({ type: "link", id: title.toLowerCase(), title, url, icon: "" });

test("a link points to the web and nowhere else", () => {
  expect(webUrl("http://192.168.1.1")).toBe("http://192.168.1.1/");
  expect(webUrl(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "example.com", "", null, 5]) expect(webUrl(bad)).toBe("");
});

const at = (x: number, y: number, w = 1, h = 1) => ({ x, y, w, h });
const app = (name: string, box = at(0, 0)) => ({ type: "app", name, ...box });
const overlaps = (cards: { x: number; y: number; w: number; h: number }[]) => cards.some((a, i) => cards.some((b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));

test("what does not fit a layout is dropped", () => {
  const layout = cleanLayout({ cards: [app("jellyfin"), { type: "app", name: "Bad Name", ...at(1, 0) }, "not a card", { ...link("Router", "http://192.168.1.1/"), ...at(2, 0) }, { type: "block", id: "nothing", ...at(3, 0) }, { ...link("Bad", "javascript:alert(1)"), ...at(4, 0) }] });
  expect(layout.cards.map((c) => (c.type === "app" ? c.name : c.type))).toEqual(["jellyfin", "link"]);
  expect(cleanLayout({ cards: {} }).cards.length).toBeGreaterThan(0);
});

test("an app is on Home once, ids are unique, a link without a title takes its host, a folder of nothing goes", () => {
  const layout = cleanLayout({
    cards: [app("memos"), { type: "folder", id: "a", title: "Tools", items: [{ type: "app", name: "memos" }, { type: "app", name: "gitea" }], ...at(1, 0) }, { type: "folder", id: "a", title: "", items: [{ type: "app", name: "gitea" }], ...at(2, 0) }, { type: "link", id: "a", url: "https://example.com/x", title: "", ...at(3, 0) }],
  });
  expect(layout.cards[1]).toMatchObject({ type: "folder", id: "a", title: "Tools", items: [{ type: "app", name: "gitea" }] });
  expect(layout.cards).toHaveLength(3);
  expect(layout.cards[2]).toMatchObject({ type: "link", title: "example.com" });
  expect((layout.cards[2] as unknown as { id: string }).id).not.toBe("a");
});

test("a size stays within the limits of its kind and the grid", () => {
  const { cards } = cleanLayout({ cards: [{ type: "block", id: "stats", x: 0, y: 0, w: 1, h: 1 }, { type: "app", name: "big", x: 0, y: 5, w: 99, h: 99 }, { type: "app", name: "edge", x: 7, y: 20, w: 3, h: 1 }, { type: "app", name: "odd", x: 1.4, y: -3, w: 1, h: 1 }] });
  const find = (name: string) => cards.find((c) => c.type === "app" && c.name === name)!;
  expect(cards.find((c) => c.type === "block")).toMatchObject({ w: GRID.limits.stats![0], h: GRID.limits.stats![1] });
  expect(find("big")).toMatchObject({ w: 4, h: 4 });
  // what would stand past the right edge is moved in
  expect(find("edge")).toMatchObject({ x: 5, w: 3 });
  expect(find("odd")).toMatchObject({ x: 1 });
  expect(find("odd").y).toBeGreaterThanOrEqual(0);
});

test("a card over another goes down; one with no place takes the first free one; an empty place stays", () => {
  const { cards } = cleanLayout({ cards: [app("a", at(0, 4, 2, 2)), app("b", at(1, 5)), { type: "app", name: "free" }] });
  expect(overlaps(cards)).toBe(false);
  const find = (name: string) => cards.find((c) => c.type === "app" && c.name === name)!;
  expect(find("a")).toMatchObject({ x: 0, y: 4 });
  expect(find("b")).toMatchObject({ x: 1, y: 6 });
  // rows 0–3 stay as they were left: only what has no place goes there
  expect(find("free")).toMatchObject({ x: 0, y: 0 });
});

test("a layout of groups and zones becomes the grid", () => {
  const { cards } = cleanLayout({
    widgets: { top: ["stats", "machine:aaaaaaaa"], side: ["attention"], bottom: [], hidden: ["activity"] },
    groups: [
      { id: "main", title: "Media", items: [{ type: "app", name: "memos" }, { type: "ha", server: "bbbbbbbb", entity: "light.x", size: "2x2" }] },
      { id: "second", title: "Other", items: [{ type: "widget", id: "w1", source: "qbit", server: "cccccccc", view: "torrents", size: "2x1" }] },
    ],
  });
  expect(overlaps(cards)).toBe(false);
  expect(cards.map((c) => c.type)).toEqual(["block", "block", "block", "app", "ha", "widget"]);
  expect(cards[0]).toMatchObject({ id: "stats", x: 0, y: 0, w: 5, h: 3 });
  expect(cards[1]).toMatchObject({ id: "machine:aaaaaaaa", x: 5, y: 0, w: 3, h: 1 });
  expect(cards[4]).toMatchObject({ w: 2, h: 2 });
  expect(cards[5]).toMatchObject({ w: 2, h: 1 });
  // what was put away stays away
  expect(cards.some((c) => c.type === "block" && c.id === "activity")).toBe(false);
});

test("a layout of the free grid, and of the numbers as separate blocks, comes through", () => {
  const free = cleanLayout({ hidden: ["attention"], blocks: [{ id: "group:b", x: 0, y: 0 }, { id: "group:a", x: 0, y: 3 }], groups: [{ id: "a", items: [{ type: "app", name: "second" }] }, { id: "b", bare: true, items: [{ type: "app", name: "first" }] }] });
  expect(free.cards.filter((c) => c.type === "app").map((c) => (c as { name: string }).name)).toEqual(["first", "second"]);
  expect(free.cards.some((c) => c.type === "block" && c.id === "attention")).toBe(false);
  const numbers = cleanLayout({ widgets: { top: ["cpu", "memory"], side: [] }, groups: [] });
  expect(numbers.cards.filter((c) => c.type === "block" && c.id === "stats")).toHaveLength(1);
});

test("a new server has the numbers, the attention list and the activity; ad blocking waits to be added", () => {
  expect(cleanLayout(null).cards.map((c) => (c as { id: string }).id)).toEqual(["stats", "attention", "activity"]);
  // a page laid out with no blocks stays so
  expect(cleanLayout({ cards: [] }).cards).toEqual([]);
});

test("arranging: what is gone is left out, what is new takes a free place, the saved layout is not touched", () => {
  const layout = cleanLayout({ cards: [app("gone", at(0, 0)), app("memos", at(1, 0)), { ...link("Router"), ...at(2, 0) }, { type: "folder", id: "f", title: "Video", items: [{ type: "app", name: "jellyfin" }, { type: "app", name: "plex" }], ...at(3, 0) }] });
  const seen = arrange(layout, { apps: ["jellyfin", "memos", "new"], folders: ["/DATA/Media"], builtins: ["store"], admin: true });
  expect(overlaps(seen.cards)).toBe(false);
  expect(seen.cards.find((c) => c.type === "folder")).toMatchObject({ items: [{ type: "app", name: "jellyfin" }] });
  expect(seen.cards.some((c) => c.type === "app" && c.name === "gone")).toBe(false);
  // the place left by what is gone is the first free one
  expect(seen.cards.find((c) => c.type === "app" && c.name === "new")).toMatchObject({ x: 0, y: 0 });
  expect(seen.cards.some((c) => c.type === "files")).toBe(true);
  expect(seen.cards.some((c) => c.type === "builtin" && c.id === "store")).toBe(true);
  expect(layout.cards).toHaveLength(4);
});

test("a member has the numbers and their own tiles, closed up", () => {
  const layout = cleanLayout({ cards: [{ type: "block", id: "attention", ...at(0, 0, 3, 3) }, { type: "block", id: "stats", ...at(3, 0, 5, 3) }, app("theirs", at(7, 9)), app("others", at(0, 3))] });
  const seen = arrange(layout, { apps: ["theirs"] });
  expect(seen.cards.map((c) => (c.type === "block" ? c.id : (c as { name: string }).name))).toEqual(["stats", "theirs"]);
  expect(seen.cards[0]).toMatchObject({ x: 0, y: 0 });
  expect(seen.cards[1]).toMatchObject({ x: 5, y: 0 });
  // an administrator's page stays as it was laid out
  expect(arrange(layout, { apps: ["theirs"], admin: true }).cards.find((c) => c.type === "app")).toMatchObject({ x: 7, y: 9 });
});

test("a tile of Home Assistant and a widget stay while their server is seen", () => {
  const layout = cleanLayout({ cards: [{ type: "ha", server: "bbbbbbbb", entity: "light.x", ...at(0, 0) }, { type: "widget", id: "w", source: "frigate", server: "cccccccc", view: "camera", camera: "yard", ...at(1, 0, 2, 2) }, { type: "widget", source: "frigate", server: "cccccccc", view: "camera", ...at(3, 0) }] });
  expect(layout.cards).toHaveLength(2);
  expect(arrange(layout, { apps: [], servers: ["bbbbbbbb"], widgetServers: ["cccccccc"], admin: true }).cards).toHaveLength(2);
  expect(arrange(layout, { apps: [], admin: true }).cards).toHaveLength(0);
  expect(haTiles(layout)).toEqual(["bbbbbbbb/light.x"]);
});

test("a removed server's cards go, also out of a folder; a machine's numbers go with the machine; places stay", () => {
  const layout = cleanLayout({ cards: [{ type: "ha", server: "bbbbbbbb", entity: "light.x", ...at(0, 0) }, { type: "folder", id: "f", title: "", items: [{ type: "ha", server: "bbbbbbbb", entity: "light.y" }, { type: "app", name: "a" }], ...at(5, 5) }, { type: "folder", id: "g", title: "", items: [{ type: "ha", server: "bbbbbbbb", entity: "light.z" }], ...at(6, 5) }, { type: "block", id: "machine:aaaaaaaa", ...at(0, 1, 3, 1) }] });
  const dropped = dropServer(layout, "bbbbbbbb");
  expect(dropped.cards.map((c) => c.type)).toEqual(["block", "folder"]);
  expect(dropped.cards[1]).toMatchObject({ x: 5, y: 5, items: [{ type: "app", name: "a" }] });
  expect(dropBlock(dropped, "machine:aaaaaaaa").cards.map((c) => c.type)).toEqual(["folder"]);
});

test("a folder of the file manager follows a move and goes with a removal", () => {
  const layout = cleanLayout({ cards: [{ type: "files", path: "/DATA/a", ...at(2, 2) }, { type: "files", path: "/DATA/ab", ...at(3, 2) }, { type: "folder", id: "f", title: "", items: [{ type: "files", path: "/DATA/a/in" }], ...at(4, 2) }] });
  const moved = movePath(layout, "/DATA/a", "/mnt/b");
  expect(moved.cards[0]).toMatchObject({ path: "/mnt/b", x: 2, y: 2 });
  expect(moved.cards[1]).toMatchObject({ path: "/DATA/ab" });
  expect(moved.cards[2]).toMatchObject({ items: [{ path: "/mnt/b/in" }] });
  expect(movePath(layout, "/DATA/a", null).cards.map((c) => c.type)).toEqual(["files"]);
});

test("the layout as text comes back the same; text of the old format is taken too; other text is refused", () => {
  const layout = cleanLayout({ cards: [{ type: "block", id: "stats", ...at(0, 0, 4, 2) }, app("memos", at(4, 0)), { ...link("Router"), ...at(5, 1, 2, 1) }, { type: "folder", id: "f", title: "Tools", items: [{ type: "app", name: "gitea" }], ...at(0, 2) }] });
  expect(parseLayoutText(layoutText(layout))).toEqual(layout);
  expect(parseLayoutText("groups:\n  - id: a\n    items:\n      - type: app\n        name: memos\n").cards.some((c) => c.type === "app")).toBe(true);
  expect(() => parseLayoutText("just words")).toThrow();
  expect(() => parseLayoutText("a: 1")).toThrow();
});
