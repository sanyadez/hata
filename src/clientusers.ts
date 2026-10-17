/**
 * The users of Hata as accounts of a machine with Hata's client: made when the machine is let to them,
 * removed when it no longer is. Nobody signs in to the machine with them (no shell, no password, no
 * home folder) — they are there so that the people of Hata are the people of the machine too.
 */

import { existsSync, readFileSync } from "node:fs";
import { MuxError } from "./mux";
import { UNIX_NAME_RE } from "./smbconf";

export interface Account {
  /** `hata-<8 hex>`, as on Hata's own server */
  name: string;
  /** The name the person signs in to Hata with, for the system's list of users */
  comment: string;
}

const nologin = (): string => ["/usr/sbin/nologin", "/sbin/nologin", "/bin/false"].find((path) => existsSync(path)) ?? "/bin/false";

async function run(cmd: string[]): Promise<{ code: number; err: string }> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
    const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    return { code, err };
  } catch (e) {
    return { code: 127, err: e instanceof Error ? e.message : String(e) };
  }
}

/** The accounts the list asks for, made; Hata's accounts it does not name, removed */
export async function syncUsers(args: { users?: unknown }): Promise<{ made: string[]; removed: string[]; failed: string[] }> {
  if (!Array.isArray(args.users) || args.users.length > 1000) throw new MuxError("request.failed");
  const wanted = (args.users as Partial<Account>[]).filter((one) => typeof one?.name === "string" && UNIX_NAME_RE.test(one.name));
  const passwd = existsSync("/etc/passwd") ? readFileSync("/etc/passwd", "utf8") : "";
  const have = new Set(passwd.split("\n").map((line) => line.split(":")[0]!));
  const out = { made: [] as string[], removed: [] as string[], failed: [] as string[] };
  for (const one of wanted) {
    if (have.has(one.name!)) continue;
    const comment = `Hata user ${String(one.comment ?? "").replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 40)}`.trim();
    const made = await run(["useradd", "--system", "--no-create-home", "--shell", nologin(), "--comment", comment, one.name!]);
    (made.code === 0 ? out.made : out.failed).push(one.name!);
  }
  const keep = new Set(wanted.map((one) => one.name!));
  for (const name of have) {
    if (!UNIX_NAME_RE.test(name) || keep.has(name)) continue;
    const gone = await run(["userdel", name]);
    (gone.code === 0 ? out.removed : out.failed).push(name);
  }
  return out;
}
