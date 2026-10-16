/**
 * App stores, of two kinds.
 *
 * Hata's own format (`hataapp.ts`): the store publishes one `index.json` with every app — on GitHub in
 * the branch `index` of the repository, elsewhere at any https address ending in `/index.json`. A sync
 * downloads that file.
 *
 * CasaOS-compatible GitHub repositories (`Apps/<Name>/docker-compose.yml` with `x-casaos`): a store
 * repository is hundreds of megabytes of screenshots, while all we need are the compose files — icons and
 * screenshots are referenced from them by URL. So a sync asks GitHub for the file tree (one request) and
 * downloads only the compose files whose blob hash changed since the last sync.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP_NAME_RE, appMeta, localize, parseCompose, type AppMeta, type Compose } from "./appform";
import { readIndexApp, startingEnv, viewCompose, type IndexApp, type Text } from "./hataapp";
import { record } from "./activity";
import { bus } from "./bus";
import { DATA_DIR, saveSettings, settings, type StoreSource } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic, writeTextAtomic } from "./fsutil";

const STORES_DIR = join(DATA_DIR, "stores");
const COMPOSE_PATH_RE = /^Apps\/([A-Za-z0-9][A-Za-z0-9._-]*)\/docker-compose\.ya?ml$/;
const EXTRA_FILES = ["category-list.json", "recommend-list.json"];
const DOWNLOADS_AT_ONCE = 12;
const MAX_COMPOSE_BYTES = 1024 * 1024;
const MAX_INDEX_BYTES = 32 * 1024 * 1024;
/** The file a store of Hata's format keeps on disk: its `index.json` as downloaded */
const HATA_INDEX = "hata-index.json";

interface StoreIndex {
  syncedAt: number;
  /** path in the repository → git blob hash of the copy on disk */
  files: Record<string, string>;
  /** "hata" — the store is in Hata's format, its apps are in `HATA_INDEX` */
  kind?: "hata";
}

export interface StoreApp {
  store: string;
  /** Compose project name — the key of the app within its store */
  name: string;
  /** Path of the compose file inside the store */
  path: string;
  /** The compose file as Hata reads its tile: for an app of Hata's format, with the `x-casaos` made from `hata.yml` */
  compose: Compose;
  /** An app of Hata's format: `hata.yml`, the compose file as written, the other files */
  hata?: IndexApp;
}

interface LoadedStore {
  source: StoreSource;
  index: StoreIndex;
  apps: Map<string, StoreApp>;
  /** Names, or texts in several languages */
  categories: Text[];
  recommended: string[];
  /** The store's own name, for one of Hata's format */
  name: Text;
}

const stores = new Map<string, LoadedStore>();
const syncing = new Map<string, Promise<SyncResult>>();

const storeDir = (id: string) => join(STORES_DIR, id);
const validStoreId = (id: string) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(id);

export function githubRepo(url: string): { owner: string; repo: string } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

/**
 * A store's address as people paste it, made the repository's: CasaOS takes the ZIP of a branch
 * (`…/archive/refs/heads/main.zip`), and a page of the repository (`…/tree/main`) is copied as often.
 * null — not a repository on GitHub.
 */
export function storeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const index = indexUrl(value.trim());
  if (index) return index;
  const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/(?:archive|tree|blob|releases)\/[^\s]*)?\/?$/.exec(value.trim());
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

/**
 * The address of a store's `index.json` given as such: https, or http when `HATA_STORE_INSECURE=1` (for
 * trying a store out on the home network). null — not one.
 */
export function indexUrl(value: string): string | null {
  const insecure = process.env.HATA_STORE_INSECURE === "1";
  if (!/^https?:\/\/[^\s?#]+\/index\.json$/.test(value) || (!insecure && !value.startsWith("https://"))) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

/** A short id for a new store, from its repository's name, not taken by another */
export function storeId(url: string, taken: string[]): string {
  // for an index of its own the folder it lies in names it
  const repo = githubRepo(url)?.repo ?? (indexUrl(url) ? new URL(url).pathname.split("/").slice(-2, -1)[0] || new URL(url).hostname : "store");
  const base = repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "store";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export class StoreError extends Error {
  constructor(
    readonly code: string,
    readonly detail: Record<string, string> = {},
  ) {
    super(code);
  }
}

/** Adds a store by its address; one that has no app Hata can read is not kept */
export async function addStore(value: unknown, user: string): Promise<SyncResult & { id: string }> {
  const url = storeUrl(value);
  if (!url) throw new StoreError("store.badUrl");
  const same = settings.stores.find((s) => s.url.toLowerCase() === url.toLowerCase());
  if (same) throw new StoreError("store.exists", { id: same.id });
  const id = storeId(url, settings.stores.map((s) => s.id));
  settings.stores = [...settings.stores, { id, url }];
  const result = await syncStore(id);
  if (!result.ok || result.apps === 0) {
    settings.stores = settings.stores.filter((s) => s.id !== id);
    stores.delete(id);
    rmSync(storeDir(id), { recursive: true, force: true });
    throw new StoreError(result.ok ? "store.noApps" : "store.syncFailed", { message: result.error ?? "" });
  }
  saveSettings();
  record("store.added", { user, detail: url });
  bus.publish("store");
  return { ...result, id };
}

/** Takes a store away: its apps leave the catalogue; installed ones keep running, without its updates */
export function removeStore(id: string, user: string): void {
  const source = settings.stores.find((s) => s.id === id);
  if (!source) throw new StoreError("store.noStore");
  settings.stores = settings.stores.filter((s) => s.id !== id);
  stores.delete(id);
  if (validStoreId(id)) rmSync(storeDir(id), { recursive: true, force: true });
  saveSettings();
  record("store.removed", { user, detail: source.url });
  bus.publish("store");
}

function readList(file: string, pick: (item: unknown) => string | undefined): string[] {
  const list = readJsonFile<unknown[]>(file, [], Array.isArray);
  return list.map(pick).filter((v): v is string => typeof v === "string" && v !== "");
}

/** What a downloaded `index.json` holds, read leniently: a broken app must not hide the rest */
function readHataIndex(source: StoreSource, index: StoreIndex, doc: unknown): LoadedStore {
  const apps = new Map<string, StoreApp>();
  const top = isPlainObject(doc) ? doc : {};
  const store = isPlainObject(top.store) ? top.store : {};
  const categories: Record<string, Text> = isPlainObject(store.categories) ? (store.categories as Record<string, Text>) : {};
  const repo = githubRepo(source.url);
  const commit = typeof top.commit === "string" && /^[0-9a-f]{7,40}$/.test(top.commit) ? top.commit : "";
  // screenshots lie in the repository, at the commit the index was made of
  const base = repo && commit ? `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${commit}/` : source.url.replace(/[^/]*$/, "");
  for (const entry of Array.isArray(top.apps) ? top.apps : []) {
    const app = readIndexApp(entry, base, categories);
    if (!app || apps.has(app.name)) continue;
    try {
      const compose = parseCompose(app.compose);
      // the tile is read with every setting at its default
      const view = viewCompose(compose, app.meta, startingEnv(app.meta, {}, () => ""));
      apps.set(app.name, { store: source.id, name: app.name, path: `apps/${app.name}/compose.yml`, compose: view, hata: app });
    } catch {
      // one broken file must not hide the rest of the store
    }
  }
  const loaded: LoadedStore = {
    source,
    index,
    apps,
    categories: Object.values(categories),
    recommended: Array.isArray(store.recommended) ? store.recommended.filter((n: unknown): n is string => typeof n === "string") : [],
    name: typeof store.name === "string" || isPlainObject(store.name) ? (store.name as Text) : "",
  };
  stores.set(source.id, loaded);
  return loaded;
}

function load(source: StoreSource): LoadedStore {
  const dir = storeDir(source.id);
  const index = readJsonFile<StoreIndex>(join(dir, "index.json"), { syncedAt: 0, files: {} }, (v) => isPlainObject(v) && isPlainObject(v.files));
  if (index.kind === "hata") return readHataIndex(source, index, readJsonFile<unknown>(join(dir, HATA_INDEX), {}, isPlainObject));
  const apps = new Map<string, StoreApp>();
  for (const path of Object.keys(index.files)) {
    if (!COMPOSE_PATH_RE.test(path)) continue;
    try {
      const compose = parseCompose(readFileSync(join(dir, path), "utf8"));
      const name = typeof compose.name === "string" ? compose.name : "";
      // an app we could not address or install is not listed at all
      if (!APP_NAME_RE.test(name) || apps.has(name)) continue;
      apps.set(name, { store: source.id, name, path, compose });
    } catch {
      // one broken file must not hide the rest of the store
    }
  }
  const loaded: LoadedStore = {
    source,
    index,
    apps,
    categories: readList(join(dir, "category-list.json"), (c) => (isPlainObject(c) ? (c.name as string) : undefined)),
    recommended: readList(join(dir, "recommend-list.json"), (c) => (isPlainObject(c) ? (c.appid as string) : undefined)),
    name: "",
  };
  stores.set(source.id, loaded);
  return loaded;
}

function loaded(): LoadedStore[] {
  return settings.stores.filter((s) => validStoreId(s.id)).map((s) => stores.get(s.id) ?? load(s));
}

export interface SyncResult {
  ok: boolean;
  apps: number;
  changed: number;
  error?: string;
}

async function download(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_COMPOSE_BYTES) throw new Error(`${url}: too large`);
  return text;
}

/**
 * The `index.json` of a store in Hata's format: at the address given, or in the branch `index` of a
 * GitHub repository. null — the store has none (a CasaOS one); a failure to download it throws.
 */
async function fetchHataIndex(source: StoreSource): Promise<unknown | null> {
  const repo = githubRepo(source.url);
  const url = repo ? `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/index/index.json` : source.url;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { "user-agent": "hata" } });
  if (res.status === 404 && repo) return null;
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_INDEX_BYTES) throw new Error(`${url}: too large`);
  const doc = JSON.parse(text) as unknown;
  if (!isPlainObject(doc) || doc.format !== 1 || !Array.isArray(doc.apps)) throw new Error(`${url}: not an index of a store`);
  return doc;
}

async function syncHata(source: StoreSource, doc: unknown): Promise<SyncResult> {
  const dir = storeDir(source.id);
  const before = stores.get(source.id) ?? load(source);
  const old = new Map([...before.apps].map(([name, app]) => [name, JSON.stringify(app.hata ?? null)]));
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(join(dir, HATA_INDEX), doc);
  // the files of a CasaOS copy that may lie here from before are not this store's any more
  for (const path of Object.keys(before.index.files)) rmSync(join(dir, path), { force: true });
  writeJsonAtomic(join(dir, "index.json"), { syncedAt: Date.now(), files: {}, kind: "hata" } satisfies StoreIndex);
  const fresh = load(source);
  bus.publish("store");
  const changed = [...fresh.apps].filter(([name, app]) => old.get(name) !== JSON.stringify(app.hata ?? null)).length;
  return { ok: true, apps: fresh.apps.size, changed };
}

async function doSync(source: StoreSource): Promise<SyncResult> {
  const repo = githubRepo(source.url);
  if (!repo && !indexUrl(source.url)) return { ok: false, apps: 0, changed: 0, error: "Only GitHub repositories and addresses of an index.json are supported" };
  const index = await fetchHataIndex(source);
  if (index) return syncHata(source, index);
  if (!repo) return { ok: false, apps: 0, changed: 0, error: "No index.json there" };
  const current = stores.get(source.id) ?? load(source);
  const dir = storeDir(source.id);

  const treeRes = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/HEAD?recursive=1`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "hata" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!treeRes.ok) {
    const limited = treeRes.status === 403 || treeRes.status === 429;
    return { ok: false, apps: current.apps.size, changed: 0, error: limited ? "GitHub rate limit reached, try again later" : `GitHub answered ${treeRes.status}` };
  }
  const tree = (await treeRes.json()) as { sha: string; tree: { path: string; type: string; sha: string }[] };

  const wanted = new Map<string, string>();
  for (const entry of tree.tree) {
    if (entry.type === "blob" && (COMPOSE_PATH_RE.test(entry.path) || EXTRA_FILES.includes(entry.path))) wanted.set(entry.path, entry.sha);
  }
  const todo = [...wanted].filter(([path, sha]) => current.index.files[path] !== sha || !existsSync(join(dir, path)));
  const files: Record<string, string> = {};
  for (const [path, sha] of wanted) if (!todo.some(([p]) => p === path)) files[path] = sha;

  let failed = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: DOWNLOADS_AT_ONCE }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const [path, sha] = job;
        try {
          // pinned to the commit of the tree, so the file is the one whose hash we record
          const text = await download(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${tree.sha}/${path}`);
          mkdirSync(dirname(join(dir, path)), { recursive: true });
          writeTextAtomic(join(dir, path), text);
          files[path] = sha;
        } catch {
          failed++;
          // keep the previous copy listed, if there is one
          if (current.index.files[path] && existsSync(join(dir, path))) files[path] = current.index.files[path]!;
        }
      }
    }),
  );
  for (const path of Object.keys(current.index.files)) {
    if (!wanted.has(path)) rmSync(join(dir, path), { force: true });
  }
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(join(dir, "index.json"), { syncedAt: Date.now(), files } satisfies StoreIndex);
  rmSync(join(dir, HATA_INDEX), { force: true });
  const fresh = load(source);
  bus.publish("store");
  return { ok: failed === 0, apps: fresh.apps.size, changed: todo.length - failed, error: failed ? `${failed} files could not be downloaded` : undefined };
}

/** Synchronises a store with its repository; parallel calls share one run */
export function syncStore(id: string): Promise<SyncResult> {
  const source = settings.stores.find((s) => s.id === id);
  if (!source || !validStoreId(id)) return Promise.resolve({ ok: false, apps: 0, changed: 0, error: "No such store" });
  let run = syncing.get(id);
  if (!run) {
    run = doSync(source)
      .catch((e): SyncResult => ({ ok: false, apps: stores.get(id)?.apps.size ?? 0, changed: 0, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => syncing.delete(id));
    syncing.set(id, run);
  }
  return run;
}

export async function syncAllStores(): Promise<void> {
  for (const s of settings.stores) await syncStore(s.id);
}

const SYNC_EVERY_MS = 12 * 3600 * 1000;

/** Syncs stores that were never synced or are stale, now and then twice a day */
export function scheduleStoreSync(): void {
  const tick = () => {
    for (const s of loaded()) {
      if (Date.now() - s.index.syncedAt > SYNC_EVERY_MS) void syncStore(s.source.id);
    }
  };
  tick();
  setInterval(tick, 3600 * 1000);
}

// --- Catalogue --------------------------------------------------------------------------------------

/** Docker's name for the architecture this server runs on */
export const ARCH = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : process.arch;

export interface CatalogueApp extends Pick<AppMeta, "title" | "tagline" | "icon" | "category" | "developer"> {
  store: string;
  /** The store's name, for telling apart the same app of two stores */
  storeName: string;
  name: string;
  /** false — the app has no image for this machine's architecture */
  supported: boolean;
  recommended: boolean;
}

export interface Catalogue {
  stores: { id: string; url: string; name: string; kind: "hata" | "casaos"; syncedAt: number; syncing: boolean; apps: number }[];
  categories: string[];
  apps: CatalogueApp[];
}

export function catalogue(lang: string): Catalogue {
  const all = loaded();
  const apps: CatalogueApp[] = [];
  const categories = new Set<string>();
  for (const s of all) {
    for (const c of s.categories) categories.add(localize(c, lang));
    const storeName = localize(s.name, lang) || s.source.id;
    for (const app of s.apps.values()) {
      const meta = appMeta(app.compose, lang);
      if (meta.category) categories.add(meta.category);
      apps.push({
        store: app.store,
        storeName,
        name: app.name,
        title: meta.title,
        tagline: meta.tagline,
        icon: meta.icon,
        category: meta.category,
        developer: meta.developer,
        supported: meta.architectures.length === 0 || meta.architectures.includes(ARCH),
        recommended: s.recommended.includes(app.name),
      });
    }
  }
  apps.sort((a, b) => a.title.localeCompare(b.title));
  return {
    stores: all.map((s) => ({ id: s.source.id, url: s.source.url, name: localize(s.name, lang) || s.source.id, kind: s.index.kind === "hata" ? ("hata" as const) : ("casaos" as const), syncedAt: s.index.syncedAt, syncing: syncing.has(s.source.id), apps: s.apps.size })),
    categories: [...categories],
    apps,
  };
}

export function storeApp(store: string, name: string): StoreApp | null {
  return loaded().find((s) => s.source.id === store)?.apps.get(name) ?? null;
}

/** The app of this name in whichever store has it — for apps that do not say where they came from */
export function findStoreApp(name: string): StoreApp | null {
  for (const s of loaded()) {
    const app = s.apps.get(name);
    if (app) return app;
  }
  return null;
}
