import { expect, test } from "bun:test";
import type { AttentionItem } from "../src/attention";
import { changeConfig, cleanConfig, DEFAULT_CONFIG, due, keyOf, ntfyRequest, QUIET_MS, SETTLE_MS, telegramRequest, webhookRequest, wording, type Seen } from "../src/notify";

const disk = (severity: AttentionItem["severity"] = "warn"): AttentionItem => ({ id: "disk:/", severity, code: "disk", detail: { path: "/", percent: 91, free: 9 * 1024 ** 3 } });
const restarting: AttentionItem = { id: "restarting:memos", severity: "danger", code: "restarting", detail: { title: "Memos", container: "memos" }, app: "memos" };
const failed = (at: number): AttentionItem => ({ id: "failed:backup:memos", severity: "warn", code: "failed.backup", detail: { title: "Memos", message: "tar: no space" }, app: "memos", at });

/** Runs the list through `due` at the given moments, as the server does twice a minute */
function run(steps: [number, AttentionItem[]][], seen: Seen = {}): string[][] {
  return steps.map(([now, items]) => {
    const result = due(items, seen, now);
    seen = result.seen;
    return result.send.map(keyOf);
  });
}

test("a problem is sent once, after it has lasted a while", () => {
  expect(run([[0, [disk()]], [30_000, [disk()]], [SETTLE_MS, [disk()]], [SETTLE_MS + 30_000, [disk()]], [10 * QUIET_MS, [disk()]]])).toEqual([[], [], ["disk:/"], [], []]);
});

test("a problem that is over before it has lasted is never sent", () => {
  expect(run([[0, [restarting]], [30_000, []], [30_000 + SETTLE_MS, [restarting]], [60_000 + SETTLE_MS, [restarting]], [30_000 + 2 * SETTLE_MS, [restarting]]])).toEqual([[], [], [], [], ["restarting:memos"]]);
  expect(run([[0, [restarting]], [30_000, []], [10 * SETTLE_MS, []]])).toEqual([[], [], []]);
});

test("a problem that flickers still counts from when it began", () => {
  expect(run([[0, [restarting]], [30_000, []], [60_000, [restarting]], [90_000, []], [120_000, [restarting]], [150_000, [restarting]]])).toEqual([[], [], [], [], ["restarting:memos"], []]);
});

test("a problem that comes and goes is the same problem for six hours", () => {
  const steps: [number, AttentionItem[]][] = [[0, [disk()]], [SETTLE_MS, [disk()]], [200_000, []], [300_000, [disk()]], [300_000 + SETTLE_MS, [disk()]], [400_000, []]];
  expect(run([...steps, [400_000 + QUIET_MS, []], [500_000 + QUIET_MS, [disk()]], [500_000 + QUIET_MS + SETTLE_MS, [disk()]]])).toEqual([[], ["disk:/"], [], [], [], [], [], [], ["disk:/"]]);
});

test("a warning that turns into a danger is sent again, at once", () => {
  expect(run([[0, [disk()]], [SETTLE_MS, [disk()]], [SETTLE_MS + 30_000, [disk("danger")]], [SETTLE_MS + 60_000, [disk("danger")]], [SETTLE_MS + 90_000, [disk()]]])).toEqual([[], ["disk:/"], ["disk:/"], [], []]);
});

test("every failure and every new version is news", () => {
  const update = (version: string): AttentionItem => ({ id: "update", severity: "warn", code: "update", detail: { version } });
  const sent = run([[0, [failed(1), update("0.4.0")]], [SETTLE_MS, [failed(1), update("0.4.0")]], [SETTLE_MS + 30_000, [failed(2), update("0.5.0")]], [2 * SETTLE_MS + 30_000, [failed(2), update("0.5.0")]]]);
  expect(sent).toEqual([[], ["failed:backup:memos@1", "update@0.4.0"], [], ["failed:backup:memos@2", "update@0.5.0"]]);
});

test("the words are those of the home page, in the language asked for", () => {
  expect(wording([disk()], "en")).toEqual([{ title: "Disk / is 91% full", text: "9.0 GB left.", severity: "warn", route: "#/", tag: "disk:/", code: "disk", app: undefined }]);
  expect(wording([restarting], "uk")[0]).toMatchObject({ title: "Memos постійно перезапускається", route: "#/apps/memos/logs", severity: "danger" });
  expect(wording([failed(5)], "xx")[0]).toMatchObject({ title: "Backup of Memos failed", text: "tar: no space", route: "#/apps/memos", tag: "failed:backup:memos@5" });
});

test("many problems at once arrive as one message", () => {
  const many = ["a", "b", "c", "d"].map((name): AttentionItem => ({ id: `partial:${name}`, severity: "warn", code: "partial", detail: { title: name.toUpperCase(), container: name }, app: name }));
  expect(wording(many.slice(0, 3), "en")).toHaveLength(3);
  const [message, ...rest] = wording([...many, restarting], "en");
  expect(rest).toEqual([]);
  expect(message).toMatchObject({ title: "5 things need attention", severity: "danger", route: "#/" });
  expect(message!.text.split("\n")).toEqual(["• A is only partly running", "• B is only partly running", "• C is only partly running", "• D is only partly running", "• Memos keeps restarting"]);
});

test("settings: a channel switched on has to be filled in, and filled in right", () => {
  const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
  expect(changeConfig(DEFAULT_CONFIG, { telegram: { enabled: true } })).toBe("notify.needTelegram");
  expect(changeConfig(DEFAULT_CONFIG, { telegram: { token: "nonsense" } })).toBe("notify.badToken");
  expect(changeConfig(DEFAULT_CONFIG, { telegram: { token, chat: "my chat" } })).toBe("notify.badChat");
  const telegram = changeConfig(DEFAULT_CONFIG, { telegram: { enabled: true, token: ` ${token} `, chat: "-1001234" } });
  expect(telegram).toMatchObject({ problems: true, telegram: { enabled: true, token, chat: "-1001234" } });
  // a part of the settings leaves the rest as it was
  expect(changeConfig(telegram as typeof DEFAULT_CONFIG, { problems: false })).toMatchObject({ problems: false, telegram: { enabled: true, token } });
  expect(changeConfig(DEFAULT_CONFIG, { ntfy: { enabled: true, url: "https://ntfy.sh/" } })).toBe("notify.badNtfy");
  expect(changeConfig(DEFAULT_CONFIG, { ntfy: { enabled: true, url: "https://ntfy.sh/hata-7f3k" } })).toMatchObject({ ntfy: { enabled: true } });
  expect(changeConfig(DEFAULT_CONFIG, { webhook: { enabled: true, url: "ftp://example.com/x" } })).toBe("notify.badUrl");
  expect(changeConfig(DEFAULT_CONFIG, { webhook: { enabled: true } })).toBe("notify.badUrl");
  expect(changeConfig(DEFAULT_CONFIG, "x")).toBe("notify.bad");
  expect(cleanConfig({ telegram: { enabled: true } })).toEqual(DEFAULT_CONFIG);
  expect(cleanConfig(undefined)).toEqual(DEFAULT_CONFIG);
});

test("the requests to the services", () => {
  const [message] = wording([{ ...restarting, detail: { title: "A <b> & C", container: "c" } }], "en");
  const base = "https://hata.example/";
  const telegram = telegramRequest({ enabled: true, token: "1:abc", chat: "42" }, message!, base);
  expect(telegram.url).toBe("https://api.telegram.org/bot1:abc/sendMessage");
  const sent = JSON.parse(telegram.body);
  expect(sent).toMatchObject({ chat_id: "42", parse_mode: "HTML" });
  expect(sent.text).toStartWith("🔴 <b>A &lt;b&gt; &amp; C keeps restarting</b>\nContainer c does not stay up");
  expect(sent.text).toContain('<a href="https://hata.example/#/apps/memos/logs">');

  const ntfy = ntfyRequest({ enabled: true, url: "https://ntfy.example/sub/home-alerts", token: "tk_1" }, message!, base);
  expect(ntfy.url).toBe("https://ntfy.example/");
  expect(ntfy.headers.authorization).toBe("Bearer tk_1");
  expect(JSON.parse(ntfy.body)).toMatchObject({ topic: "home-alerts", title: "A <b> & C keeps restarting", priority: 5, click: "https://hata.example/#/apps/memos/logs" });
  expect(ntfyRequest({ enabled: true, url: "https://ntfy.sh/t", token: "" }, message!, base).headers.authorization).toBeUndefined();

  const hook = webhookRequest({ enabled: true, url: "http://192.168.1.5:5678/webhook/hata" }, message!, base, Date.UTC(2026, 9, 10));
  expect(hook.url).toBe("http://192.168.1.5:5678/webhook/hata");
  expect(JSON.parse(hook.body)).toMatchObject({ severity: "danger", code: "restarting", app: "memos", url: "https://hata.example/#/apps/memos/logs", time: "2026-10-10T00:00:00.000Z" });
});
