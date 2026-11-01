/** What the integrations share: they are services found by an address, often an app of this very server */
import { networkInterfaces } from "node:os";
import { homeLinks } from "./mdns";

export function isHere(url: string): boolean {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  return Object.values(networkInterfaces()).some((list) => (list ?? []).some((a) => a.address === host));
}

export const portOf = (url: string) => Number(new URL(url).port) || (url.startsWith("https:") ? 443 : 80);

/** The app whose published port a server of this machine is */
export const appOfServer = <A extends { port?: string | number | null }>(apps: A[], server: { here: boolean; port: number }): A | undefined => (server.here ? apps.find((a) => String(a.port) === String(server.port)) : undefined);

export const cleanName = (value: unknown, fallback: string, max = 40) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback);

export const newId = (taken: { id: string }[]) => {
  let id = "";
  while (!id || taken.some((s) => s.id === id)) id = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  return id;
};

/**
 * This server's address on the home network, for a service of this machine. The page must not lend it the
 * host it was opened by: behind a domain that leads to a proxy, which knows nothing of the service's port.
 */
export function lanAddress(): string {
  for (const link of homeLinks()) if (link.address) return link.address;
  return "";
}
