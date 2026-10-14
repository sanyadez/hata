/**
 * The internet side: an interface the person marked as the one the internet comes in on (a provider's
 * cable in a port, a public address). Nothing of the server answers there — the pages, the apps, the
 * network folders, the announcements — and the rules below stop whoever comes in through it, Docker's
 * published ports included (Docker writes its own rules ahead of a host firewall; `DOCKER-USER` is the
 * place it leaves to others).
 *
 * Pure and import-free: the uninstaller takes the rules away with `outsideDown`.
 */

/** Hata's own chain, for IPv4 and IPv6 alike */
export const OUTSIDE_CHAIN = "HATA-OUTSIDE";

/** Where the chain is jumped to: what comes to the server, and what passes through it — to the containers too */
export const OUTSIDE_HOOKS = ["INPUT", "FORWARD", "DOCKER-USER"];

/** What still gets in on the internet side besides the answers to what the server asked for */
export interface Openings {
  /** The UDP port of the server's WireGuard, while it is on: devices from afar come in through it */
  wireguard: number | null;
}

/** Tailscale's own port: it gets through without it, but straight connections are faster than relayed ones */
const TAILSCALE_PORT = 41641;

/** The rules of the chain for one family (`iptables` or `ip6tables`), as arguments of one command each */
export function outsideRules(names: string[], open: Openings, family: "4" | "6"): string[][] {
  const rules: string[][] = [];
  for (const name of names) {
    const rule = (...rest: string[]) => rules.push(["-A", OUTSIDE_CHAIN, "-i", name, ...rest]);
    rule("-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "RETURN");
    if (family === "6") {
      // without them IPv6 does not work at all: neighbours, the router's announcements, the addresses it hands out
      rule("-p", "ipv6-icmp", "-j", "RETURN");
      rule("-p", "udp", "--dport", "546", "-j", "RETURN");
    } else rule("-p", "udp", "--sport", "67", "--dport", "68", "-j", "RETURN");
    if (open.wireguard) rule("-p", "udp", "--dport", String(open.wireguard), "-j", "RETURN");
    rule("-p", "udp", "--dport", String(TAILSCALE_PORT), "-j", "RETURN");
    rule("-j", "DROP");
  }
  return rules;
}

/** The names of the interfaces marked as the internet side, as the settings keep them */
export const cleanOutside = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.filter((name): name is string => typeof name === "string" && /^[A-Za-z0-9_.-]{1,15}$/.test(name)))] : []);

/** Whether an IPv4 address is reachable from the internet: not a home network's, a provider's shared one, a link's own or the machine's */
export function isPublic(address: string): boolean {
  const parts = address.split("/")[0]!.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  // the addresses a provider shares behind its own translation (CGNAT) — and Tailscale's
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

/** The number an address stands for, IPv4 or IPv6, and how many bits it has; null — not an address */
function numberOf(ip: string): { n: bigint; bits: number } | null {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    return parts.every((p) => p <= 255) ? { n: parts.reduce((n, p) => n * 256n + BigInt(p), 0n), bits: 32 } : null;
  }
  if (!ip.includes(":") || !/^[0-9a-f:]+$/i.test(ip)) return null;
  const [head = "", tail, ...more] = ip.split("::");
  if (more.length) return null;
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { n: groups.reduce((n, g) => n * 65536n + BigInt(parseInt(g, 16)), 0n), bits: 128 };
}

/** Whether `address` lies in the network of one of `addresses` (`192.168.1.5/24`, `2001:db8::5/64`) */
export function inNetworkOf(address: string, addresses: string[]): boolean {
  const ip = numberOf(address);
  if (!ip) return false;
  return addresses.some((cidr) => {
    const [base = "", bits] = cidr.split("/");
    const net = numberOf(base);
    if (!net || net.bits !== ip.bits) return false;
    const prefix = Number(bits ?? net.bits);
    if (!(prefix >= 0 && prefix <= net.bits)) return false;
    const shift = BigInt(net.bits - prefix);
    return net.n >> shift === ip.n >> shift;
  });
}

/** Shell lines that take the chain and its jumps away, for both families; nothing fails when they are not there */
export function outsideDown(): string[] {
  return ["iptables", "ip6tables"].flatMap((tool) => [...OUTSIDE_HOOKS.map((hook) => `while ${tool} -D ${hook} -j ${OUTSIDE_CHAIN} 2>/dev/null; do :; done`), `${tool} -F ${OUTSIDE_CHAIN} 2>/dev/null; ${tool} -X ${OUTSIDE_CHAIN} 2>/dev/null; true`]);
}
