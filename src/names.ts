/**
 * Names under Hata's domain for what is not an app of this server: a container or a virtual machine of
 * this server, a guest of Proxmox, another machine, an app of another machine, or any address of the home
 * network. Like an app's, such a name leads to Hata, which passes the request on to the target's address
 * and port — so it works by the local name and by the domain alike, with Hata's certificate and, when
 * asked, Hata's sign-in in front of it.
 *
 * Pure and tested: what the page sends read and checked, and where a name leads, given what is known of
 * the targets right now.
 */

/** A label under the domain: the same rule as an app's chosen subdomain */
export const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A host name or an IPv4 / IPv6 address the request is passed on to */
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_RE = /^[0-9a-f:]+$/i;

export type Target =
  /** A container or a virtual machine of this server (Incus) */
  | { kind: "container"; name: string }
  /** A guest of a Proxmox server: `guest` is `lxc/243` */
  | { kind: "guest"; host: string; guest: string }
  /** A machine with Hata's client */
  | { kind: "machine"; id: string }
  /** An app on a machine with Hata's client */
  | { kind: "machineApp"; id: string; app: string }
  /** Any address: a NAS, a router's page, a printer */
  | { kind: "address"; host: string };

export interface DomainName {
  label: string;
  target: Target;
  port: number;
  /** The target speaks HTTPS itself (its own certificate is not checked: it is the home network's) */
  https: boolean;
  /** Only people signed in to Hata get through */
  protect: boolean;
  /** With `protect`: "all" — every member; a list — only these users (ids). Administrators always. */
  allowed: "all" | string[];
}

export class NameError extends Error {
  constructor(readonly code: string, readonly detail: Record<string, string> = {}) {
    super(code);
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A host the request may be passed on to: a name or an address, never one with a port or a path */
export function cleanHost(value: unknown): string | null {
  const host = str(value).toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return null;
  const v4 = IPV4_RE.exec(host);
  if (v4) return v4.slice(1).every((p) => Number(p) <= 255) ? host : null;
  if (host.includes(":")) return IPV6_RE.test(host) && host.split(":").length <= 8 ? host : null;
  return HOST_RE.test(host) ? host : null;
}

/** What a target sent by the page is; null — not one */
export function cleanTarget(value: unknown): Target | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Record<string, unknown>;
  const id = (v: unknown) => /^[A-Za-z0-9._@:/-]{1,100}$/.test(str(v)) ? str(v) : "";
  switch (t.kind) {
    case "container":
      return /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(str(t.name)) ? { kind: "container", name: str(t.name) } : null;
    case "guest":
      return id(t.host) && /^(lxc|qemu)\/\d{1,9}$/.test(str(t.guest)) ? { kind: "guest", host: id(t.host), guest: str(t.guest) } : null;
    case "machine":
      return id(t.id) ? { kind: "machine", id: id(t.id) } : null;
    case "machineApp":
      return id(t.id) && /^[a-z0-9][a-z0-9_.-]{0,62}$/i.test(str(t.app)) ? { kind: "machineApp", id: id(t.id), app: str(t.app) } : null;
    case "address": {
      const host = cleanHost(t.host);
      return host ? { kind: "address", host } : null;
    }
  }
  return null;
}

/**
 * A name as the page sent it, checked. `taken` — the labels that answer already (apps', other names'),
 * without the one being changed; `users` — the ids there are.
 */
export function readName(input: Record<string, unknown>, taken: string[], users: string[]): DomainName {
  const label = str(input.label).toLowerCase();
  if (!LABEL_RE.test(label)) throw new NameError("domains.badLabel");
  if (taken.includes(label)) throw new NameError("domains.taken", { label });
  const target = cleanTarget(input.target);
  if (!target) throw new NameError("domains.badTarget");
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new NameError("domains.badPort");
  const allowed = Array.isArray(input.allowed) ? [...new Set(input.allowed.filter((id): id is string => typeof id === "string" && users.includes(id)))] : "all";
  return { label, target, port, https: input.https === true, protect: input.protect === true, allowed };
}

/** The names kept in the settings, as read back: anything that is not one is left out */
export function cleanNames(value: unknown): DomainName[] {
  if (!Array.isArray(value)) return [];
  const out: DomainName[] = [];
  for (const one of value) {
    if (!one || typeof one !== "object") continue;
    try {
      const n = one as Record<string, unknown>;
      const name = readName(n, out.map((o) => o.label), Array.isArray(n.allowed) ? (n.allowed as string[]) : []);
      out.push(name);
    } catch {}
  }
  return out;
}

/** Where a name leads right now: the host and port to pass requests to, or why it cannot */
export type Upstream = { host: string; port: number; https: boolean } | { away: string };

/** What is known of the targets, asked when a request comes */
export interface World {
  /** An instance of this server: its address (in whichever network it is), "" — none yet; null — no such instance */
  container: (name: string) => string | null | Promise<string | null>;
  /** A guest of Proxmox: its address, "" — not known (a virtual machine without the agent); null — no such guest */
  guest: (host: string, guest: string) => string | null;
  /** A machine: its address while connected, "" — away; null — no such machine */
  machine: (id: string) => string | null;
  /** An app of a machine behind Hata's sign-in: the local end of its tunnel; 0 — not behind it */
  tunnel: (id: string, app: string) => number;
}

/** Where `name` leads, given what is known now */
export async function upstreamOf(name: DomainName, world: World): Promise<Upstream> {
  const at = (host: string | null, gone: string, away: string): Upstream => (host === null ? { away: gone } : host ? { host, port: name.port, https: name.https } : { away });
  const t = name.target;
  switch (t.kind) {
    case "address":
      return { host: t.host, port: name.port, https: name.https };
    case "container":
      return at(await world.container(t.name), "domains.away.noContainer", "domains.away.noAddress");
    case "guest":
      return at(world.guest(t.host, t.guest), "domains.away.noGuest", "domains.away.noAddress");
    case "machine":
      return at(world.machine(t.id), "domains.away.noMachine", "domains.away.machineAway");
    case "machineApp": {
      // behind Hata's sign-in the app listens on the machine's 127.0.0.1 only: the tunnel reaches it
      const tunnel = world.tunnel(t.id, t.app);
      if (tunnel) return { host: "127.0.0.1", port: tunnel, https: false };
      return at(world.machine(t.id), "domains.away.noMachine", "domains.away.machineAway");
    }
  }
}

/** A URL host: an IPv6 address in brackets */
export const urlHost = (host: string): string => (host.includes(":") ? `[${host}]` : host);

/** The names of a target that is gone or renamed: an instance's name follows a rename */
export function renamedTarget(names: DomainName[], from: Target, to: Target): DomainName[] {
  const key = JSON.stringify(from);
  return names.map((n) => (JSON.stringify(n.target) === key ? { ...n, target: to } : n));
}
