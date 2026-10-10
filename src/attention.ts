/**
 * "Needs attention": the short list of things on the home page that are wrong or about to be.
 * A pure function of the server's state, so every rule is covered by tests.
 */
import type { Activity } from "./activity";
import type { InstalledApp } from "./apps";
import type { DockerInfo } from "./docker";
import type { SystemStatus } from "./system";

export interface AttentionItem {
  /** Stable key of the item, for the UI's list */
  id: string;
  severity: "danger" | "warn";
  /** The UI shows `attention.<code>.title` and `.text` */
  code: string;
  detail: Record<string, string | number>;
  /** App the item is about — the UI links to its page */
  app?: string;
  /** When it happened, for an item about an event (a failed backup) rather than a state (a full disk) */
  at?: number;
}

const DISK_WARN = 85;
const DISK_DANGER = 95;
const MEMORY_WARN = 92;
const TEMPERATURE_WARN = 85;
const FAILURE_WINDOW_MS = 24 * 3600 * 1000;

export function attention(input: { system: SystemStatus; docker: DockerInfo; apps: InstalledApp[]; activity: Activity[]; update?: string | null; offsite?: { error: string } | null; now?: number }): AttentionItem[] {
  const { system, docker, apps, activity } = input;
  const now = input.now ?? Date.now();
  const items: AttentionItem[] = [];

  if (!docker.available) items.push({ id: "docker", severity: "danger", code: "docker", detail: { message: docker.error ?? "" } });

  for (const app of apps) {
    const restarting = app.containers.filter((c) => c.state === "restarting");
    if (restarting.length) {
      items.push({ id: `restarting:${app.name}`, severity: "danger", code: "restarting", detail: { title: app.title, container: restarting[0]!.name }, app: app.name });
    } else if (app.status === "partial") {
      const down = app.containers.filter((c) => c.state !== "running");
      items.push({ id: `partial:${app.name}`, severity: "warn", code: "partial", detail: { title: app.title, container: down[0]?.name ?? "" }, app: app.name });
    }
  }

  // The latest outcome decides: a failure followed by a success is history, not a problem. Running the
  // app and backing it up are judged apart — a good start says nothing about a failed backup.
  const latest = new Map<string, Activity>();
  for (const entry of activity) {
    const m = /^app\.(install|update|apply|start|backup|restore)\.(done|failed)$/.exec(entry.code);
    if (!entry.app || !m) continue;
    const key = `${m[1] === "backup" ? "backup" : "run"}:${entry.app}`;
    if (!latest.has(key)) latest.set(key, entry);
  }
  for (const [key, entry] of latest) {
    if (!entry.code.endsWith(".failed") || now - entry.ts > FAILURE_WINDOW_MS) continue;
    const name = entry.app!;
    const app = apps.find((a) => a.name === name);
    const kind = entry.code.split(".")[1]!;
    // a failed install leaves no app behind, so there is nothing to link to
    if (!app && kind !== "install") continue;
    items.push({ id: `failed:${key}`, severity: "warn", code: `failed.${kind}`, detail: { title: app?.title ?? name, message: entry.detail ?? "" }, app: app?.name, at: entry.ts });
  }

  for (const disk of system.disks) {
    const percent = Math.round((disk.used / disk.total) * 100);
    if (percent >= DISK_WARN) {
      items.push({ id: `disk:${disk.path}`, severity: percent >= DISK_DANGER ? "danger" : "warn", code: "disk", detail: { path: disk.path, percent, free: disk.total - disk.used } });
    }
  }

  const memory = system.memory.total ? Math.round((system.memory.used / system.memory.total) * 100) : 0;
  if (memory >= MEMORY_WARN) items.push({ id: "memory", severity: "warn", code: "memory", detail: { percent: memory } });
  if (system.temperature !== null && system.temperature >= TEMPERATURE_WARN) {
    items.push({ id: "temperature", severity: "warn", code: "temperature", detail: { degrees: system.temperature } });
  }

  // the second copy of the backups is behind: it stays on the list until a run gets through
  if (input.offsite) items.push({ id: "offsite", severity: "warn", code: "offsite", detail: { message: input.offsite.error } });

  if (input.update) items.push({ id: "update", severity: "warn", code: "update", detail: { version: input.update } });

  return items.sort((a, b) => Number(b.severity === "danger") - Number(a.severity === "danger"));
}
