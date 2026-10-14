/**
 * How Hata is reached: by address and port, or by a domain name over HTTPS — and then either behind the
 * user's own reverse proxy or with Hata serving HTTPS itself. With a domain, every app has an address
 * of its own: `<app>.<domain>`. The same goes for the name on the home network, `<name>.local`.
 */
import type { Server } from "bun";
import { settings } from "./config";

const withoutPort = (host: string): string => host.replace(/:\d+$/, "").toLowerCase();

/** The host the browser asked for */
export const requestHost = (req: Request): string => withoutPort(req.headers.get("host") ?? new URL(req.url).host);

/** The port the browser asked for, as `:8080`; "" when it is the usual one of the protocol */
export const requestPort = (req: Request): string => /:\d+$/.exec(req.headers.get("host") ?? "")?.[0] ?? "";

/** Headers a proxy adds are believed only when the settings say there is a proxy */
const behindProxy = (): boolean => settings.https.mode === "proxy";

export function requestProto(req: Request): "http" | "https" {
  if (new URL(req.url).protocol === "https:") return "https";
  return behindProxy() && req.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
}

/** The visitor's address: behind a proxy it is the last hop the proxy recorded, not the proxy itself */
/** An IPv4 address as a listener on both families reports it (`::ffff:192.168.1.5`), in its usual form */
export const plainIp = (address: string): string => address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");

export function clientIp(req: Request, server: Server): string {
  const direct = plainIp(server.requestIP(req)?.address ?? "unknown");
  if (!behindProxy()) return direct;
  return req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || direct;
}

/** The domain in use, or "" when Hata is reached by address only */
export const siteDomain = (): string => (settings.https.mode === "off" ? "" : settings.https.domain);

/** The name on the home network; "" when that is switched off */
export const localDomain = (): string => (settings.local.enabled ? settings.local.name : "");

/** The domain of ours a host name belongs to — the one that is set, or the local one; "" for an address */
export function domainOf(host: string): string {
  for (const domain of [siteDomain(), localDomain()]) if (domain && (host === domain || host.endsWith("." + domain))) return domain;
  return "";
}

/** The label of an app's subdomain: app names may hold `_`, host names may not */
export const appLabel = (name: string): string => name.replace(/_/g, "-");

/** The label an app answers to: the one chosen for it, or the one its name gives */
export const labelOf = (app: { name: string; subdomain?: string }): string => app.subdomain || appLabel(app.name);

/** The address of an app under the domain */
/**
 * The address of an app's page as the person would open it, the way the tile does: with Hata opened by
 * its domain (or its local name), `<label>.<domain>`; otherwise the host Hata was opened at and the
 * app's port. `origin` is where Hata was opened, `http://192.168.1.10`; null — the app has no page.
 */
export function webAddress(app: { name: string; subdomain?: string; port?: number; scheme?: string; index?: string; hostname?: string }, origin: string, domains: string[]): string | null {
  if (!app.port) return null;
  let at: URL;
  try {
    at = new URL(origin);
  } catch {
    return null;
  }
  const index = app.index || "/";
  if (!app.hostname && domains.includes(at.hostname)) return `${at.protocol}//${labelOf(app)}.${at.hostname}${at.port ? ":" + at.port : ""}${index}`;
  return `${app.scheme || "http"}://${app.hostname || at.hostname}:${app.port}${index}`;
}

export const appHost = (app: { name: string; subdomain?: string }): string => `${labelOf(app)}.${siteDomain()}`;

/**
 * What a host name means: Hata itself, the subdomain of an app (its label is returned — which app it is,
 * the caller looks up), or a name we do not serve.
 */
export function classifyHost(host: string): { kind: "hata" } | { kind: "app"; label: string } {
  const domain = domainOf(host);
  if (!domain || host === domain) return { kind: "hata" };
  const label = host.slice(0, -domain.length - 1);
  // one label only: `a.b.<domain>` is not an app
  return label.includes(".") ? { kind: "hata" } : { kind: "app", label };
}

/**
 * The Domain attribute for the session cookie: with a domain, the cookie must also reach the apps'
 * subdomains, where Hata checks it before letting a request through. Undefined — a host-only cookie.
 */
export function cookieDomain(host: string): string | undefined {
  return domainOf(host) || undefined;
}
