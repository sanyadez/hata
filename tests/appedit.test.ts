import { expect, test } from "bun:test";
import { applyEdit, blankCompose, megabytes, readEdit, type AppEdit } from "../src/appedit";
import { appMeta, dumpCompose, parseCompose } from "../src/appform";

const FILE = `
name: demo
services:
  web:
    image: nginx:1.27
    restart: unless-stopped
    ports:
      - 8080:80
      - "127.0.0.1:8443:443"
      - target: 53
        published: "5353"
        protocol: udp
        mode: host
      - 9000-9005:9000-9005
    volumes:
      - /DATA/AppData/demo/html:/usr/share/nginx/html:ro
      - cache:/var/cache/nginx
      - type: bind
        source: /DATA/Media
        target: /media
        bind:
          propagation: rslave
      - type: tmpfs
        target: /tmp
    environment:
      TZ: $TZ
      GREETING: hello
      PRICE: 5$$
      EMPTY:
    devices:
      - /dev/ttyUSB0:/dev/ttyUSB0:rwm
    command: nginx -g "daemon off;"
    cap_add: [NET_ADMIN]
    mem_limit: 512m
  db:
    image: postgres:16
    environment:
      - POSTGRES_PASSWORD=secret
      - PGDATA
volumes:
  cache: {}
x-casaos:
  title:
    en_us: Demo
    uk_ua: Демо
  icon: https://example.com/demo.png
  port_map: "8080"
  index: /admin
`;

const fresh = () => parseCompose(FILE);
/** The form as the page sends it back: read, changed by `change`, applied */
function edit(change: (form: AppEdit) => void, compose = fresh()) {
  const form = structuredClone(readEdit(compose, "en"));
  change(form);
  return { error: applyEdit(compose, form, "en"), compose };
}

test("megabytes of a compose byte value", () => {
  expect([megabytes("512m"), megabytes("1g"), megabytes("2GB"), megabytes(268435456), megabytes("1048576k"), megabytes(undefined), megabytes("lots")]).toEqual([512, 1024, 2048, 256, 1024, 0, 0]);
});

test("a compose file read as the form", () => {
  const form = readEdit(fresh(), "uk");
  expect(form).toMatchObject({ title: "Демо", icon: "https://example.com/demo.png", web: { scheme: "http", host: "", port: "8080", path: "/admin" } });
  const [web, db] = form.services;
  expect(web).toMatchObject({ name: "web", image: "nginx:1.27", network: "", restart: "unless-stopped", privileged: false, memory: 512, cpuShares: 0, capAdd: ["NET_ADMIN"], hostname: "", command: ['nginx -g "daemon off;"'] });
  expect(web!.ports).toEqual([
    { from: 0, host: "8080", container: "80", protocol: "tcp" },
    { from: 1, host: "8443", container: "443", protocol: "tcp" },
    { from: 2, host: "5353", container: "53", protocol: "udp" },
    { from: 3, raw: "9000-9005:9000-9005", host: "", container: "", protocol: "tcp" },
  ]);
  expect(web!.volumes).toEqual([
    { from: 0, host: "/DATA/AppData/demo/html", container: "/usr/share/nginx/html" },
    { from: 1, host: "cache", container: "/var/cache/nginx" },
    { from: 2, host: "/DATA/Media", container: "/media" },
    { from: 3, raw: '{"type":"tmpfs","target":"/tmp"}', host: "", container: "" },
  ]);
  expect(web!.envs).toEqual([
    { from: 0, name: "TZ", value: "$TZ" },
    { from: 1, name: "GREETING", value: "hello" },
    { from: 2, name: "PRICE", value: "5$" },
    { from: 3, name: "EMPTY", value: "" },
  ]);
  expect(web!.devices).toEqual([{ from: 0, host: "/dev/ttyUSB0", container: "/dev/ttyUSB0" }]);
  expect(db!.envs).toEqual([{ from: 0, name: "POSTGRES_PASSWORD", value: "secret" }, { from: 1, name: "PGDATA", value: "" }]);
});

test("a form sent back untouched leaves the file as it was", () => {
  const { error, compose } = edit(() => {});
  expect(error).toBeNull();
  expect(dumpCompose(compose)).toBe(dumpCompose(fresh()));
});

test("a changed row is rewritten, keeping what the form does not show; the others stay as written", () => {
  const { error, compose } = edit((form) => {
    const web = form.services[0]!;
    web.ports[0]!.host = "8090";
    web.ports[1]!.host = "9443";
    web.ports[2]!.container = "5300";
    web.volumes[0]!.host = "/srv/html";
    web.volumes[2]!.container = "/movies";
    web.devices[0]!.host = "/dev/ttyACM0";
  });
  expect(error).toBeNull();
  const web = compose.services.web;
  expect(web.ports).toEqual(["8090:80", { target: 443, published: "9443", protocol: "tcp", host_ip: "127.0.0.1" }, { target: 5300, published: "5353", protocol: "udp", mode: "host" }, "9000-9005:9000-9005"]);
  expect(web.volumes).toEqual(["/srv/html:/usr/share/nginx/html:ro", "cache:/var/cache/nginx", { type: "bind", source: "/DATA/Media", target: "/movies", bind: { propagation: "rslave" } }, { type: "tmpfs", target: "/tmp" }]);
  expect(web.devices).toEqual(["/dev/ttyACM0:/dev/ttyUSB0:rwm"]);
});

test("rows are added and taken out; TCP + UDP becomes two entries; a named volume is declared", () => {
  const { error, compose } = edit((form) => {
    const web = form.services[0]!;
    web.ports = [web.ports[0]!, { host: "53", container: "53", protocol: "both" }, { host: "", container: "9100", protocol: "udp" }];
    web.volumes = [web.volumes[1]!, { host: "uploads", container: "/uploads" }, { host: "/DATA/AppData/demo/conf", container: "/etc/nginx/conf.d" }];
    web.devices = [];
    form.services[1]!.envs.push({ name: "POSTGRES_DB", value: "demo" });
  });
  expect(error).toBeNull();
  const web = compose.services.web;
  expect(web.ports).toEqual(["8080:80", "53:53", "53:53/udp", "9100/udp"]);
  expect(web.volumes).toEqual(["cache:/var/cache/nginx", "uploads:/uploads", "/DATA/AppData/demo/conf:/etc/nginx/conf.d"]);
  expect(compose.volumes).toEqual({ cache: {}, uploads: {} });
  expect(web.devices).toBeUndefined();
  // a list of NAME=value stays a list
  expect(compose.services.db.environment).toEqual(["POSTGRES_PASSWORD=secret", "PGDATA", "POSTGRES_DB=demo"]);
});

test("variables: what is typed is literal, a reference stays a reference, an untouched value stays as written", () => {
  const { error, compose } = edit((form) => {
    const envs = form.services[0]!.envs;
    envs[0]!.value = "${TZ:-UTC}";
    envs[1]!.value = "costs $5";
    envs[2]!.name = "COST";
    envs.splice(3, 1);
    envs.push({ name: "TOKEN", value: "a$b" });
  });
  expect(error).toBeNull();
  expect(compose.services.web.environment).toEqual({ TZ: "${TZ:-UTC}", GREETING: "costs $$5", COST: "5$$", TOKEN: "a$$b" });
  expect(edit((form) => form.services[0]!.envs.push({ name: "GREETING", value: "x" })).error).toBe("edit.sameEnv");
  expect(edit((form) => form.services[0]!.envs.push({ name: "bad name", value: "x" })).error).toBe("edit.badEnv");
});

test("the fields of a service", () => {
  const { error, compose } = edit((form) => {
    const web = form.services[0]!;
    Object.assign(web, { image: "nginx:1.28", network: "host", restart: "", privileged: true, memory: 1024, cpuShares: 90, hostname: "demo-web", capAdd: ["cap_sys_time", "NET_ADMIN"], command: ["nginx", "-g", "daemon off;"] });
    Object.assign(form.services[1]!, { memory: 2048 });
  });
  expect(error).toBeNull();
  const { web, db } = compose.services;
  expect(web).toMatchObject({ image: "nginx:1.28", network_mode: "host", privileged: true, mem_limit: "1024M", cpu_shares: 90, hostname: "demo-web", cap_add: ["SYS_TIME", "NET_ADMIN"], command: ["nginx", "-g", "daemon off;"] });
  expect("restart" in web).toBe(false);
  // where there was no limit yet, it is written the way CasaOS writes it
  expect(db.deploy).toEqual({ resources: { limits: { memory: "2048M" } } });

  const back = edit((form) => Object.assign(form.services[1]!, { memory: 0 }), compose);
  expect(back.error).toBeNull();
  expect("deploy" in back.compose.services.db).toBe(false);
  // one argument for a command written as a string keeps it a string
  expect(edit((form) => (form.services[0]!.command = ["nginx -T"])).compose.services.web.command).toBe("nginx -T");
});

test("title, icon and the web UI go into x-casaos; a typed title wins in every language", () => {
  const { error, compose } = edit((form) => Object.assign(form, { title: "My site", icon: "", web: { scheme: "https", host: "nas.lan", port: "8443", path: "ui" } }));
  expect(error).toBeNull();
  expect(compose["x-casaos"]).toEqual({ title: { en_us: "Demo", uk_ua: "Демо", custom: "My site" }, port_map: "8443", index: "/ui", scheme: "https", hostname: "nas.lan" });
  expect(appMeta(compose, "uk")).toMatchObject({ title: "My site", port: "8443", index: "/ui", scheme: "https", hostname: "nas.lan" });
  expect(edit((form) => (form.web.port = "")).compose["x-casaos"].port_map).toBeUndefined();
});

test("what cannot be right is refused", () => {
  const bad = (change: (form: AppEdit) => void) => edit(change).error;
  expect(bad((f) => (f.services[0]!.image = " "))).toBe("edit.badImage");
  expect(bad((f) => (f.services[0]!.ports[0]!.host = "70000"))).toBe("edit.badPort");
  expect(bad((f) => f.services[0]!.ports.push({ host: "80", container: "", protocol: "tcp" }))).toBe("edit.badPort");
  expect(bad((f) => (f.services[0]!.volumes[0]!.host = "../etc"))).toBe("edit.badVolume");
  expect(bad((f) => (f.services[0]!.volumes[0]!.container = "html"))).toBe("edit.badVolume");
  expect(bad((f) => (f.services[0]!.devices[0]!.host = "ttyUSB0"))).toBe("edit.badDevice");
  expect(bad((f) => (f.services[0]!.capAdd = ["NET ADMIN"]))).toBe("edit.badCapability");
  expect(bad((f) => (f.icon = "javascript:alert(1)"))).toBe("edit.badIcon");
  expect(bad((f) => (f.web.port = "http"))).toBe("edit.badWeb");
  expect(bad((f) => (f.services[0]!.name = "other"))).toBe("edit.unknownService");
  expect(bad((f) => f.services[0]!.ports.push({ raw: "1-2:1-2", host: "", container: "", protocol: "tcp" }))).toBe("edit.invalid");
  expect(applyEdit(fresh(), "x", "en")).toBe("edit.invalid");
});

test("a new app starts from an empty form", () => {
  const compose = blankCompose("whoami");
  const form = readEdit(compose, "en");
  Object.assign(form, { title: "Who am I", web: { ...form.web, port: "8088" } });
  Object.assign(form.services[0]!, { image: "traefik/whoami", ports: [{ host: "8088", container: "80", protocol: "tcp" }] });
  expect(applyEdit(compose, form, "en")).toBeNull();
  expect(parseCompose(dumpCompose(compose))).toEqual({ name: "whoami", services: { whoami: { image: "traefik/whoami", restart: "unless-stopped", ports: ["8088:80"] } }, "x-casaos": { title: { custom: "Who am I" }, port_map: "8088" } });
  expect(applyEdit(blankCompose("x"), readEdit(blankCompose("x"), "en"), "en")).toBe("edit.badImage");
});
