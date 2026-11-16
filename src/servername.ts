/**
 * The server's name: one word that is both the computer's own name (what the system and its prompt
 * say) and the first part of its name on the home network.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { record } from "./activity";
import { AppError } from "./apps";
import { localName, settings, updateSettings } from "./config";
import { run } from "./packages";

/** A name typed for the server: one word (`hata`) or a whole home-network name (`hata.lan`); null — neither */
export function readServerName(raw: unknown, now: string): { host: string; local: string } | null {
  const typed = typeof raw === "string" ? raw.trim().toLowerCase().replace(/\.$/, "") : "";
  const host = typed.split(".")[0] ?? "";
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) return null;
  // one word keeps the ending the home-network name has now; a whole name brings its own
  const ending = now.includes(".") ? now.slice(now.indexOf(".")) : ".local";
  const local = localName(typed.includes(".") ? typed : host + ending);
  return local ? { host, local } : null;
}

/**
 * `/etc/hosts` with the computer's own line saying the new name: without it programs that look their
 * own name up (sudo among them) complain or wait.
 */
export function hostsWith(text: string, old: string, next: string): string {
  const lines = text.split("\n");
  let found = false;
  const out = lines.map((line) => {
    if (!/^\s*127\.0\.1\.1\s/.test(line)) return line;
    found = true;
    const words = line.trim().split(/\s+/).slice(1).filter((word) => word !== old && !word.startsWith(old + ".") && word !== next);
    return ["127.0.1.1", next, ...words].join("\t");
  });
  if (!found) {
    const at = out.findIndex((line) => /^\s*127\.0\.0\.1\s/.test(line));
    out.splice(at < 0 ? 0 : at + 1, 0, `127.0.1.1\t${next}`);
  }
  return out.join("\n");
}

/** Renames the server: the computer's own name and its name on the home network, together */
export async function renameServer(raw: unknown, by: string): Promise<{ host: string; local: string }> {
  if (process.getuid?.() !== 0) throw new AppError("system.renameDenied", 403);
  const name = readServerName(raw, settings.local.name);
  if (!name) throw new AppError("system.badName", 400);
  const old = hostname().split(".")[0] ?? "";
  if (name.host !== old) {
    const set = Bun.which("hostnamectl") ? await run(["hostnamectl", "set-hostname", name.host], 30_000) : { code: 1, out: "", err: "" };
    if (set.code !== 0) {
      // no systemd to ask: the file the system reads at start, and the running kernel
      try {
        writeFileSync("/etc/hostname", name.host + "\n");
      } catch (e) {
        throw new AppError("system.renameFailed", 500, { message: e instanceof Error ? e.message : String(e) });
      }
      const now = await run(["hostname", name.host], 10_000);
      if (now.code !== 0) throw new AppError("system.renameFailed", 500, { message: (now.err || now.out || set.err).trim() });
    }
    try {
      if (existsSync("/etc/hosts")) writeFileSync("/etc/hosts", hostsWith(readFileSync("/etc/hosts", "utf8"), old, name.host));
    } catch {
      // a read-only /etc/hosts (some containers): the name itself is changed
    }
  }
  const error = updateSettings({ local: { name: name.local } });
  if (error) throw new AppError(error, 400);
  record("system.renamed", { user: by, detail: name.host });
  return name;
}
