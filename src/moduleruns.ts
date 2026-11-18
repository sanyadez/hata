/**
 * What the modules run and what holds each of them on (`modules.ts` is the list). A module that is off
 * answers no request, starts no work and offers no tool; turning one on starts its work at once. One
 * that is in use cannot be turned off, and neither can one another module stands on.
 */
import { record } from "./activity";
import { listKeys } from "./agents";
import { AppError } from "./apps";
import { assistantConfig, configured as assistantReady } from "./assistant";
import { needsSetup } from "./auth";
import { pairedKept, startBluetooth } from "./bluetooth";
import { bus } from "./bus";
import { saveSettings, settings } from "./config";
import { inUse as containersInUse, startContainers } from "./containers";
import { startBlocker } from "./dnsblocker";
import { startDns } from "./dnsserver";
import { startForwards } from "./forwards";
import { servers as homeAssistants, startHomeAssistant } from "./homeassistant";
import { startMachineGates } from "./machinegate";
import { machines, startMachines } from "./machines";
import { startMachineUsers } from "./machineusers";
import { cleanModules, isModule, missingFor, MODULE_IDS, MODULES, neededBy, switchesFor, type ModuleGroup, type ModuleId } from "./modules";
import { mergedFolders } from "./mounting";
import { speakerOn, startMusic, stopMusic } from "./music";
import { placesKept, startNetPlaces } from "./netplaces";
import { offsiteOn } from "./offsite";
import { hosts as proxmoxHosts, startProxmox } from "./proxmox";
import { connections, startIntegrations } from "./integrations";
import { lookAtPools, poolsReport, startPools } from "./raid";
import { startShares } from "./shares";
import { startSnapraid } from "./snapraid";
import { tvEnabled, tvSetUp, watchTv } from "./television";
import { installed as tailscaleInstalled, report as tailscaleReport } from "./tailscale";
import { inUse as wireguardInUse } from "./wireguard";

/** One thing that uses a module: the page words it as `modules.use.<what>` */
export interface Use {
  what: string;
  count?: number;
}

interface Run {
  /** Its background work; called once, when the server starts with the module on or when it is turned on */
  start?: () => void;
  /** What it runs is ended: called when it is turned off */
  stop?: () => void;
  /** What of the person's stands on it right now: the module stays on while there is any */
  uses: () => Use[] | Promise<Use[]>;
  /** Signs that it was worked with on a server from before modules, beyond `uses`: it comes on there */
  was?: () => boolean;
}

const some = (what: string, count: number): Use[] => (count > 0 ? [{ what, count }] : []);
const when = (what: string, yes: boolean): Use[] => (yes ? [{ what }] : []);

const RUNS: Record<ModuleId, Run> = {
  raid: {
    start: () => {
      startPools();
      startSnapraid();
    },
    uses: async () => {
      // the arrays the system has are found by a look; before the module's first one there is nothing to go by
      if (poolsReport().pools.length === 0) await lookAtPools().catch(() => {});
      return [...when("array", settings.snapraid.parity !== ""), ...some("merged", mergedFolders()), ...some("pools", poolsReport().pools.length)];
    },
  },
  netplaces: { start: startNetPlaces, uses: () => some("places", placesKept()) },
  shares: { start: startShares, uses: () => some("shares", settings.shares.length) },
  offsite: { uses: () => when("offsite", offsiteOn()) },
  remote: {
    uses: async () => [...when("wireguard", wireguardInUse()), ...when("tailscale", tailscaleInstalled() && (await tailscaleReport(0).catch(() => null))?.state === "running")],
    was: tailscaleInstalled,
  },
  dns: { start: startDns, uses: () => when("dnsOn", settings.dns.enabled), was: () => settings.dns.records.length > 0 },
  adblock: { start: startBlocker, uses: () => when("blocking", settings.dnsBlock.enabled), was: () => settings.dnsBlock.lists.length > 0 || settings.dnsBlock.rules.length > 0 },
  domains: {
    start: () => void startForwards().catch((e) => console.error("Ports:", e)),
    uses: () => [...some("names", settings.names.length), ...some("ports", settings.forwards.length)],
  },
  machines: {
    start: () => {
      startMachines();
      startMachineUsers();
      startMachineGates();
    },
    uses: () => some("machines", machines().length),
  },
  proxmox: { start: startProxmox, uses: () => some("proxmox", proxmoxHosts().length) },
  containers: { start: startContainers, uses: async () => when("containers", await containersInUse().catch(() => false)), was: () => !!Bun.which("incus") },
  integrations: {
    start: () => {
      startHomeAssistant();
      startIntegrations();
    },
    uses: () => [...some("homeAssistant", homeAssistants().length), ...some("services", connections().length)],
  },
  tv: { start: watchTv, uses: () => when("tv", tvEnabled()), was: tvSetUp },
  bluetooth: { start: startBluetooth, uses: () => some("bluetooth", pairedKept()) },
  music: { start: startMusic, stop: stopMusic, uses: () => when("speaker", speakerOn()) },
  assistant: { uses: () => some("keys", listKeys().length), was: () => assistantReady(assistantConfig()) },
};

/** Whether a module is on. Until the first start has decided (`settleModules`) every one counts as on */
export const moduleOn = (id: ModuleId): boolean => settings.modules === null || settings.modules[id];

/** What the page is told: which modules there are to show things for */
export const modulesOn = (): Record<ModuleId, boolean> => Object.fromEntries(MODULE_IDS.map((id) => [id, moduleOn(id)])) as Record<ModuleId, boolean>;

const started = new Set<ModuleId>();

function start(id: ModuleId): void {
  if (started.has(id)) return;
  started.add(id);
  try {
    RUNS[id].start?.();
  } catch (e) {
    console.error(`Module ${id} did not start:`, e instanceof Error ? e.message : e);
  }
}

/**
 * The first start with modules. A new server has the base alone; one that was here before keeps
 * everything it uses — nothing a person works with goes away with an update.
 */
export async function settleModules(): Promise<void> {
  if (settings.modules !== null) return;
  if (needsSetup()) {
    settings.modules = cleanModules({});
  } else {
    const used: ModuleId[] = [];
    for (const id of MODULE_IDS) {
      const run = RUNS[id];
      // what cannot be asked, or takes too long to answer, counts as used: nothing goes away by mistake
      const sure = [{ what: "unknown" }];
      const asked = (async () => (run.was?.() ? sure : await run.uses()))().catch(() => sure);
      const late = new Promise<Use[]>((resolve) => setTimeout(() => resolve(sure), 10_000));
      if ((await Promise.race([asked, late])).length > 0) used.push(id);
    }
    settings.modules = switchesFor(used);
    console.log(used.length ? `Modules in use, left on: ${used.join(", ")}` : "No module is in use: all are off");
  }
  saveSettings();
}

/** The work of every module that is on, once the base is up */
export function startModules(): void {
  for (const id of MODULE_IDS) if (moduleOn(id)) start(id);
}

export interface ModuleReport {
  id: ModuleId;
  group: ModuleGroup;
  on: boolean;
  needs: ModuleId[];
  /** What uses it: not empty — it cannot be turned off now */
  uses: Use[];
  /** Modules that are on and stand on it */
  neededBy: ModuleId[];
  sections: string[];
  views: string[];
}

export async function modulesReport(): Promise<ModuleReport[]> {
  const on = modulesOn();
  return Promise.all(
    MODULES.map(async (spec) => ({
      id: spec.id,
      group: spec.group,
      on: on[spec.id],
      needs: spec.needs,
      uses: on[spec.id] ? await Promise.resolve(RUNS[spec.id].uses()).catch(() => []) : [],
      neededBy: neededBy(spec.id, on),
      sections: spec.sections,
      views: spec.views,
    })),
  );
}

/**
 * Turns a module on or off. On: what it stands on goes on with it — only when the person agreed
 * (`withNeeds`), otherwise the answer names them. Off: refused while something uses it or another
 * module stands on it; its settings stay as they are.
 */
export async function setModule(id: unknown, on: boolean, by: string, withNeeds = false): Promise<ModuleReport[]> {
  if (!isModule(id)) throw new AppError("modules.unknown", 404);
  if (settings.modules === null) await settleModules();
  const switches = settings.modules!;
  if (switches[id] === on) return modulesReport();
  if (on) {
    const missing = missingFor(id, switches);
    if (missing.length && !withNeeds) throw new AppError("modules.needs", 409, { module: id, needs: missing.join(",") });
    // what it stands on first, so its own work finds it there
    for (const one of [...missing.reverse(), id]) {
      switches[one] = true;
      start(one);
      record("modules.on", { user: by, detail: one });
    }
  } else {
    const dependants = neededBy(id, switches);
    if (dependants.length) throw new AppError("modules.needed", 409, { module: id, by: dependants.join(",") });
    const uses = await RUNS[id].uses();
    if (uses.length) throw new AppError("modules.inUse", 409, { module: id, uses: uses.map((use) => (use.count ? `${use.what}:${use.count}` : use.what)).join(",") });
    switches[id] = false;
    // its work is started anew when it is turned on again
    started.delete(id);
    RUNS[id].stop?.();
    record("modules.off", { user: by, detail: id });
  }
  saveSettings();
  bus.publish("modules");
  return modulesReport();
}
