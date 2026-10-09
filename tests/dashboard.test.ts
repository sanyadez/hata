import { expect, test } from "bun:test";
import { arrange, cleanLayout, movePath, webUrl } from "../src/dashboard";

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
  expect(cleanLayout(null)).toEqual({ groups: [] });
  expect(cleanLayout({ groups: {} })).toEqual({ groups: [] });
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
  expect(arrange({ groups: [] }, ["b", "a"], ["/x"])).toEqual({ groups: [{ id: "main", title: "", items: [{ type: "app", name: "b" }, { type: "app", name: "a" }, { type: "files", path: "/x" }] }] });
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
