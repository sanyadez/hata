import { expect, test } from "bun:test";
import { imageParts, stayingVersion, updateWords } from "../src/updatewords";

test("an image's name and version are told apart", () => {
  expect(imageParts("ghcr.io/home-assistant/home-assistant:2026.11.1")).toEqual({ name: "ghcr.io/home-assistant/home-assistant", short: "home-assistant", tag: "2026.11.1" });
  expect(imageParts("localhost:5000/app")).toEqual({ name: "localhost:5000/app", short: "app", tag: "latest" });
  expect(imageParts("nginx")).toEqual({ name: "nginx", short: "nginx", tag: "latest" });
});

test("a newer version of the program is one line", () => {
  const before = { services: { homeassistant: { image: "ghcr.io/home-assistant/home-assistant:2026.10.4", restart: "unless-stopped" } } };
  const after = { services: { homeassistant: { image: "ghcr.io/home-assistant/home-assistant:2026.11.1", restart: "unless-stopped" } } };
  const words = updateWords(before, after);
  expect(words).toEqual([{ code: "version", service: "homeassistant", name: "home-assistant", from: "2026.10.4", to: "2026.11.1" }]);
  expect(stayingVersion(after, words)).toBe("");
});

test("a step added before the app is said as that, and the wait for it is not a line of its own", () => {
  const app = { image: "ghcr.io/hotio/qbittorrent:release-v5.3.0", ports: ["8181:8080"], environment: { TZ: "UTC" } };
  const before = { services: { qbittorrent: app } };
  const after = {
    services: {
      qbittorrent: { ...app, depends_on: { "allow-published-port": { condition: "service_completed_successfully" } } },
      "allow-published-port": { image: "ghcr.io/hotio/qbittorrent:release-v5.3.0", restart: "no" },
    },
  };
  const words = updateWords(before, after);
  expect(words).toEqual([{ code: "addedFirst", service: "allow-published-port", name: "ghcr.io/hotio/qbittorrent:release-v5.3.0", from: "", to: "" }]);
  expect(stayingVersion(after, words)).toBe("release-v5.3.0");
});

test("variables, ports, folders, other keys, parts gone and files", () => {
  const before = { services: { a: { image: "x/a:1", environment: ["OLD=1", "KEEP=1", "TURN=1"], ports: ["80:80"], volumes: ["/d:/d"], command: "run" }, b: { image: "x/b:1" } }, volumes: { data: {} } };
  const after = { services: { a: { image: "y/a:1", environment: { KEEP: "1", TURN: "2", NEW: "" }, ports: ["81:80"], volumes: ["/d:/d", "/e:/e"], command: "serve", healthcheck: { test: "true" } } } };
  expect(updateWords(before, after, true).map((w) => [w.code, w.service, w.name])).toEqual([
    ["image", "a", "a"],
    ["envChanged", "a", "TURN"],
    ["envAdded", "a", "NEW"],
    ["envRemoved", "a", "OLD"],
    ["ports", "a", ""],
    ["volumes", "a", ""],
    ["other", "a", "command, healthcheck"],
    ["removed", "b", ""],
    ["other", "", "volumes"],
    ["files", "", ""],
  ]);
  expect(updateWords(before, before)).toEqual([]);
});
