/**
 * HTTPS to a service of the home network that shows its own certificate. Bun's `fetch` does not say what
 * certificate it saw, so the connection is made first and judged, and only then a password or a session
 * goes out over it. What is trusted is the one fingerprint the person confirmed.
 */
import { request } from "node:https";
import { connect, type TLSSocket } from "node:tls";
import { cleanFingerprint } from "./pve";

export interface Shown {
  fingerprint: string;
  /** A public authority vouches for it */
  trusted: boolean;
  subject: string;
  issuer: string;
}

export interface Answer {
  status: number;
  cookies: string[];
  bytes: Buffer;
}

function reach(url: string, timeout: number): Promise<{ socket: TLSSocket; shown: Shown }> {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: Number(u.port || 443), servername: /^[\d.]+$|:/.test(host) ? undefined : host, rejectUnauthorized: false, timeout }, () => {
      const cert = socket.getPeerCertificate();
      resolve({ socket, shown: { fingerprint: cleanFingerprint(cert.fingerprint256) ?? "", trusted: socket.authorized, subject: String(cert.subject?.CN ?? ""), issuer: String(cert.issuer?.CN ?? "") } });
    });
    socket.once("timeout", () => (socket.destroy(), reject(new Error("timeout"))));
    socket.once("error", reject);
  });
}

/** What the server shows, for the person to confirm */
export async function showCertificate(url: string, timeout = 10_000): Promise<Shown> {
  const { socket, shown } = await reach(url, timeout);
  socket.destroy();
  return shown;
}

export class CertificateChanged extends Error {}

export async function pinnedRequest(url: string, fingerprint: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeout = 10_000): Promise<Answer> {
  const { socket, shown } = await reach(url, timeout);
  if (fingerprint ? shown.fingerprint !== fingerprint : !shown.trusted) {
    socket.destroy();
    throw new CertificateChanged(shown.fingerprint);
  }
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: u.hostname, port: Number(u.port || 443), method: init.method ?? "GET", path, createConnection: () => socket, headers: { Connection: "close", ...init.headers, ...(init.body ? { "Content-Length": Buffer.byteLength(init.body) } : {}) }, timeout } as Parameters<typeof request>[0],
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, cookies: res.headers["set-cookie"] ?? [], bytes: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
