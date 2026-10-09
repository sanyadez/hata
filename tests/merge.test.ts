import { expect, test } from "bun:test";
import { normalize, parseCompose, type Compose } from "../src/appform";
import { guessBase, merge3, same } from "../src/merge";

const load = (text: string): Compose => {
  const compose = parseCompose(text);
  normalize(compose, "/DATA", "memos");
  return compose;
};

const STORE_1 = `
name: memos
services:
  memos:
    image: neosmemo/memos:0.24.0
    restart: unless-stopped
    ports:
      - 5230:5230
    volumes:
      - /DATA/AppData/$AppID:/var/opt/memos
    environment:
      MODE: prod
      LOG: info
x-casaos:
  port_map: "5230"
  title: { en_us: Memos }
`;
const STORE_2 = STORE_1.replace("0.24.0", "0.28.0").replace("LOG: info", "LOG: warn\n      NEW: one").replace("      - 5230:5230", "      - 5230:5230\n      - 9000:9000/udp") + "  tagline: { en_us: Notes }\n";

test("what the user did not touch follows the store; what they changed stays", () => {
  const ours = load(STORE_1.replace("5230:5230", "8081:5230").replace("/DATA/AppData/$AppID", "/mnt/tank/memos").replace('port_map: "5230"', 'port_map: "8081"').replace("MODE: prod", "MODE: demo"));
  ours.services.memos.labels = { "traefik.enable": "true" };
  const { merged, changes } = merge3(load(STORE_1), ours, load(STORE_2));
  expect(merged.services.memos).toEqual({
    image: "neosmemo/memos:0.28.0",
    restart: "unless-stopped",
    ports: [
      { target: 5230, published: "8081", protocol: "tcp" },
      { target: 9000, published: "9000", protocol: "udp" },
    ],
    volumes: [{ type: "bind", source: "/mnt/tank/memos", target: "/var/opt/memos" }],
    environment: { MODE: "demo", LOG: "warn", NEW: "one" },
    labels: { "traefik.enable": "true" },
  });
  expect(merged["x-casaos"]).toEqual({ port_map: "8081", title: { en_us: "Memos" }, tagline: { en_us: "Notes" } });
  expect(changes.map((c) => [c.path, c.kind, c.from, c.to])).toEqual([
    ["services.memos.image", "store", "neosmemo/memos:0.24.0", "neosmemo/memos:0.28.0"],
    ["services.memos.ports.9000/udp", "store", "", '{"target":9000,"published":"9000","protocol":"udp"}'],
    ["services.memos.environment.LOG", "store", "info", "warn"],
    ["services.memos.environment.NEW", "store", "", "one"],
    ["x-casaos.tagline", "store", "", '{"en_us":"Notes"}'],
  ]);
});

test("where both changed the same thing, the user's value stays and the conflict is reported", () => {
  const ours = load(STORE_1.replace("LOG: info", "LOG: debug").replace("0.24.0", "0.25.1"));
  const { merged, changes } = merge3(load(STORE_1), ours, load(STORE_2));
  expect(merged.services.memos.environment.LOG).toBe("debug");
  expect(merged.services.memos.image).toBe("neosmemo/memos:0.25.1");
  expect(changes.filter((c) => c.kind === "conflict").map((c) => [c.path, c.from, c.to])).toEqual([
    ["services.memos.image", "neosmemo/memos:0.25.1", "neosmemo/memos:0.28.0"],
    ["services.memos.environment.LOG", "debug", "warn"],
  ]);
});

test("removals: the store's are followed, the user's are respected", () => {
  const base = load(STORE_1);
  // the store drops a variable and a service the user never touched
  const theirs = load(STORE_1.replace("      LOG: info\n", ""));
  expect(merge3(base, load(STORE_1), theirs).merged.services.memos.environment).toEqual({ MODE: "prod" });
  // the user removed the port; a store that keeps it as it was does not bring it back
  const ours = load(STORE_1);
  delete ours.services.memos.ports;
  expect(merge3(base, ours, load(STORE_1.replace("0.24.0", "0.28.0"))).merged.services.memos.ports).toBeUndefined();
  // nothing new in the store: the file stays exactly the user's
  const edited = load(STORE_1.replace("prod", "x"));
  expect(merge3(base, edited, load(STORE_1))).toEqual({ merged: edited, changes: [] });
});

test("without the store file the app was installed from, the form's answers are what is kept", () => {
  const ours = load(STORE_1.replace("5230:5230", "8081:5230").replace("/DATA/AppData/$AppID", "/mnt/tank/memos").replace('port_map: "5230"', 'port_map: "8081"').replace("MODE: prod", "MODE: demo"));
  ours["x-hata"] = { store: "casaos" };
  const theirs = load(STORE_2);
  const { merged, changes } = merge3(guessBase(ours, theirs), ours, theirs);
  expect(merged.services.memos.image).toBe("neosmemo/memos:0.28.0");
  expect(merged.services.memos.ports[0].published).toBe("8081");
  expect(merged.services.memos.volumes[0].source).toBe("/mnt/tank/memos");
  // a value that exists on both sides may be the user's: it stays, the store's new default does not arrive
  expect(merged.services.memos.environment).toEqual({ MODE: "demo", LOG: "info", NEW: "one" });
  expect(merged["x-casaos"].port_map).toBe("8081");
  expect(changes.every((c) => c.kind === "store")).toBe(true);
  // an app nobody edited is reported line by line all the same
  const plain = load(STORE_1);
  expect(merge3(guessBase(plain, theirs), plain, theirs).changes.map((c) => c.path)).toContain("services.memos.image");
  // the mark older versions wrote into the compose file goes: the store does not have it
  expect(merged["x-hata"]).toBeUndefined();
});

test("same() compares data, not text", () => {
  expect(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
  expect(same([1, 2], [2, 1])).toBe(false);
  expect(same({ a: undefined }, {})).toBe(false);
  expect(same(null, undefined)).toBe(false);
});
