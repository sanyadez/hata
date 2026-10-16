import { describe, expect, test } from "bun:test";
import { appMeta, localize } from "../src/appform";
import { answer, casaosOf, envLine, fill, filled, ownCasaos, readIndexApp, settingFolders, settingPorts, settingsForm, startingEnv, textIn, viewCompose, webPortOf } from "../src/hataapp";

const icon = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64")}`;
const entry = (extra: object = {}) => ({
  id: "jellyfin",
  title: "Jellyfin",
  tagline: { en: "Films", uk: "Фільми" },
  description: { en: "A media server.", uk: "Медіасервер." },
  category: "media",
  developer: "Jellyfin",
  website: "https://jellyfin.org",
  icon,
  screenshots: ["apps/jellyfin/screenshots/1.webp"],
  web: { service: "jellyfin", port: 8096 },
  settings: [
    { name: "WEB_PORT", type: "port", default: 8096, label: { en: "Web port", uk: "Порт" } },
    { name: "MEDIA", type: "folder", default: "${DATA_ROOT}/Media", label: "Media" },
    { name: "DB_PASSWORD", type: "secret", label: "Database password", length: 16 },
    { name: "ADMIN", type: "password", label: "Admin password", required: true },
    { name: "SIGNUPS", type: "switch", default: true, label: "Sign-ups" },
  ],
  permissions: { "host-network": { en: "Finds devices", uk: "Шукає пристрої" } },
  version: "12.2",
  architectures: ["amd64", "arm64"],
  compose: "services:\n  jellyfin:\n    image: jellyfin/jellyfin:12.2\n    restart: unless-stopped\n    ports:\n      - ${WEB_PORT:-8096}:8096\n    volumes:\n      - ${APP_DATA:-.}/config:/config\n      - ${MEDIA:-./media}:/media\n",
  files: { "conf/a.conf": "x = 1\n" },
  ...extra,
});
const categories = { media: { en: "Media", uk: "Медіа" } };
const read = (extra: object = {}) => readIndexApp(entry(extra), "https://raw.example/abc/", categories);

describe("an app of the index", () => {
  test("is read with its texts, the category's name and the screenshots' addresses", () => {
    const app = read()!;
    expect(app.name).toBe("jellyfin");
    expect(app.meta.category).toEqual({ en: "Media", uk: "Медіа" });
    expect(app.meta.screenshots).toEqual(["https://raw.example/abc/apps/jellyfin/screenshots/1.webp"]);
    expect(app.meta.settings.map((s) => s.name)).toEqual(["WEB_PORT", "MEDIA", "DB_PASSWORD", "ADMIN", "SIGNUPS"]);
    expect(app.meta.settings[0]!.default).toBe("8096");
    expect(app.files).toEqual({ "conf/a.conf": "x = 1\n" });
  });
  test("what cannot be offered is left out", () => {
    expect(read({ id: "Bad Name" })).toBeNull();
    expect(read({ title: undefined })).toBeNull();
    // a file of Hata's own, or one outside the app's folder, makes the app unusable
    expect(read({ files: { ".env": "A=1" } })).toBeNull();
    expect(read({ files: { "../x": "" } })).toBeNull();
    // a picture that is not one is no icon; a setting of an unknown type, or of Hata's own variable, is dropped
    expect(read({ icon: "javascript:alert(1)" })!.meta.icon).toBe("");
    expect(read({ settings: [{ name: "X", type: "magic", label: "X" }, { name: "APP_DATA", type: "text", label: "A" }] })!.meta.settings).toEqual([]);
  });
});

describe("texts", () => {
  test("in the language asked for, then English", () => {
    expect(textIn({ en: "Hi", uk: "Привіт" }, "uk")).toBe("Привіт");
    expect(textIn({ en: "Hi", uk: "Привіт" }, "de")).toBe("Hi");
    expect(textIn("Hi", "uk")).toBe("Hi");
    // the tile is read by appMeta: both ways of writing languages
    expect(localize({ en: "Hi", uk: "Привіт" }, "uk")).toBe("Привіт");
    expect(localize({ en_US: "Hi", uk_UA: "Привіт" }, "uk")).toBe("Привіт");
    expect(localize({ en: "Hi", uk: "Привіт" }, "fr")).toBe("Hi");
  });
});

describe("variables", () => {
  test("are filled as docker compose does it", () => {
    expect(fill("${A:-.}/x", {})).toBe("./x");
    expect(fill("${A:-.}/x", { A: "/d" })).toBe("/d/x");
    expect(fill("$$HOME $B", { B: "b" })).toBe("$HOME b");
    expect(filled({ services: { a: { ports: ["${P:-80}:80"], environment: { X: "${X}" } } } }, { P: "81", X: "x" })).toEqual({ services: { a: { ports: ["81:80"], environment: { X: "x" } } } });
  });
  test("the web port is where the service publishes the container's port", () => {
    const { meta } = read()!;
    expect(webPortOf(meta, { services: { jellyfin: { ports: ["9000:8096"] } } })).toBe(9000);
    expect(webPortOf(meta, { services: { jellyfin: { ports: ["127.0.0.1:9000:8096/tcp"] } } })).toBe(9000);
    expect(webPortOf(meta, { services: { jellyfin: { ports: [{ target: 8096, published: "9001" }] } } })).toBe(9001);
    expect(webPortOf(meta, { services: { jellyfin: { network_mode: "host" } } })).toBe(8096);
    expect(webPortOf(meta, { services: { jellyfin: { ports: ["9000:80"] } } })).toBe(0);
  });
});

describe("the view", () => {
  test("is the file filled from .env with the tile made of hata.yml", () => {
    const app = read()!;
    const view = viewCompose(Bun.YAML.parse(app.compose) as any, app.meta, { WEB_PORT: "9000", APP_DATA: "/DATA/AppData/jellyfin", MEDIA: "/DATA/Media" });
    expect(view.services.jellyfin.volumes).toEqual(["/DATA/AppData/jellyfin/config:/config", "/DATA/Media:/media"]);
    const meta = appMeta(view, "uk");
    expect([meta.title, meta.tagline, meta.category, meta.port, meta.index, meta.icon]).toEqual(["Jellyfin", "Фільми", "Медіа", "9000", "/", icon]);
  });
  test("what the person changed of the tile wins, and only that is kept", () => {
    const app = read()!;
    const compose = { ...(Bun.YAML.parse(app.compose) as any), "x-casaos": { subdomain: "films", title: { custom: "Films" } } };
    const view = viewCompose(compose, app.meta, { WEB_PORT: "8096" });
    expect(appMeta(view, "en").subdomain).toBe("films");
    expect(appMeta(view, "en").title).toBe("Films");
    const made = casaosOf(app.meta, { services: { jellyfin: { ports: ["8096:8096"] } } });
    expect(ownCasaos({ ...made, title: { ...(made.title as object), custom: "Films" }, subdomain: "films" }, made)).toEqual({ title: { custom: "Films" }, subdomain: "films" });
    expect(ownCasaos({ ...made }, made)).toBeNull();
  });
});

describe("settings", () => {
  const { meta } = read()!;
  const start = startingEnv(meta, { DATA_ROOT: "/DATA" }, (n) => "s".repeat(n));
  test("start at their defaults, with secrets made", () => {
    expect(start).toEqual({ WEB_PORT: "8096", MEDIA: "/DATA/Media", DB_PASSWORD: "s".repeat(16), SIGNUPS: "true" });
  });
  test("a secret or a password is never sent to the page", () => {
    const rows = settingsForm(meta, { ...start, ADMIN: "x" }, "uk");
    expect(rows.find((r) => r.name === "WEB_PORT")!.label).toBe("Порт");
    expect(rows.filter((r) => r.type === "secret" || r.type === "password").map((r) => [r.value, r.set])).toEqual([["", true], ["", true]]);
  });
  test("answers are checked", () => {
    const ok = answer(meta, { WEB_PORT: "9000", MEDIA: "/srv/media/", ADMIN: "pass word", SIGNUPS: false }, start);
    expect(ok).toEqual({ values: { WEB_PORT: "9000", MEDIA: "/srv/media", DB_PASSWORD: "s".repeat(16), ADMIN: "pass word", SIGNUPS: "false" } });
    expect(answer(meta, { ADMIN: "x", WEB_PORT: "99999" }, start)).toEqual({ error: "form.badPort", name: "WEB_PORT" });
    expect(answer(meta, { ADMIN: "x", MEDIA: "media" }, start)).toEqual({ error: "form.badPath", name: "MEDIA" });
    expect(answer(meta, {}, start)).toEqual({ error: "form.required", name: "ADMIN" });
    expect(answer(meta, { ADMIN: "it's" }, start)).toEqual({ error: "form.badEnv", name: "ADMIN" });
    // a password left empty keeps the one there is
    expect("values" in answer(meta, { ADMIN: "" }, { ...start, ADMIN: "old" }) && (answer(meta, { ADMIN: "" }, { ...start, ADMIN: "old" }) as any).values.ADMIN).toBe("old");
  });
  test("ports and folders of the answers", () => {
    expect(settingPorts(meta, start)).toEqual([{ name: "WEB_PORT", port: 8096 }]);
    expect(settingFolders(meta, start)).toEqual(["/DATA/Media"]);
  });
  test("a line of .env is quoted when it has to be", () => {
    expect(envLine("A", "/DATA/Media")).toBe("A=/DATA/Media");
    expect(envLine("A", "two words # not a comment")).toBe("A='two words # not a comment'");
  });
});

test("the user an image runs as, read from its own files", async () => {
  const { accountId, firstTarFile } = await import("../src/docker");
  const passwd = "root:x:0:0:root:/root:/bin/sh\netherpad:x:5001:0::/home/etherpad:/bin/sh\n";
  expect(accountId(passwd, "etherpad")).toBe(5001);
  expect(accountId(passwd, "etherpad", 3)).toBe(0);
  expect(accountId(passwd, "nobody")).toBeNull();
  // a tar of one file: a 512-byte header with the size in octal at 124, then the file
  const header = new Uint8Array(512);
  header.set(new TextEncoder().encode("passwd"), 0);
  header.set(new TextEncoder().encode(passwd.length.toString(8).padStart(11, "0") + "\0"), 124);
  const tar = new Uint8Array(1024 + 512);
  tar.set(header, 0);
  tar.set(new TextEncoder().encode(passwd), 512);
  expect(firstTarFile(tar)).toBe(passwd);
});

test("a secret of hexadecimal digits is made so", () => {
  const app = readIndexApp(entry({ settings: [{ name: "CREDS_KEY", type: "secret", length: 64, chars: "hex", label: "Key" }] }), "", {})!;
  expect(app.meta.settings[0]).toMatchObject({ length: 64, chars: "hex" });
  expect(startingEnv(app.meta, {}, (n, chars) => (chars === "hex" ? "f" : "x").repeat(n))).toEqual({ CREDS_KEY: "f".repeat(64) });
});
