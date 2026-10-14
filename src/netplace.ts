/**
 * Folders of other machines mounted into this one — the pure part: what a person typed made safe, the
 * files systemd and rclone are given, and what the tools that look around the network print.
 *
 * SMB and NFS are mounted by the kernel (a `.mount` unit); SFTP, WebDAV and FTP by `rclone mount` (a
 * service). Either way the place is a plain folder under `/mnt/net`, so the file manager, the folder
 * pickers, the apps' volumes and the backups all reach it as any other.
 */

export const KINDS = ["smb", "nfs", "sftp", "webdav", "ftp"] as const;
export type Kind = (typeof KINDS)[number];

export interface Place {
  id: string;
  /** What the person calls it; the folder's name is made of it */
  name: string;
  /** The folder's name under `/mnt/net`: lowercase letters, digits and dashes */
  slug: string;
  kind: Kind;
  host: string;
  /** 0 — the protocol's own */
  port: number;
  /** smb: the share (and a folder in it); nfs: the exported path; the others: a folder on the server */
  path: string;
  /** webdav: the whole address of the server */
  url: string;
  user: string;
  password: string;
  /** smb: the workgroup or domain, when the server wants one */
  domain: string;
  /** ftp: explicit TLS (FTPS) */
  tls: boolean;
  readOnly: boolean;
  created: number;
}

export const ROOT = "/mnt/net";
export const where = (place: Pick<Place, "slug">): string => `${ROOT}/${place.slug}`;

/** The programs a kind is mounted with, as packages to install */
export const PACKAGES: Record<Kind, string[]> = { smb: ["cifs-utils"], nfs: ["nfs-common"], sftp: ["rclone", "fuse3"], webdav: ["rclone", "fuse3"], ftp: ["rclone", "fuse3"] };
/** The program that shows a package is there */
export const BINARY: Record<string, string> = { "cifs-utils": "mount.cifs", "nfs-common": "mount.nfs", rclone: "rclone", fuse3: "fusermount3", smbclient: "smbclient" };
export const byRclone = (kind: Kind): boolean => kind === "sftp" || kind === "webdav" || kind === "ftp";

const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\d{1,3}(?:\.\d{1,3}){3}|\[?[0-9A-Fa-f:]+\]?)$/;
const CONTROL = /[\0-\x1f\x7f]/;

/** A folder's name from the words a person used: Latin letters as they are, the rest dropped; "" — nothing left */
export function slugOf(text: string): string {
  const latin = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin.slice(0, 32).replace(/-+$/, "");
}

/** The first of `base`, `base-2`, `base-3`… nobody has */
export function freeSlug(base: string, taken: string[]): string {
  const root = base || "place";
  if (!taken.includes(root)) return root;
  for (let n = 2; ; n++) if (!taken.includes(`${root}-${n}`)) return `${root}-${n}`;
}

export type Input = Partial<Record<keyof Place, unknown>>;

/**
 * A place from what the page sent, checked: an error code, or the place. `before` — the one it changes
 * (an empty password keeps its password), `taken` — the folder names of the others.
 */
export function cleanPlace(input: Input, before: Place | null, taken: string[], id: string, now: number): Place | string {
  const kind = KINDS.find((k) => k === input.kind) ?? before?.kind;
  if (!kind) return "netplace.badKind";
  const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value.trim() : fallback);
  const name = text(input.name, before?.name);
  const host = text(input.host, before?.host).replace(/^\[|\]$/g, "");
  const url = text(input.url, before?.url);
  let path = text(input.path, before?.path);
  const user = text(input.user, before?.user);
  const password = typeof input.password === "string" && input.password !== "" ? input.password : (before?.password ?? "");
  const domain = text(input.domain, before?.domain);
  const port = input.port === undefined || input.port === "" || input.port === null ? (before?.port ?? 0) : Number(input.port);
  if ([name, host, url, path, user, password, domain].some((v) => CONTROL.test(v))) return "netplace.badText";
  if (!name || name.length > 40) return "netplace.badName";
  if (!Number.isInteger(port) || port < 0 || port > 65535) return "netplace.badPort";
  if (kind === "webdav") {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return "netplace.badUrl";
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return "netplace.badUrl";
  } else if (!host || !HOST_RE.test(host) || host.startsWith("-")) return "netplace.badHost";
  if (kind === "smb") {
    path = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    // the share, then folders in it; a name the kernel would read as an option is not one
    if (!path || !/^[^\s/'",=]+(\/[^/'",=]+)*$/.test(path)) return "netplace.badShare";
    if (/[,=]/.test(user + domain)) return "netplace.badText";
  }
  if (kind === "nfs" && !/^\/[^\s'",]*$/.test(path)) return "netplace.badExport";
  // for SFTP and FTP a path without a slash starts at the user's own folder on the server
  if (byRclone(kind) && path.split("/").includes("..")) return "netplace.badPath";
  const slug = before?.slug ?? freeSlug(slugOf(name) || slugOf(kind === "webdav" ? new URL(url).hostname : host), taken);
  return {
    id: before?.id ?? id,
    name,
    slug,
    kind,
    host: kind === "webdav" ? "" : host,
    port,
    path,
    url: kind === "webdav" ? url : "",
    user,
    password,
    domain: kind === "smb" ? domain : "",
    tls: kind === "ftp" && (input.tls === undefined ? (before?.tls ?? false) : input.tls === true),
    readOnly: input.readOnly === undefined ? (before?.readOnly ?? false) : input.readOnly === true,
    created: before?.created ?? now,
  };
}

/** What the page is shown of a place: the password stays on the server */
export const shown = (place: Place) => ({ ...place, password: "", passwordSet: place.password !== "" });

// --- What systemd and rclone are given ------------------------------------------------------------

/** A path as systemd names its mount unit (`systemd-escape --path`), for the folders Hata makes */
export function unitPath(path: string): string {
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((part) => part.replace(/[^A-Za-z0-9:_.]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`).replace(/^\./, "\\x2e"))
    .join("-");
}

/** The unit that mounts a place: `<path>.mount` for the kernel's kinds, a service for rclone's */
export const unitOf = (place: Pick<Place, "slug" | "kind">): string => (byRclone(place.kind) ? `hata-net-${place.slug}.service` : `${unitPath(where(place))}.mount`);

/** One argument of an `ExecStart=` line, quoted as systemd reads it */
export function quoteArg(arg: string): string {
  const escaped = arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$");
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? escaped : `"${escaped}"`;
}

/** What `mount.cifs` reads the sign-in from: never on a command line */
export const credentials = (place: Place): string => [`username=${place.user || "guest"}`, `password=${place.password}`, ...(place.domain ? [`domain=${place.domain}`] : []), ""].join("\n");

export interface Owner {
  uid: number;
  gid: number;
}

const header = (place: Place): string[] => [
  "# Written by Hata: a network place. Changed from Hata's page; edits here are written over.",
  "[Unit]",
  `Description=Hata network place: ${place.name.replace(/[\r\n%]/g, " ")}`,
  "Wants=network-online.target",
  "After=network-online.target",
];

/**
 * The `.mount` unit of an SMB or NFS place. `soft` mounts: a server that went away makes calls fail
 * after a while instead of freezing whatever looks at the folder — Hata itself included.
 */
export function mountUnit(place: Place, owner: Owner, credentialsFile: string): string {
  const options =
    place.kind === "smb"
      ? [`credentials=${credentialsFile}`, `uid=${owner.uid}`, `gid=${owner.gid}`, "file_mode=0664", "dir_mode=0775", "iocharset=utf8", "soft", "echo_interval=15", ...(place.port ? [`port=${place.port}`] : [])]
      : ["soft", "timeo=100", "retrans=2", ...(place.port ? [`port=${place.port}`] : [])];
  if (place.readOnly) options.push("ro");
  const what = place.kind === "smb" ? `//${place.host.includes(":") ? `[${place.host}]` : place.host}/${place.path}` : `${place.host.includes(":") ? `[${place.host}]` : place.host}:${place.path}`;
  return [...header(place), "", "[Mount]", `What=${what}`, `Where=${where(place)}`, `Type=${place.kind === "smb" ? "cifs" : "nfs"}`, `Options=${options.join(",")}`, "TimeoutSec=30", "", "[Install]", "WantedBy=remote-fs.target", ""].join("\n");
}

/** The section of rclone's configuration a place reads; `obscured` — its password as `rclone obscure` gave it */
export function rcloneSection(place: Place, obscured: string, knownHosts: string): string {
  const lines = [`[hata-${place.slug}]`];
  if (place.kind === "sftp") {
    lines.push("type = sftp", `host = ${place.host}`, `user = ${place.user}`, `port = ${place.port || 22}`, `known_hosts_file = ${knownHosts}`, "shell_type = unix", "md5sum_command = none", "sha1sum_command = none");
  } else if (place.kind === "webdav") {
    lines.push("type = webdav", `url = ${place.url}`, "vendor = other", ...(place.user ? [`user = ${place.user}`] : []));
  } else {
    lines.push("type = ftp", `host = ${place.host}`, `user = ${place.user || "anonymous"}`, `port = ${place.port || 21}`, ...(place.tls ? ["explicit_tls = true"] : []));
  }
  if (obscured) lines.push(`pass = ${obscured}`);
  return lines.join("\n") + "\n";
}

/** The service that keeps an rclone place mounted, and mounts it again when the server comes back */
export function rcloneUnit(place: Place, owner: Owner, rclone: string, config: string, cacheDir: string, fusermount: string): string {
  const args = [rclone, "mount", `hata-${place.slug}:${place.path}`, where(place), "--config", config, "--allow-other", "--uid", String(owner.uid), "--gid", String(owner.gid), "--umask", "002", "--vfs-cache-mode", "writes", "--cache-dir", cacheDir, "--dir-cache-time", "1m", "--contimeout", "15s", "--timeout", "1m", ...(place.readOnly ? ["--read-only"] : [])];
  return [
    ...header(place),
    "",
    "[Service]",
    "Type=notify",
    `ExecStart=${args.map(quoteArg).join(" ")}`,
    `ExecStop=${quoteArg(fusermount)} -uz ${quoteArg(where(place))}`,
    "Restart=on-failure",
    "RestartSec=30",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

// --- Looking around -------------------------------------------------------------------------------

/** The shares `smbclient -L -g` lists: disk shares only, without the administrative ones ending in `$` */
export function parseSmbShares(out: string): string[] {
  return out
    .split("\n")
    .map((line) => line.split("|"))
    .filter((f) => f[0] === "Disk" && f[1] && !f[1].endsWith("$"))
    .map((f) => f[1]!);
}

/** The exports `showmount -e` lists */
export function parseExports(out: string): string[] {
  return out
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((path) => path.startsWith("/"));
}

/** Which kind a DNS-SD service type is */
export const SERVICE_KINDS: Record<string, Kind> = { "_smb._tcp": "smb", "_nfs._tcp": "nfs", "_sftp-ssh._tcp": "sftp", "_webdav._tcp": "webdav", "_webdavs._tcp": "webdav", "_ftp._tcp": "ftp" };

/** A multicast DNS question for the PTR records of these service types; from a port of its own, so answers come back to it */
export function browseQuery(types: string[]): Uint8Array {
  const bytes = [0, 0, 0, 0, types.length >> 8, types.length & 0xff, 0, 0, 0, 0, 0, 0];
  for (const type of types) {
    for (const label of `${type}.local`.split(".")) {
      const b = new TextEncoder().encode(label);
      bytes.push(b.length, ...b);
    }
    bytes.push(0, 0, 12, 0, 1);
  }
  return Uint8Array.from(bytes);
}

export interface DnsRecord {
  name: string;
  type: number;
  /** PTR: the instance; SRV: the target host; A: the address */
  value: string;
  port?: number;
}

/** The records of an answer (all sections), with the names' compression undone; [] — not one that reads */
export function parseAnswer(packet: Uint8Array): DnsRecord[] {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (packet.length < 12 || !(packet[2]! & 0x80)) return [];
  const name = (at: number, depth = 0): [string, number] => {
    const labels: string[] = [];
    let pos = at;
    let end = -1;
    while (pos < packet.length && depth < 20) {
      const len = packet[pos]!;
      if (len === 0) {
        pos++;
        break;
      }
      if ((len & 0xc0) === 0xc0) {
        if (end < 0) end = pos + 2;
        pos = ((len & 0x3f) << 8) | packet[pos + 1]!;
        depth++;
        continue;
      }
      labels.push(new TextDecoder().decode(packet.subarray(pos + 1, pos + 1 + len)));
      pos += 1 + len;
    }
    return [labels.join("."), end >= 0 ? end : pos];
  };
  const counts = [4, 6, 8, 10].map((o) => view.getUint16(o));
  let pos = 12;
  for (let q = 0; q < counts[0]!; q++) pos = name(pos)[1] + 4;
  const out: DnsRecord[] = [];
  const total = counts[1]! + counts[2]! + counts[3]!;
  for (let r = 0; r < total && pos + 10 <= packet.length; r++) {
    const [owner, after] = name(pos);
    const type = view.getUint16(after);
    const length = view.getUint16(after + 8);
    const data = after + 10;
    if (data + length > packet.length) break;
    if (type === 12) out.push({ name: owner, type, value: name(data)[0] });
    else if (type === 33) out.push({ name: owner, type, value: name(data + 6)[0], port: view.getUint16(data + 4) });
    else if (type === 1 && length === 4) out.push({ name: owner, type, value: Array.from(packet.subarray(data, data + 4)).join(".") });
    pos = data + length;
  }
  return out;
}

export interface Found {
  kind: Kind;
  /** The name the server announces itself under */
  name: string;
  host: string;
  address: string;
  port: number;
}

/** Servers out of the records gathered: one per kind and host */
export function foundServers(records: DnsRecord[]): Found[] {
  const found = new Map<string, Found>();
  for (const ptr of records.filter((r) => r.type === 12)) {
    const type = Object.keys(SERVICE_KINDS).find((t) => ptr.name === `${t}.local`);
    if (!type) continue;
    const srv = records.find((r) => r.type === 33 && r.name === ptr.value);
    if (!srv) continue;
    const address = records.find((r) => r.type === 1 && r.name === srv.value)?.value ?? "";
    const kind = SERVICE_KINDS[type]!;
    const instance = ptr.value.slice(0, -(type.length + ".local".length + 1)).replace(/\\032/g, " ");
    found.set(`${kind} ${srv.value}`, { kind, name: instance, host: srv.value.replace(/\.$/, ""), address, port: srv.port ?? 0 });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
}
