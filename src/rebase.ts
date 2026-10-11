/**
 * Pointing an app at a data folder that changed place: only the host side of its bind mounts moves.
 * Pure — used when the data folder is moved and when a snapshot from before a move is restored.
 */
import { dumpCompose, parseCompose, type Compose } from "./appform";

/** A path under `from` as it is under `to`; null — it does not lie there */
export function rebasePath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  return path.startsWith(from + "/") ? to + path.slice(from.length) : null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The compose file as data with the host side of its bind mounts moved; says whether anything changed */
function rebaseParsed(compose: Compose, from: string, to: string): boolean {
  let changed = false;
  for (const service of Object.values(isObject(compose.services) ? compose.services : {})) {
    if (!isObject(service) || !Array.isArray(service.volumes)) continue;
    service.volumes = service.volumes.map((volume: unknown) => {
      if (typeof volume === "string") {
        const colon = volume.indexOf(":");
        const moved = colon > 0 ? rebasePath(volume.slice(0, colon), from, to) : null;
        if (moved === null) return volume;
        changed = true;
        return moved + volume.slice(colon);
      }
      if (isObject(volume) && typeof volume.source === "string" && (volume.type === undefined || volume.type === "bind")) {
        const moved = rebasePath(volume.source, from, to);
        if (moved === null) return volume;
        changed = true;
        return { ...volume, source: moved };
      }
      return volume;
    });
  }
  return changed;
}

/**
 * The text of a compose file with every bind mount under `from` pointed at `to`. The lines are changed
 * in place; when that does not give what changing the data gives (volumes written in an unusual way),
 * the file is written out anew from the data, without its comments.
 */
export function rebaseCompose(text: string, from: string, to: string): string {
  const wanted = parseCompose(text);
  if (!rebaseParsed(wanted, from, to)) return text;
  const lines = text.split("\n");
  // the indent of the `volumes:` key we are under; -1 — not under one
  let under = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const item = line.trimStart().startsWith("- ");
    if (/^\s*volumes:\s*(#.*)?$/.test(line)) {
      under = indent;
      continue;
    }
    if (under < 0) continue;
    // a list may sit at the indent of its key; anything else that far left ends the block
    if (indent < under || (indent === under && !item)) {
      under = -1;
      continue;
    }
    const short = /^(\s*-\s+["']?)([^:"'\s][^:"']*)(:.*)$/.exec(line);
    const long = /^(\s*(?:-\s+)?source:\s*["']?)([^"'#]*?)(["']?\s*(?:#.*)?)$/.exec(line);
    const hit = short && !/^\s*-\s+(type|source|target|read_only|bind|volume|consistency):/.test(line) ? short : long;
    const moved = hit ? rebasePath(hit[2]!, from, to) : null;
    if (hit && moved !== null) lines[i] = hit[1] + moved + hit[3];
  }
  const rewritten = lines.join("\n");
  try {
    if (Bun.deepEquals(parseCompose(rewritten), wanted)) return rewritten;
  } catch {}
  return dumpCompose(wanted);
}

/** An app's `.env` with the values that are paths under `from` moved */
export function rebaseEnv(text: string, from: string, to: string): string {
  return text
    .split("\n")
    .map((line) => {
      const m = /^(\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*["']?)([^"'\s]*)(.*)$/.exec(line);
      const moved = m ? rebasePath(m[2]!, from, to) : null;
      return m && moved !== null ? m[1] + moved + m[3] : line;
    })
    .join("\n");
}
