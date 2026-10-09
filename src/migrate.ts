/**
 * `hata migrate casaos`: takes over the apps of a CasaOS install on the same machine.
 *
 * CasaOS keeps every app as a compose project in `<AppsPath>/<name>/docker-compose.yml`, and Docker knows
 * the project by its name. So moving in is copying that file into Hata's apps directory under the same
 * name: the running containers are not touched, their data stays where it is, and from then on Hata's
 * `docker compose -p <name>` manages the very same containers. Nothing of CasaOS is deleted — its services
 * are only stopped and disabled — which is what makes `--undo` possible.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME_RE, appMeta, parseCompose } from "./appform";
import { readJsonFile, writeJsonAtomic, writeTextAtomic } from "./fsutil";

const CASAOS_CONF = "/etc/casaos/app-management.conf";
const CASAOS_ENV = "/etc/casaos/env";
const DEFAULT_APPS_PATH = "/var/lib/casaos/apps";

/** Reads `key = value` out of one of CasaOS's ini files */
export function iniValue(text: string, key: string): string | null {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, "mi").exec(text);
  return m?.[1] || null;
}

/** `KEY=value` lines of an env file; comments and anything else are skipped */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export type PlanStatus = "ready" | "exists" | "badName" | "badCompose";

export interface PlannedApp {
  name: string;
  title: string;
  /** The compose file in CasaOS */
  source: string;
  status: PlanStatus;
  /** Why the app cannot be moved, for `badCompose` */
  reason?: string;
}

/** What a migration would do with each app found in CasaOS's apps directory */
export function planCasaos(casaosApps: string, hataApps: string): PlannedApp[] {
  if (!existsSync(casaosApps)) return [];
  const plan: PlannedApp[] = [];
  for (const entry of readdirSync(casaosApps, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = ["docker-compose.yml", "docker-compose.yaml"].map((f) => join(casaosApps, entry.name, f)).find(existsSync);
    if (!source) continue;
    const app: PlannedApp = { name: entry.name, title: entry.name, source, status: "ready" };
    if (!APP_NAME_RE.test(entry.name)) app.status = "badName";
    else {
      try {
        app.title = appMeta(parseCompose(readFileSync(source, "utf8")), "en").title || entry.name;
        if (existsSync(join(hataApps, entry.name))) app.status = "exists";
      } catch (e) {
        app.status = "badCompose";
        app.reason = e instanceof Error ? e.message : String(e);
      }
    }
    plan.push(app);
  }
  return plan.sort((a, b) => a.name.localeCompare(b.name));
}

/** What a migration did — enough to take it back */
export interface MigrationRecord {
  at: number;
  casaosApps: string;
  /** Names of the apps copied into Hata */
  apps: string[];
  /** CasaOS units that were running or enabled and that we stopped and disabled */
  units: string[];
}

/**
 * Copies the ready apps of a plan into Hata's apps directory: the compose file as it is, and a `.env`
 * written by `writeEnv` (given by the caller, so this module needs no settings). Returns the names moved.
 */
export function copyApps(plan: PlannedApp[], hataApps: string, writeEnv: (name: string) => void): string[] {
  const moved: string[] = [];
  for (const app of plan) {
    if (app.status !== "ready") continue;
    const dir = join(hataApps, app.name);
    mkdirSync(dir, { recursive: true });
    writeTextAtomic(join(dir, "compose.yml"), readFileSync(app.source, "utf8"));
    writeEnv(app.name);
    moved.push(app.name);
  }
  return moved;
}

// --- The command ------------------------------------------------------------------------------------

const STATUS_TEXT: Record<PlanStatus, string> = {
  ready: "will be moved",
  exists: "skipped: Hata already has an app with this name",
  badName: "skipped: the name cannot be used as a compose project name",
  badCompose: "skipped: its compose file cannot be read",
};

function sh(...cmd: string[]): { ok: boolean; out: string } {
  try {
    const r = Bun.spawnSync({ cmd, stdout: "pipe", stderr: "pipe" });
    return { ok: r.exitCode === 0, out: r.stdout.toString().trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

/** CasaOS's systemd services that are running or set to start at boot */
function casaosUnits(): string[] {
  const listed = sh("systemctl", "list-unit-files", "casaos*.service", "--no-legend", "--plain").out;
  return listed
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((unit) => /^casaos[a-z-]*\.service$/.test(unit))
    .filter((unit) => sh("systemctl", "is-active", "--quiet", unit).ok || sh("systemctl", "is-enabled", "--quiet", unit).ok);
}

function confirm(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  const answer = prompt(`${question} [y/N]`);
  return /^y(es)?$/i.test(answer?.trim() ?? "");
}

export async function migrateCasaos(args: string[]): Promise<number> {
  const flags = new Set(args);
  const unknown = args.filter((a) => !["--dry-run", "--yes", "--keep-casaos", "--undo"].includes(a));
  if (unknown.length) {
    console.error(`Unknown option: ${unknown[0]}\nUsage: hata migrate casaos [--dry-run] [--yes] [--keep-casaos] [--undo]`);
    return 2;
  }
  const { DATA_DIR } = await import("./config");
  const { APPS_DIR, writeEnv } = await import("./apps");
  const recordFile = join(DATA_DIR, "migrations", "casaos.json");

  if (flags.has("--undo")) return undo(recordFile, APPS_DIR, flags.has("--yes"));

  const conf = existsSync(CASAOS_CONF) ? readFileSync(CASAOS_CONF, "utf8") : "";
  const casaosApps = iniValue(conf, "AppsPath") ?? DEFAULT_APPS_PATH;
  if (!existsSync(casaosApps) && !conf) {
    console.error(`CasaOS was not found on this machine (no ${CASAOS_CONF}, no ${DEFAULT_APPS_PATH}).`);
    return 1;
  }

  const plan = planCasaos(casaosApps, APPS_DIR);
  const ready = plan.filter((a) => a.status === "ready");
  const units = flags.has("--keep-casaos") ? [] : casaosUnits();

  console.log(`CasaOS apps in ${casaosApps}:`);
  if (!plan.length) console.log("  (none)");
  for (const app of plan) console.log(`  ${app.name.padEnd(28)} ${STATUS_TEXT[app.status]}${app.reason ? ` (${app.reason})` : ""}`);
  console.log("");
  console.log("What will happen:");
  console.log(`  1. The compose file of ${ready.length} app(s) is copied to ${APPS_DIR}/<name>/compose.yml.`);
  console.log("     Containers keep running and are not recreated; app data stays where it is.");
  console.log(units.length ? `  2. CasaOS is stopped and disabled: ${units.join(", ")}.` : "  2. CasaOS services are left as they are.");
  console.log("     Nothing of CasaOS is deleted. `hata migrate casaos --undo` takes this back.");
  console.log("");

  if (flags.has("--dry-run")) return 0;
  if (!ready.length && !units.length) {
    console.log("Nothing to do.");
    return 0;
  }
  if (!flags.has("--yes") && !confirm("Continue?")) {
    console.log("Nothing was changed. Run again with --yes to proceed without asking.");
    return 1;
  }

  // variables CasaOS gave to every app (its /etc/casaos/env) go into each app's own .env
  const shared = existsSync(CASAOS_ENV) ? parseEnvFile(readFileSync(CASAOS_ENV, "utf8")) : {};
  const moved = copyApps(plan, APPS_DIR, (name) => writeEnv(name, shared));
  for (const name of moved) console.log(`Moved ${name}`);

  const stopped: string[] = [];
  for (const unit of units) {
    if (sh("systemctl", "disable", "--now", unit).ok) stopped.push(unit);
    else console.error(`Could not stop ${unit}; stop it yourself with: systemctl disable --now ${unit}`);
  }
  if (stopped.length) console.log(`Stopped CasaOS (${stopped.length} services).`);

  const previous = readJsonFile<MigrationRecord | null>(recordFile, null);
  mkdirSync(join(DATA_DIR, "migrations"), { recursive: true });
  writeJsonAtomic(recordFile, {
    at: Date.now(),
    casaosApps,
    apps: [...new Set([...(previous?.apps ?? []), ...moved])],
    units: [...new Set([...(previous?.units ?? []), ...stopped])],
  } satisfies MigrationRecord);

  console.log(`\nDone: ${moved.length} app(s) are now managed by Hata.`);
  if (sh("systemctl", "is-active", "--quiet", "hata.service").ok) {
    const { listenAddress } = await import("./config");
    if (stopped.length && listenAddress().port !== 80) console.log("Port 80 is free now. To put Hata on it: sudo hata install --port 80");
  } else if (!process.env.HATA_INSTALLER) console.log("Hata is not running as a service yet: sudo hata install");
  return 0;
}

function undo(recordFile: string, hataApps: string, yes: boolean): number {
  const record = readJsonFile<MigrationRecord | null>(recordFile, null);
  if (!record) {
    console.error("There is no migration from CasaOS to undo.");
    return 1;
  }
  console.log("What will happen:");
  console.log(`  1. ${record.apps.length} app(s) are removed from Hata's list: ${record.apps.join(", ") || "none"}.`);
  console.log("     Their containers and data are not touched; changes made to them in Hata since the move stay in the containers.");
  console.log(`  2. CasaOS is enabled and started again: ${record.units.join(", ") || "nothing to start"}.`);
  console.log("");
  // CasaOS's gateway wants the port it had; with Hata on it, CasaOS would come back without its web UI
  const gatewayPort = Number(iniValue(existsSync("/etc/casaos/gateway.ini") ? readFileSync("/etc/casaos/gateway.ini", "utf8") : "", "port") ?? 80);
  const holder = sh("systemctl", "is-active", "--quiet", "hata.service").ok ? sh("systemctl", "show", "hata.service", "-p", "MainPID", "--value").out : "";
  const listening = holder ? sh("ss", "-Hltnp", `sport = :${gatewayPort}`).out.includes(`pid=${holder},`) : false;
  if (record.units.length && listening) {
    console.error(`Hata is listening on port ${gatewayPort}, which CasaOS needs. Move Hata first: sudo hata install --port 8080`);
    return 1;
  }
  if (!yes && !confirm("Continue?")) {
    console.log("Nothing was changed.");
    return 1;
  }
  for (const name of record.apps) {
    if (APP_NAME_RE.test(name)) rmSync(join(hataApps, name), { recursive: true, force: true });
  }
  if (record.units.length) {
    // one call: the services depend on each other, and systemd works out the order
    sh("systemctl", "enable", "--now", ...record.units);
    for (const unit of record.units) {
      if (!sh("systemctl", "is-active", "--quiet", unit).ok) console.error(`Could not start ${unit}; see: journalctl -u ${unit}`);
    }
  }
  rmSync(recordFile, { force: true });
  console.log("Done: the apps are back with CasaOS.");
  return 0;
}
