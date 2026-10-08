/**
 * App stores: CasaOS-compatible GitHub repositories (`Apps/<Name>/docker-compose.yml` with `x-casaos`).
 *
 * A store repository is hundreds of megabytes of screenshots, while all we need are the compose files:
 * icons and screenshots are referenced from them by URL. So a sync asks GitHub for the file tree (one
 * request) and downloads only the compose files whose blob hash changed since the last sync.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP_NAME_RE, appMeta, parseCompose, type AppMeta, type Compose } from "./appform";
import { bus } from "./bus";
import { DATA_DIR, settings, type StoreSource } from "./config";
import { isPlainObject, readJsonFile, writeJsonAtomic, writeTextAtomic } from "./fsutil";

const STORES_DIR = join(DATA_DIR, "stores");
const COMPOSE_PATH_RE = /^Apps\/([A-Za-z0-9][A-Za-z0-9._-]*)\/docker-compose\.ya?ml$/;
const EXTRA_FILES = ["category-list.json", "recommend-list.json"];
const DOWNLOADS_AT_ONCE = 12;
const MAX_COMPOSE_BYTES = 1024 * 1024;

interface StoreIndex {
  syncedAt: number;
  /** path in the repository → git blob hash of the copy on disk */
  files: Record<string, string>;
}

export interface StoreApp {
  store: string;
  /** Compose project name — the key of the app within its store */
  name: string;
  /** Path of the compose file inside the store */
  path: string;
  compose: Compose;
}

interface LoadedStore {
  source: StoreSource;
  index: StoreIndex;
  apps: Map<string, StoreApp>;
  categories: string[];
  recommended: string[];
}

const stores = new Map<string, LoadedStore>();
const syncing = new Map<string, Promise<SyncResult>>();

const storeDir = (id: string) => join(STORES_DIR, id);
const validStoreId = (id: string) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(id);

export function githubRepo(url: string): { owner: string; repo: string } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

function readList(file: string, pick: (item: unknown) => string | undefined): string[] {
  const list = readJsonFile<unknown[]>(file, [], Array.isArray);
  return list.map(pick).filter((v): v is string => typeof v === "string" && v !== "");
}

function load(source: StoreSource): LoadedStore {
  const dir = storeDir(source.id);
  const index = readJsonFile<StoreIndex>(join(dir, "index.json"), { syncedAt: 0, files: {} }, (v) => isPlainObject(v) && isPlainObject(v.files));
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

async function doSync(source: StoreSource): Promise<SyncResult> {
  const repo = githubRepo(source.url);
  if (!repo) return { ok: false, apps: 0, changed: 0, error: "Only GitHub repository URLs are supported for now" };
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
  name: string;
  /** false — the app has no image for this machine's architecture */
  supported: boolean;
  recommended: boolean;
}

export interface Catalogue {
  stores: { id: string; url: string; syncedAt: number; syncing: boolean; apps: number }[];
  categories: string[];
  apps: CatalogueApp[];
}

export function catalogue(lang: string): Catalogue {
  const all = loaded();
  const apps: CatalogueApp[] = [];
  const categories = new Set<string>();
  for (const s of all) {
    for (const c of s.categories) categories.add(c);
    for (const app of s.apps.values()) {
      const meta = appMeta(app.compose, lang);
      if (meta.category) categories.add(meta.category);
      apps.push({
        store: app.store,
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
    stores: all.map((s) => ({ id: s.source.id, url: s.source.url, syncedAt: s.index.syncedAt, syncing: syncing.has(s.source.id), apps: s.apps.size })),
    categories: [...categories],
    apps,
  };
}

export function storeApp(store: string, name: string): StoreApp | null {
  return loaded().find((s) => s.source.id === store)?.apps.get(name) ?? null;
}
