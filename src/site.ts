/**
 * How Hata is reached: by address and port, or by a domain name over HTTPS — and then either behind the
 * user's own reverse proxy or with Hata serving HTTPS itself. With a domain, every app has an address
 * of its own: `<app>.<domain>`.
 */
import type { Server } from "bun";
import { settings } from "./config";

const withoutPort = (host: string): string => host.replace(/:\d+$/, "").toLowerCase();

/** The host the browser asked for */
export const requestHost = (req: Request): string => withoutPort(req.headers.get("host") ?? new URL(req.url).host);

/** Headers a proxy adds are believed only when the settings say there is a proxy */
const behindProxy = (): boolean => settings.https.mode === "proxy";

export function requestProto(req: Request): "http" | "https" {
  if (new URL(req.url).protocol === "https:") return "https";
  return behindProxy() && req.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
}

/** The visitor's address: behind a proxy it is the last hop the proxy recorded, not the proxy itself */
export function clientIp(req: Request, server: Server): string {
  const direct = server.requestIP(req)?.address ?? "unknown";
  if (!behindProxy()) return direct;
  return req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || direct;
}

/** The domain in use, or "" when Hata is reached by address only */
export const siteDomain = (): string => (settings.https.mode === "off" ? "" : settings.https.domain);

/** The label of an app's subdomain: app names may hold `_`, host names may not */
export const appLabel = (name: string): string => name.replace(/_/g, "-");

/** The address of an app under the domain */
export const appHost = (name: string): string => `${appLabel(name)}.${siteDomain()}`;

/**
 * What a host name means: Hata itself, the subdomain of an app (its label is returned — which app it is,
 * the caller looks up), or a name we do not serve.
 */
export function classifyHost(host: string): { kind: "hata" } | { kind: "app"; label: string } {
  const domain = siteDomain();
  if (!domain || host === domain || !host.endsWith("." + domain)) return { kind: "hata" };
  const label = host.slice(0, -domain.length - 1);
  // one label only: `a.b.<domain>` is not an app
  return label.includes(".") ? { kind: "hata" } : { kind: "app", label };
}

/**
 * The Domain attribute for the session cookie: with a domain, the cookie must also reach the apps'
 * subdomains, where Hata checks it before letting a request through. Undefined — a host-only cookie.
 */
export function cookieDomain(host: string): string | undefined {
  const domain = siteDomain();
  return domain && (host === domain || host.endsWith("." + domain)) ? domain : undefined;
}
