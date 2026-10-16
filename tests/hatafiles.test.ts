import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appMeta } from "../src/appform";
import { foldersOfFiles, hataFileText, hataMetaIn, viewOfFiles } from "../src/apps";
import { readIndexApp } from "../src/hataapp";

process.env.HATA_CLIENT_APPS = mkdtempSync(join(tmpdir(), "hata-client-apps-"));
const client = await import("../src/clientapps");

const app = readIndexApp(
  {
    id: "notes",
    title: "Notes",
    compose: "services:\n  notes:\n    image: notes:1\n    ports:\n      - ${WEB_PORT}:3000\n    volumes:\n      - ${APP_DATA}/db:/db\n      - ${SHARED}:/shared\n      - ./config/app.yml:/app.yml\n",
    web: { service: "notes", port: 3000 },
    settings: [
      { name: "WEB_PORT", type: "port", default: 3000, label: "Port" },
      { name: "SHARED", type: "folder", default: "${DATA_ROOT}/Notes", label: "Notes" },
    ],
    files: { "config/app.yml": "mode: home\n", ".env.example": "WEB_PORT=3000\n" },
  },
  "https://example.org/",
  {},
)!;

const files = (dataRoot: string) => ({
  compose: app.compose,
  env: `APP_DATA=${dataRoot}/AppData/notes\nWEB_PORT=3010\nSHARED=${dataRoot}/Notes\n`,
  hata: hataFileText("hata", Bun.YAML.parse(app.compose) as object, app),
  others: app.files,
});

test("the view of an app of Hata's format from its files: filled from .env, the tile from hata.yml", () => {
  const view = viewOfFiles(files("/srv"))!;
  expect(view.services.notes.ports).toEqual(["3010:3000"]);
  expect(appMeta(view, "en")).toMatchObject({ title: "Notes", port: "3010" });
  expect(hataMetaIn(files("/srv").hata)?.files).toEqual(app.files);
  expect(hataMetaIn("store: casaos\nbase: {}\n")).toBeNull();
  expect(viewOfFiles({ compose: "services: [", env: "", hata: null })).toBeNull();
});

test("the folders made before the first start: the app's own and the settings' ones, under the data folder", () => {
  const made = foldersOfFiles(files("/srv"), "/srv", "notes");
  expect(made).toContain("/srv/AppData/notes/db");
  expect(made).toContain("/srv/Notes");
});

test("the client keeps the other files hata.yml names, and nothing outside the app's folder", () => {
  client.write({ name: "notes", fresh: true, files: { "compose.yml": app.compose, ".env": "A=1\n", "hata.yml": files("/DATA").hata, ...app.files } });
  expect(readFileSync(join(process.env.HATA_CLIENT_APPS!, "notes", "config/app.yml"), "utf8")).toBe("mode: home\n");
  const listed = client.list().find((a) => a.name === "notes")!;
  expect(listed.others).toEqual(app.files);
  for (const path of ["../escape", "config/../../x", "/etc/passwd", "a//b", "x.tmp"]) {
    expect(() => client.write({ name: "notes", files: { [path]: "x" } })).toThrow();
  }
  // a file hata.yml does not name is not the store's: it does not travel
  symlinkSync("/etc/hostname", join(process.env.HATA_CLIENT_APPS!, "notes", "stray"));
  expect(Object.keys(client.list().find((a) => a.name === "notes")!.others)).toEqual(Object.keys(app.files));
});
