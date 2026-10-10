/**
 * A `docker run` command read into the settings form of an app (`appedit.ts`): what people paste from a
 * project's README becomes the fields of the form, to look over before anything is installed. Pure and
 * tested. Options the form has no field for are named in `ignored`, not silently dropped.
 */
import { megabytes, readService, type AppEdit, type ServiceEdit } from "./appedit";

/** Splits a command line the way a shell does: quotes, backslashes, lines joined by a trailing backslash */
export function shellWords(text: string): string[] {
  const words: string[] = [];
  let word = "";
  let open = false;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && '"\\$`'.includes(text[i + 1] ?? "")) word += text[++i];
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      open = true;
    } else if (c === "\\") {
      // a backslash before a line break only joins the lines
      if (text[i + 1] === "\r") i++;
      if (text[i + 1] === "\n") i++;
      else if (i + 1 < text.length) {
        word += text[++i];
        open = true;
      }
    } else if (/\s/.test(c)) {
      if (open || word) words.push(word);
      word = "";
      open = false;
    } else word += c;
  }
  if (open || word) words.push(word);
  return words;
}

/** Options of `docker run` that stand alone; every other option is followed by its value */
const SWITCHES = new Set(["d", "detach", "i", "interactive", "t", "tty", "rm", "privileged", "init", "read-only", "P", "publish-all", "no-healthcheck", "oom-kill-disable", "q", "quiet"]);
const SHORT: Record<string, string> = { p: "publish", v: "volume", e: "env", h: "hostname", m: "memory", c: "cpu-shares", l: "label", u: "user", w: "workdir" };

export interface RunImport {
  /** A name for the app: the container's, or the image's */
  name: string;
  edit: AppEdit;
  /** Options that did not make it into the form, as written */
  ignored: string[];
}

const appName = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|-+$/g, "")
    .slice(0, 63);

/** `[ip:]host:container[/protocol]`, `container[/protocol]`; null when it is something else (a range) */
function port(value: string): ServiceEdit["ports"][number] | null {
  const m = /^(?:(?:[\d.]+:)?(\d*):)?(\d+)(?:\/(tcp|udp))?$/.exec(value);
  return m ? { host: m[1] ?? "", container: m[2]!, protocol: m[3] === "udp" ? "udp" : "tcp" } : null;
}

/** Reads the command; returns an error code when it is not a `docker run` with an image */
export function parseDockerRun(text: unknown): RunImport | string {
  if (typeof text !== "string" || text.length > 64 * 1024) return "run.notRun";
  const words = shellWords(text.trim());
  if (words[0] === "sudo") words.shift();
  if (words[0] !== "docker" && words[0] !== "podman") return "run.notRun";
  words.shift();
  if (words[0] === "container") words.shift();
  if (words[0] !== "run" && words[0] !== "create") return "run.notRun";
  words.shift();

  const service = readService("", {});
  const ignored: string[] = [];
  let container = "";
  let i = 0;
  const option = (name: string, value: string, written: string): void => {
    if (name === "name") container = value;
    else if (name === "publish") {
      const row = port(value);
      if (row) service.ports.push(row);
      else ignored.push(written);
    } else if (name === "volume") {
      const [host, target] = value.split(":");
      if (host && target) service.volumes.push({ host, container: target });
      else ignored.push(written);
    } else if (name === "env") {
      const eq = value.indexOf("=");
      // a name alone passes the variable of the shell on — there is no such shell here
      if (eq > 0) service.envs.push({ name: value.slice(0, eq), value: value.slice(eq + 1) });
      else ignored.push(written);
    } else if (name === "device") {
      const [host, target] = value.split(":");
      service.devices.push({ host: host!, container: target ?? host! });
    } else if (name === "restart") service.restart = value;
    else if (name === "network" || name === "net") service.network = value;
    else if (name === "cap-add") service.capAdd.push(value.toUpperCase().replace(/^CAP_/, ""));
    else if (name === "hostname") service.hostname = value;
    else if (name === "memory") service.memory = megabytes(value);
    else if (name === "cpu-shares") service.cpuShares = Number(value) || 0;
    else ignored.push(written);
  };
  const flag = (name: string, written: string): void => {
    if (name === "privileged") service.privileged = true;
    // running in the background, with a terminal, removed on exit: an app is always the first and never the last
    else if (!["d", "detach", "i", "interactive", "t", "tty", "rm"].includes(name)) ignored.push(written);
  };

  for (; i < words.length; i++) {
    const word = words[i]!;
    if (word === "--") {
      i++;
      break;
    }
    if (!word.startsWith("-") || word === "-") break;
    if (word.startsWith("--")) {
      const eq = word.indexOf("=");
      const name = word.slice(2, eq < 0 ? undefined : eq);
      if (eq >= 0) option(name, word.slice(eq + 1), word);
      else if (SWITCHES.has(name)) flag(name, word);
      else if (i + 1 < words.length) option(name, words[++i]!, `${word} ${words[i]}`);
      continue;
    }
    // short options can be written together: -itd, -dp 8080:80, -e=NAME=value
    for (let at = 1; at < word.length; at++) {
      const letter = word[at]!;
      if (SWITCHES.has(letter)) {
        flag(letter, "-" + letter);
        continue;
      }
      const rest = word.slice(at + 1).replace(/^=/, "");
      const value = rest || words[++i] || "";
      option(SHORT[letter] ?? letter, value, `-${letter} ${value}`);
      break;
    }
  }

  const image = words[i] ?? "";
  if (!image || /\s/.test(image)) return "run.noImage";
  service.image = image;
  service.command = words.slice(i + 1);
  // what the image is called without the registry, the owner and the tag
  const fromImage = image.split("/").pop()!.split(/[:@]/)[0]!;
  const name = appName(container) || appName(fromImage) || "app";
  service.name = name;
  if (!service.restart) service.restart = "unless-stopped";
  const web = service.ports.find((p) => p.protocol === "tcp" && p.host);
  return { name, edit: { title: "", icon: "", web: { scheme: "http", host: "", port: web?.host ?? "", path: "/" }, services: [service] }, ignored };
}
