/**
 * Modules: the parts of Hata a person turns on. A new server has the base only — apps, files, backups,
 * users, disks, the network, HTTPS; a module that is on adds its pages, its sections of Settings, its
 * background work and its tools. Nothing here has side effects: what a module runs and what holds it
 * is `moduleruns.ts`.
 */

export const MODULE_IDS = ["raid", "netplaces", "shares", "offsite", "remote", "dns", "adblock", "domains", "machines", "proxmox", "containers", "integrations", "assistant", "tv"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export type ModuleGroup = "storage" | "network" | "servers" | "more";

export interface ModuleSpec {
  id: ModuleId;
  group: ModuleGroup;
  /** Modules this one cannot work without */
  needs: ModuleId[];
  /** The requests that are this module's: answered "off" while it is */
  paths: RegExp[];
  /** The tools of agents and of the assistant that are this module's */
  tools?: RegExp;
  /** The sections of Settings it adds */
  sections: string[];
  /** The pages (views) it adds */
  views: string[];
}

export const MODULES: ModuleSpec[] = [
  { id: "raid", group: "storage", needs: [], paths: [/^\/api\/disks\/(array|raid)(\/|$)/, /^\/api\/disks\/(merge|plan)$/], tools: /^disk_arrays$/, sections: ["protection"], views: [] },
  { id: "netplaces", group: "storage", needs: [], paths: [/^\/api\/netplaces(\/|$)/], tools: /^network_places$/, sections: ["places"], views: [] },
  { id: "shares", group: "storage", needs: [], paths: [/^\/api\/shares(\/|$)/], tools: /^shares$/, sections: ["shares"], views: [] },
  { id: "offsite", group: "storage", needs: [], paths: [/^\/api\/backups\/offsite(\/|$)/], sections: [], views: [] },
  { id: "remote", group: "network", needs: [], paths: [/^\/api\/(tailscale|wireguard)(\/|$)/], tools: /^remote_access$/, sections: ["remote"], views: [] },
  { id: "dns", group: "network", needs: [], paths: [/^\/api\/dns(\/(?!block(\/|$))|$)/], tools: /^(dns_server|dns_record_add|dns_record_remove)$/, sections: ["dns"], views: [] },
  { id: "adblock", group: "network", needs: ["dns"], paths: [/^\/api\/dns\/block(\/|$)/], tools: /^(ad_blocking|dns_queries$)/, sections: ["adblock"], views: [] },
  { id: "domains", group: "network", needs: [], paths: [/^\/api\/(domains|ports)(\/|$)/], tools: /^(domain_names?$|domain_name_|ports$|port_)/, sections: ["ports"], views: [] },
  { id: "machines", group: "servers", needs: [], paths: [/^\/api\/(machines|moveapp)(\/|$)/, /^\/client\//], tools: /^(machines$|machine_|app_move$)/, sections: [], views: ["machines"] },
  { id: "proxmox", group: "servers", needs: [], paths: [/^\/api\/proxmox(\/|$)/], tools: /^proxmox/, sections: [], views: ["machines", "proxmox", "guest"] },
  { id: "containers", group: "servers", needs: [], paths: [/^\/api\/containers(\/|$)/], tools: /^(containers?$|container_|disc_images$)/, sections: [], views: ["machines", "containers"] },
  { id: "integrations", group: "more", needs: [], paths: [/^\/api\/(ha|qbit|frigate)(\/|$)/], tools: /^(cameras$|camera_|torrents$|torrent_|home_assistant)/, sections: ["integrations"], views: ["integrations", "ha", "qbit", "frigate"] },
  { id: "tv", group: "more", needs: [], paths: [/^\/api\/tv(\/|$)/], sections: [], views: ["tv"] },
  { id: "assistant", group: "more", needs: [], paths: [/^\/api\/(assistant|agents|approvals|oauth)(\/|$)/, /^\/mcp$/, /^\/oauth\//, /^\/\.well-known\/oauth-/], sections: ["agents", "assistant"], views: ["assistant", "connect"] },
];

const BY_ID = new Map(MODULES.map((spec) => [spec.id, spec]));

export const isModule = (id: unknown): id is ModuleId => typeof id === "string" && BY_ID.has(id as ModuleId);

export const moduleSpec = (id: ModuleId): ModuleSpec => BY_ID.get(id)!;

/** Whose request this is; null — the base's */
export function moduleOfPath(path: string): ModuleId | null {
  for (const spec of MODULES) if (spec.paths.some((re) => re.test(path))) return spec.id;
  return null;
}

/** Whose tool this is; null — the base's */
export function moduleOfTool(name: string): ModuleId | null {
  for (const spec of MODULES) if (spec.tools?.test(name)) return spec.id;
  return null;
}

export type ModuleSwitches = Record<ModuleId, boolean>;

/** What a settings file says, made whole: a module it does not name is off, a name it made up is dropped */
export function cleanModules(raw: unknown): ModuleSwitches {
  const given = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(MODULE_IDS.map((id) => [id, given[id] === true])) as ModuleSwitches;
}

/** Everything a module stands on, the nearest first */
export function needsOf(id: ModuleId): ModuleId[] {
  const out: ModuleId[] = [];
  const walk = (one: ModuleId) => {
    for (const need of moduleSpec(one).needs) {
      if (out.includes(need) || need === id) continue;
      out.push(need);
      walk(need);
    }
  };
  walk(id);
  return out;
}

/** What it needs that is off: those go on with it */
export const missingFor = (id: ModuleId, on: ModuleSwitches): ModuleId[] => needsOf(id).filter((need) => !on[need]);

/** The modules that are on and cannot work without this one: it stays on while they are */
export const neededBy = (id: ModuleId, on: ModuleSwitches): ModuleId[] => MODULE_IDS.filter((other) => other !== id && on[other] && needsOf(other).includes(id));

/**
 * What an older install has on after the update that brought modules: what it uses, and what those
 * stand on. Nothing a person works with goes away by itself.
 */
export function switchesFor(used: ModuleId[]): ModuleSwitches {
  const on = cleanModules({});
  for (const id of used) {
    on[id] = true;
    for (const need of needsOf(id)) on[need] = true;
  }
  return on;
}
