/**
 * An app moved to another machine: from this server to a machine, back, or from one machine to another.
 *
 * Both ends are a `Place` — this server, or a machine through its client — with the same few things it
 * can do. The move: the app is stopped where it is; its own data folder (`<data folder>/AppData/<name>`)
 * travels as one tar stream with its owners kept by number (a database that runs as 999 must find its
 * files its own); its compose file is pointed at the data folder of the other end (`rebaseCompose`) and
 * the app is started there. Then the old place lets it go — its data stays there unless asked to go too.
 * Anything that fails before the app is up at the new place takes the new place's half away and starts
 * the app where it was.
 *
 * Not moved: folders of the app outside its own (a shared `/DATA/Media` — they are looked for at the
 * same place under the other data folder) and Docker's named volumes; `moveCheck` names both for the page.
 */
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { record } from "./activity";
import { bindSources, normalize, parseCompose, publishedPorts, type Compose } from "./appform";
import { adoptApp, AppError, assertName, busyPorts, dc, envText, installedNames, letGo, localAppFiles, startJob, type Job, type Log } from "./apps";
import { settings } from "./config";
import { machineAppGone, machineApps } from "./machineapps";
import { call, machine, machineDataRoot, open } from "./machines";
import { MuxError } from "./mux";
import { rebaseCompose } from "./rebase";

interface AppFiles {
  compose: string;
  env: string;
  hata: string | null;
}

interface Place {
  id: string;
  name: string;
  dataRoot: string;
  has(app: string): Promise<boolean>;
  files(app: string): Promise<AppFiles>;
  compose(app: string, command: "stop" | "up" | "down", log: Log): Promise<void>;
  busy(ports: { port: number; protocol: string }[]): Promise<number[]>;
  exists(path: string): Promise<boolean>;
  /** The tar stream of a folder, owners kept */
  pack(path: string): { stream: ReadableStream<Uint8Array>; done: Promise<unknown>; stop: () => void };
  unpack(dir: string, name: string): { write: (chunk: Uint8Array) => Promise<void>; end: () => Promise<void> };
  adopt(app: string, files: AppFiles, log: Log): Promise<void>;
  letGo(app: string): Promise<void>;
  dropData(path: string): Promise<void>;
}

const asApp = (e: unknown): never => {
  if (e instanceof MuxError) throw new AppError(e.code, 400, e.detail);
  throw e;
};

const tarError = async (code: number, errors: Promise<string>): Promise<never> => {
  const said = (await errors).trim();
  if (/No space left/i.test(said)) throw new AppError("files.noSpace", 507);
  throw new AppError("files.failed", 500, { code: said.split("\n").pop() || `tar exited with ${code}` });
};

const here: Place = {
  id: "",
  name: hostname(),
  get dataRoot() {
    return settings.dataRoot;
  },
  has: async (app) => installedNames().includes(app),
  files: async (app) => localAppFiles(app),
  compose: (app, command, log) => dc(app, command === "up" ? ["up", "-d", "--remove-orphans"] : command === "down" ? ["down", "--remove-orphans"] : ["stop"], log),
  busy: busyPorts,
  exists: async (path) => existsSync(path),
  pack(path) {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    const proc = Bun.spawn(["tar", "-cf", "-", "--numeric-owner", "-C", parent, "--", path.slice(parent.length + 1)], { stdout: "pipe", stderr: "pipe" });
    const errors = new Response(proc.stderr).text();
    return { stream: proc.stdout, done: proc.exited.then((code) => (code === 0 ? undefined : tarError(code, errors))), stop: () => proc.kill() };
  },
  unpack(dir) {
    Bun.spawnSync(["mkdir", "-p", "--", dir]);
    const proc = Bun.spawn(["tar", "-xf", "-", "-C", dir, "--same-owner", "--numeric-owner", "-p"], { stdin: "pipe", stdout: "ignore", stderr: "pipe" });
    const errors = new Response(proc.stderr).text();
    return {
      write: async (chunk) => {
        proc.stdin.write(chunk);
        await proc.stdin.flush();
      },
      end: async () => {
        await proc.stdin.end();
        const code = await proc.exited;
        if (code !== 0) await tarError(code, errors);
      },
    };
  },
  adopt: adoptApp,
  letGo: async (app) => letGo(app),
  async dropData(path) {
    const appData = join(settings.dataRoot, "AppData");
    if (!path.startsWith(appData + "/") || path.slice(appData.length + 1).includes("/")) throw new AppError("files.protected", 403);
    Bun.spawnSync(["rm", "-rf", "--", path]);
  },
};

function onMachine(id: string): Place {
  const m = machine(id);
  if (!m.online) throw new AppError("machine.offline", 409, { name: m.name });
  const filesOf = async (app: string) => {
    const found = (await call<(AppFiles & { name: string })[]>(id, "apps.list").catch(asApp)).find((f) => f.name === app);
    if (!found) throw new AppError("app.notFound", 404);
    return { compose: found.compose, env: found.env, hata: found.hata };
  };
  const composeOn = async (app: string, command: string, log: Log) => {
    const channel = open(id, "apps.compose", { name: app, command });
    const decoder = new TextDecoder();
    try {
      for (let chunk = await channel.read(); chunk; chunk = await channel.read()) for (const line of decoder.decode(chunk).split(/\r?\n|\r/)) if (line.trim()) log(line);
      await channel.result;
    } catch (e) {
      if (e instanceof MuxError && e.code === "machine.composeFailed") throw new Error(String(e.detail.message ?? e.message));
      asApp(e);
    }
  };
  return {
    id,
    name: m.name,
    dataRoot: machineDataRoot(id),
    has: async (app) => (await call<{ name: string }[]>(id, "apps.list").catch(asApp)).some((f) => f.name === app),
    files: filesOf,
    compose: composeOn,
    busy: async (ports) => (await call<{ busy: number[] }>(id, "apps.ports", { ports }).catch(asApp)).busy,
    exists: async (path) => {
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      const listing = await call<{ entries: { name: string }[] }>(id, "fs.list", { path: parent }).catch(() => null);
      return !!listing?.entries.some((e) => e.name === path.slice(parent.length + 1));
    },
    pack(path) {
      const channel = open(id, "fs.pack", { paths: [path], owners: true });
      return { stream: channel.readable(), done: channel.result, stop: () => channel.cancel() };
    },
    unpack(dir, name) {
      const channel = open(id, "fs.unpack", { to: dir, names: [name], owners: true });
      return {
        write: (chunk) => channel.send(chunk),
        end: async () => {
          channel.end();
          await channel.result.catch(asApp);
        },
      };
    },
    async adopt(app, files, log) {
      await call(id, "apps.write", { name: app, fresh: true, files: { "compose.yml": files.compose, ".env": envText(app, files.env), ...(files.hata ? { "hata.yml": files.hata } : {}) } }).catch(asApp);
      try {
        await composeOn(app, "config", log);
        const compose = parseCompose(files.compose);
        normalize(compose, machineDataRoot(id));
        await call(id, "apps.folders", { paths: bindSources(compose), root: machineDataRoot(id), owner: `${settings.puid}:${settings.pgid}` }).catch(asApp);
        await composeOn(app, "pull", log);
        await composeOn(app, "up", log);
      } catch (e) {
        await composeOn(app, "down", () => {}).catch(() => {});
        await call(id, "apps.remove", { name: app }).catch(() => {});
        throw e;
      }
    },
    letGo: async (app) => {
      await call(id, "apps.remove", { name: app }).catch(asApp);
      // its sign-in was this machine's: the app at its new place starts open
      machineAppGone(id, app);
    },
    dropData: async (path) => void (await call(id, "fs.dropData", { path, root: machineDataRoot(id) }).catch(asApp)),
  };
}

const placeOf = (id: unknown): Place => (id === undefined || id === null || id === "" ? here : typeof id === "string" ? onMachine(id) : (() => { throw new AppError("machine.notFound", 404); })());

const appDataOf = (root: string, app: string) => `${root.replace(/\/+$/, "")}/AppData/${app}`;

/** What the page tells before a move: what stays behind */
export async function moveCheck(input: { from?: unknown; name?: unknown }): Promise<{ own: string; outside: string[]; volumes: string[] }> {
  const from = placeOf(input.from);
  const app = String(input.name ?? "");
  assertName(app);
  const compose: Compose = parseCompose((await from.files(app)).compose);
  normalize(compose, from.dataRoot);
  const own = appDataOf(from.dataRoot, app);
  const outside = bindSources(compose).filter((path) => path !== own && !path.startsWith(own + "/"));
  const volumes = Object.keys(typeof compose.volumes === "object" && compose.volumes ? compose.volumes : {});
  return { own, outside, volumes };
}

export async function moveApp(input: { from?: unknown; to?: unknown; name?: unknown; dropOld?: unknown }, by: string): Promise<Job> {
  const from = placeOf(input.from);
  const to = placeOf(input.to);
  const app = String(input.name ?? "");
  assertName(app);
  if (from.id === to.id) throw new AppError("files.samePlace");
  if (!(await from.has(app))) throw new AppError("app.notFound", 404);
  if (await to.has(app)) throw new AppError("app.exists", 409);
  const files = await from.files(app);
  const rebased = rebaseCompose(files.compose, from.dataRoot.replace(/\/+$/, ""), to.dataRoot.replace(/\/+$/, ""));
  const compose = parseCompose(rebased);
  normalize(compose, to.dataRoot);
  const ports = publishedPorts(compose);
  const taken = ports.length ? await to.busy(ports) : [];
  if (taken.length) throw new AppError("app.portBusy", 409, { port: taken[0]! });
  const oldData = appDataOf(from.dataRoot, app);
  const newData = appDataOf(to.dataRoot, app);
  if (await to.exists(newData)) throw new AppError("files.exists", 409, { name: newData });
  const dropOld = input.dropOld === true;

  return startJob(
    from.id ? `${app}@${from.id}` : app,
    "moveapp",
    by,
    async (log) => {
      log(`Moving ${app} from ${from.name} to ${to.name}`);
      await from.compose(app, "stop", log);
      let copied = false;
      try {
        if (await from.exists(oldData)) {
          log(`Copying ${oldData} to ${to.name}:${newData}`);
          const source = from.pack(oldData);
          const sink = to.unpack(newData.slice(0, newData.lastIndexOf("/")), app);
          let sent = 0;
          const tick = setInterval(() => log(`  ${Math.ceil(sent / 1024 / 1024)} MB`), 3000);
          try {
            for await (const chunk of source.stream) {
              await sink.write(chunk);
              sent += chunk.length;
            }
            await source.done;
            await sink.end();
          } catch (e) {
            source.stop();
            throw e;
          } finally {
            clearInterval(tick);
          }
          copied = true;
          log(`  ${Math.ceil(sent / 1024 / 1024)} MB copied`);
        }
        await to.adopt(app, { ...files, compose: rebased }, log);
      } catch (e) {
        log(`The move failed: ${e instanceof Error ? e.message : e}. ${app} is started again on ${from.name}`);
        if (copied) await to.dropData(newData).catch(() => {});
        await from.compose(app, "up", log).catch(() => {});
        throw e instanceof MuxError ? new AppError(e.code, 400, e.detail) : e;
      }
      await from.compose(app, "down", log).catch((e) => log(`Could not take the old containers down: ${e instanceof Error ? e.message : e}`));
      await from.letGo(app);
      if (dropOld) {
        log(`Removing ${oldData} on ${from.name}`);
        await from.dropData(oldData).catch((e) => log(`Could not remove ${oldData}: ${e instanceof Error ? e.message : e}`));
      } else log(`The old data stays on ${from.name} in ${oldData}`);
      record("app.moveapp.done", { app, user: by, detail: `${from.name} → ${to.name}` });
      if (from.id) void machineApps(from.id, "en").catch(() => {});
      if (to.id) void machineApps(to.id, "en").catch(() => {});
    },
    true,
    from.id ? { app, machine: from.name } : undefined,
  );
}
