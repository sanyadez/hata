/**
 * The DNS providers' own APIs, for the TXT record a wildcard certificate is confirmed by (ACME's DNS-01).
 * Each is a few plain requests over `fetch`; the fetch is handed in, so the requests are tested as they go.
 * A provider's zone may be a parent of the domain (`home.example.com` in `example.com`): it is looked for
 * from the whole name upwards.
 */
import { sign } from "./s3";

export const PROVIDERS = ["cloudflare", "desec", "duckdns", "hetzner", "digitalocean", "gandi", "route53"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface DnsApi {
  provider: Provider;
  /** The API token; Route 53 has a key pair instead */
  token: string;
  accessKey: string;
  secret: string;
}

export class DnsApiError extends Error {}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** What puts the TXT values of a confirmation in place */
export interface Presenter {
  /** The provider keeps one TXT value per name: the values go one by one, each awaited */
  oneAtATime: boolean;
  add(name: string, values: string[]): Promise<void>;
  remove(name: string, values: string[]): Promise<void>;
  /** That the sign-in works and the provider holds the domain; throws in words otherwise */
  check(domain: string): Promise<void>;
}

/** The names a zone of `domain` may have, from the whole name up to two labels */
export function zoneCandidates(domain: string): string[] {
  // the confirmation's own label is never a zone; a provider may answer more than "no such" to asking
  const labels = domain.replace(/^_acme-challenge\./, "").split(".");
  return labels.slice(0, Math.max(1, labels.length - 1)).map((_, i) => labels.slice(i).join("."));
}

/** A name relative to its zone; "@" — the zone itself */
export const relative = (name: string, zone: string): string => (name === zone ? "@" : name.slice(0, -zone.length - 1));

const quoted = (value: string): string => `"${value}"`;
const TTL = 60;

const answerOf = async (r: Response): Promise<any> => {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** A refusal in the provider's words, whichever way it words them */
function refusal(r: Response, body: any): DnsApiError {
  const said = typeof body === "string" ? (/<Message>([^<]*)<\/Message>/.exec(body)?.[1] ?? (body.trimStart().startsWith("<") ? "" : body.slice(0, 200))) : (body?.errors?.[0]?.message ?? body?.error?.message ?? body?.message ?? body?.detail ?? body?.cause ?? "");
  return new DnsApiError(`HTTP ${r.status}${said ? `: ${said}` : ""}`);
}

/** Calls an API; `quiet` — statuses that are an answer here, not a failure */
function caller(f: Fetch, base: string, headers: Record<string, string>) {
  return async (method: string, path: string, body?: unknown, quiet: number[] = []): Promise<{ status: number; body: any }> => {
    const r = await f(base + path, { method, headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const answer = await answerOf(r);
    if (!r.ok && !quiet.includes(r.status)) throw refusal(r, answer);
    return { status: r.status, body: answer };
  };
}

/** Finds the zone of a name by asking of each candidate whether the provider holds it */
async function zoneOf(domain: string, holds: (zone: string) => Promise<boolean>): Promise<string> {
  for (const zone of zoneCandidates(domain)) if (await holds(zone)) return zone;
  throw new DnsApiError(`The provider does not hold ${domain}`);
}

function cloudflare(api: DnsApi, f: Fetch, base: string): Presenter {
  const call = caller(f, base, { authorization: `Bearer ${api.token}` });
  const ids = new Map<string, string>();
  const zone = async (domain: string): Promise<string> => {
    await zoneOf(domain, async (candidate) => {
      const id = (await call("GET", `/client/v4/zones?name=${encodeURIComponent(candidate)}`)).body?.result?.[0]?.id;
      if (id) ids.set(domain, id);
      return !!id;
    });
    return ids.get(domain)!;
  };
  return {
    oneAtATime: false,
    check: async (domain) => void (await zone(domain)),
    async add(name, values) {
      const id = await zone(name);
      for (const value of values) await call("POST", `/client/v4/zones/${id}/dns_records`, { type: "TXT", name, content: quoted(value), ttl: TTL });
    },
    async remove(name, values) {
      const id = await zone(name);
      const list = (await call("GET", `/client/v4/zones/${id}/dns_records?type=TXT&name=${encodeURIComponent(name)}`)).body?.result ?? [];
      for (const r of list) if (values.includes(String(r.content).replace(/^"|"$/g, ""))) await call("DELETE", `/client/v4/zones/${id}/dns_records/${r.id}`);
    },
  };
}

function desec(api: DnsApi, f: Fetch, base: string): Presenter {
  const call = caller(f, base, { authorization: `Token ${api.token}` });
  const zone = (domain: string) => zoneOf(domain, async (candidate) => (await call("GET", `/api/v1/domains/${candidate}/`, undefined, [404])).status === 200);
  return {
    oneAtATime: false,
    check: async (domain) => void (await zone(domain)),
    async add(name, values) {
      const z = await zone(name);
      const subname = relative(name, z);
      // deSEC's smallest TTL is an hour; an RRset that is there (a confirmation cut short) is replaced
      const made = await call("POST", `/api/v1/domains/${z}/rrsets/`, { subname, type: "TXT", ttl: 3600, records: values.map(quoted) }, [400, 409]);
      if (made.status !== 201) await call("PATCH", `/api/v1/domains/${z}/rrsets/${subname}/TXT/`, { records: values.map(quoted) });
    },
    async remove(name) {
      const z = await zone(name);
      await call("DELETE", `/api/v1/domains/${z}/rrsets/${relative(name, z)}/TXT/`);
    },
  };
}

function duckdns(api: DnsApi, f: Fetch, base: string): Presenter {
  // the one label before duckdns.org: its TXT record answers for every name under it
  const label = (domain: string): string => {
    const m = /(?:^|\.)([a-z0-9-]+)\.duckdns\.org$/.exec(domain);
    if (!m) throw new DnsApiError(`${domain} is not under duckdns.org`);
    return m[1]!;
  };
  const update = async (domain: string, rest: string) => {
    const r = await f(`${base}/update?domains=${label(domain)}&token=${encodeURIComponent(api.token)}&${rest}`, { signal: AbortSignal.timeout(30_000) });
    if ((await r.text()).trim() !== "OK") throw new DnsApiError("DuckDNS refused: the token or the domain is not right");
  };
  return {
    oneAtATime: true,
    check: (domain) => update(domain, "txt=hata-check"),
    add: (name, values) => update(name, `txt=${encodeURIComponent(values[0]!)}`),
    remove: (name) => update(name, "clear=true"),
  };
}

function hetzner(api: DnsApi, f: Fetch, base: string): Presenter {
  const call = caller(f, base, { authorization: `Bearer ${api.token}` });
  const zone = (domain: string) => zoneOf(domain, async (candidate) => (await call("GET", `/v1/zones/${candidate}`, undefined, [404])).status === 200);
  return {
    oneAtATime: false,
    check: async (domain) => void (await zone(domain)),
    async add(name, values) {
      const z = await zone(name);
      await call("POST", `/v1/zones/${z}/rrsets/${relative(name, z)}/TXT/actions/add_records`, { ttl: TTL, records: values.map((value) => ({ value: quoted(value) })) });
    },
    async remove(name, values) {
      const z = await zone(name);
      await call("POST", `/v1/zones/${z}/rrsets/${relative(name, z)}/TXT/actions/remove_records`, { records: values.map((value) => ({ value: quoted(value) })) });
    },
  };
}

function digitalocean(api: DnsApi, f: Fetch, base: string): Presenter {
  const call = caller(f, base, { authorization: `Bearer ${api.token}` });
  const zone = (domain: string) => zoneOf(domain, async (candidate) => (await call("GET", `/v2/domains/${candidate}`, undefined, [404])).status === 200);
  return {
    oneAtATime: false,
    check: async (domain) => void (await zone(domain)),
    async add(name, values) {
      const z = await zone(name);
      for (const data of values) await call("POST", `/v2/domains/${z}/records`, { type: "TXT", name: relative(name, z), data, ttl: TTL });
    },
    async remove(name, values) {
      const z = await zone(name);
      const list = (await call("GET", `/v2/domains/${z}/records?type=TXT&name=${encodeURIComponent(name)}`)).body?.domain_records ?? [];
      for (const r of list) if (values.includes(String(r.data))) await call("DELETE", `/v2/domains/${z}/records/${r.id}`);
    },
  };
}

function gandi(api: DnsApi, f: Fetch, base: string): Presenter {
  const call = caller(f, base, { authorization: `Bearer ${api.token}` });
  const zone = (domain: string) => zoneOf(domain, async (candidate) => (await call("GET", `/v5/livedns/domains/${candidate}`, undefined, [404])).status === 200);
  return {
    oneAtATime: false,
    check: async (domain) => void (await zone(domain)),
    async add(name, values) {
      const z = await zone(name);
      await call("PUT", `/v5/livedns/domains/${z}/records/${relative(name, z)}/TXT`, { rrset_ttl: 300, rrset_values: values.map(quoted) });
    },
    async remove(name) {
      const z = await zone(name);
      await call("DELETE", `/v5/livedns/domains/${z}/records/${relative(name, z)}/TXT`, undefined, [404]);
    },
  };
}

/** A change of Route 53's: the whole set of values of one name */
export const route53Change = (action: "UPSERT" | "DELETE", name: string, values: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><ChangeBatch><Changes><Change><Action>${action}</Action><ResourceRecordSet><Name>${name}.</Name><Type>TXT</Type><TTL>${TTL}</TTL><ResourceRecords>${values.map((value) => `<ResourceRecord><Value>&quot;${value}&quot;</Value></ResourceRecord>`).join("")}</ResourceRecords></ResourceRecordSet></Change></Changes></ChangeBatch></ChangeResourceRecordSetsRequest>`;

function route53(api: DnsApi, f: Fetch, base: string): Presenter {
  const send = async (method: string, path: string, body = ""): Promise<string> => {
    const url = new URL(base + path);
    const hash = new Bun.CryptoHasher("sha256").update(body).digest("hex");
    const headers = await sign(method, url, body ? { "content-type": "text/xml" } : {}, hash, { region: "us-east-1", accessKey: api.accessKey, secret: api.secret }, new Date(), "route53");
    const r = await f(url.toString(), { method, headers, body: body || undefined, signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    if (!r.ok) throw refusal(r, text);
    return text;
  };
  const zones = new Map<string, string>();
  const zone = async (domain: string): Promise<string> => {
    await zoneOf(domain, async (candidate) => {
      const text = await send("GET", `/2013-04-01/hostedzonesbyname?dnsname=${encodeURIComponent(candidate)}&maxitems=1`);
      const m = /<HostedZone><Id>\/hostedzone\/([^<]+)<\/Id><Name>([^<]+)<\/Name>/.exec(text);
      if (m && m[2] === `${candidate}.`) zones.set(domain, m[1]!);
      return zones.has(domain);
    });
    return zones.get(domain)!;
  };
  return {
    oneAtATime: false,
    check: async (domain) => void (await zone(domain)),
    add: async (name, values) => void (await send("POST", `/2013-04-01/hostedzone/${await zone(name)}/rrset`, route53Change("UPSERT", name, values))),
    remove: async (name, values) => void (await send("POST", `/2013-04-01/hostedzone/${await zone(name)}/rrset`, route53Change("DELETE", name, values))),
  };
}

const BASES: Record<Provider, string> = {
  cloudflare: "https://api.cloudflare.com",
  desec: "https://desec.io",
  duckdns: "https://www.duckdns.org",
  hetzner: "https://api.hetzner.cloud",
  digitalocean: "https://api.digitalocean.com",
  gandi: "https://api.gandi.net",
  route53: "https://route53.amazonaws.com",
};

/** The provider's presenter. `base` replaces its address, for a stand-in in a test */
export function presenterFor(api: DnsApi, f: Fetch = fetch, base = BASES[api.provider]): Presenter {
  return { cloudflare, desec, duckdns, hetzner, digitalocean, gandi, route53 }[api.provider](api, f, base);
}

/** What the page sent, over what is kept: an empty secret keeps the saved one */
export function cleanApi(input: Record<string, unknown>, kept: DnsApi | null): DnsApi | null {
  const provider = PROVIDERS.find((p) => p === input.provider);
  if (!provider) return null;
  const same = kept?.provider === provider ? kept : null;
  const field = (key: "token" | "accessKey" | "secret"): string => (typeof input[key] === "string" && (input[key] as string).trim()) || same?.[key] || "";
  const api: DnsApi = { provider, token: field("token"), accessKey: field("accessKey"), secret: field("secret") };
  return (provider === "route53" ? api.accessKey && api.secret : api.token) ? api : null;
}
