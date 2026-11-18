/**
 * What is here already that a module is for: looked for when a new server is walked through, so the
 * module is offered ticked and the person sees at once what Hata could take in. Nothing is connected
 * and nothing is signed in to — a thing found is only named.
 */
import { connect } from "node:net";
import { discover as findHomeAssistants } from "./homeassistant";
import { homeLinks, type Link } from "./mdns";
import type { ModuleId } from "./modules";
import { discover as findShares } from "./netplaces";
import { integrationsFound } from "./integrations";
import { lookAtPools, poolsReport } from "./raid";

/** One thing found: the page words it as `modules.found.<what>` */
export interface Find {
  module: ModuleId;
  what: string;
  /** Its name or address, or how many */
  detail: string;
}

const PROXMOX_PORT = 8006;
/** The most addresses of one network that are tried: a home's /24 */
const MOST = 254;

const toNumber = (ip: string): number => ip.split(".").reduce((sum, part) => sum * 256 + Number(part), 0) >>> 0;
const toAddress = (n: number): string => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

/**
 * The other addresses of the network an address of ours is on. A network larger than a home's is cut
 * down to the 254 around our own address: nobody's whole provider is walked.
 */
export function neighbours(link: Link): string[] {
  const own = toNumber(link.address);
  let mask = toNumber(link.netmask);
  if (!mask || (~mask >>> 0) > MOST + 1) mask = 0xffffff00;
  const first = (own & mask) >>> 0;
  const size = (~mask >>> 0) + 1;
  const out: string[] = [];
  for (let i = 1; i < size - 1 && out.length < MOST; i++) if (first + i !== own) out.push(toAddress(first + i));
  return out;
}

/** Whether something listens there, asked for no longer than `ms` */
const listens = (host: string, port: number, ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (yes: boolean) => {
      socket.destroy();
      resolve(yes);
    };
    socket.setTimeout(ms, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

/** Whether what listens there is Proxmox VE: its list of sign-in realms is open to anyone, nothing of ours is sent */
async function isProxmox(host: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}:${PROXMOX_PORT}/api2/json/access/domains`, { tls: { rejectUnauthorized: false }, signal: AbortSignal.timeout(3000), redirect: "manual" });
    if (!res.ok) return false;
    const said = (await res.json()) as { data?: { realm?: unknown }[] };
    return Array.isArray(said.data) && said.data.some((one) => typeof one?.realm === "string");
  } catch {
    return false;
  }
}

/** Proxmox announces itself nowhere, so its port is tried on every address of the home networks */
async function findProxmox(): Promise<string[]> {
  const hosts = [...new Set(homeLinks().slice(0, 2).flatMap(neighbours))];
  const open: string[] = [];
  const queue = [...hosts];
  await Promise.all(
    Array.from({ length: 64 }, async () => {
      for (let host = queue.pop(); host; host = queue.pop()) if (await listens(host, PROXMOX_PORT, 700)) open.push(host);
    }),
  );
  const found: string[] = [];
  for (const host of open.slice(0, 8)) if (await isProxmox(host)) found.push(host);
  return found.sort((a, b) => toNumber(a) - toNumber(b));
}

const quiet = <T>(work: Promise<T>, otherwise: T): Promise<T> => work.catch(() => otherwise);

let last: { at: number; finds: Find[] } | null = null;
let looking: Promise<Find[]> | null = null;

async function look(): Promise<Find[]> {
  // HATA_NO_LOOK: nothing is sent to the network (a run on somebody else's network, a test)
  const around = !process.env.HATA_NO_LOOK;
  const [proxmox, assistants, shares, services] = await Promise.all([around ? quiet(findProxmox(), []) : [], around ? quiet(findHomeAssistants(), []) : [], around ? quiet(findShares(), []) : [], quiet(integrationsFound("en"), []), quiet(lookAtPools(), undefined)]);
  const finds: Find[] = [];
  const pools = poolsReport().pools;
  if (pools.length) finds.push({ module: "raid", what: "arrays", detail: pools.map((pool) => pool.name).join(", ") });
  const servers = [...new Set(shares.map((s) => s.name || s.host || s.address))];
  if (servers.length) finds.push({ module: "netplaces", what: "shares", detail: servers.slice(0, 4).join(", ") });
  if (Bun.which("smbd") || Bun.which("smbd", { PATH: "/usr/sbin:/sbin" })) finds.push({ module: "shares", what: "samba", detail: "" });
  if (Bun.which("tailscale")) finds.push({ module: "remote", what: "tailscale", detail: "" });
  for (const host of proxmox) finds.push({ module: "proxmox", what: "proxmox", detail: host });
  if (Bun.which("incus")) finds.push({ module: "containers", what: "incus", detail: "" });
  for (const one of assistants.filter((a) => !a.known)) finds.push({ module: "integrations", what: "homeAssistant", detail: one.name || one.url });
  for (const one of services) finds.push({ module: "integrations", what: "service", detail: `${one.kindTitle} (${one.title})` });
  return finds;
}

/** What was found, looked for at most once in ten minutes; a look takes a few seconds */
export function findForModules(): Promise<Find[]> {
  if (last && Date.now() - last.at < 10 * 60_000) return Promise.resolve(last.finds);
  looking ??= look()
    .then((finds) => {
      last = { at: Date.now(), finds };
      return finds;
    })
    .finally(() => (looking = null));
  return looking;
}
