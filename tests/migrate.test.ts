import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envText } from "../src/apps";
import { copyApps, iniValue, parseEnvFile, planCasaos } from "../src/migrate";

const COMPOSE = "name: memos\nservices:\n  memos:\n    image: neosmemo/memos:0.28.0\nx-casaos:\n  title: { en_US: Memos }\n";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hata-migrate-"));
  const casaos = join(root, "casaos");
  const hata = join(root, "hata");
  const app = (name: string, file: string, text: string) => {
    mkdirSync(join(casaos, name), { recursive: true });
    writeFileSync(join(casaos, name, file), text);
  };
  app("memos", "docker-compose.yml", COMPOSE);
  app("syncthing", "docker-compose.yaml", COMPOSE.replaceAll("memos", "syncthing").replace("Memos", "Syncthing"));
  app("taken", "docker-compose.yml", COMPOSE);
  app("Bad Name", "docker-compose.yml", COMPOSE);
  app("broken", "docker-compose.yml", "services: [");
  mkdirSync(join(casaos, "empty"));
  mkdirSync(join(hata, "taken"), { recursive: true });
  return { casaos, hata };
}

test("the plan says what happens to every CasaOS app", () => {
  const { casaos, hata } = fixture();
  const plan = planCasaos(casaos, hata);
  expect(plan.map((a) => [a.name, a.status])).toEqual([
    ["Bad Name", "badName"],
    ["broken", "badCompose"],
    ["memos", "ready"],
    ["syncthing", "ready"],
    ["taken", "exists"],
  ]);
  expect(plan.find((a) => a.name === "memos")!.title).toBe("Memos");
  expect(planCasaos(join(casaos, "nowhere"), hata)).toEqual([]);
});

test("only ready apps are copied, and the compose file is copied as it is", () => {
  const { casaos, hata } = fixture();
  const envs: string[] = [];
  const moved = copyApps(planCasaos(casaos, hata), hata, (name) => envs.push(name));
  expect(moved).toEqual(["memos", "syncthing"]);
  expect(envs).toEqual(moved);
  expect(readFileSync(join(hata, "memos", "compose.yml"), "utf8")).toBe(COMPOSE);
  expect(existsSync(join(hata, "broken"))).toBe(false);
  expect(existsSync(join(hata, "taken", "compose.yml"))).toBe(false);
  // the source stays: CasaOS can take the apps back
  expect(existsSync(join(casaos, "memos", "docker-compose.yml"))).toBe(true);
});

test("CasaOS config readers", () => {
  expect(iniValue("[app]\nLogPath = /var/log\nAppsPath = /mnt/apps \n", "AppsPath")).toBe("/mnt/apps");
  expect(iniValue("[app]\n", "AppsPath")).toBeNull();
  expect(parseEnvFile("# note\nOPENAI_API_KEY=sk-x\n\nbroken line\nA = b c\n")).toEqual({ OPENAI_API_KEY: "sk-x", A: "b c" });
});

test(".env keeps the user's lines and refreshes ours", () => {
  const first = envText("memos", "", { OPENAI_API_KEY: "sk-x", TZ: "ignored" });
  expect(first).toContain("AppID=memos\n");
  expect(first).toContain("OPENAI_API_KEY=sk-x\n");
  expect(first).not.toContain("TZ=ignored");
  const edited = first.replace("OPENAI_API_KEY=sk-x", "OPENAI_API_KEY=real\n# mine\nEXTRA=1").replace(/PUID=\d+/, "PUID=4242");
  const second = envText("memos", edited);
  expect(second).toContain("OPENAI_API_KEY=real\n# mine\nEXTRA=1\n");
  expect(second).not.toContain("PUID=4242");
  expect(second.match(/AppID=/g)!.length).toBe(1);
  expect(envText("memos", second)).toBe(second);
});
