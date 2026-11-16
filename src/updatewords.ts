/**
 * What a store's newer version changes in an app, in terms a person reads: which version becomes
 * which, what part is added, which setting is new. Made from the compose file as it is and as it
 * will be; pure. The page words each item (`update.word.<code>`); the raw table stays for whoever
 * wants the lines of the file.
 */
type Compose = Record<string, any>;

export interface UpdateWord {
  code: "version" | "image" | "added" | "addedFirst" | "removed" | "envAdded" | "envChanged" | "envRemoved" | "ports" | "volumes" | "other" | "files";
  /** The service of the compose file it is about; "" — the file as a whole */
  service: string;
  /** version, image: the program's short name; env*: the variable; other: the keys, comma separated; added*: the image */
  name: string;
  from: string;
  to: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** An image's name in two: what it is and which version (`ghcr.io/a/b:1.2` → `ghcr.io/a/b`, `1.2`) */
export function imageParts(image: unknown): { name: string; short: string; tag: string } {
  let name = typeof image === "string" ? image.trim() : "";
  let tag = "";
  const at = name.indexOf("@");
  if (at >= 0) {
    tag = name.slice(at + 1, at + 20);
    name = name.slice(0, at);
  }
  const colon = name.lastIndexOf(":");
  if (colon > name.lastIndexOf("/")) {
    if (at < 0) tag = name.slice(colon + 1);
    name = name.slice(0, colon);
  }
  return { name, short: name.slice(name.lastIndexOf("/") + 1), tag: tag || "latest" };
}

/** The variables of a service, whichever way they are written (a list of `A=b` or a mapping) */
function envOf(service: Compose): Record<string, string> {
  const env = service?.environment;
  const out: Record<string, string> = {};
  if (Array.isArray(env)) {
    for (const line of env) {
      const text = String(line);
      const eq = text.indexOf("=");
      out[eq < 0 ? text : text.slice(0, eq)] = eq < 0 ? "" : text.slice(eq + 1);
    }
  } else if (isObject(env)) for (const [key, value] of Object.entries(env)) out[key] = value === null || value === undefined ? "" : String(value);
  return out;
}

/** Whether another service waits for this one to finish: a step run before the app at every start */
function runsFirst(compose: Compose, name: string): boolean {
  return Object.values(isObject(compose.services) ? compose.services : {}).some((service) => {
    const needs = (service as Compose)?.depends_on;
    return isObject(needs) && isObject(needs[name]) && (needs[name] as Compose).condition === "service_completed_successfully";
  });
}

/** What differs between the app's compose file now and after the update, most telling first */
export function updateWords(before: Compose, after: Compose, filesChanged = false): UpdateWord[] {
  const was: Compose = isObject(before?.services) ? before.services : {};
  const now: Compose = isObject(after?.services) ? after.services : {};
  const versions: UpdateWord[] = [];
  const rest: UpdateWord[] = [];
  const coming = new Set(Object.keys(now).filter((name) => !(name in was)));
  const going = new Set(Object.keys(was).filter((name) => !(name in now)));
  for (const name of Object.keys(now)) {
    const [a, b] = [was[name] as Compose, now[name] as Compose];
    if (!a) {
      rest.push({ code: runsFirst(after, name) ? "addedFirst" : "added", service: name, name: typeof b?.image === "string" ? b.image : "", from: "", to: "" });
      continue;
    }
    if (a.image !== b.image) {
      const [x, y] = [imageParts(a.image), imageParts(b.image)];
      if (x.name === y.name) versions.push({ code: "version", service: name, name: y.short, from: x.tag, to: y.tag });
      else versions.push({ code: "image", service: name, name: y.short, from: String(a.image ?? ""), to: String(b.image ?? "") });
    }
    const [ea, eb] = [envOf(a), envOf(b)];
    for (const key of Object.keys(eb)) {
      if (!(key in ea)) rest.push({ code: "envAdded", service: name, name: key, from: "", to: "" });
      else if (ea[key] !== eb[key]) rest.push({ code: "envChanged", service: name, name: key, from: "", to: "" });
    }
    for (const key of Object.keys(ea)) if (!(key in eb)) rest.push({ code: "envRemoved", service: name, name: key, from: "", to: "" });
    if (!same(a.ports, b.ports)) rest.push({ code: "ports", service: name, name: "", from: "", to: "" });
    if (!same(a.volumes, b.volumes)) rest.push({ code: "volumes", service: name, name: "", from: "", to: "" });
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => {
      if (["image", "environment", "ports", "volumes"].includes(key) || same(a[key], b[key])) return false;
      // waiting for a part that comes or goes is said by that part's own line
      if (key === "depends_on") {
        const names = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : isObject(v) ? Object.keys(v) : []);
        const [na, nb] = [names(a[key]), names(b[key])];
        const differ = [...na.filter((n) => !nb.includes(n)), ...nb.filter((n) => !na.includes(n))];
        if (differ.length && differ.every((n) => coming.has(n) || going.has(n))) return false;
      }
      return true;
    });
    if (keys.length) rest.push({ code: "other", service: name, name: keys.join(", "), from: "", to: "" });
  }
  for (const name of going) rest.push({ code: "removed", service: name, name: "", from: "", to: "" });
  const top = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((key) => key !== "services" && !key.startsWith("x-") && !same(before?.[key], after?.[key]));
  if (top.length) rest.push({ code: "other", service: "", name: top.join(", "), from: "", to: "" });
  if (filesChanged) rest.push({ code: "files", service: "", name: "", from: "", to: "" });
  return [...versions, ...rest];
}

/** The version the app's main program stays at, for an update that changes none: "" when it cannot be said */
export function stayingVersion(after: Compose, words: UpdateWord[]): string {
  if (words.some((word) => word.code === "version" || word.code === "image")) return "";
  const services: Compose = isObject(after?.services) ? after.services : {};
  const added = new Set(words.filter((word) => word.code === "added" || word.code === "addedFirst").map((word) => word.service));
  const main = Object.keys(services).find((name) => !added.has(name));
  const tag = main ? imageParts(services[main]?.image).tag : "";
  return tag === "latest" ? "" : tag;
}
