/**
 * Files between Hata and the machines it looks after: a copy or a move from one to another — Hata to a
 * machine, a machine to Hata, a machine to another machine — as a job with a log.
 *
 * The entries travel as one tar stream: `tar -c` where they lie (Hata's own, or the client's `fs.pack`)
 * and `tar -x` where they go (`fs.unpack` on a machine), relayed by Hata, with flow control end to end,
 * so a slow side slows the other instead of filling the memory. What arrives takes the owner of the
 * folder it lands in, as everything made in the file manager does. Nothing is overwritten: a name that
 * is taken in the folder is refused before anything is sent. A move removes the originals only once
 * the copy is whole — on Hata into the trash, on a machine for good.
 */
import { statSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { record } from "./activity";
import { AppError, startJob, type Job } from "./apps";
import { packable, receiving, remove as removeHere, summary as summaryHere } from "./files";
import { call, machine, open } from "./machines";
import { MuxError } from "./mux";

/** One side of a transfer: a machine's id, or "" for Hata itself */
interface Place {
  machine: string;
  name: string;
}

function placeOf(id: unknown): Place {
  if (id === undefined || id === null || id === "") return { machine: "", name: hostname() };
  if (typeof id !== "string") throw new AppError("machine.notFound", 404);
  const m = machine(id);
  if (!m.online) throw new AppError("machine.offline", 409, { name: m.name });
  return { machine: id, name: m.name };
}

const megabytes = (n: number): string => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.ceil(n / 1024 ** 2))} MB`);

/** The tar stream of the entries, and how it ended */
function packed(from: Place, paths: string[]): { stream: ReadableStream<Uint8Array>; done: Promise<unknown>; stop: () => void } {
  if (from.machine) {
    const channel = open(from.machine, "fs.pack", { paths });
    return { stream: channel.readable(), done: channel.result, stop: () => channel.cancel() };
  }
  const { dir, names } = packable(paths);
  const proc = Bun.spawn(["tar", "-cf", "-", "-C", dir, "--", ...names], { stdout: "pipe", stderr: "pipe" });
  const errors = new Response(proc.stderr).text();
  const done = proc.exited.then(async (code) => {
    if (code !== 0) throw new AppError("files.failed", 500, { code: (await errors).trim().split("\n").pop() || `tar exited with ${code}` });
  });
  return { stream: proc.stdout, done, stop: () => proc.kill() };
}

/** Where the stream goes: a writer of its pieces, and the end that says whether it all landed */
function unpacking(to: Place, dir: string, names: string[]): { write: (chunk: Uint8Array) => Promise<void>; end: () => Promise<void> } {
  if (to.machine) {
    const channel = open(to.machine, "fs.unpack", { to: dir, names });
    return {
      write: (chunk) => channel.send(chunk),
      end: async () => {
        channel.end();
        await channel.result;
      },
    };
  }
  const proc = Bun.spawn(["tar", "-xf", "-", "-C", dir, "--no-same-owner"], { stdin: "pipe", stdout: "ignore", stderr: "pipe" });
  const errors = new Response(proc.stderr).text();
  return {
    write: async (chunk) => {
      proc.stdin.write(chunk);
      await proc.stdin.flush();
    },
    end: async () => {
      await proc.stdin.end();
      const code = await proc.exited;
      if (code !== 0) {
        const said = (await errors).trim();
        if (/No space left/i.test(said)) throw new AppError("files.noSpace", 507);
        throw new AppError("files.failed", 500, { code: said.split("\n").pop() || `tar exited with ${code}` });
      }
      if (process.getuid?.() === 0) {
        const owner = statSync(dir);
        for (const name of names) Bun.spawnSync(["chown", "-R", "-h", `${owner.uid}:${owner.gid}`, "--", join(dir, name)]);
      }
    },
  };
}

const MAX_PATHS = 1000;

/**
 * Copies or moves entries of one folder to a folder elsewhere. What can be refused — a machine away, a
 * path that is not there, a name taken — is refused before the job starts.
 */
export async function crossTransfer(input: { from?: unknown; to?: unknown; copy?: unknown }, by: string): Promise<Job> {
  const fromIn = (input.from ?? {}) as { machine?: unknown; paths?: unknown };
  const toIn = (input.to ?? {}) as { machine?: unknown; dir?: unknown };
  const copy = input.copy === true;
  const from = placeOf(fromIn.machine);
  const to = placeOf(toIn.machine);
  if (from.machine === to.machine) throw new AppError("files.samePlace");
  const paths = fromIn.paths;
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_PATHS || paths.some((p) => typeof p !== "string" || !p.startsWith("/"))) throw new AppError("files.badPath");
  const names = (paths as string[]).map((p) => p.replace(/\/+$/, "").split("/").pop() ?? "");
  if (new Set(names).size !== names.length || names.some((n) => !n)) throw new AppError("files.badPath");
  if (!from.machine) packable(paths);
  if (typeof toIn.dir !== "string") throw new AppError("files.badPath");
  const taken = to.machine ? (await call<{ taken: string[] }>(to.machine, "fs.taken", { dir: toIn.dir, names })).taken : receiving(toIn.dir, names).taken;
  if (taken.length) throw new AppError("files.exists", 409, { name: taken[0]! });
  const dir = toIn.dir.replace(/(.)\/+$/, "$1");
  const what = names.length === 1 ? (paths as string[])[0]! : `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;

  return startJob(
    "",
    "transfer",
    by,
    async (log) => {
      const total = from.machine ? (await call<{ size: number }>(from.machine, "fs.summary", { paths })).size : (await summaryHere(paths)).size;
      log(`${copy ? "Copying" : "Moving"} ${megabytes(total)} from ${from.name} to ${to.name}:${dir}`);
      const source = packed(from, paths as string[]);
      const sink = unpacking(to, dir, names);
      let sent = 0;
      const tick = setInterval(() => log(`  ${megabytes(sent)} of ${megabytes(total)}`), 2000);
      try {
        for await (const chunk of source.stream) {
          await sink.write(chunk);
          sent += chunk.length;
        }
        await source.done;
        await sink.end();
      } catch (e) {
        source.stop();
        // what the machine said is worded like Hata's own
        throw e instanceof MuxError ? new AppError(e.code, 400, e.detail) : e;
      } finally {
        clearInterval(tick);
      }
      log(`  ${megabytes(sent)} sent`);
      if (!copy) {
        if (from.machine) await call(from.machine, "fs.delete", { paths });
        else await removeHere(paths, false, by);
        log(`The originals on ${from.name} are removed`);
      }
      record(copy ? "files.copy" : "files.move", { user: by, detail: `${from.name}:${what} → ${to.name}:${dir}`.slice(0, 300) });
    },
    true,
  );
}
