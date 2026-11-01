/**
 * Ports of this server passed on to a target: `<server>:2222` → a container's 22, a guest's database, a
 * game server on a machine. The targets are the same as those of the names under the domain (`names.ts`).
 * A container of this server gets a proxy device of Incus's own (it keeps working while Hata restarts);
 * anything else is relayed by Hata. The internet side stays closed to such a port unless it is opened.
 *
 * Pure and tested: what the page sends read and checked, and the device Incus is given.
 */
import { cleanTarget, NameError, type Target } from "./names";

export type Proto = "tcp" | "udp" | "both";

export interface Forward {
  /** The port of this server people connect to */
  port: number;
  proto: Proto;
  target: Target;
  /** The target's port */
  to: number;
  /** Open on the internet side too (an interface marked as the one the internet comes in on) */
  outside: boolean;
  /** What it is for, in the person's words */
  note: string;
}

/** The protocols a forward takes */
export const protocolsOf = (proto: Proto): ("tcp" | "udp")[] => (proto === "both" ? ["tcp", "udp"] : [proto]);

/** Whether two forwards would want the same port of the same protocol */
export const clash = (a: Pick<Forward, "port" | "proto">, b: Pick<Forward, "port" | "proto">): boolean => a.port === b.port && protocolsOf(a.proto).some((p) => protocolsOf(b.proto).includes(p));

/** Ports Hata itself listens on, by protocol: never given away */
export function ownPorts(hata: number, https: number): { port: number; proto: Proto }[] {
  return [
    { port: hata, proto: "tcp" },
    { port: https, proto: "tcp" },
    { port: 80, proto: "tcp" },
    { port: 53, proto: "both" },
    { port: 5353, proto: "udp" },
    { port: 3702, proto: "udp" },
    { port: 5357, proto: "tcp" },
  ];
}

const port = (v: unknown, code: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new NameError(code);
  return n;
};

/**
 * A forward as the page sent it, checked. `taken` — the ports already given (other forwards, without the
 * one being changed) and Hata's own.
 */
export function readForward(input: Record<string, unknown>, taken: Pick<Forward, "port" | "proto">[]): Forward {
  const proto: Proto = input.proto === "udp" || input.proto === "both" ? input.proto : "tcp";
  const f = { port: port(input.port, "ports.badPort"), proto };
  const other = taken.find((t) => clash(t, f));
  if (other) throw new NameError("ports.taken", { port: String(f.port) });
  const target = cleanTarget(input.target);
  if (!target) throw new NameError("domains.badTarget");
  const note = typeof input.note === "string" ? input.note.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) : "";
  return { ...f, target, to: port(input.to, "ports.badPort"), outside: input.outside === true, note };
}

/** The forwards kept in the settings, as read back */
export function cleanForwards(value: unknown): Forward[] {
  if (!Array.isArray(value)) return [];
  const out: Forward[] = [];
  for (const one of value) {
    if (!one || typeof one !== "object") continue;
    try {
      out.push(readForward(one as Record<string, unknown>, out));
    } catch {}
  }
  return out;
}

/** The name of the proxy device a container gets for one protocol of a forward */
export const deviceName = (port: number, proto: "tcp" | "udp"): string => `hata-port-${proto}-${port}`;

/**
 * The proxy device of Incus: it listens on the server and connects inside the container, whichever network
 * the container is on — so it needs no address of the container at all.
 */
export function proxyDevice(f: Pick<Forward, "port" | "to">, proto: "tcp" | "udp"): Record<string, string> {
  return { type: "proxy", listen: `${proto}:0.0.0.0:${f.port}`, connect: `${proto}:127.0.0.1:${f.to}`, bind: "host" };
}

/** Whether a device of an instance is one of Hata's forwards */
export const isOurDevice = (name: string): boolean => /^hata-port-(tcp|udp)-\d+$/.test(name);

/** The ports opened on the internet side, for the firewall */
export const outsideOpenings = (forwards: Forward[]): { port: number; proto: "tcp" | "udp" }[] => forwards.filter((f) => f.outside).flatMap((f) => protocolsOf(f.proto).map((proto) => ({ port: f.port, proto })));
