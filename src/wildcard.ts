/**
 * One certificate for the domain and every name under it (Settings → Domains and HTTPS). The authority gives
 * a wildcard only for a TXT record at `_acme-challenge.<domain>`, and there are three ways to put it there:
 * the DNS provider's API (`dnsapi.ts`, the token kept in `dns-api.json`), Hata's own DNS server with that one
 * name delegated to it, or the person, who is shown the record and says when it is in place. Renewal goes the
 * same way by itself, the person's way asking again.
 */
import { createSocket } from "node:dgram";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { onWildcard, certificateStates } from "./acme";
import { record } from "./activity";
import { AppError } from "./apps";
import type { AttentionItem } from "./attention";
import { saveSettings, SECRETS_DIR, settings } from "./config";
import { challengeName, delegateServer, queryFor, TYPE, txtsOf } from "./dns";
import { cleanApi, DnsApiError, presenterFor, PROVIDERS, type DnsApi, type Presenter } from "./dnsapi";
import { setChallenge, syncDns } from "./dnsserver";
import { readJsonFile, writeJsonAtomic } from "./fsutil";
import { siteDomain } from "./site";

const API_FILE = join(SECRETS_DIR, "dns-api.json");
const kept = (): DnsApi | null => readJsonFile<DnsApi | null>(API_FILE, null);
/** A local test authority has its own DNS: the public one knows nothing of what it asks about */
const testing = (): boolean => process.env.HATA_ACME_INSECURE === "1";
const provider = (api: DnsApi): Presenter => presenterFor(api, fetch, process.env.HATA_DNS_API || undefined);

const SETTLE_FIRST_MS = 15_000;
const SETTLE_MAX_MS = 120_000;
/** The record the person was shown waits this long for them */
const MANUAL_MS = 7 * 24 * 3600_000;

/** One question to a public resolver */
function askTxt(server: string, name: string): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    const done = (values: string[]) => {
      clearTimeout(timer);
      socket.close();
      resolve(values);
    };
    const timer = setTimeout(() => done([]), 3000);
    socket.on("message", (msg) => done(txtsOf(new Uint8Array(msg))));
    socket.on("error", () => done([]));
    socket.send(queryFor(name, TYPE.TXT, Math.floor(Math.random() * 65535)), 53, server);
  });
}

/** Waits for a TXT record to be seen from outside; past the limit the authority is told to look all the same */
async function settle(name: string, values: string[]): Promise<void> {
  if (testing()) return;
  await Bun.sleep(SETTLE_FIRST_MS);
  const until = Date.now() + SETTLE_MAX_MS;
  while (Date.now() < until) {
    const seen = await Promise.all(["1.1.1.1", "8.8.8.8"].map((server) => askTxt(server, name)));
    if (seen.some((list) => values.every((v) => list.includes(v)))) return;
    await Bun.sleep(5000);
  }
}

let manual: { name: string; values: string[]; since: number; go: () => void; stop: () => void } | null = null;

function presenter(): Presenter {
  const via = settings.https.wildcard;
  if (via === "api") {
    const api = kept();
    if (!api) throw new DnsApiError("No DNS provider is set");
    const p = provider(api);
    return { ...p, add: async (name, values) => (await p.add(name, values), await settle(name, values)) };
  }
  if (via === "delegate") {
    return {
      oneAtATime: false,
      check: async () => {},
      add: async (_name, values) => {
        if (!settings.dns.enabled) throw new DnsApiError("Hata's DNS server is off");
        setChallenge(values);
      },
      remove: async () => setChallenge([]),
    };
  }
  return {
    oneAtATime: false,
    check: async () => {},
    add: (name, values) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          manual = null;
          reject(new DnsApiError("The TXT record was not confirmed in time"));
        }, MANUAL_MS);
        const end = () => clearTimeout(timer);
        manual = { name, values, since: Date.now(), go: () => (end(), resolve()), stop: () => (end(), reject(new DnsApiError("Another way was chosen"))) };
      }),
    remove: async () => void (manual = null),
  };
}
onWildcard(presenter);

/** What the page shows */
export function wildcardReport() {
  const domain = siteDomain();
  const api = kept();
  return {
    via: settings.https.wildcard,
    providers: PROVIDERS,
    provider: api?.provider ?? "",
    saved: !!api,
    dns: settings.dns.enabled,
    name: domain ? challengeName(domain) : "",
    server: domain ? delegateServer(domain) : "",
    manual: manual && { name: manual.name, values: manual.values, since: manual.since },
  };
}

/** Chooses the way; the provider's sign-in is tried before it is kept */
export async function setWildcard(input: Record<string, unknown>, by: string): Promise<void> {
  const via = input.via;
  if (via !== "off" && via !== "api" && via !== "delegate" && via !== "manual") throw new AppError("wildcard.badWay", 400);
  const domain = siteDomain();
  if (via !== "off" && (settings.https.mode !== "acme" || !domain)) throw new AppError("wildcard.needAcme", 409);
  if (via === "delegate" && !settings.dns.enabled) throw new AppError("wildcard.dnsOff", 409);
  if (via === "api") {
    const api = cleanApi(input, kept());
    if (!api) throw new AppError("wildcard.badApi", 400);
    try {
      await provider(api).check(domain);
    } catch (e) {
      throw new AppError("wildcard.apiRefused", 409, { message: e instanceof Error ? e.message : String(e) });
    }
    writeJsonAtomic(API_FILE, api, 0o600);
  }
  // a token nothing uses is not kept
  if (via !== "api") rmSync(API_FILE, { force: true });
  manual?.stop();
  settings.https = { ...settings.https, wildcard: via };
  saveSettings();
  await syncDns();
  record(via === "off" ? "https.wildcardOff" : "https.wildcardOn", { user: by, detail: domain });
}

/** The person says the TXT record is in place: it is looked for from outside, then the authority is told */
export function manualDone(): void {
  if (!manual) throw new AppError("wildcard.nothingWaits", 409);
  const { name, values, go } = manual;
  void settle(name, values).then(go);
}

/** For the attention list: a record the person has to put in place, a wildcard that could not be had */
export function wildcardTrouble(): AttentionItem[] {
  const domain = siteDomain();
  if (settings.https.mode !== "acme" || settings.https.wildcard === "off" || !domain) return [];
  const out: AttentionItem[] = [];
  if (manual) out.push({ id: "https:wildcard:manual", severity: "warn", code: "https.manual", detail: { name: manual.name } });
  const [state] = certificateStates([`*.${domain}`]);
  if (state?.error && !manual) out.push({ id: "https:wildcard:failed", severity: state.notAfter && state.notAfter - Date.now() > 14 * 24 * 3600_000 ? "warn" : "danger", code: "https.wildcardFailed", detail: { domain, message: state.error } });
  return out;
}
