/**
 * Remote access with Tailscale: the server joins the person's own private network (a "tailnet"), and
 * their phone or laptop, joined to the same one, reaches it from anywhere — no port opened on the
 * router, no public address needed.
 *
 * Tailscale is somebody else's service and program, so nothing of it is here until asked for: the page
 * says what it is and has the button that runs Tailscale's own installer. After that Hata only drives
 * the `tailscale` command — sign in (the link it gives is shown), on and off, sign out, and offering the
 * home network to the other devices. What the daemon says about itself is read as data, pure and tested.
 */
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, startJob, type Job } from "./apps";
import { record } from "./activity";
import { bus } from "./bus";
import { run as streamed } from "./docker";
import { homeLinks, type Link } from "./mdns";
import { PATH, run } from "./packages";

export const INSTALLER = "https://tailscale.com/install.sh";
/** What a person would type to do the same by hand */
export const INSTALL_COMMAND = `curl -fsSL ${INSTALLER} | sh`;
/** Where a route offered by this server is accepted, on Tailscale's own service */
const ADMIN = "https://login.tailscale.com/admin/machines";
const FORWARDING = "/etc/sysctl.d/99-hata-tailscale.conf";

export interface Device {
  name: string;
  os: string;
  addresses: string[];
  online: boolean;
  /** When it was last seen, for one that is away; 0 — not told */
  lastSeen: number;
}

/** What `tailscale status --json` tells, as the page needs it */
export interface Status {
  /** needsLogin — nobody signed in; starting — signing in or coming up; off — signed in, switched off */
  state: "needsLogin" | "starting" | "running" | "off";
  /** The page to open to let this server in; "" — none is waiting */
  authUrl: string;
  /** This server's name in the private network, `server.tail1234.ts.net`; "" — none yet */
  name: string;
  addresses: string[];
  /** Whose network it is: the account's name */
  tailnet: string;
  /** When the sign-in runs out and has to be made again; 0 — never, or not told */
  expires: number;
  /** The home networks the service lets the other devices reach through this server */
  approved: string[];
  /** What the daemon itself says is wrong */
  health: string[];
  devices: Device[];
}

export interface Report extends Partial<Status> {
  /** missing — not installed; stopped — installed, the daemon does not run */
  state: "missing" | "stopped" | Status["state"];
  version: string;
  install: string;
  /** The service signed in to, when it is not Tailscale's own (Headscale); "" otherwise */
  server: string;
  /** The home networks of this machine, and the ones it offers */
  networks: string[];
  offered: string[];
  /** Where an offered network is accepted */
  admin: string;
  /** The port Hata answers on, for the addresses the page shows */
  port: number;
}

// --- Pure -------------------------------------------------------------------------------------------

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const when = (value: unknown): number => {
  const at = Date.parse(text(value));
  // a time never set is printed as year 1
  return Number.isFinite(at) && at > 0 ? at : 0;
};
const bare = (dnsName: unknown): string => text(dnsName).replace(/\.$/, "");

export function parseStatus(json: string): Status | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const backend = text(data.BackendState);
  const self = (data.Self && typeof data.Self === "object" ? data.Self : {}) as Record<string, unknown>;
  const tailnet = (data.CurrentTailnet && typeof data.CurrentTailnet === "object" ? data.CurrentTailnet : {}) as Record<string, unknown>;
  const authUrl = /^https?:\/\//.test(text(data.AuthURL)) ? text(data.AuthURL) : "";
  const state: Status["state"] = backend === "Running" ? "running" : backend === "Stopped" ? "off" : backend === "NeedsLogin" || backend === "NeedsMachineAuth" ? (authUrl || backend === "NeedsMachineAuth" ? "starting" : "needsLogin") : "starting";
  const devices = Object.values(data.Peer && typeof data.Peer === "object" ? (data.Peer as Record<string, Record<string, unknown>>) : {})
    .filter((peer) => peer && typeof peer === "object")
    .map((peer) => ({ name: bare(peer.DNSName).split(".")[0] || text(peer.HostName), os: text(peer.OS), addresses: list(peer.TailscaleIPs), online: peer.Online === true, lastSeen: peer.Online === true ? 0 : when(peer.LastSeen) }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  // the routes of its own the service has accepted: its own addresses are there too, as /32 and /128
  const approved = list(self.PrimaryRoutes).length ? list(self.PrimaryRoutes) : list(self.AllowedIPs).filter((route) => !/\/(32|128)$/.test(route));
  return { state, authUrl, name: state === "needsLogin" ? "" : bare(self.DNSName), addresses: list(self.TailscaleIPs ?? data.TailscaleIPs), tailnet: text(tailnet.Name), expires: when(self.KeyExpiry), approved, health: list(data.Health), devices };
}

/** What `tailscale debug prefs` holds of interest: the service signed in to and the routes offered */
export function parsePrefs(json: string): { server: string; offered: string[] } {
  try {
    const prefs = JSON.parse(json) as Record<string, unknown>;
    const control = text(prefs.ControlURL);
    return { server: /^https:\/\/(controlplane|login)\.tailscale\.com\/?$/.test(control) ? "" : control, offered: list(prefs.AdvertiseRoutes) };
  } catch {
    return { server: "", offered: [] };
  }
}

/** The network an address is on, `192.168.1.0/24` */
export function networkOf(link: Link): string {
  const parts = (ip: string) => ip.split(".").map(Number);
  const mask = parts(link.netmask);
  const bits = mask.reduce((sum, part) => sum + part.toString(2).split("1").length - 1, 0);
  return `${parts(link.address).map((part, i) => part & mask[i]!).join(".")}/${bits}`;
}

/** The home networks worth offering: not Tailscale's own range, not a network of one address */
export const homeNetworks = (links: Link[]): string[] => [...new Set(links.filter((link) => !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(link.address) && link.netmask !== "255.255.255.255").map(networkOf))];

/** The address of a service of the person's own (Headscale): a web address and nothing more; null — not one */
export function cleanServer(value: unknown): string | null {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string") return null;
  const server = value.trim().replace(/\/+$/, "");
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/.test(server) ? server : null;
}

// --- The program ------------------------------------------------------------------------------------

export const installed = (): boolean => !!Bun.which("tailscale", { PATH });

const tailscale = (args: string[], timeout = 20_000) => run(["tailscale", ...args], timeout);
const said = (ran: { out: string; err: string }): string => (ran.err.trim() || ran.out.trim()).split("\n").slice(-1)[0] ?? "";

export async function report(port: number): Promise<Report> {
  const base = { install: INSTALL_COMMAND, admin: ADMIN, port, version: "", server: "", networks: homeNetworks(homeLinks()), offered: [] as string[] };
  if (!installed()) return { ...base, state: "missing" };
  const [status, version, prefs] = await Promise.all([tailscale(["status", "--json"], 8000), tailscale(["version"], 5000), tailscale(["debug", "prefs"], 5000)]);
  const parsed = status.code === 0 || status.out.trim().startsWith("{") ? parseStatus(status.out) : null;
  const versionLine = version.out.trim().split("\n")[0] ?? "";
  if (!parsed) return { ...base, version: versionLine, state: "stopped" };
  return { ...base, ...parsed, ...parsePrefs(prefs.out), version: versionLine };
}

/** Downloads Tailscale's own installer and runs it; the lines it prints are the job's log */
export function install(user: string): Job {
  if (installed()) throw new AppError("tailscale.installed", 409);
  return startJob("", "tailscale", user, async (log) => {
    log(`$ ${INSTALL_COMMAND}`);
    // a home network whose DNS filters such services out fails right here: said in so many words
    const res = await fetch(INSTALLER, { signal: AbortSignal.timeout(60_000) }).catch((e) => {
      throw new Error(`Could not reach ${new URL(INSTALLER).host}: ${e instanceof Error ? e.message : e} Some networks block Tailscale's addresses in their DNS.`);
    });
    if (!res.ok) throw new Error(`Could not download the installer: ${INSTALLER} answered ${res.status}`);
    const script = join(tmpdir(), `hata-tailscale-${crypto.randomUUID()}.sh`);
    writeFileSync(script, await res.text(), { mode: 0o700 });
    try {
      const done = await streamed(["sh", script], { onLine: log });
      if (done.code !== 0) throw new Error(`The Tailscale installer failed (exit ${done.code})`);
    } finally {
      rmSync(script, { force: true });
    }
    await run(["systemctl", "enable", "--now", "tailscaled"], 60_000);
    bus.publish("tailscale");
  });
}

/** The daemon is installed and not running: starts it, and has it start with the system */
export async function start(): Promise<void> {
  const started = await run(["systemctl", "enable", "--now", "tailscaled"], 60_000);
  if (started.code !== 0) throw new AppError("tailscale.failed", 500, { message: said(started) });
}

let signingIn: ReturnType<typeof Bun.spawn> | null = null;

/**
 * Switches it on. Nobody signed in yet: `tailscale up` waits for the person to open its link, so it is
 * left running and the link is read from the status — the answer comes as soon as there is one.
 */
export async function connect(server: unknown, user: string): Promise<void> {
  if (!installed()) throw new AppError("tailscale.missing", 409);
  const own = cleanServer(server);
  if (own === null) throw new AppError("tailscale.badServer", 400);
  signingIn?.kill();
  const before = parseStatus((await tailscale(["status", "--json"], 8000)).out);
  // a server already signed in comes up with what it was set to; a new sign-in starts clean
  const fresh = !before || before.state === "needsLogin" || before.state === "starting";
  const proc = Bun.spawn({ cmd: ["tailscale", "up", ...(fresh ? ["--reset", ...(own ? [`--login-server=${own}`] : [])] : [])], stdout: "ignore", stderr: "pipe", stdin: "ignore", env: { ...process.env, PATH } });
  signingIn = proc;
  const errors = new Response(proc.stderr).text();
  void proc.exited.then(() => {
    if (signingIn === proc) signingIn = null;
    bus.publish("tailscale");
  });
  setTimeout(() => proc.kill(), 15 * 60_000).unref();
  for (let i = 0; i < 40; i++) {
    await Bun.sleep(500);
    const now = parseStatus((await tailscale(["status", "--json"], 8000)).out);
    if (now?.state === "running" || now?.authUrl) break;
    if (proc.exitCode !== null && proc.exitCode !== 0) throw new AppError("tailscale.failed", 500, { message: (await errors).trim().split("\n").slice(-1)[0] ?? "" });
  }
  record("system.tailscale.on", { user });
}

export async function disconnect(user: string): Promise<void> {
  signingIn?.kill();
  const done = await tailscale(["down"]);
  if (done.code !== 0) throw new AppError("tailscale.failed", 500, { message: said(done) });
  record("system.tailscale.off", { user });
}

/** Signs this server out: it leaves the private network and has to be let in anew */
export async function signOut(user: string): Promise<void> {
  signingIn?.kill();
  const done = await tailscale(["logout"], 30_000);
  if (done.code !== 0) throw new AppError("tailscale.failed", 500, { message: said(done) });
  record("system.tailscale.out", { user });
}

/**
 * Offers the home networks of this machine to the other devices, or takes the offer back. The service
 * still has to accept it — on its own page, by the owner of the network. Passing packets on between
 * networks is switched on in the kernel, in a file of Hata's that an offer taken back removes.
 */
export async function offerNetworks(on: boolean, user: string): Promise<void> {
  if (!installed()) throw new AppError("tailscale.missing", 409);
  const networks = on ? homeNetworks(homeLinks()) : [];
  if (on && !networks.length) throw new AppError("tailscale.noNetwork", 409);
  if (on) {
    writeFileSync(FORWARDING, "# Written by Hata: this server passes packets on from Tailscale to the home network\nnet.ipv4.ip_forward = 1\n");
    await run(["sysctl", "-p", FORWARDING], 10_000);
  } else rmSync(FORWARDING, { force: true });
  const done = await tailscale(["set", `--advertise-routes=${networks.join(",")}`]);
  if (done.code !== 0) throw new AppError("tailscale.failed", 500, { message: said(done) });
  record(on ? "system.tailscale.share" : "system.tailscale.unshare", { user, detail: networks.join(", ") });
}
