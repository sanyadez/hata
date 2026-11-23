// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Apps: shared pieces ------------------------------------------------------------------------

const TILE_COLORS = ["#7B5CD6", "#3B82C4", "#1D8FD1", "#2FA7C4", "#C44A3F", "#4B63B8", "#4E8A9B", "#3F9B6B", "#C4862A", "#B8612F"];

function appIcon(app, size = "") {
  const title = app.title || app.name || "?";
  let hash = 0;
  for (const ch of app.name ?? title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const letter = h("span", { class: `app-icon letter ${size}` }, title.slice(0, 1).toUpperCase());
  letter.style.background = TILE_COLORS[hash % TILE_COLORS.length];
  if (!app.icon) return letter;
  return h("img", { class: `app-icon ${size}`, src: app.icon, alt: "", loading: "lazy", referrerPolicy: "no-referrer", onerror: (e) => e.target.replaceWith(letter) });
}

/** The app's own name under the domain (the one that is set, or the local one), when Hata itself is opened by that domain; otherwise null */
function appDomain(app) {
  const site = state.overview?.site;
  const domain = [site?.domain, site?.local].find((name) => name && location.hostname === name);
  return domain && !app.hostname ? `${app.subdomain || app.name.replace(/_/g, "-")}.${domain}` : null;
}

function appUrl(app) {
  if (!app.port) return null;
  const host = appDomain(app);
  if (host) return `${location.protocol}//${host}${location.port ? ":" + location.port : ""}${app.index}`;
  return `${app.scheme}://${app.hostname || location.hostname}:${app.port}${app.index}`;
}

/** What the tile shows under the name: where the app answers */
function appAddress(app) {
  return app.port ? (appDomain(app) ?? `${app.hostname || location.hostname}:${app.port}`) : "";
}

const isUp = (app) => app.status === "running" || app.status === "partial";
const appState = (app) => (app.job ? "busy" : app.containers?.some((c) => c.state === "restarting") ? "restarting" : app.status);
const stateChip = (app) => h("span", { class: "state " + appState(app) }, t("status." + appState(app)));

// --- Home ---------------------------------------------------------------------------------------

function sparkline(values, max) {
  const top = max ?? Math.max(1, ...values);
  const bars = values.slice(-28).map((v, i, list) => {
    const bar = h("i", { class: i === list.length - 1 ? "last" : "" });
    bar.style.height = Math.max(6, Math.round((v / top) * 100)) + "%";
    return bar;
  });
  return h("div", { class: "spark", "aria-hidden": "true" }, bars);
}

function statCell(id, iconName, label) {
  return h(
    "div",
    { class: "stat", id: "stat-" + id },
    h("div", { class: "stat-label" }, icon(iconName), label),
    h("div", { class: "stat-row" }, h("div", { class: "stat-value" }, h("strong", null, "—"), h("span", { class: "unit" })), h("div", { class: "stat-chart" })),
    h("div", { class: "stat-hint" }, " "),
  );
}

function setStat(id, value, unit, hint, chart, level = "") {
  const el = document.getElementById("stat-" + id);
  if (!el) return;
  const strong = el.querySelector("strong");
  strong.textContent = value;
  strong.className = level;
  el.querySelector(".unit").textContent = unit;
  el.querySelector(".stat-hint").textContent = hint || " ";
  el.querySelector(".stat-chart").replaceChildren(chart ?? "");
}

const level = (percent) => (percent >= 95 ? "danger" : percent >= 85 ? "warn" : "");

/** A bar of a share: `percent` of it filled, coloured by how full it is */
function meterBar(percent, cls = level(percent)) {
  const fill = h("i", { class: cls });
  fill.style.width = Math.max(0, Math.min(100, percent)) + "%";
  return h("div", { class: "bar" }, fill);
}

/**
 * One number of this server: on Home a row of the block (`fact`: icon, label, meter, value), on the server's page a
 * number of the strip (`stat`). Made once with its id, refilled by `setKpi` as the numbers come.
 */
function kpi(id, iconName, label, href = "", form = "stat") {
  const attrs = { id: "kpi-" + id, ...(href ? { href, title: t("load.title") } : {}) };
  if (form === "fact")
    return h(href ? "a" : "div", { class: "ui-mfact kpi", ...attrs }, h("span", { class: "ui-mfact-label" }, icon(iconName), h("span", { class: "clip" }, label)), h("span", { class: "ui-mfact-bar" }), h("span", { class: "ui-mfact-value mono" }, "—"));
  return h(href ? "a" : "div", { class: "ui-stat kpi", ...attrs }, h("span", { class: "ui-stat-label" }, icon(iconName), h("span", { class: "clip" }, label)), h("span", { class: "ui-stat-value" }, h("strong", null, "—"), h("span")), h("span", { class: "ui-stat-chart" }), h("span", { class: "ui-stat-hint" }, " "));
}

function setKpi(id, value, unit, hint, gauge, cls = "") {
  const el = document.getElementById("kpi-" + id);
  if (!el) return;
  const tone = cls === "danger" ? "bad" : cls;
  if (el.classList.contains("ui-mfact")) {
    const v = el.querySelector(".ui-mfact-value");
    v.textContent = value + (unit && unit !== "%" ? " " : "") + unit;
    v.className = "ui-mfact-value mono" + (tone ? " " + tone : "");
    el.querySelector(".ui-mfact-bar").replaceChildren(gauge ?? "");
    if (hint) el.title = hint;
    return;
  }
  const strong = el.querySelector(".ui-stat-value strong");
  strong.textContent = value;
  strong.className = tone;
  el.querySelector(".ui-stat-value span").textContent = unit;
  el.querySelector(".ui-stat-hint").textContent = hint || " ";
  el.querySelector(".ui-stat-chart").replaceChildren(gauge ?? "");
}

/** The numbers of this server, one to a row: CPU, memory, disk, network, temperature */
const ownKpis = (form) => [kpi("cpu", "cpu", t("sys.cpu"), isAdmin() ? "#/machines/load/here" : "", form), kpi("memory", "memory", t("sys.memory"), isAdmin() ? "#/machines/load/here" : "", form), kpi("disk", "disk", t("sys.disk"), "", form), kpi("network", "network", t("sys.network"), "", form), kpi("temp", "temp", t("sys.temperature"), "", form)];

/** The block of this server's numbers on Home: made once, refilled as the numbers come */
function statsBlock() {
  return widget(
    "stats",
    uiCard(
      { title: h("span", { id: "own-name" }, state.overview?.system?.hostname ?? "…"), count: t("home.thisServer"), actions: h("span", { class: "ui-row-time", id: "own-up" }), cls: "numbers" },
      h("div", { class: "ui-mfacts" }, ownKpis("fact")),
      h("div", { class: "trend", id: "own-trend" }),
    ),
  );
}

const MINUTE_MS = 60_000;

/** CPU and memory of the last 40 minutes, a point a minute: drawn again only when a minute is over */
function paintTrend(trend) {
  const box = document.getElementById("own-trend");
  if (!box || !trend || box.dataset.at === String(trend.at)) return;
  box.dataset.at = String(trend.at);
  // the chart is as high as its card of Home lets it be: drawn again when the card gets its size or is resized
  if (!box.hataWatch && typeof ResizeObserver === "function") {
    let high = box.clientHeight;
    box.hataWatch = new ResizeObserver(() => {
      if (Math.abs(box.clientHeight - high) < 12) return;
      high = box.clientHeight;
      box.dataset.at = "";
      paintTrend(state.overview?.system?.trend);
    });
    box.hataWatch.observe(box);
  }
  const n = trend.cpu.length;
  const points = trend.cpu.map((cpu, i) => ({ t: trend.at - (n - 1 - i) * MINUTE_MS, cpu, memory: trend.memory[i] }));
  const series = [
    { cls: "s2", label: t("sys.cpu"), value: (p) => p.cpu },
    { cls: "s1", label: t("sys.memory"), value: (p) => p.memory },
  ];
  put(
    box,
    n < 2 ? h("p", { class: "muted small" }, t("home.trendSoon")) : h("div", { class: "trend-head muted small" }, h("span", { class: "grow" }, t("home.trend", { n })), series.map((s) => h("span", null, h("i", { class: "series-key " + s.cls }), s.label))),
    // in a card of Home the chart takes the room the card has; elsewhere its usual height
    n >= 2 && lineChart(points, series, { max: 100, fmt: (v) => Math.round(v) + "%", label: t("home.trend", { n }), height: box.closest(".pg-card") ? Math.max(90, box.clientHeight - 54) : 160, head: false }),
  );
}

function renderSystem() {
  const s = state.overview?.system;
  if (!s || (state.route.view !== "home" && state.route.view !== "server")) return;
  // of this server's page only the overview has the numbers
  if (state.route.view === "server" && !document.getElementById("kpi-disk")) return void paintServerMeta();
  const meta = document.getElementById("host");
  const own = document.getElementById("own-name");
  if (own) own.textContent = s.hostname;
  const up = document.getElementById("own-up");
  if (up) up.textContent = t("sys.uptime", { time: duration(s.uptime) });
  if (meta) meta.textContent = [s.hostname, location.host, "Hata " + state.version].join(" · ");

  setKpi("cpu", s.cpu == null ? "—" : String(s.cpu), "%", t("sys.cores", { n: s.cores }) + " · " + t("sys.load", { load: s.load[0] }), uiMeter(s.cpu ?? 0, { kind: "load" }));
  const mem = s.memory;
  const memPercent = mem.total ? Math.round((mem.used / mem.total) * 100) : 0;
  const used = bytesParts(mem.used);
  setKpi("memory", used.value, used.unit, t("sys.ofPercent", { total: bytes(mem.total), percent: memPercent }), uiMeter(memPercent, { kind: "load" }), level(memPercent));
  const disk = s.disks[s.disks.length - 1];
  const diskCell = document.getElementById("kpi-disk");
  if (diskCell) diskCell.hidden = !disk;
  if (disk) {
    const percent = Math.round((disk.used / disk.total) * 100);
    setKpi("disk", String(percent), "%", t("sys.free", { free: bytes(disk.total - disk.used), total: bytes(disk.total) }), uiMeter(percent), level(percent));
    const label = diskCell.querySelector(".clip");
    if (label) label.textContent = `${t("sys.disk")} ${disk.path}`;
  }
  const net = s.net ? bytesParts(s.net.rx + s.net.tx) : null;
  setKpi("network", net ? net.value : "—", net ? net.unit + "/s" : "", s.net ? `↓ ${bytes(s.net.rx)}/s · ↑ ${bytes(s.net.tx)}/s` : "", sparkline(s.history.net));
  const temp = document.getElementById("kpi-temp");
  if (temp) temp.hidden = s.temperature == null;
  if (s.temperature != null) setKpi("temp", String(s.temperature), "°C", t("sys.cpu"), uiMeter(s.temperature, { kind: "load" }), s.temperature >= 85 ? "warn" : "");
  paintTrend(s.trend);
}

// --- Home: tiles and folders of tiles --------------------------------------------------------------

/** `folder` — the open folder of tiles; `widgets` — the blocks of the page */
const homeUi = { folder: null, widgets: null };

/** What a card is called in the layout: blocks and tiles alike */
const tileKey = (item) => item.type + ":" + (item.type === "app" ? item.name : item.type === "files" ? item.path : item.type === "ha" ? `${item.server}/${item.entity}` : item.id);
/** The "Add" tile: a doorway, which is moved about but never put into a folder */
const isAddTile = (item) => item.type === "builtin" && item.id === "add";
/** What does not go into a folder: "Add", and a widget, which is as large as the page lets it be */
const staysOut = (item) => isAddTile(item) || item.type === "widget";
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, "0")).join("");
const linkHost = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
/** A link without a picture of its own shows the site's icon */
const linkIcon = (link) => {
  if (link.icon) return link.icon;
  try {
    return new URL("/favicon.ico", link.url).href;
  } catch {
    return "";
  }
};

/** What a tile of the layout stands for: the app, the pinned folder; null when it is not there */
function tileTarget(item) {
  const o = state.overview;
  // `<name>@<machine>` — an app of another machine
  if (item.type === "app") return item.name.includes("@") ? ((o.machineApps ?? []).find((app) => app.key === item.name) ?? null) : (o.apps.find((app) => app.name === item.name) ?? o.failedApps?.find((app) => app.name === item.name) ?? null);
  if (item.type === "files") return (o.folders ?? []).find((folder) => folder.path === item.path) ?? null;
  if (item.type === "ha") return haTarget(item);
  if (item.type === "widget") return widgetServer(item);
  return item;
}

const tileTitle = (item) => {
  const target = tileTarget(item);
  if (item.type === "builtin") return t(item.id === "store" ? "home.store" : "home.add");
  if (item.type === "ha") return target?.state?.name ?? item.entity;
  if (item.type === "widget") return widgetTitle(item, target);
  return item.type === "app" ? (target?.title ?? item.name) : item.type === "files" ? (target?.name ?? item.path) : item.title || (item.type === "folder" ? t("home.folder") : linkHost(item.url));
};

function tileIcon(item, size = "") {
  const target = tileTarget(item);
  if (item.type === "app") return appIcon(target ?? { name: item.name }, size);
  if (item.type === "link") return appIcon({ name: item.id, title: tileTitle(item), icon: linkIcon(item) }, size);
  if (item.type === "files") return h("span", { class: `app-icon plus ${size}` }, icon(tileTarget(item)?.disk ? (tileTarget(item).disk.network ? "globe" : "disk") : "folder"));
  if (item.type === "builtin") return h("span", { class: `app-icon plus ${size}` }, icon(item.id === "store" ? "store" : "plus"));
  if (item.type === "ha") return h("span", { class: `app-icon plus ${size}` }, icon(haIcon(target?.state ?? { domain: item.entity.split(".")[0] })));
  if (item.type === "widget") return h("span", { class: `app-icon plus ${size}` }, icon(svcConnections().find((c) => c.id === item.server)?.icon ?? "plug"));
  return h("span", { class: "app-icon stack" }, item.items.filter(tileTarget).slice(0, 4).map((inner) => tileIcon(inner, "mini")));
}

/** What every tile is made of: the picture with the marks beside it, the name (two lines at most), how it is, where */
function tileContent(item, title, sub, { badges = null, where = null, big = "" } = {}) {
  return [
    h("span", { class: "tile-head" }, tileIcon(item), big && h("span", { class: "tile-big" }, big), h("span", { class: "tile-badges" }, badges)),
    h("span", { class: "tile-name", title }, title),
    // one line under every name: what does not fit is cut, and the whole of a plain text is in its title
    h("span", { class: "tile-sub", ...(typeof sub === "string" ? { title: sub } : {}) }, sub),
    where,
  ];
}

/** The thin bar of a tile whose app is being worked on; `install` also tells it apart by its number */
function tileBar(job, install) {
  const bar = h("span", { class: "tile-bar" }, h("i"));
  bar.dataset.tileJob = job.id;
  paintTileBar(bar, job, install);
  return bar;
}

function paintTileBar(bar, job, install = true) {
  const pct = install && job.progress?.step === "download" ? jobPercent(job.progress) : null;
  bar.classList.toggle("moving", pct === null);
  bar.firstChild.style.width = pct === null ? "" : pct + "%";
}

function tile(item) {
  const target = tileTarget(item);
  if (!target) return null;
  if (item.type === "widget") return widgetTile(item, target);
  const admin = isAdmin();
  const title = tileTitle(item);
  let cls = "";
  let href = null;
  let external = false;
  let sub;
  let side = null;
  let badges = null;
  let haMain = null;
  let where = null;
  let bar = null;
  let onMain = null;
  if (item.type === "app" && target.machine) {
    // an app of another machine: opened at the machine's address, managed on the machine's page
    const app = target;
    const installing = app.job?.kind === "install";
    if (installing && !admin) return null;
    const st = (cls = target.machine.online ? (app.job?.kind === "update" ? app.status : appState(app)) : "stopped");
    if (app.job) bar = tileBar(app.job, installing);
    const url = isUp(app) ? machineAppUrl(target.machine, app) : null;
    href = url ?? `#/machines/${target.machine.id}/apps`;
    external = !!url;
    sub = [h("i", { class: "dot " + st }), target.machine.online ? (st === "running" && (app.guarded || app.port) ? (app.guarded ? `${location.hostname}:${app.guarded}` : `${target.machine.ip}:${app.port}`) : t("status." + st)) : t("machines.offline")];
    badges = [app.guarded && h("span", { class: "lock", title: t("access.protected") }, icon("lock"))];
    if (installing) {
      cls = "installing";
      sub = [h("i", { class: "dot" }), h("span", { class: "clip" }, jobShort(app.job, target.machine.name))];
    }
    where = !installing && h("span", { class: "tile-where" }, icon("server"), h("span", { class: "clip" }, target.machine.name));
    side = admin && h("a", { class: "tile-open", href: `#/machines/${target.machine.id}/apps`, title: target.machine.name, "aria-label": `${target.machine.name}: ${title}` }, icon("sliders"));
  } else if (item.type === "app") {
    const app = target;
    const installing = app.job?.kind === "install";
    if ((installing || app.failedJob) && !admin) return null;
    const st = (cls = app.failedJob ? "install-failed" : installing ? "installing" : app.job?.kind === "update" ? app.status : appState(app));
    if (installing || app.job?.kind === "update") bar = tileBar(app.job, installing);
    if (installing || app.failedJob) {
      jobsUi.places[app.name] = { x: item.x, y: item.y };
      onMain = () => jobDialog(app.failedJob ?? app.job.id, "install", app.title);
    }
    if (jobsUi.ready.delete(app.name)) cls += " just-ready";
    const url = isUp(app) ? appUrl(app) : null;
    // the tile opens the app; while it has no page to open, its own page here
    href = url ?? `#/apps/${app.name}`;
    external = !!url;
    sub = app.failedJob
      ? [icon("x"), t("jobs.couldNotShort")]
      : installing
        ? [h("i", { class: "dot" }), h("span", { class: "jt-short clip", "data-job-short": app.job.id }, jobShort(app.job))]
        : [h("i", { class: "dot " + st }), st === "running" && appAddress(app) ? appAddress(app) : t("status." + st)];
    const line = st === "running" && appServiceLine(app);
    if (line) where = h("span", { class: "tile-where" }, h("span", { class: "clip" }, line));
    badges = [app.protected && h("span", { class: "lock", title: t("access.protected") }, icon("lock")), (app.update || app.newer?.length > 0) && isAdmin() && h("span", { class: "lock", title: t(app.update ? "app.storeUpdate" : "app.newer") }, icon("up"))];
    // an administrator gets what can be done to the app right there; a member, the app's page
    side = admin
      ? h("button", { type: "button", class: "tile-open", title: t("home.tileActions"), "aria-label": `${t("home.tileActions")}: ${title}`, onclick: (e) => appTileMenu(app, e.currentTarget) }, icon("more"))
      : h("a", { class: "tile-open", href: `#/apps/${app.name}`, title: t("home.manage"), "aria-label": `${t("home.manage")}: ${title}` }, icon("sliders"));
  } else if (item.type === "ha") {
    ({ cls, side, main: haMain } = haTile(item, target, title));
  } else if (item.type === "link") {
    href = item.url;
    external = true;
    sub = linkHost(item.url);
    // a link for the TV: one press shows it on the server's screen (for whoever may; for the rest it is a usual link)
    const toScreen = item.screen && isAdmin() && hasModule("tv");
    if (toScreen) onMain = () => void showOnTv(item.url).then((shown) => shown && toast(t("tv.page.sent", { name: title })));
    badges = h("span", { class: "lock", title: toScreen ? t("home.linkScreen") : null }, icon(toScreen ? "tv" : "external"));
    side = isAdmin() && h("button", { type: "button", class: "tile-open", title: t("home.editLink"), "aria-label": `${t("home.editLink")}: ${title}`, onclick: () => linkDialog(item) }, icon("sliders"));
  } else if (item.type === "builtin") {
    // Hata's own tiles: the store opens like an app, "Add" asks what to add
    href = "#/store";
    cls = item.id === "add" ? "add" : "";
    sub = t(item.id === "store" ? "home.storeHint" : "home.addHint");
  } else if (item.type === "files") {
    cls = target.missing ? "stopped" : "";
    href = filesHash(item.path);
    sub = h("span", { class: "mono clip", title: item.path }, target.missing ? t("home.folderMissing") : item.path);
    if (target.disk?.total && !target.missing) sub = diskRoom(target.disk, true);
  } else {
    const shown = item.items.filter(tileTarget).length;
    if (!shown) return null;
    sub = t("home.items", { n: shown });
  }
  // what has no page of its own to manage it gets a menu: where to move it, how to take it off
  if (admin && !side && !isAddTile(item) && !tileHasNoMenu(item)) side = h("button", { type: "button", class: "tile-open", title: t("home.tileActions"), "aria-label": `${t("home.tileActions")}: ${title}`, onclick: () => tileMenu(item) }, icon("more"));
  const content = [...tileContent(item, title, sub, { badges, where }), bar];
  const key = tileKey(item);
  const main = haMain ??
    (onMain ? h("button", { type: "button", class: "tile-main", onclick: onMain }, content) : item.type === "folder" || isAddTile(item)
      ? h("button", { type: "button", class: "tile-main", onclick: () => (isAddTile(item) ? addDialog() : openFolder(item.id)) }, content)
      : h("a", { class: "tile-main", href, draggable: false, ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, content));
  if (!admin) return h("div", { class: `tile kind-${item.type} ${cls}`, "data-key": key }, main, side);
  return h("div", { class: `tile kind-${item.type} ${cls}`, "data-key": key, oncontextmenu: (e) => {
        if (e.pointerType === "touch") return;
        e.preventDefault();
        const at = { x: e.clientX, y: e.clientY };
        // "Add" offers what it adds; an app, the same menu as its button, where the pointer is
        if (isAddTile(item)) menuAt(at, null, [{ label: t("home.add"), icon: "plus", run: () => addDialog() }]);
        else if (item.type === "app" && !target.machine) appTileMenu(target, null, at);
        else tileMenu(item, at);
      }, ondragstart: (e) => e.preventDefault() }, main, side);
}

// --- Widgets: what an integration shows right on the page, as much as its cells let it -------------

const widgetServer = (item) => svcConnections().find((s) => s.id === item.server) ?? null;
/** The widget of the description a card on Home is */
const widgetSpec = (item) => {
  const x = widgetServer(item);
  return (x && svcSpecNow(x.kind)?.widgets?.[item.view]) ?? null;
};
const widgetTitle = (item, x) => {
  const w = widgetSpec(item);
  return item.row ?? (w?.kind === "summary" ? (x?.name ?? "") : svcText(w?.label) || (x?.name ?? ""));
};
/** A picture of a widget stays the same element across redraws and takes the next one only once it has come: no blinking */
const widgetPictures = new Map();

function widgetPicture(key, src, alt) {
  let img = widgetPictures.get(key);
  if (!img) widgetPictures.set(key, (img = picture(src, alt)));
  return img;
}

/**
 * A camera's live video (Frigate's MJPEG stream through Hata): one stream per picture. It is let go when the picture
 * leaves the page or the tab is hidden, and after a break it is asked for again in a few seconds.
 */
const LIVE_FPS = 5;
const liveShown = new Set();

function livePicture(src, alt, cls) {
  const img = picture(src, alt, cls);
  img.removeAttribute("loading");
  img.dataset.live = src;
  img.liveStart = () => (img.src = `${img.dataset.live}&r=${Date.now()}`);
  img.liveStop = () => img.removeAttribute("src");
  liveShown.add(img);
  img.addEventListener("error", () =>
    setTimeout(() => {
      if (!img.isConnected || !img.dataset.live || document.hidden) return;
      img.classList.remove("broken");
      img.liveStart();
    }, 5000),
  );
  return img;
}

/** Where WebRTC did not reach the camera: frames through Hata for a while instead of trying again at every redraw */
const rtcRefused = new Map();
const RTC_WAIT = 8000;

/** Live video of a service's stream: by WebRTC when its description has it (the video goes straight from the service, which
 *  plays in real time and does not break), else — or when that cannot connect — the frames through Hata */
function liveView(x, name, key, height, alt, cls) {
  const frames = () => livePicture(svcLive(x.id, name, key, height), alt, cls);
  const p = svcSpecNow(x.kind)?.pictures?.[name];
  const refused = `${x.id}/${name}/${key}`;
  if (!p?.webrtc || typeof RTCPeerConnection !== "function" || (rtcRefused.get(refused) ?? 0) > Date.now()) return frames();
  const video = h("video", { class: cls ? `live-video ${cls}` : "live-video", "aria-label": alt });
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.dataset.live = refused;
  let pc = null;
  let wait = 0;
  let again = 0;
  let seen = false;
  const stop = () => {
    clearTimeout(wait);
    clearTimeout(again);
    if (pc) pc.close();
    pc = null;
    video.srcObject = null;
  };
  const giveUp = () => {
    stop();
    rtcRefused.set(refused, Date.now() + 10 * 60_000);
    liveShown.delete(video);
    if (!video.isConnected || !video.dataset.live) return;
    const img = frames();
    for (const [k, v] of widgetPictures) if (v === video) widgetPictures.set(k, img);
    video.replaceWith(img);
  };
  // a stream that played and broke is asked for once more; one that does not play gives way to the frames
  const lost = () => {
    if (!seen) return giveUp();
    stop();
    again = setTimeout(() => video.isConnected && video.dataset.live && !document.hidden && start(), 2000);
  };
  const start = async () => {
    stop();
    seen = false;
    const mine = (pc = new RTCPeerConnection());
    const tracks = new MediaStream();
    mine.addTransceiver("video", { direction: "recvonly" });
    mine.addTransceiver("audio", { direction: "recvonly" });
    mine.ontrack = (e) => {
      tracks.addTrack(e.track);
      video.srcObject = tracks;
      void video.play().catch(() => {});
    };
    mine.onconnectionstatechange = () => {
      if (pc !== mine) return;
      const now = mine.connectionState;
      if (now === "connected") {
        seen = true;
        clearTimeout(wait);
      } else if (now === "failed") lost();
      else if (now === "disconnected") wait = setTimeout(() => pc === mine && mine.connectionState !== "connected" && lost(), 4000);
    };
    wait = setTimeout(() => pc === mine && mine.connectionState !== "connected" && lost(), RTC_WAIT);
    try {
      await mine.setLocalDescription(await mine.createOffer());
      // the whole offer at once: the service answers one request, so the browser's addresses go in it
      await new Promise((done) => {
        if (mine.iceGatheringState === "complete") return done();
        const enough = setTimeout(done, 2000);
        mine.addEventListener("icegatheringstatechange", () => mine.iceGatheringState === "complete" && (clearTimeout(enough), done()));
      });
      if (pc !== mine) return;
      const answer = await api("POST", `/api/integrations/${x.id}/webrtc/${name}/${encodeURIComponent(key)}`, { sdp: mine.localDescription.sdp });
      if (pc !== mine) return;
      await mine.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    } catch {
      if (pc === mine) lost();
    }
  };
  video.liveStart = start;
  video.liveStop = stop;
  liveShown.add(video);
  start();
  return video;
}

function letLiveGo(el) {
  delete el.dataset.live;
  el.liveStop?.();
  liveShown.delete(el);
}

setInterval(() => {
  for (const el of liveShown) if (!el.isConnected) letLiveGo(el);
  for (const [key, el] of widgetPictures) if (!el.isConnected && !liveShown.has(el) && key.startsWith("live:")) widgetPictures.delete(key);
}, 3000);

document.addEventListener("visibilitychange", () => {
  for (const el of liveShown) {
    if (document.hidden) el.liveStop?.();
    else if (el.isConnected) el.liveStart?.();
  }
});

function renewPicture(img, src) {
  const next = h("img", { src });
  next.addEventListener("load", () => (img.src = next.src));
}

/** A widget of numbers and the first rows of a list: what is moving, what is left */
function summaryWidget(item, x, w) {
  const { w: wide = 1, h: tall = 1 } = item;
  const spec = svcSpecNow(x.kind);
  // what does not fit goes under "N more": a card has no scroll of its own
  // a row with a bar is two lines; named numbers stand a line taller; one line goes to "N more"
  const labelled = w.numbers.some((n) => n.label);
  const line = w.list?.bar ? 38 : 25;
  const space = tall * 140 - (labelled ? 141 : 120);
  const rows = w.list ? (x.lists[w.list.of] ?? []) : [];
  const room = tall === 1 ? (wide > 1 && !labelled ? 1 : 0) : Math.max(1, Math.floor((rows.length * line > space ? space - 20 : space) / line));
  const shown = rows.slice(0, room);
  return h(
    "a",
    { class: "tile-main widget-body", href: `#/service/${x.id}`, draggable: false },
    h("span", { class: "widget-head" }, tileIcon(item), h("span", { class: "widget-title clip" }, x.name)),
    x.online
      ? [
          // a number with its words says what it counts; the line of all numbers then says nothing new
          h("span", { class: "widget-speeds" + (labelled ? " labelled" : "") }, w.numbers.map((n) => h("span", null, h("b", null, svcFormat(x.values[n.value], n.as) || "—"), n.label && h("small", null, svcText(n.label))))),
          !labelled && !(tall === 1 && room > 0) && spec && h("span", { class: "muted small clip" }, svcNumbers(spec, x.values)),
          shown.length > 0 && h("span", { class: "widget-torrents" }, shown.map((row) => widgetRow(spec, w.list, row))),
          room > 0 && rows.length > shown.length && h("span", { class: "muted small" }, t("attention.moreItems", { n: rows.length - shown.length })),
          room > 0 && w.list && !rows.length && h("span", { class: "muted small" }, t("service.nothing")),
        ]
      : h("span", { class: "muted small" }, t("service.offline")),
  );
}

/** A row of a summary's list: its name, then its state as a coloured word or a note, and its bar */
function widgetRow(spec, list, row) {
  const said = list.state ? spec?.words[list.state.words]?.[String(row[list.state.field])] : null;
  const side = said ? h("span", { class: "with-dot small" }, h("i", { class: "dot " + (said.tone || "stopped") }), svcText(said.label)) : list.note ? h("span", { class: "muted small" }, svcFill(list.note, row)) : null;
  return h("span", { class: "widget-torrent" }, side ? h("span", { class: "widget-row" }, h("span", { class: "small clip" }, String(row[list.title] ?? "")), side) : h("span", { class: "small clip" }, String(row[list.title] ?? "")), list.bar && meterBar(Number(row[list.bar]) || 0, ""));
}

/** How tall a picture a picture's card asks for */
const cameraHeight = (item) => Math.min(1080, (item.h ?? 1) * 240);

/** One row's picture: renewed every 10 s, or live when the person chose that */
function pictureWidget(item, x, w) {
  const spec = svcSpecNow(x.kind);
  const row = (x.lists[w.of] ?? []).find((r) => spec && svcKey(spec, w.of, r) === item.row);
  const height = cameraHeight(item);
  const open = () => row && svcPictureDialog(x, w.picture, w.live, item.row, String(row[w.caption] ?? item.row));
  const on = x.online && row && row.enabled !== false;
  let shown = null;
  if (on && item.live && w.live) {
    // a stream per size: a card made larger asks for a larger picture
    const liveKey = `live:${item.id}:${height}`;
    shown = widgetPictures.get(liveKey);
    if (!shown || !liveShown.has(shown)) widgetPictures.set(liveKey, (shown = liveView(x, w.live, item.row, height, item.row)));
  } else if (on) shown = widgetPicture(`still:${item.id}`, svcPicture(x.id, w.picture, item.row, height, Date.now()), item.row);
  return h(
    "button",
    { type: "button", class: "tile-main widget-picture", onclick: open },
    shown ?? h("span", { class: "camera-off" }, icon(x.icon)),
    h("span", { class: "widget-caption" }, h("i", { class: "dot " + (on && row.online !== false ? "running" : "stopped") }), h("span", { class: "clip" }, item.row ?? "")),
  );
}

/** The newest rows' pictures, as many as the card holds */
function picturesWidget(item, x, w) {
  const spec = svcSpecNow(x.kind);
  const cols = item.w ?? 1;
  const latest = (x.lists[w.of] ?? []).slice(0, cols * (item.h ?? 1));
  const el = h(
    "a",
    { class: "tile-main widget-events", href: `#/service/${x.id}`, draggable: false },
    latest.length && spec
      ? latest.map((row) => {
          const key = svcKey(spec, w.of, row);
          return h("span", { class: "widget-picture" }, widgetPicture(`row:${item.id}:${key}:${item.h ?? 1}`, svcPicture(x.id, w.picture, key, Math.min(720, (item.h ?? 1) * 280)), String(row[w.caption] ?? "")), h("span", { class: "widget-caption" }, h("span", { class: "clip" }, String(row[w.caption] ?? "")), w.note && h("span", { class: "muted" }, svcFill(w.note, row))));
        })
      : h("span", { class: "widget-body" }, h("span", { class: "widget-head" }, tileIcon(item), h("span", { class: "widget-title clip" }, svcText(w.label))), h("span", { class: "muted small" }, t("service.nothing"))),
  );
  if (latest.length) {
    el.style.gridTemplateColumns = `repeat(${Math.min(cols, latest.length)}, minmax(0, 1fr))`;
    el.style.gridTemplateRows = `repeat(${Math.ceil(latest.length / cols)}, minmax(0, 1fr))`;
  }
  return el;
}

function widgetTile(item, x) {
  const w = widgetSpec(item);
  const body = !w ? h("span", { class: "tile-main widget-body muted small" }, t("service.widgetGone")) : w.kind === "summary" ? summaryWidget(item, x, w) : w.kind === "picture" ? pictureWidget(item, x, w) : picturesWidget(item, x, w);
  const title = tileTitle(item);
  return h(
    "div",
    { class: `tile kind-widget view-${item.view}`, "data-key": tileKey(item), oncontextmenu: (e) => {
        if (e.pointerType === "touch") return;
        e.preventDefault();
        tileMenu(item, { x: e.clientX, y: e.clientY });
      }, ondragstart: (e) => e.preventDefault() },
    body,
    h("button", { type: "button", class: "tile-open", title: t("home.tileActions"), "aria-label": `${t("home.tileActions")}: ${title}`, onclick: () => tileMenu(item) }, icon("more")),
  );
}

/** The widgets on the page follow their servers without the page being drawn again */
async function widgetsTick() {
  if (state.route?.view !== "home" || document.hidden || gridUi.drag || !isAdmin()) return;
  const items = (state.overview?.dashboard?.cards ?? []).filter((item) => item.type === "widget");
  if (!items.length) return;
  const fresh = await api("GET", "/api/widgets").catch(() => null);
  if (!fresh || state.route.view !== "home" || gridUi.drag) return;
  if (state.overview.integrations) state.overview.integrations.connections = fresh.x;
  for (const item of items) {
    const sized = { ...item, ...gridUi.at?.[tileKey(item)] };
    const old = document.querySelector(`.tile[data-key="widget:${item.id}"]`);
    const made = old && tile(sized);
    if (made) old.replaceWith(made);
    const x = widgetServer(item);
    const w = widgetSpec(item);
    if (w?.kind === "picture" && x?.online && widgetPictures.has(`still:${item.id}`)) renewPicture(widgetPictures.get(`still:${item.id}`), svcPicture(x.id, w.picture, item.row, cameraHeight(sized), Date.now()));
  }
}
setInterval(() => void widgetsTick(), 10_000);

// --- The grid of Home: every card has a place and a size; they change only while editing the grid ---

const gridUi = { at: null, arranging: false, undo: [], entry: null, drag: null, gone: new Set(), wanted: null };
/** What has a "×" while arranging; a folder of tiles and Hata's own two tiles have none */
const gridRemovable = (card) => ["block", "widget", "ha", "link", "files", "app"].includes(card.type);

/** The kind whose limits a card's size keeps — the server's own: every widget is one kind, whatever its description calls its view */
const cardKind = (card) => (card.type === "block" ? (card.id.startsWith("machine:") ? "machine" : card.id) : card.type);
/** A card that shows a picture: it is never made a strip */
const cardPicture = (card) => card.type === "widget" && (card.view === "camera" || widgetSpec(card)?.kind === "picture");
const boxOf = ({ x, y, w, h: tall }) => ({ x, y, w, h: tall });
const gridOverlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The first free place from the top: nothing already placed moves */
function gridFit(taken, w, tall) {
  const cols = state.overview.grid.cols;
  for (let y = 0; ; y++) for (let x = 0; x + w <= cols; x++) if (!taken.some((box) => gridOverlaps({ x, y, w, h: tall }, box))) return { x, y, w, h: tall };
}

/** A new card on a copy of the layout, of the size its kind first takes */
function addCard(layout, item) {
  const [w, tall] = cardPicture(item) ? [1, 1] : (state.overview.grid.first[cardKind(item)] ?? [1, 1]);
  layout.cards.push({ ...item, ...gridFit(layout.cards, w, tall) });
}

/** A card put somewhere: what it covers goes down, and whatever that covers; nothing rises, so an empty place stays */
function gridPlace(base, key, box) {
  const at = structuredClone(base);
  at[key] = box;
  const queue = [key];
  while (queue.length) {
    const by = queue.shift();
    for (const other of Object.keys(at)) {
      if (other === key || other === by || !gridOverlaps(at[by], at[other])) continue;
      at[other].y = at[by].y + at[by].h;
      queue.push(other);
    }
  }
  return at;
}

/** Places as the layout has them; while editing, what came or went meanwhile is taken in and the rest stays */
function gridLoad() {
  const cards = state.overview.dashboard.cards;
  const at = {};
  if (!gridUi.arranging) gridUi.gone.clear();
  // a card taken off and brought back by "Undo" is no longer gone
  for (const key of [...gridUi.gone]) if (gridUi.at?.[key]) gridUi.gone.delete(key);
  const here = cards.filter((card) => !gridUi.gone.has(tileKey(card)));
  if (gridUi.arranging) for (const card of here) if (gridUi.at?.[tileKey(card)]) at[tileKey(card)] = gridUi.at[tileKey(card)];
  for (const card of here) at[tileKey(card)] ??= gridUi.arranging ? gridWanted(Object.values(at), card) ?? gridFit(Object.values(at), card.w, card.h) : boxOf(card);
  gridUi.at = at;
}

/** The empty place the person clicked while arranging, for the first card added after it — when the card fits there */
function gridWanted(taken, card) {
  const wish = gridUi.wanted;
  if (!wish) return null;
  gridUi.wanted = null;
  const box = { x: Math.min(wish.x, state.overview.grid.cols - card.w), y: wish.y, w: card.w, h: card.h };
  return box.x >= 0 && !taken.some((other) => gridOverlaps(box, other)) ? box : null;
}

/** A click on an empty place while arranging asks what to put there */
function gridAddAt(x, y) {
  gridUi.wanted = { x, y };
  // closed with nothing added, the place is forgotten; a row that opens a window of its own keeps it for what that window adds
  addDialog((ran) => !ran && (gridUi.wanted = null));
}

const gridEdit = () => {
  gridLoad();
  Object.assign(gridUi, { entry: structuredClone(gridUi.at), undo: [], arranging: true, gone: new Set(), wanted: null });
  paintGrid();
};

function gridDone() {
  const at = gridUi.at;
  const gone = [...gridUi.gone];
  gridUi.arranging = false;
  changeLayout((layout) => {
    for (const key of gone) takeTile(layout, key);
    for (const card of layout.cards) Object.assign(card, at[tileKey(card)]);
  });
}

/** How a card is called in a question about it */
function cardName(card) {
  if (card.type === "block") return blockTitle(card.id);
  if (card.type === "link") return card.title || linkHost(card.url);
  if (card.type === "files") return card.path.split("/").filter(Boolean).pop() ?? card.path;
  // what the card itself says: a Home Assistant device by its name, a widget by its own title
  if (card.type === "ha" || card.type === "widget" || card.type === "builtin") return tileTitle(card);
  const it = tileTarget(card);
  return it?.title ?? it?.name ?? card.name ?? card.entity ?? "";
}

/**
 * Nothing leaves Home without a question that says what it is: an app is removed as an app (its own window,
 * with its data's fate), a link goes with its address, a pinned folder is only unpinned, the rest is taken off
 * and can be added back. `take` does it once the person agreed.
 */
function askRemoveCard(card, take) {
  if (card.type === "app") {
    const it = tileTarget(card);
    if (!it) return;
    return card.name.includes("@") ? removeMachineAppDialog(it.machine, it) : removeDialog(it);
  }
  const name = cardName(card);
  const kind = card.type === "link" ? "link" : card.type === "files" ? "files" : "card";
  confirmAction({
    title: t(`home.take.${kind}.title`, { name }),
    lead: t(`home.take.${kind}.lead`, { name, url: card.url ?? "", path: card.path ?? "" }),
    label: t(`home.take.${kind}.go`),
    run: async () => void (await take()),
  });
}

/** The "×" of a card while arranging: asked first; what is only a matter of Home goes with "Done" */
const askTake = (card) => askRemoveCard(card, () => (card.type === "files" ? pinFolder(card.path, false) : gridTake(card)));

/** A card taken off while arranging: it goes with "Done", comes back with "Undo" or "Cancel" */
function gridTake(card) {
  gridUi.undo.push(structuredClone(gridUi.at));
  gridUi.gone.add(tileKey(card));
  delete gridUi.at[tileKey(card)];
  paintGrid();
}

function gridCancel() {
  gridUi.arranging = false;
  paintGrid();
}

/** Everything laid out anew at its first size: the server finds places for cards with none. Offered only while arranging */
const gridReset = () =>
  confirmAction({
    title: t("grid.resetTitle"),
    lead: t("grid.resetLead"),
    label: t("grid.resetGo"),
    iconName: "refresh",
    run: async () => {
      const blocksFirst = [...state.overview.dashboard.cards].sort((a, b) => (b.type === "block") - (a.type === "block"));
      await api("PUT", "/api/dashboard", { cards: blocksFirst.map(({ x: _x, y: _y, w: _w, h: _h, ...item }) => item) });
      gridUi.arranging = false;
      await refresh();
    },
  });

/** Home as YAML from the arranging bar: what was moved and not saved yet would not be in the text, so it is asked about first */
function gridYaml() {
  const open = () => (gridCancel(), layoutTextDialog());
  if (!gridUi.undo.length && !gridUi.gone.size) return open();
  confirmAction({ title: t("grid.yamlTitle"), lead: t("grid.yamlLead"), label: t("grid.yamlGo"), kind: "primary", iconName: "code", run: async () => open() });
}

/** Arranging is for a screen as wide as the grid: a narrower one lays Home out by itself */
const mayArrange = () => isAdmin() && !gridUi.arranging && state.route.view === "home" && !!state.overview && gridColumns() === state.overview.grid.cols;

function gridBar() {
  const box = document.getElementById("grid-bar");
  if (!box) return;
  const undo = () => ((gridUi.at = gridUi.undo.pop()), paintGrid());
  // the bar's rarer actions are pictures with their words on hover, so the two that end arranging stand out
  const tool = (label, iconName, onclick, disabled = false, kind = "") => h("button", { type: "button", class: "icon-btn " + kind, title: label, "aria-label": label, disabled, onclick }, icon(iconName));
  box.hidden = !gridUi.arranging;
  const head = document.getElementById("home-head");
  if (head) head.hidden = gridUi.arranging;
  put(box, gridUi.arranging && h("div", { class: "pg-bar" }, h("strong", null, t("grid.arranging")), h("span", { class: "grow" }), h("div", { class: "pg-tools" }, tool(t("grid.undo"), "undo", undo, !gridUi.undo.length), tool(t("menu.dashboardConfig"), "code", gridYaml), tool(t("grid.reset"), "refresh", gridReset, false, "danger")), button(t("common.cancel"), { class: "small", onclick: gridCancel }), button(t("grid.done"), { class: "small primary", onclick: gridDone }, "check")));
  // the button stays the same element across redraws: one under the pointer keeps its click
  const slot = document.getElementById("grid-edit-slot");
  const offer = mayArrange();
  if (slot && !!slot.firstChild !== offer) put(slot, offer && button(t("grid.editShort"), { onclick: gridEdit }, "grid"));
}

const GRID_WIDE = 1000;
const gridColumns = () => {
  const width = document.getElementById("pg")?.clientWidth ?? innerWidth;
  return width >= GRID_WIDE ? state.overview.grid.cols : width >= 640 ? 4 : 2;
};

function gridBody(card, box) {
  const o = state.overview;
  if (card.type !== "block") return tile({ ...card, ...box });
  const id = card.id;
  if (id.startsWith("machine:")) return machineBlock(id);
  const el = homeUi.widgets[id];
  if (id === "attention" && el) put(el, attentionBlock(o.attention));
  if (id === "activity" && el) put(el, ...activityBody(o));
  if (id === "adblock" && el) adblockBlock(el, o.adblock);
  if (id === "tv" && el) tvBlock(el);
  return el;
}

/** A list in a block shows what fits; the rest goes under its "N more" */
function fitBlock(block) {
  const list = block?.querySelector(".fits");
  if (!list) return;
  let left = 0;
  const more = block.querySelector(".fits-more");
  // the list itself may be cut by its card (it gives way to the link under it), so both are measured
  const over = () => block.scrollHeight > block.clientHeight + 1 || list.scrollHeight > list.clientHeight + 1;
  while (list.children.length > 1 && over()) {
    list.lastElementChild.remove();
    left++;
    if (more) {
      more.hidden = false;
      more.querySelector("span").textContent = t("attention.moreItems", { n: left });
    }
  }
  // the one item left is still higher than the card: its words are cut short, then left out, so the link
  // under the list never stands over it
  for (const step of ["squeezed", "bare"]) {
    if (!over()) break;
    list.classList.add(step);
  }
}

function paintGrid() {
  const pg = document.getElementById("pg");
  // a card's picture has this device's whole screen: taken out of the page for a redraw, it would fall back
  if (!pg || !state.overview || gridUi.drag || pg.contains(document.fullscreenElement)) return;
  const cols = gridColumns();
  const free = cols === state.overview.grid.cols;
  if (!free) gridUi.arranging = false;
  gridLoad();
  gridBar();
  pg.className = "pg" + (gridUi.arranging ? " arranging" : "") + (free ? "" : " flowing");
  pg.style.setProperty("--pg-cols", String(cols));
  const cards = state.overview.dashboard.cards;
  const shown = cards.filter((card) => !gridUi.gone.has(tileKey(card)));
  const inOrder = free ? shown : [...shown].sort((a, b) => gridUi.at[tileKey(a)].y - gridUi.at[tileKey(b)].y || gridUi.at[tileKey(a)].x - gridUi.at[tileKey(b)].x);
  // room to pull a card further down than anything stands yet
  const rows = Math.max(0, ...Object.values(gridUi.at).map((b) => b.y + b.h)) + 6;
  const cells = gridUi.arranging ? Array.from({ length: rows * cols }, (_, i) => {
    const x = i % cols;
    const y = Math.floor(i / cols);
    const cell = h("button", { type: "button", class: "pg-cell", title: t("grid.addHere"), "aria-label": t("grid.addHere"), onclick: () => gridAddAt(x, y) }, icon("plus"));
    cell.style.gridArea = `${Math.floor(i / cols) + 1} / ${(i % cols) + 1}`;
    return cell;
  }) : [];
  put(pg, ...cells, ...inOrder.map((card) => gridCard(card, free)));
  for (const id of ["attention", "activity"]) if (pg.contains(homeUi.widgets?.[id])) fitBlock(homeUi.widgets[id]);
  renderSystem();
}

function gridPosition(el, box, free) {
  el.style.gridColumn = free ? `${box.x + 1} / span ${box.w}` : `span ${Math.min(box.w, gridColumns())}`;
  // on a phone the numbers are lines, with no graph: they need less height
  const tall = gridColumns() === 2 && el.dataset.card === "block:stats" ? Math.min(box.h, 2) : box.h;
  el.style.gridRow = free ? `${box.y + 1} / span ${box.h}` : `span ${tall}`;
}

function gridCard(card, free) {
  const box = gridUi.at[tileKey(card)];
  const body = gridBody(card, box);
  if (!body) return null;
  const el = h("div", { class: "pg-card", "data-card": tileKey(card) }, body, gridUi.arranging && ["n", "e", "s", "w", "ne", "se", "sw", "nw"].map((side) => h("span", { class: `pg-side pg-${side}`, "data-side": side })), gridUi.arranging && gridRemovable(card) && h("button", { type: "button", class: "icon-btn pg-remove", title: t("home.removeBlock"), "aria-label": t("home.removeBlock"), onpointerdown: (e) => e.stopPropagation(), onclick: () => askTake(card) }, icon("x")));
  gridPosition(el, box, free);
  if (gridUi.arranging) el.addEventListener("pointerdown", (e) => gridStart(e, card, el));
  el.addEventListener("contextmenu", (e) => {
    if (gridUi.arranging) return e.preventDefault();
    if (card.type !== "block" || !isAdmin() || e.defaultPrevented || e.shiftKey || e.target.closest("a[href]")) return;
    const picked = getSelection();
    if (picked && !picked.isCollapsed && picked.containsNode(e.target, true)) return;
    e.preventDefault();
    menuAt({ x: e.clientX, y: e.clientY }, null, [mayArrange() && { label: t("grid.edit"), icon: "grid", run: gridEdit }, { label: t("home.removeBlock"), icon: "trash", danger: true, run: () => askRemoveCard(card, () => removeBlock(card.id)) }].filter(Boolean));
  });
  return el;
}

/** Moving a card by any part of it, or pulling one of its edges and corners */
function gridStart(e, card, el) {
  // a press on the × is the ×'s own: it asks, it does not move the card
  if (e.button !== 0 || e.target.closest(".pg-remove")) return;
  const grip = e.target.closest(".pg-side");
  const pg = document.getElementById("pg");
  const rect = pg.getBoundingClientRect();
  const gap = 12;
  const cols = state.overview.grid.cols;
  const cell = { w: (rect.width - gap * (cols - 1)) / cols + gap, h: 128 + gap };
  const key = tileKey(card);
  const box = gridUi.at[key];
  const drag = { key, el, kind: cardKind(card), picture: cardPicture(card), side: grip?.dataset.side ?? "", sx: e.clientX, sy: e.clientY, base: structuredClone(gridUi.at), moved: false, rect, cell, grabX: Math.floor((e.clientX - rect.left) / cell.w) - box.x, grabY: Math.floor((e.clientY - rect.top) / cell.h) - box.y };
  gridUi.drag = drag;
  const move = (ev) => ((drag.last = ev), gridMove(ev, drag));
  // near the window's edge the page follows the pointer: a card can be pulled past what is on the screen
  const follow = setInterval(() => {
    if (!drag.last) return;
    const y = drag.last.clientY;
    const by = y > innerHeight - 70 ? 16 : y < 130 ? -16 : 0;
    if (!by) return;
    scrollBy(0, by);
    gridMove(drag.last, drag);
  }, 30);
  const escape = (ev) => ev.key === "Escape" && end(ev);
  const end = (ev) => {
    clearInterval(follow);
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", end);
    removeEventListener("pointercancel", end);
    removeEventListener("keydown", escape);
    gridEnd(drag, ev.type !== "pointerup");
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
  addEventListener("keydown", escape);
  e.preventDefault();
}

function gridMove(e, drag) {
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    drag.moved = true;
    drag.el.classList.add("pg-moving");
  }
  const old = drag.base[drag.key];
  const { cols, limits } = state.overview.grid;
  const [minW, minH, maxW, maxH] = limits[drag.kind] ?? [1, 1, cols, 6];
  let box;
  // the scroll of the page counts: the grid's place is read again
  const top = document.getElementById("pg").getBoundingClientRect().top;
  if (drag.side) {
    // the side pulled follows the pointer; the opposite one stays where it is
    const col = Math.floor((e.clientX - drag.rect.left) / drag.cell.w);
    const row = Math.max(0, Math.floor((e.clientY - top) / drag.cell.h));
    let { x, y, w, h: tall } = old;
    if (drag.side.includes("e")) w = Math.max(minW, Math.min(maxW, cols - old.x, col - old.x + 1));
    if (drag.side.includes("s")) tall = Math.max(minH, Math.min(maxH, row - old.y + 1));
    if (drag.side.includes("w")) {
      const right = old.x + old.w;
      w = Math.max(minW, Math.min(maxW, right, right - Math.max(0, col)));
      x = right - w;
    }
    if (drag.side.includes("n")) {
      const bottom = old.y + old.h;
      tall = Math.max(minH, Math.min(maxH, bottom, bottom - row));
      y = bottom - tall;
    }
    // a camera is never a strip
    if (drag.picture && tall < Math.ceil(w / 3)) {
      const need = Math.ceil(w / 3);
      if (drag.side.includes("n")) y = Math.max(0, y - (need - tall));
      tall = need;
    }
    box = { x, y, w, h: tall };
    gridHint(drag, box);
  } else {
    box = { ...old, x: Math.max(0, Math.min(cols - old.w, Math.floor((e.clientX - drag.rect.left) / drag.cell.w) - drag.grabX)), y: Math.max(0, Math.floor((e.clientY - top) / drag.cell.h) - drag.grabY) };
  }
  gridUi.at = gridPlace(drag.base, drag.key, box);
  for (const el of document.querySelectorAll(".pg-card")) gridPosition(el, gridUi.at[el.dataset.card], true);
}

function gridHint(drag, box) {
  const [minW, minH, maxW, maxH] = state.overview.grid.limits[drag.kind] ?? [1, 1, state.overview.grid.cols, 6];
  let hint = drag.el.querySelector(".pg-hint");
  if (!hint) drag.el.append((hint = h("span", { class: "pg-hint" })));
  hint.textContent = t("grid.hint", { size: `${box.w}×${box.h}`, min: `${minW}×${minH}`, max: `${maxW}×${maxH}` });
}

function gridEnd(drag, cancelled) {
  gridUi.drag = null;
  if (!drag.moved) return;
  if (cancelled) gridUi.at = drag.base;
  else gridUi.undo.push(drag.base);
  paintGrid();
}

window.addEventListener("resize", () => state.route?.view === "home" && paintGrid());

// --- Changing the layout: every change is made on a copy, shown at once and sent to the server ----

const layoutCopy = () => structuredClone(state.overview.dashboard);
const allFolders = (layout) => layout.cards.filter((item) => item.type === "folder");

/** Where a tile is: its list, its place in it and (inside one) the folder */
function locate(layout, key) {
  for (const [index, item] of layout.cards.entries()) {
    if (tileKey(item) === key) return { list: layout.cards, index, folder: null, item };
    if (item.type !== "folder") continue;
    const inner = item.items.findIndex((entry) => tileKey(entry) === key);
    if (inner >= 0) return { list: item.items, index: inner, folder: item, item: item.items[inner] };
  }
  return null;
}

/** Takes a tile out of the layout; a folder left with nothing goes with it */
function takeTile(layout, key) {
  const at = locate(layout, key);
  if (!at) return null;
  at.list.splice(at.index, 1);
  if (at.folder && !at.folder.items.length) layout.cards.splice(layout.cards.indexOf(at.folder), 1);
  return at.item;
}

async function saveLayout(layout) {
  state.overview.dashboard = layout;
  renderHomeBody();
  try {
    await api("PUT", "/api/dashboard", layout);
  } catch (e) {
    toast(errorText(e), "error");
    await refresh();
  }
}

const withoutBox = ({ x: _x, y: _y, w: _w, h: _h, ...item }) => item;

/** Puts a tile into a folder of tiles */
function intoFolder(key, id) {
  const layout = layoutCopy();
  const item = takeTile(layout, key);
  const folder = allFolders(layout).find((f) => f.id === id);
  if (!item || !folder || item.type === "folder" || staysOut(item)) return;
  folder.items.push(withoutBox(item));
  return saveLayout(layout);
}

/** A new folder where the tile stands, with the tile in it */
function makeFolder(key, title = "") {
  const layout = layoutCopy();
  const own = locate(layout, key);
  if (!own || own.folder || own.item.type === "folder" || staysOut(own.item)) return;
  own.list[own.index] = { type: "folder", id: newId(), title, items: [withoutBox(own.item)], ...boxOf(own.item) };
  return saveLayout(layout);
}

/** Takes a tile out of its folder: it takes the first free place */
function outOfFolder(key) {
  const layout = layoutCopy();
  const item = takeTile(layout, key);
  if (item) addCard(layout, item);
  return saveLayout(layout);
}

function changeLayout(change) {
  const layout = layoutCopy();
  if (change(layout) === false) return;
  return saveLayout(layout);
}

/** A link lives only on Home: gone from there, its address is gone */
const removeLinkDialog = (link) =>
  confirmAction({
    title: t("home.removeLinkTitle", { name: link.title || linkHost(link.url) }),
    lead: t("home.removeLinkLead", { url: link.url }),
    label: t("home.removeLink"),
    run: () => changeLayout((layout) => void takeTile(layout, tileKey(link))),
  });

function linkDialog(link) {
  const title = h("input", { value: link?.title ?? "", maxLength: 60, autocomplete: "off" });
  const url = h("input", { type: "url", value: link?.url ?? "", required: true, maxLength: 2000, placeholder: "https://", spellcheck: false, autocomplete: "off" });
  const picture = h("input", { type: "url", value: link?.icon ?? "", maxLength: 2000, placeholder: "https://", spellcheck: false, autocomplete: "off" });
  const error = h("p", { class: "error", role: "alert" });
  const screen = isAdmin() && hasModule("tv") ? h("input", { type: "checkbox", checked: link?.screen === true }) : null;
  const web = (value) => {
    const address = new URL(value.trim());
    if (!["http:", "https:"].includes(address.protocol)) throw new Error("not web");
    return address.href;
  };
  let dialog;
  dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          let made;
          try {
            made = { type: "link", id: link?.id ?? newId(), title: title.value.trim(), url: web(url.value), icon: picture.value.trim() ? web(picture.value) : "", ...((screen ? screen.checked : link?.screen) ? { screen: true } : {}) };
          } catch {
            error.textContent = t("home.badLink");
            return;
          }
          dialog.close();
          await changeLayout((layout) => {
            const at = link && locate(layout, tileKey(link));
            if (at) at.list[at.index] = { ...made, ...(at.folder ? {} : boxOf(at.item)) };
            else addCard(layout, made);
          });
        },
      },
      h("h2", null, t(link ? "home.editLink" : "home.addLink")),
      field(t("home.linkUrl"), url),
      field(t("home.linkTitle"), title, t("home.linkTitleHint")),
      field(t("home.linkIcon"), picture, t("home.linkIconHint")),
      screen && h("label", { class: "check" }, screen, h("span", null, h("strong", null, t("home.linkScreen")), h("span", { class: "muted small block" }, t("home.linkScreenHint")))),
      error,
      h(
        "footer",
        null,
        link && button(t("home.removeLink"), { class: "ghost danger-text", onclick: () => (dialog.close(), removeLinkDialog(link)) }, "trash"),
        closeButton(() => dialog, t("common.cancel")),
        h("button", { class: "btn primary" }, t(link ? "home.saveLink" : "home.add")),
      ),
    ),
  );
  url.focus();
}

const renameFolderDialog = (folder) =>
  nameDialog(t("home.renameFolder"), folder.title || t("home.folder"), t("files.rename"), (title) =>
    changeLayout((layout) => {
      const found = allFolders(layout).find((f) => f.id === folder.id);
      if (!found) return false;
      found.title = title;
    }),
  );

/** The store's tile only moves between folders: with no folder there is nothing to do to it */
const tileHasNoMenu = (item) => item.type === "builtin" && !allFolders(state.overview.dashboard).length;

/** Everything that can be done to a tile */
function tileMenu(item, point = null) {
  if (tileHasNoMenu(item)) return point ? pageMenu(point) : undefined;
  const key = tileKey(item);
  const layout = state.overview.dashboard;
  const at = locate(layout, key);
  if (!at) return;
  let dialog;
  const entry = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    point ? "menu dropdown" : "menu",
    h("header", null, tileIcon(item), h("div", null, h("h2", { class: "clip" }, tileTitle(item)), at.folder && h("span", { class: "muted small" }, at.folder.title || t("home.folder")))),
    item.type === "link" && isAdmin() && hasModule("tv") && entry(t("home.linkOnTv"), "tv", () => void showOnTv(item.url).then((shown) => shown && toast(t("tv.page.sent", { name: tileTitle(item) })))),
    item.type === "link" && entry(t("home.linkNewTab"), "external", () => window.open(item.url, "_blank", "noopener,noreferrer")),
    item.type === "link" && entry(t("home.editLink"), "edit", () => linkDialog(item)),
    item.type === "ha" && entry(t("ha.tile.more"), "sliders", () => haEntityDialog(item.server, tileTarget(item)?.state ?? { id: item.entity, name: item.entity, domain: item.entity.split(".")[0] }, item)),
    item.type === "ha" && tileTarget(item) && entry(t("ha.openThere"), "external", () => window.open(haEntityUrl(tileTarget(item).server, item.entity), "_blank", "noopener")),
    item.type === "folder" && entry(t("common.open"), "folder", () => openFolder(item.id)),
    item.type === "folder" && entry(t("files.rename"), "edit", () => renameFolderDialog(item)),
    at.folder && entry(t("home.outOfFolder"), "signout", () => outOfFolder(key)),
    item.type !== "folder" && !staysOut(item) && allFolders(layout).filter((folder) => folder !== at.folder).map((folder) => entry(t("home.intoFolder", { name: folder.title || t("home.folder") }), "folder", () => intoFolder(key, folder.id))),
    item.type !== "folder" && !staysOut(item) && !at.folder && item.type !== "builtin" && entry(t("home.intoNewFolder"), "plus", () => nameDialog(t("home.newFolder"), "", t("files.create"), (title) => makeFolder(key, title))),
    item.type === "folder" && entry(t("home.ungroup"), "x", () => changeLayout((next) => {
      const { list, index, item: folder } = locate(next, key);
      list.splice(index, 1);
      for (const inner of folder.items) addCard(next, inner);
    })),
    item.type === "link" && entry(t("home.removeLink"), "trash", () => askRemoveCard(item, () => changeLayout((next) => void takeTile(next, key))), "danger"),
    item.type === "ha" && entry(t("ha.offHome"), "trash", () => askRemoveCard(item, () => changeLayout((next) => void takeTile(next, key))), "danger"),
    item.type === "widget" && widgetSpec(item)?.live && entry(t(item.live ? "service.showPicture" : "service.showLive"), item.live ? "image" : "play", () => changeLayout((next) => {
      const found = locate(next, key);
      if (!found) return false;
      if (item.live) delete found.item.live;
      else found.item.live = true;
    })),
    item.type === "widget" && entry(t("ha.offHome"), "trash", () => askRemoveCard(item, () => changeLayout((next) => void takeTile(next, key))), "danger"),
    item.type === "files" && entry(t("files.unpin"), "home", () => askRemoveCard(item, () => pinFolder(item.path, false))),
  );
  if (point) placeAt(dialog, point);
}

/** What can be put on Home, by sections, with a search over all of them */
const addUi = { section: "machines", find: "" };

function addSections() {
  const o = state.overview;
  const layout = () => o.dashboard;
  const on = (key) => !!locate(state.overview.dashboard, key);
  /** A row of what stands on Home or not; `found` — its card when there is one */
  const card = (title, sub, lead, item, found = () => (on(tileKey(item)) ? tileKey(item) : null)) => ({
    title,
    sub,
    lead,
    placed: found,
    add: () => changeLayout((next) => addCard(next, item)),
    remove: () => changeLayout((next) => void takeTile(next, found())),
  });
  const action = (title, sub, lead, label, run) => ({ title, sub, lead, label, run });
  const block = (id, sub) => card(blockTitle(id), sub, icon(BLOCKS[id]), { type: "block", id });
  const widgetRow = (title, sub, lead, item) => card(title, sub, lead, { ...item, id: newId() }, () => {
    const there = layout().cards.find((c) => c.type === "widget" && c.source === item.source && c.server === item.server && c.view === item.view && c.row === item.row);
    return there ? tileKey(there) : null;
  });
  const pinned = () => (o.folders ?? []).map((folder) => folder.path);
  const dot = (cls) => h("i", { class: "dot " + cls });
  return [
    { id: "apps", icon: "grid", rows: [action(t("home.addApp"), t("home.addAppHint"), icon("store"), t("common.open"), () => go("#/store")), o.importable > 0 && action(t("home.import"), t("home.importHint", { n: o.importable }), icon("download"), t("common.open"), () => go("#/import"))].filter(Boolean) },
    {
      id: "links",
      icon: "link",
      rows: [
        action(t("home.addLinkItem"), t("home.addLinkHint"), icon("link"), t("home.add"), () => linkDialog()),
        action(t("home.addDisk"), t("home.addDiskHint"), icon("disk"), t("home.add"), () => diskPickDialog(pinned())),
        action(t("home.addFolder"), t("home.addFolderHint"), icon("folder"), t("home.add"), () => folderPicker({ title: t("home.addFolderTitle"), start: "", confirmLabel: t("home.addFolderHere"), allowed: (path) => !pinned().includes(path), action: (path) => pinFolder(path, true, false) })),
        ...layout().cards.filter((c) => c.type === "link").map((c) => card(tileTitle(c), linkHost(c.url), icon("link"), c)),
      ],
    },
    {
      id: "machines",
      icon: "server",
      group: "state",
      rows: [
        { ...block("stats", o.system?.hostname ?? t("home.thisServer")), title: t("home.thisServer"), lead: dot("running") },
        ...(o.machines ?? []).map((m) => card(m.name, [m.os, m.online ? t("machines.online") : t("machines.offline")].filter(Boolean).join(" · "), dot(m.online ? "running" : "stopped"), { type: "block", id: "machine:" + m.id })),
      ],
    },
    { id: "overview", icon: "list", group: "state", rows: [block("attention", t("add.attentionHint")), block("activity", t("add.activityHint")), o.adblock && block("adblock", t("add.adblockHint")), isAdmin() && hasModule("tv") && block("tv", t("add.tvHint"))].filter(Boolean) },
    (o.ha?.servers ?? []).length > 0 && { id: "ha", icon: "home", group: "integrations", rows: [action(t("ha.pick.item"), t("ha.pick.hint"), icon("bulb"), t("add.choose"), () => haPickDialog())] },
    // every connected service, with the widgets its description has: one card for the whole, or one per row
    ...svcConnections().map((x) => {
      const spec = svcSpecNow(x.kind);
      const rows = Object.entries(spec?.widgets ?? {}).flatMap(([view, w]) =>
        w.kind === "picture"
          ? (x.lists[w.of] ?? []).map((row) => widgetRow(String(row[w.caption] ?? ""), `${x.name} · ${svcText(w.label)}`, icon(x.icon), { type: "widget", source: "x", server: x.id, view, row: svcKey(spec, w.of, row) }))
          : [widgetRow(w.kind === "summary" ? x.name : svcText(w.label), w.kind === "summary" ? svcText(w.label) : x.name, icon(x.icon), { type: "widget", source: "x", server: x.id, view })],
      );
      return rows.length > 0 && { id: `x-${x.id}`, label: x.name, icon: x.icon, group: "integrations", rows };
    }),
  ].filter(Boolean);
}

/** `closed(ran)` is told when the window goes: `ran` — a row that opens a window of its own was pressed */
function addDialog(closed) {
  let dialog;
  let ran = false;
  const nav = h("nav", { class: "cats fold add-nav" });
  const main = h("div", { class: "add-main" });
  const row = (one) => {
    const there = one.placed?.();
    return h(
      "div",
      { class: "add-row" },
      h("span", { class: "add-lead" }, one.lead),
      h("span", { class: "add-text" }, h("strong", { class: "clip" }, one.title), h("span", { class: "muted small clip" }, one.sub)),
      one.placed
        ? h("span", { class: "add-do" }, there && h("span", { class: "muted small add-on" }, icon("check", "ok"), t("add.onHome")), button(t(there ? "add.remove" : "home.add"), { class: "small", onclick: async () => (await (there ? one.remove() : one.add()), paint()) }, there ? null : "plus"))
        : h("span", { class: "add-do" }, button(one.label, { class: "small", onclick: () => ((ran = true), dialog.close(), one.run()) })),
    );
  };
  const counted = (section) => {
    const rows = section.rows.filter((one) => one.placed);
    return rows.length ? t("add.count", { n: rows.filter((one) => one.placed()).length, total: rows.length }) : "";
  };
  const paint = () => {
    const sections = addSections();
    if (!sections.some((one) => one.id === addUi.section)) addUi.section = "machines";
    const entry = (section) => h("button", { type: "button", class: "cat" + (section.id === addUi.section && !addUi.find ? " active" : ""), onclick: () => ((addUi.section = section.id), (addUi.find = ""), (field.value = ""), paint()) }, h("span", { class: "add-cat" }, icon(section.icon), section.label ?? t("add.section." + section.id)), h("span", { class: "muted small" }, counted(section)));
    const titled = (group) => [group && h("div", { class: "cat-title" }, t("add.group." + group)), sections.filter((one) => (one.group ?? "") === group).map(entry)];
    put(nav, titled(""), titled("state"), titled("integrations"), h("a", { class: "cat", href: storeKinds().length > 0 ? "#/store" : "#/house", onclick: () => ((state.storeFilter = { query: "", category: storeKinds().length > 0 ? "@" : "" }), dialog.close()) }, h("span", { class: "add-cat" }, icon("plus"), t("add.connect"))));
    const typed = addUi.find.trim().toLowerCase();
    if (typed) {
      const found = sections.flatMap((section) => section.rows.filter((one) => `${one.title} ${one.sub}`.toLowerCase().includes(typed)));
      return put(main, found.length ? found.map(row) : h("p", { class: "muted add-none" }, t("add.none", { text: addUi.find.trim() })));
    }
    const section = sections.find((one) => one.id === addUi.section);
    put(main, h("div", { class: "add-head" }, h("h3", null, section.label ?? t("add.section." + section.id)), h("p", { class: "muted small" }, section.label ? t("add.lead.service") : t("add.lead." + section.id))), section.rows.map(row));
  };
  const field = h("input", { type: "search", placeholder: t("add.find"), "aria-label": t("add.find"), value: addUi.find, autocomplete: "off", oninput: () => ((addUi.find = field.value), paint()) });
  dialog = openDialog("xwide add-dialog", h("header", null, h("h2", { class: "grow" }, t("home.addTitle")), closeX(() => dialog)), h("label", { class: "add-find" }, icon("search"), field), h("div", { class: "add-body" }, nav, main));
  if (closed) dialog.addEventListener("close", () => closed(ran));
  paint();
  field.focus();
}

/** The disks and network places of the server, to put one on the dashboard: its tile says how full it is */
async function diskPickDialog(pinned) {
  let disks;
  try {
    disks = (await api("GET", "/api/files?path=")).disks ?? [];
  } catch (e) {
    return toast(errorText(e), "error");
  }
  let dialog;
  const row = (d) => {
    const on = pinned.includes(d.path);
    return h(
      "button",
      { type: "button", class: "menu-item disk-pick", disabled: on, onclick: async () => {
        dialog.close();
        await pinFolder(d.path, true, true, volumeName(d));
      } },
      h("span", { class: "app-icon plus" }, icon(d.network ? "globe" : "disk")),
      h("span", { class: "tile-text" }, h("span", { class: "tile-name" }, volumeName(d)), on ? h("span", { class: "muted small" }, t("home.diskThere")) : d.total ? diskRoom(d) : h("span", { class: "muted small mono" }, d.path)),
    );
  };
  dialog = openDialog(
    "menu",
    h("header", null, h("h2", null, t("home.addDiskTitle"))),
    disks.length ? disks.map(row) : h("p", { class: "muted" }, t("home.noDisks")),
    h("footer", null, closeButton(() => dialog)),
  );
}

// --- A folder of tiles, opened ----------------------------------------------------------------------

function openFolder(id) {
  if (homeUi.folder) return;
  const body = h("div", { class: "tiles", "data-folder": id });
  const head = h("h2", { class: "clip grow" });
  const rename = h("button", { type: "button", class: "icon-btn", title: t("files.rename"), "aria-label": t("files.rename"), onclick: () => renameFolderDialog(homeUi.folder.item) }, icon("edit"));
  const dialog = openDialog("wide tile-folder", h("header", null, head, rename, closeX(() => dialog)), body);
  dialog.addEventListener("close", () => (homeUi.folder = null));
  // a tile that leads somewhere takes the folder off the screen
  body.addEventListener("click", (e) => e.target.closest("a") && dialog.close());
  homeUi.folder = { id, dialog, body, head, rename, item: null };
  renderFolder();
}

function renderFolder() {
  const open = homeUi.folder;
  if (!open) return;
  const item = allFolders(state.overview.dashboard).find((folder) => folder.id === open.id);
  const tiles = item?.items.map(tile).filter(Boolean) ?? [];
  if (!tiles.length) return open.dialog.close();
  open.item = item;
  open.head.textContent = item.title || t("home.folder");
  open.rename.hidden = !isAdmin();
  open.body.replaceChildren(...tiles);
}

const ATTENTION_ICONS = { update: "up", docker: "box", restarting: "refresh", partial: "alert", disk: "disk", smart: "disk", memory: "memory", temperature: "temp", internet: "network", network: "network", array: "disk", share: "share", netplace: "globe", machine: "server", pve: "server", ha: "home", containers: "box", absent: "disk" };

/** The title and the words of an item of the list, sizes said as sizes */
function attentionWords(item) {
  const detail = { ...item.detail, free: item.detail.free == null ? "" : bytes(item.detail.free), trash: item.detail.trash == null ? "" : bytes(item.detail.trash), size: item.detail.size == null ? "" : bytes(item.detail.size) };
  if (item.code === "load.cpu" && LOAD_NAMED.includes(item.detail.kind)) detail.name = t("load.kind." + item.detail.kind);
  if (item.code === "load.cpu" && item.detail.kind === "sessions") detail.name = t("load.sessionsOf", { user: item.detail.name });
  if (item.code === "load.cpu" && item.detail.kind === "service" && LOAD_UNITS[item.detail.name]) detail.name = t(LOAD_UNITS[item.detail.name]);
  const base = "attention." + item.code;
  // an item of a kind this version no longer has (kept hidden from an older one): its own words, never a key
  if (!has(base + ".title")) return { title: String(detail.title || detail.name || detail.kind || item.code), text: String(detail.text ?? "") };
  return { title: t(base + ".title", detail), text: t(base + ".text", detail).trim() };
}

const attentionIcon = (code) => ATTENTION_ICONS[code.split(".")[0]] ?? "alert";

/** Asks before something that cannot be taken back by a click, does it, says a refusal in the window and looks again */
function confirmAction({ title, lead, label, run, kind = "danger", iconName = "trash" }) {
  let dialog;
  const error = h("p", { class: "error", role: "alert" });
  const go = button(label, {
    class: kind,
    onclick: async () => {
      go.disabled = true;
      error.textContent = "";
      // it may take a while: the button turns, so the wait is seen to be one
      const mark = go.querySelector(".ico");
      const turning = icon("refresh", "spin");
      mark?.replaceWith(turning);
      try {
        await run();
        dialog.close();
        void refresh();
      } catch (err) {
        error.textContent = errorText(err);
        go.disabled = false;
        if (mark) turning.replaceWith(mark);
      }
    },
  }, iconName);
  dialog = openDialog("confirm", h("h2", { class: "wrap" }, title), lead && h("p", { class: "muted" }, lead), error, h("footer", null, closeButton(() => dialog, t("common.cancel")), go));
}

function attentionItem(item) {
  const { title, text } = attentionWords(item);
  // only what does the thing is a button; the ways elsewhere and the rest are entries of its menu
  const open = (href, label = t("common.open")) => ({ href, label, icon: "external" });
  // the button that does the thing itself: it waits for the answer, says a refusal and looks again
  const doIt = (label, iconName, work) =>
    isAdmin() &&
    button(label, {
      class: "small",
      onclick: async (e) => {
        const el = e.currentTarget;
        el.disabled = true;
        try {
          await work(el);
        } catch (err) {
          toast(errorText(err), "error");
        }
        el.disabled = false;
        void refresh();
      },
    }, iconName);
  const app = item.app && { name: item.app, title: item.detail.title || item.app };
  const onMachine = { name: item.detail.name, title: item.detail.title };
  const away = { id: item.detail.id, name: item.detail.name, pve: item.detail.pveHost ? { host: item.detail.pveHost, id: item.detail.pveGuest, status: item.detail.pveStatus } : null };
  const runArray = (path, data = {}) => api("POST", "/api/disks/array" + path, data);
  // every button sits under the words, the one that does the thing first: beside them it leaves the words a narrow column
  const below = [
    item.code === "update" && doIt(t("update.install", { version: item.detail.version }), "up", async () => {
      await api("POST", "/api/update/install", {});
      void followUpdate(item.detail.version);
    }),
    (item.code === "restarting" || item.code === "partial") && app && doIt(t("app.restart"), "refresh", () => startAction(app, "restart")),
    (item.code === "failed.start" || item.code === "failed.update" || item.code === "failed.backup") && app && doIt(t("attention.retry"), "refresh", () => startAction(app, item.code.slice(7))),
    (item.code === "machine.restarting" || item.code === "machine.partial") && item.detail.name && doIt(t("app.restart"), "refresh", async () => {
      const res = await api("POST", `/api/machines/${item.detail.id}/apps/${onMachine.name}/restart`, {});
      jobDialog(res.job, "restart", onMachine.title);
    }),
    item.code === "machine.away" && away.pve && doIt(t("pve.startHere", { host: item.detail.pveName }), "play", (el) => startGuestOf(away, el)),
    item.code === "machine.away" && item.detail.wake === "lan" && doIt(t("machines.wake"), "play", (el) => wakeMachine(away, el)),
    item.code === "pve.guestDown" && item.detail.guestId && doIt(t("pve.start"), "play", async () => {
      const r = await api("POST", `/api/proxmox/${item.detail.host}/guests/${item.detail.guestId}/power`, { action: "start" });
      toast(t(r.done ? "pve.done.start" : "pve.going", { name: item.detail.guest }));
    }),
    item.code === "containers.down" && doIt(t("incus.start"), "play", () => api("POST", `/api/containers/${item.detail.name}/state`, { action: "start" })),
    item.code === "netplace.down" && item.detail.id && doIt(t("attention.reconnect"), "refresh", () => api("POST", `/api/netplaces/${item.detail.id}/retry`, {})),
    item.code === "share.stopped" && doIt(t("attention.startSamba"), "play", () => api("POST", "/api/shares/tool", {})),
    item.code === "offsite" && doIt(t("attention.retry"), "refresh", async () => (await api("POST", "/api/backups/offsite/sync", {}), toast(t("attention.started")))),
    item.code === "array.errors" && doIt(t("array.repair"), "refresh", () => runArray("/repair")),
    item.code === "array.parityLost" && doIt(t("array.rebuild"), "refresh", () => runArray("/rebuild")),
    item.code === "array.held" && doIt(t("array.bringBack"), "refresh", () => runArray("/fix")),
    item.code === "array.failed" && doIt(t("array.syncNow"), "refresh", () => runArray("/sync")),
    item.code === "docker.missing" && isAdmin() && button(t("docker.install"), { class: "small", onclick: () => dockerDialog() }, "download"),
    item.code === "docker.stopped" && isAdmin() && dockerStartButton("small"),
    item.code === "disk.usb" && isAdmin() && button(t("copyin.button"), { class: "small", onclick: () => ((state.copyInFrom = item.detail.id), go("#/settings/storage")) }, "download"),
    (item.code === "disk.new" || item.code.startsWith("absent")) && isAdmin() && open("#/settings/storage", t("attention.disk.open")),
    item.code === "update" && open("#/settings/about"),
    item.code === "system.security" && isAdmin() && button(t("attention.system.security.go"), { class: "small", onclick: () => go("#/machines/this/system") }, "up"),
    item.code === "system.reboot" && isAdmin() && button(t("power.reboot"), { class: "small", onclick: () => serverPowerDialog("reboot") }, "refresh"),
    item.code === "disk.trash" && open("#/trash", t("trash.title")),
    (item.code === "raid.errors" || item.code === "raid.mismatch") && doIt(t("raid.check"), "refresh", () => api("POST", "/api/disks/raid/check", { id: item.detail.id, action: "check" })),
    (item.code.startsWith("array.") || item.code.startsWith("raid.")) && open("#/storage/raid"),
    (item.code.startsWith("smart.") || item.code === "disk.filling") && open("#/settings/storage"),
    (item.code.startsWith("internet.") || item.code === "network.exposed") && open("#/settings/network"),
    item.code.startsWith("share.") && open("#/settings/shares"),
    item.code.startsWith("dns.block") && open("#/settings/adblock"),
    item.code.startsWith("dns.") && !item.code.startsWith("dns.block") && open("#/settings/dns"),
    item.code.startsWith("https.") && open("#/settings/https"),
    item.code === "netplace.down" && open("#/settings/places"),
    item.code === "machine.away" && open(`#/machines/${item.detail.id}`),
    item.code.startsWith("containers.") && state.route.view !== "containers" && open("#/containers"),
    item.code.startsWith("ha.") && !(state.route.view === "ha" && state.route.id === item.detail.host) && open(`#/ha/${item.detail.host}`),
    item.code.startsWith("integration.") && !(state.route.view === "service" && state.route.id === item.detail.host) && open(`#/service/${item.detail.host}`),
    item.code.startsWith("pve.") && state.route.view !== "proxmox" && open(`#/proxmox/${item.detail.host}${item.code === "pve.guestDown" ? "/guests" : item.code === "pve.backupFailed" ? "/tasks" : ""}`),
    (item.code === "machine.restarting" || item.code === "machine.partial") && open(`#/machines/${item.detail.id}/apps`),
    item.app && open(`#/apps/${item.app}${item.code === "restarting" || item.code === "partial" ? "/logs" : ""}`, t(item.code === "restarting" || item.code === "partial" ? "app.logs" : "common.open")),
    // the assistant is asked with the item's own words: it looks with its tools where it can and explains the rest
    // what ends the thing the item is about, asked first: the menu, not a button, so it is not pressed by the way
    ...(isAdmin() ? attentionEnds(item, app, onMachine) : []),
    isAdmin() && { label: t(item.app ? "assistant.askWhy" : "assistant.ask"), icon: "chat", run: () => openAssistant({ ask: item.app ? t("assistant.whyDown", { title: item.detail.title || item.app, app: item.app }) : t("assistant.whyItem", { title, text }) }) },
    isAdmin() && { label: t("attention.later", { n: SNOOZE_DAYS }), icon: "clock", run: () => snoozeItem(item) },
    isAdmin() && { label: t("attention.once"), icon: "x", run: () => snoozeItem(item, "once") },
    isAdmin() && { label: t("attention.never"), icon: "bell-off", run: () => snoozeItem(item, true) },
    (item.code === "disk.new" || item.code === "disk.usb") && isAdmin() && { label: t("mounting.ignore"), icon: "x", run: () => void api("POST", "/api/disks/ignore", { id: item.detail.id }).then(refresh, (e) => toast(errorText(e), "error")) },
  ].filter(Boolean);
  // one action at hand — what does the thing, else the first way to it; the rest in "⋯" (the design system's rule)
  const header = menuHeader(title, null, attentionIcon(item.code));
  const nodes = below.filter((x) => x instanceof Node);
  const entries = below.filter((x) => !(x instanceof Node));
  const way = !nodes.length && entries.find((x) => x.href);
  const action = nodes[0] ?? (way ? h("a", { class: "btn small", href: way.href }, icon(way.icon ?? "external"), h("span", null, way.label)) : null);
  const rest = [...nodes.slice(1).map((b) => ({ label: b.textContent, icon: "next", run: () => b.click() })), ...entries.filter((x) => x !== way)];
  const openMore = rest.length ? (at) => menuAt(at, header, rest) : undefined;
  const row = uiRow({ lead: { icon: attentionIcon(item.code), tone: { warn: "warn", danger: "bad", info: "info" }[item.severity] ?? null }, name: title, sub: text, action, more: rest.length ? rest : null, menu: openMore, cls: "attention-item " + item.severity });
  // on a phone the button does not fit beside the words: the row itself is pressed
  row.addEventListener("click", (e) => {
    if (!phone.matches || e.target.closest("a, button")) return;
    if (action) action.click();
    else openMore?.({ x: e.clientX, y: e.clientY });
  });
  return row;
}

/**
 * The buttons of an item, all in one look: what does the thing (elements), then the rest (menu entries) under an
 * arrow joined to the first button, so the rest is seen to be there; with nothing to do right here, the first way
 * elsewhere is the button. Gives the buttons and what opens the rest (also the item's right click).
 */
function splitActions(entries, header) {
  const main = entries.filter((x) => x instanceof Node);
  const more = entries.filter((x) => x && !(x instanceof Node));
  const way = !main.length && more.find((x) => x.href);
  if (way) main.push(h("a", { class: "btn small", href: way.href }, icon(way.icon ?? "external"), way.label));
  const rest = more.filter((x) => x !== way);
  if (!rest.length) return { buttons: main, openMore: undefined };
  const openMore = (at) => menuAt(at, header, rest);
  const opener = (e) => {
    const r = e.currentTarget.closest(".split").getBoundingClientRect();
    openMore({ x: r.left, y: r.bottom + 4 });
  };
  const first = main[0];
  if (first) main[0] = h("span", { class: "split" }, first, button("", { class: "small split-more", title: t("attention.more"), "aria-label": t("attention.more"), "aria-haspopup": "menu", onclick: opener }, "down"));
  else main.push(h("span", { class: "split" }, button(t("attention.more"), { class: "small split-more", "aria-haspopup": "menu", onclick: opener }, "down")));
  return { buttons: main, openMore };
}

/**
 * A window's or a row's actions: one button for the main thing and the rest (menu entries) under an arrow joined to
 * it — several buttons side by side wrap into a heap. Without a main thing the arrow's button says "More".
 */
function oneAndMore(first, rest, kind = "") {
  const entries = rest.filter(Boolean);
  if (!entries.length) return first;
  const opener = (e) => {
    // a row that opens something on a click must not take this one for its own
    e.stopPropagation();
    const r = e.currentTarget.closest(".split").getBoundingClientRect();
    menuAt({ x: r.left, y: r.bottom + 4 }, null, entries);
  };
  return h("span", { class: "split" }, first, button(first ? "" : t("attention.more"), { class: kind + " split-more", title: t("attention.more"), "aria-label": t("attention.more"), "aria-haspopup": "menu", onclick: opener }, "down"));
}

/**
 * The buttons of a row or a card as they were written, laid out by the same rule: up to two stay as they are; of
 * three or more the main one (the primary, else the first) stays and the others go under its arrow, each doing what
 * its button does. What is not a button (a chip, a note) stays beside.
 */
function foldActions(items, kind = "") {
  const all = items.flat().filter(Boolean);
  const pressable = (x) => x instanceof Element && x.matches("button.btn, a.btn");
  const buttons = all.filter(pressable);
  if (buttons.length < 3) return all;
  const main = buttons.find((b) => b.classList.contains("primary")) ?? buttons[0];
  const entries = buttons
    .filter((b) => b !== main)
    .map((b) => ({ label: b.textContent.trim() || b.title || b.getAttribute("aria-label") || "", iconEl: b.querySelector("svg")?.cloneNode(true) ?? h("span", { class: "ico" }), danger: b.classList.contains("danger"), off: b.disabled, ...(b.tagName === "A" ? { href: b.getAttribute("href"), newTab: b.target === "_blank" } : { run: () => b.click() }) }));
  const joined = oneAndMore(main, entries, [kind, main.classList.contains("small") ? "small" : "", main.classList.contains("primary") ? "primary" : ""].join(" "));
  return [joined, ...all.filter((x) => !pressable(x))];
}

/**
 * What puts an end to the thing an item is about rather than mending it: a shared folder that is gone stops being
 * shared, a machine that is gone is removed, a disk that is gone is let go, an app that keeps failing is stopped
 */
function attentionEnds(item, app, onMachine) {
  const d = item.detail;
  const ask = (label, iconName, confirm) => ({ label, icon: iconName, run: () => confirmAction({ label, iconName, ...confirm }) });
  return [
    item.code === "share.missing" && d.name && ask(t("shares.stop"), "x", { title: t("attention.end.share", { name: d.name }), lead: t("attention.end.shareLead", { path: d.path }), run: () => api("DELETE", `/api/shares/${encodeURIComponent(d.name)}`) }),
    item.code === "machine.away" && d.id && { label: t("machines.remove") + "…", icon: "trash", run: () => removeMachineDialog({ id: d.id, name: d.name, online: false }, refresh) },
    item.code === "netplace.down" && d.id && ask(t("netplace.remove"), "trash", { title: t("netplace.removeTitle", { name: d.name }), lead: t("netplace.removeLead", { path: d.path }), run: () => api("DELETE", `/api/netplaces/${d.id}`) }),
    item.code === "absent" && d.path && ask(t("mounting.disconnect"), "x", { title: t("mounting.disconnectTitle", { path: d.path }), lead: t("attention.end.absentLead"), run: () => api("POST", "/api/disks/disconnect", { path: d.path }) }),
    (item.code === "restarting" || item.code === "partial") && app && { label: t("app.stop"), icon: "stop", run: () => startAction(app, "stop") },
    (item.code === "machine.restarting" || item.code === "machine.partial") && d.name && {
      label: t("app.stop"),
      icon: "stop",
      run: async () => {
        try {
          const res = await api("POST", `/api/machines/${d.id}/apps/${onMachine.name}/stop`, {});
          jobDialog(res.job, "stop", onMachine.title);
        } catch (err) {
          toast(errorText(err), "error");
        }
      },
    },
    item.code === "network.exposed" && d.nic && ask(t("attention.end.outside"), "lock", { kind: "primary", title: t("attention.end.outsideTitle", { nic: d.nic }), lead: t("attention.end.outsideLead", { address: d.address }), run: () => api("PUT", `/api/network/${encodeURIComponent(d.nic)}/side`, { side: "outside" }) }),
  ].filter(Boolean);
}

/** How long "remind me later" puts an item off; it comes back sooner if it gets worse */
const SNOOZE_DAYS = 3;

/** Puts an item off for some days or for good; it keeps its words, so the list of what is hidden can say it */
async function snoozeItem(item, forever = false) {
  try {
    await api("POST", "/api/attention/snooze", { id: item.id, severity: item.severity, ...(item.at ? { at: item.at } : {}), ...(forever === "once" ? { once: true } : forever ? { forever: true } : { days: SNOOZE_DAYS }), code: item.code, detail: item.detail, ...(item.app ? { app: item.app } : {}) });
    toast(forever === "once" ? t("attention.onceDone") : forever ? t("attention.neverDone") : t("attention.snoozed", { date: shortDate(Date.now() + SNOOZE_DAYS * 86_400_000) }));
    await refresh();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function dockerStartButton(cls = "small primary") {
  return button(t("docker.start"), {
    class: cls,
    onclick: async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      try {
        await api("POST", "/api/docker/start", {});
        toast(t("docker.started"));
      } catch (err) {
        toast(errorText(err), "error");
      }
      void refresh();
    },
  });
}

/** Docker is what the apps run in: what it is, the command that installs it, and the button */
async function dockerDialog() {
  const info = await api("GET", "/api/docker").catch(() => ({ install: "" }));
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("docker.title")), closeX(() => dialog)),
    h("p", null, t("docker.what")),
    h("p", { class: "muted small" }, t("docker.why")),
    h("p", { class: "cmd" }, icon("terminal"), info.install),
    h("p", { class: "muted small" }, t("docker.how")),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("docker.install"), {
        class: "primary",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            const res = await api("POST", "/api/docker/install", {});
            dialog.close();
            jobDialog(res.job, "docker", "", () => void refresh());
          } catch (err) {
            error.textContent = errorText(err);
            el.disabled = false;
          }
        },
      }, "download"),
    ),
  );
}

const ACTIVITY_ICONS = { rename: "edit", move: "arrow", copy: "copy", delete: "trash", deleteForever: "trash", purge: "trash", extract: "archive", terminal: "terminal", install: "download", update: "up", start: "play", stop: "stop", restart: "refresh", remove: "trash", apply: "code", backup: "archive", restore: "undo", snapshot: "trash", import: "download", packages: "up" };

function activityItem(entry, when) {
  const [group, kind, outcome] = entry.code.split(".");
  const failed = outcome === "failed";
  const key = "activity." + entry.code;
  const title = state.overview?.apps.find((a) => a.name === entry.app)?.title ?? entry.app ?? "";
  const by = entry.user && group !== "auth" ? (entry.user === "schedule" ? t("activity.bySchedule") : entry.user === "restore" ? t("activity.byRestore") : entry.user === "console" ? t("activity.byConsole") : entry.user === "disk" ? t("activity.byDisk") : entry.user.startsWith("agent:") ? t("activity.byAgent", { name: entry.user.slice(6) }) : entry.user.startsWith("assistant:") ? t("activity.byAssistant", { user: entry.user.slice(10) }) : t("activity.by", { user: entry.user })) : null;
  const sub = [entry.machine && t("activity.onMachine", { name: entry.machine }), by, group === "auth" ? entry.detail : null, failed ? entry.detail : null].filter(Boolean).join(" · ");
  return uiRow({
    mode: "event",
    lead: { icon: group === "auth" ? "signin" : group === "users" ? "user" : failed ? "x" : (ACTIVITY_ICONS[kind] ?? "check"), tone: failed ? "bad" : null },
    name: has(key) ? t(key, { app: title, user: entry.user ?? "", target: group === "modules" && entry.detail ? moduleName(entry.detail) : (entry.detail ?? "") }) : entry.code,
    sub: sub || null,
    time: typeof when === "string" ? when : ago(entry.ts),
    action: entry.code === "app.update.done" && !entry.machine && isAdmin() && Date.now() - entry.ts < UNDO_DAYS * 86400_000 ? button(t("activity.undo"), { class: "small", onclick: () => undoUpdate(entry) }, "undo") : null,
  });
}

/** How long after an update its "Undo" is offered: pre-update snapshots are few and get replaced */
const UNDO_DAYS = 7;

/** An update undone: the snapshot taken right before it, restored the usual way */
async function undoUpdate(entry) {
  let overview;
  try {
    overview = await api("GET", `/api/backups?lang=${state.lang}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const app = overview.apps.find((a) => a.name === entry.app);
  // the snapshot is taken inside the update job, so within the minutes before it was done
  const before = (app?.snapshots ?? []).filter((s) => s.reason === "pre-update" && s.at <= entry.ts && entry.ts - s.at < 3 * 3600_000).sort((a, b) => b.at - a.at)[0];
  if (!before) return toast(t("activity.undoNone"), "error");
  restoreDialog(app, before);
}
