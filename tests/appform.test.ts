import { describe, expect, test } from "bun:test";
import { appMeta, applyForm, bindSources, buildForm, dumpCompose, localize, normalize, parseCompose, publishedPorts } from "../src/appform";

const STORE_APP = `
name: demo
services:
  demo:
    image: example/demo:1.2.3
    environment:
      PUID: $PUID
      TZ: $TZ
      ADMIN_PASSWORD: ""
      MODE: simple
    ports:
      - target: 8080
        published: "8081"
        protocol: tcp
      - "53:53/udp"
      - "9000-9010:9000-9010"
    volumes:
      - type: bind
        source: /DATA/AppData/$AppID/config
        target: /config
      - /DATA/Media:/media:ro
      - cache:/cache
      - /dev/dri:/dev/dri
    x-casaos:
      ports:
        - container: "8080"
          description: { en_US: Web UI, uk_UA: Веб-інтерфейс }
      volumes:
        - container: /config
          description: { en_US: Configuration }
      envs:
        - container: ADMIN_PASSWORD
          description: { en_US: Administrator password }
  db:
    image: example/db:16
    environment:
      - POSTGRES_PASSWORD=secret
      - PASSTHROUGH
volumes:
  cache: {}
x-casaos:
  main: demo
  architectures: [amd64, arm64]
  category: Media
  title: { en_US: Demo, uk_UA: Демо }
  tagline: { en_US: A demo app }
  icon: https://example.com/icon.svg
  thumbnail: javascript:alert(1)
  port_map: "8081"
  index: admin
  tips:
    before_install: { en_US: Default password is "demo". }
`;

const load = (dataRoot = "/DATA") => {
  const compose = parseCompose(STORE_APP);
  normalize(compose, dataRoot, "demo");
  return compose;
};

describe("parseCompose", () => {
  test("rejects what is not a compose file", () => {
    expect(() => parseCompose("just text")).toThrow();
    expect(() => parseCompose("services: {}")).toThrow();
    expect(() => parseCompose("services:\n  a: 5")).toThrow();
    expect(() => parseCompose("a: [")).toThrow();
  });
});

describe("localize", () => {
  test("requested language, then English, then anything", () => {
    expect(localize({ en_US: "Hi", uk_UA: "Привіт" }, "uk")).toBe("Привіт");
    expect(localize({ en_US: "Hi", de_DE: "Hallo" }, "uk")).toBe("Hi");
    expect(localize({ de_DE: "Hallo" }, "uk")).toBe("Hallo");
    expect(localize("plain", "uk")).toBe("plain");
    expect(localize(undefined, "uk")).toBe("");
  });
});

describe("normalize", () => {
  test("short syntax becomes long, the rest is left as written", () => {
    const { demo, db } = load().services;
    expect(demo.ports[1]).toEqual({ target: 53, published: "53", protocol: "udp" });
    expect(demo.ports[2]).toBe("9000-9010:9000-9010");
    expect(demo.volumes[1]).toEqual({ type: "bind", source: "/DATA/Media", target: "/media", read_only: true });
    expect(demo.volumes[2]).toBe("cache:/cache");
    expect(db.environment).toEqual({ POSTGRES_PASSWORD: "secret", PASSTHROUGH: null });
  });

  test("the app id replaces $AppID in folders", () => {
    expect(load().services.demo.volumes[0].source).toBe("/DATA/AppData/demo/config");
  });

  test("binds move under another data root", () => {
    const { demo } = load("/srv/hata").services;
    expect(demo.volumes[0].source).toBe("/srv/hata/AppData/demo/config");
    expect(demo.volumes[1].source).toBe("/srv/hata/Media");
    expect(demo.volumes[3].source).toBe("/dev/dri");
  });
});

describe("appMeta", () => {
  test("reads x-casaos and drops unsafe links", () => {
    const meta = appMeta(load(), "uk");
    expect(meta.title).toBe("Демо");
    expect(meta.tagline).toBe("A demo app");
    expect(meta.icon).toBe("https://example.com/icon.svg");
    expect(meta.thumbnail).toBe("");
    expect(meta.port).toBe("8081");
    expect(meta.index).toBe("/admin");
    expect(meta.tips).toContain("demo");
  });

  test("a compose file without x-casaos is still an app", () => {
    const meta = appMeta(parseCompose("name: plain\nservices:\n  a:\n    image: nginx"), "en");
    expect(meta.title).toBe("plain");
    expect(meta.port).toBe("");
    expect(meta.index).toBe("/");
  });
});

describe("buildForm", () => {
  const form = buildForm(load(), "uk");

  test("ports with descriptions; ranges are not offered", () => {
    expect(form.ports).toEqual([
      { service: "demo", target: "8080", protocol: "tcp", published: "8081", description: "Веб-інтерфейс" },
      { service: "demo", target: "53", protocol: "udp", published: "53", description: "" },
    ]);
  });

  test("only binds are folders", () => {
    expect(form.volumes.map((v) => v.target)).toEqual(["/config", "/media", "/dev/dri"]);
  });

  test("system variables are not asked per app", () => {
    expect(form.envs.map((e) => e.name)).toEqual(["ADMIN_PASSWORD", "MODE", "POSTGRES_PASSWORD", "PASSTHROUGH"]);
    expect(form.envs[0]!.description).toBe("Administrator password");
  });
});

describe("applyForm", () => {
  test("changes ports, folders and variables; the tile follows the web port", () => {
    const compose = load();
    const error = applyForm(compose, {
      ports: [{ service: "demo", target: "8080", protocol: "tcp", published: "9090" }],
      volumes: [{ service: "demo", target: "/media", source: "/mnt/films/" }],
      envs: [
        { service: "demo", name: "ADMIN_PASSWORD", value: "pa$$word" },
        { service: "demo", name: "MODE", value: "simple" },
      ],
    });
    expect(error).toBeNull();
    const { demo } = compose.services;
    expect(demo.ports[0].published).toBe("9090");
    expect(compose["x-casaos"].port_map).toBe("9090");
    expect(demo.volumes[1].source).toBe("/mnt/films");
    // typed by the user, so literal: compose must not read `$word` as a variable
    expect(demo.environment.ADMIN_PASSWORD).toBe("pa$$$$word");
    expect(demo.environment.MODE).toBe("simple");
    expect(demo.environment.TZ).toBe("$TZ");
  });

  test("an empty port stops publishing it", () => {
    const compose = load();
    expect(applyForm(compose, { ports: [{ service: "demo", target: "53", protocol: "udp", published: "" }] })).toBeNull();
    expect(compose.services.demo.ports[1]).toEqual({ target: 53, protocol: "udp" });
  });

  test("rejects bad values and things the app does not have", () => {
    const bad = (input: unknown) => applyForm(load(), input);
    expect(bad({ ports: [{ service: "demo", target: "8080", published: "70000" }] })).toBe("form.badPort");
    expect(bad({ ports: [{ service: "demo", target: "8080", published: "80; rm" }] })).toBe("form.badPort");
    expect(bad({ ports: [{ service: "demo", target: "1", published: "80" }] })).toBe("form.unknownPort");
    expect(bad({ ports: [{ service: "__proto__", target: "8080", published: "80" }] })).toBe("form.unknownPort");
    expect(bad({ volumes: [{ service: "demo", target: "/config", source: "relative" }] })).toBe("form.badPath");
    expect(bad({ volumes: [{ service: "demo", target: "/config", source: "/a/../etc" }] })).toBe("form.badPath");
    expect(bad({ volumes: [{ service: "demo", target: "/nope", source: "/a" }] })).toBe("form.unknownVolume");
    expect(bad({ envs: [{ service: "demo", name: "NEW", value: "x" }] })).toBe("form.unknownEnv");
    expect(bad("nonsense")).toBe("form.invalid");
  });
});

describe("what an install needs to know", () => {
  test("folders to create and ports to check", () => {
    const compose = load();
    expect(bindSources(compose)).toEqual(["/DATA/AppData/demo/config", "/DATA/Media", "/dev/dri"]);
    expect(publishedPorts(compose)).toEqual([
      { port: 8081, protocol: "tcp" },
      { port: 53, protocol: "udp" },
    ]);
  });

  test("a folder that still holds a variable is not created", () => {
    const compose = parseCompose("services:\n  a:\n    image: x\n    volumes:\n      - /data/$NAME:/data");
    normalize(compose, "/DATA");
    expect(bindSources(compose)).toEqual([]);
  });
});

describe("dumpCompose", () => {
  test("what is written reads back the same", () => {
    const compose = load();
    expect(parseCompose(dumpCompose(compose))).toEqual(compose);
  });

  test("strings that look like other YAML types stay strings", () => {
    const compose = { services: { a: { image: "x", environment: { A: "yes", B: "010", C: "1e3", D: "null", E: "a: b", F: "", G: "#x", H: "multi\nline" } } } };
    expect(parseCompose(dumpCompose(compose))).toEqual(compose);
  });
});
