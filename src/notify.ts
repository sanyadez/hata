/**
 * Notifications: what the "needs attention" list shows on the home page is also sent to where the
 * administrators are — their devices (Web Push), a Telegram chat, an ntfy topic, a webhook.
 *
 * The rules of when to send (`due`), the wording and the requests to the services are pure functions;
 * the rest keeps `notify.json` (the settings, the server's push key, the subscribed devices, what has been
 * sent) and looks at the list twice a minute.
 */
import { hostname } from "node:os";
import { join } from "node:path";
import type { AttentionItem } from "./attention";
import { SECRETS_DIR, settings } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic } from "./fsutil";
import { cleanSubscription, generateVapid, sendPush, type PushTarget, type VapidKeys } from "./push";
import en from "./lang/en.json";
import uk from "./lang/uk.json";

const LANGUAGES: Record<string, Record<string, string>> = { en, uk };

export const CHANNELS = ["push", "telegram", "ntfy", "webhook"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface NotifyConfig {
  /** Send what needs attention; off — nothing is sent, the channels stay set up */
  problems: boolean;
  telegram: { enabled: boolean; token: string; chat: string };
  /** `url` is the address of the topic (`https://ntfy.sh/my-topic`); `token` — for a protected topic */
  ntfy: { enabled: boolean; url: string; token: string };
  webhook: { enabled: boolean; url: string };
}

export const DEFAULT_CONFIG: NotifyConfig = {
  problems: true,
  telegram: { enabled: false, token: "", chat: "" },
  ntfy: { enabled: false, url: "", token: "" },
  webhook: { enabled: false, url: "" },
};

const text = (value: unknown, fallback: string): string => (typeof value === "string" ? value.trim() : fallback);

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && value.length <= 2048;
  } catch {
    return false;
  }
}

/** The topic of an ntfy address: its last path segment */
const ntfyTopic = (url: string): string => (httpUrl(url) ? (new URL(url).pathname.split("/").filter(Boolean).pop() ?? "") : "");

/** Applies a change to the settings; returns them or the code of what is wrong. A channel switched on must be filled in. */
export function changeConfig(current: NotifyConfig, patch: unknown): NotifyConfig | string {
  if (!isPlainObject(patch)) return "notify.bad";
  const next: NotifyConfig = structuredClone(current);
  if ("problems" in patch) next.problems = patch.problems === true;
  if (isPlainObject(patch.telegram)) {
    const p = patch.telegram;
    next.telegram = { enabled: "enabled" in p ? p.enabled === true : next.telegram.enabled, token: text(p.token, next.telegram.token), chat: text(p.chat, next.telegram.chat) };
  }
  if (isPlainObject(patch.ntfy)) {
    const p = patch.ntfy;
    next.ntfy = { enabled: "enabled" in p ? p.enabled === true : next.ntfy.enabled, url: text(p.url, next.ntfy.url), token: text(p.token, next.ntfy.token) };
  }
  if (isPlainObject(patch.webhook)) {
    const p = patch.webhook;
    next.webhook = { enabled: "enabled" in p ? p.enabled === true : next.webhook.enabled, url: text(p.url, next.webhook.url) };
  }
  const { telegram, ntfy, webhook } = next;
  if (telegram.token && !/^\d+:[\w-]{20,}$/.test(telegram.token)) return "notify.badToken";
  if (telegram.chat && !/^(-?\d+|@\w{4,})$/.test(telegram.chat)) return "notify.badChat";
  if (telegram.enabled && !(telegram.token && telegram.chat)) return "notify.needTelegram";
  if ((ntfy.url && !ntfyTopic(ntfy.url)) || /[\r\n]/.test(ntfy.token) || (ntfy.enabled && !ntfy.url)) return "notify.badNtfy";
  if ((webhook.url && !httpUrl(webhook.url)) || (webhook.enabled && !webhook.url)) return "notify.badUrl";
  return next;
}

/** The settings as read from the file: whatever does not hold is dropped back to the defaults */
export function cleanConfig(raw: unknown): NotifyConfig {
  const config = changeConfig(DEFAULT_CONFIG, raw);
  return typeof config === "string" ? structuredClone(DEFAULT_CONFIG) : config;
}

// --- When to send -------------------------------------------------------------------------------

/** What is remembered about an item of the list, by `keyOf` */
export interface SeenItem {
  /** When it appeared */
  since: number;
  /** When it was sent, and how serious it was then */
  sent?: number;
  severity?: AttentionItem["severity"];
  /** When it went away — kept for a while, so one that comes and goes is not sent each time */
  gone?: number;
}
export type Seen = Record<string, SeenItem>;

/** A problem has to last this long before it is sent: a container restarted by hand is not one */
export const SETTLE_MS = 90_000;
/** A problem that went away and came back within this time is the same problem */
export const QUIET_MS = 6 * 3600_000;

/** A failure is an event — the next one is news again; so is the next version */
export const keyOf = (item: AttentionItem): string => (item.at ? `${item.id}@${item.at}` : item.code === "update" ? `${item.id}@${item.detail.version}` : item.id);

/**
 * Which items of the list to send now, given what was seen before: each problem once — after it has
 * lasted `SETTLE_MS`, and again when it turns from a warning into a danger.
 */
export function due(items: AttentionItem[], seen: Seen, now: number): { send: AttentionItem[]; seen: Seen } {
  const next: Seen = {};
  const send: AttentionItem[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const old = seen[key];
    // back after too long a pause to be the same occurrence
    const was = old && (old.gone === undefined || now - old.gone < (old.sent === undefined ? SETTLE_MS : QUIET_MS)) ? old : undefined;
    const record: SeenItem = was ? { since: was.since, sent: was.sent, severity: was.severity } : { since: now };
    const worse = record.sent !== undefined && record.severity === "warn" && item.severity === "danger";
    if ((record.sent === undefined || worse) && now - record.since >= SETTLE_MS) {
      send.push(item);
      record.sent = now;
      record.severity = item.severity;
    }
    next[key] = record;
  }
  for (const [key, record] of Object.entries(seen)) {
    if (key in next) continue;
    const gone = record.gone ?? now;
    // one not sent yet is remembered briefly: a container that keeps restarting is "running" in between
    if (now - gone < (record.sent === undefined ? SETTLE_MS : QUIET_MS)) next[key] = { ...record, gone };
  }
  return { send, seen: next };
}

// --- Wording ------------------------------------------------------------------------------------

export interface Message {
  title: string;
  text: string;
  severity: AttentionItem["severity"] | "info";
  /** The page of Hata it is about, as a hash route: `#/apps/memos` */
  route: string;
  /** Notifications with the same tag replace one another on a device */
  tag: string;
  code: string;
  app?: string;
}

function tr(lang: string, key: string, vars: Record<string, string | number> = {}): string {
  const template = LANGUAGES[lang]?.[key] ?? LANGUAGES.en![key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : ""));
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
function bytes(n: number): string {
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  return (i === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)) + " " + UNITS[i];
}

/** How many problems are spelled out one by one; more than that arrive as a single message */
const SEPARATE = 3;

/** The messages for the items to send, in the words of the home page */
export function wording(items: AttentionItem[], lang: string): Message[] {
  const one = (item: AttentionItem): Message => {
    const detail = { ...item.detail, free: typeof item.detail.free === "number" ? bytes(item.detail.free) : "" };
    const tab = item.code === "restarting" || item.code === "partial" ? "/logs" : "";
    return {
      title: tr(lang, `attention.${item.code}.title`, detail),
      text: tr(lang, `attention.${item.code}.text`, detail).trim(),
      severity: item.severity,
      route: item.app ? `#/apps/${item.app}${tab}` : item.code === "update" ? "#/settings/about" : "#/",
      tag: keyOf(item),
      code: item.code,
      app: item.app,
    };
  };
  const all = items.map(one);
  if (all.length <= SEPARATE) return all;
  return [
    {
      title: tr(lang, "notify.several", { n: all.length }),
      text: all.map((m) => "• " + m.title).join("\n"),
      severity: all.some((m) => m.severity === "danger") ? "danger" : "warn",
      route: "#/",
      tag: "several",
      code: "several",
    },
  ];
}

export const testMessage = (lang: string): Message => ({ title: tr(lang, "notify.test.title"), text: tr(lang, "notify.test.text", { host: hostname() }), severity: "info", route: "#/settings/notifications", tag: "test", code: "test" });

// --- The services -------------------------------------------------------------------------------

export interface Outgoing {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MARKS = { danger: "🔴", warn: "🟠", info: "🏠" } as const;

export function telegramRequest(config: NotifyConfig["telegram"], message: Message, base: string): Outgoing {
  const lines = [`${MARKS[message.severity]} <b>${escapeHtml(message.title)}</b>`, escapeHtml(message.text), `<a href="${escapeHtml(base + message.route)}">${escapeHtml(hostname())}</a>`];
  return {
    url: `https://api.telegram.org/bot${config.token}/sendMessage`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: config.chat, text: lines.filter(Boolean).join("\n"), parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
  };
}

/** ntfy takes a message as JSON at the root of its server, the topic inside */
export function ntfyRequest(config: NotifyConfig["ntfy"], message: Message, base: string): Outgoing {
  return {
    url: new URL(config.url).origin + "/",
    headers: { "content-type": "application/json", ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
    body: JSON.stringify({
      topic: ntfyTopic(config.url),
      title: message.title,
      message: message.text || message.title,
      priority: message.severity === "danger" ? 5 : message.severity === "warn" ? 4 : 3,
      tags: [message.severity === "danger" ? "rotating_light" : message.severity === "warn" ? "warning" : "house"],
      click: base + message.route,
    }),
  };
}

export function webhookRequest(config: NotifyConfig["webhook"], message: Message, base: string, now = Date.now()): Outgoing {
  const { title, text, severity, code, app } = message;
  return {
    url: config.url,
    headers: { "content-type": "application/json", "user-agent": "Hata" },
    body: JSON.stringify({ title, text, severity, code, app: app ?? null, url: base + message.route, server: hostname(), time: new Date(now).toISOString() }),
  };
}

const SEND_TIMEOUT_MS = 15_000;

async function post(request: Outgoing): Promise<void> {
  const res = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, signal: AbortSignal.timeout(SEND_TIMEOUT_MS), redirect: "error" });
  if (res.ok) return;
  const reply = await res.text().catch(() => "");
  let said = reply.slice(0, 200);
  try {
    // Telegram and ntfy explain themselves in JSON
    const parsed: unknown = JSON.parse(reply);
    if (isPlainObject(parsed)) said = String(parsed.description ?? parsed.error ?? said);
  } catch {}
  throw new Error(`HTTP ${res.status}${said ? ": " + said : ""}`);
}

/** A bot token never belongs in an error shown on a page or written to a log */
const withoutSecrets = (message: string, config: NotifyConfig): string => (config.telegram.token ? message.replaceAll(config.telegram.token, "…") : message);

// --- State --------------------------------------------------------------------------------------

export interface Device extends PushTarget {
  id: string;
  /** Whose device it is (user id): only administrators are sent anything */
  user: string;
  label: string;
  /** The language of the page that subscribed */
  lang: string;
  /** Who runs the server, for the push service: the address the device subscribed at */
  subject: string;
  createdAt: number;
}

interface State {
  config: NotifyConfig;
  vapid?: VapidKeys;
  devices: Device[];
  seen: Seen;
  /** The last attempt per channel, for the settings page */
  last: Partial<Record<Channel, { at: number; error?: string }>>;
}

const FILE = join(SECRETS_DIR, "notify.json");
const MAX_DEVICES = 50;

const saved = readJsonFile<Partial<State>>(FILE, {}, isPlainObject);
const state: State = {
  config: cleanConfig(saved.config),
  vapid: isPlainObject(saved.vapid) ? (saved.vapid as unknown as VapidKeys) : undefined,
  devices: Array.isArray(saved.devices) ? saved.devices.filter((d) => isPlainObject(d) && cleanSubscription(d) !== null) : [],
  seen: isPlainObject(saved.seen) ? (saved.seen as Seen) : {},
  last: isPlainObject(saved.last) ? saved.last : {},
};

function save(): void {
  try {
    writeJsonAtomic(FILE, state);
  } catch (e) {
    console.error("Could not write notify.json:", e instanceof Error ? e.message : e);
  }
}

/** What the server tells this module about itself */
interface Host {
  /** The list of the home page as it is now */
  attention: () => Promise<AttentionItem[]>;
  /** The address of the web UI, ending in "/" */
  baseUrl: () => string;
  isAdmin: (userId: string) => boolean;
}
let host: Host | null = null;

const devicesOfAdmins = (): Device[] => state.devices.filter((d) => host?.isAdmin(d.user) ?? false);

/** The channels that would carry a message now */
export function activeChannels(): Channel[] {
  const { telegram, ntfy, webhook } = state.config;
  return CHANNELS.filter((c) => (c === "push" ? devicesOfAdmins().length > 0 : c === "telegram" ? telegram.enabled : c === "ntfy" ? ntfy.enabled : webhook.enabled));
}

export const notifyConfig = (): NotifyConfig => state.config;
export const notifyStatus = () => ({ config: state.config, last: state.last, active: activeChannels() });

export function updateNotify(patch: unknown): string | null {
  const next = changeConfig(state.config, patch);
  if (typeof next === "string") return next;
  state.config = next;
  save();
  return null;
}

async function vapid(): Promise<VapidKeys> {
  if (!state.vapid) {
    state.vapid = await generateVapid();
    save();
  }
  return state.vapid;
}

export const pushKey = async (): Promise<string> => (await vapid()).publicKey;

const deviceId = (endpoint: string): string => new Bun.CryptoHasher("sha256").update(endpoint).digest("hex").slice(0, 12);

export const listDevices = (user: string) => state.devices.filter((d) => d.user === user).map(({ id, label, createdAt, endpoint }) => ({ id, label, createdAt, endpoint, service: new URL(endpoint).host }));

/** Subscribes a device of `user`, or renews the subscription it already has; returns an error code or null */
export function addDevice(user: string, input: { subscription: unknown; label: unknown; lang: string; origin: string }): string | null {
  const target = cleanSubscription(input.subscription);
  if (!target) return "notify.badSubscription";
  const others = state.devices.filter((d) => d.endpoint !== target.endpoint);
  if (others.length >= MAX_DEVICES) return "notify.tooManyDevices";
  const label = text(input.label, "").slice(0, 80) || "—";
  state.devices = [...others, { ...target, id: deviceId(target.endpoint), user, label, lang: input.lang, subject: input.origin, createdAt: Date.now() }];
  save();
  return null;
}

/** By id among the user's own devices, or by the endpoint the browser itself names */
export function removeDevice(user: string, idOrEndpoint: string): boolean {
  const before = state.devices.length;
  state.devices = state.devices.filter((d) => d.user !== user || (d.id !== idOrEndpoint && d.endpoint !== idOrEndpoint));
  if (state.devices.length === before) return false;
  save();
  return true;
}

// --- Sending ------------------------------------------------------------------------------------

async function toDevices(devices: Device[], message: (lang: string) => Message[]): Promise<void> {
  const keys = await vapid();
  const gone = new Set<string>();
  const errors: string[] = [];
  await Promise.all(
    devices.flatMap((device) =>
      message(device.lang).map(async (m) => {
        try {
          const payload = { title: m.title, body: m.text, tag: m.tag, url: "/" + m.route };
          if ((await sendPush(device, payload, keys, device.subject)) === "gone") gone.add(device.id);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }),
    ),
  );
  if (gone.size) state.devices = state.devices.filter((d) => !gone.has(d.id));
  if (errors.length) throw new Error(errors[0]);
}

/** Sends over one channel and notes how it went; the error comes back as text */
async function deliver(channel: Channel, message: (lang: string) => Message[], devices = devicesOfAdmins()): Promise<string | null> {
  const { config } = state;
  const base = host?.baseUrl() ?? "/";
  let error: string | null = null;
  try {
    if (channel === "push") await toDevices(devices, message);
    else {
      for (const m of message(settings.language)) {
        await post(channel === "telegram" ? telegramRequest(config.telegram, m, base) : channel === "ntfy" ? ntfyRequest(config.ntfy, m, base) : webhookRequest(config.webhook, m, base));
      }
    }
  } catch (e) {
    error = withoutSecrets(e instanceof Error ? e.message : String(e), config);
  }
  state.last[channel] = error ? { at: Date.now(), error } : { at: Date.now() };
  save();
  return error;
}

/** A test message over one channel; `user` and `device` narrow a push to one device of that user */
export async function sendTest(channel: Channel, user: string, device?: string): Promise<string | null> {
  const own = state.devices.filter((d) => d.user === user && (!device || d.id === device || d.endpoint === device));
  if (channel === "push" && own.length === 0) return "this device is not subscribed";
  return deliver(channel, (lang) => [testMessage(lang)], own);
}

/** Chats that have written to the bot lately — to pick the chat instead of looking its number up */
export async function telegramChats(token: unknown): Promise<{ id: string; title: string }[] | string> {
  if (typeof token !== "string" || !/^\d+:[\w-]{20,}$/.test(token.trim())) return "notify.badToken";
  const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getUpdates`, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) }).catch(() => null);
  const data: unknown = await res?.json().catch(() => null);
  if (!res?.ok || !isPlainObject(data) || !Array.isArray(data.result)) return "notify.telegramRefused";
  const chats = new Map<string, string>();
  for (const update of data.result as Record<string, any>[]) {
    const chat = (update.message ?? update.channel_post ?? update.my_chat_member)?.chat;
    if (!chat || typeof chat.id !== "number") continue;
    chats.set(String(chat.id), String(chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || chat.id));
  }
  return [...chats].map(([id, title]) => ({ id, title })).reverse();
}

const CHECK_EVERY_MS = 30_000;
let checking = false;

async function check(): Promise<void> {
  if (checking || !host || !state.config.problems) return;
  const channels = activeChannels();
  // with nowhere to send, nothing is marked as sent: the first channel set up hears of what is wrong now
  if (channels.length === 0) return;
  checking = true;
  try {
    const result = due(await host.attention(), state.seen, Date.now());
    const changed = JSON.stringify(result.seen) !== JSON.stringify(state.seen);
    state.seen = result.seen;
    if (changed) save();
    if (result.send.length === 0) return;
    const errors = await Promise.all(channels.map((channel) => deliver(channel, (lang) => wording(result.send, lang))));
    errors.forEach((error, i) => error && console.error(`Notification over ${channels[i]} failed: ${error}`));
  } catch (e) {
    console.error("Could not check what needs attention:", e instanceof Error ? e.message : e);
  } finally {
    checking = false;
  }
}

export function startNotifications(server: Host): void {
  host = server;
  setInterval(() => void check(), CHECK_EVERY_MS);
}
