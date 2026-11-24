// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Home Assistant ---
// Connected through its API: the servers under the machines, a page of each, its entities as tiles on Home

/** A house has hundreds of things: a room shows this many until asked */
const HA_ROOM_ROWS = 8;
const haUi = { opened: new Set(), folded: new Set(), list: null, server: null, entities: null, search: "", extra: false, timer: null, users: null };

const HA_ICONS = { light: "bulb", switch: "power", input_boolean: "power", fan: "fan", cover: "blinds", valve: "droplet", lock: "lock", climate: "temp", water_heater: "temp", media_player: "speaker", vacuum: "home", scene: "play", script: "play", button: "play", input_button: "play", automation: "refresh", siren: "bell", humidifier: "droplet", camera: "image", weather: "sun", sun: "sun", person: "user", device_tracker: "user", update: "up", alarm_control_panel: "lock", remote: "network" };
const HA_KIND_ICONS = { temperature: "temp", humidity: "droplet", moisture: "droplet", battery: "battery", power: "bolt", energy: "bolt", voltage: "bolt", current: "bolt", door: "door", window: "door", opening: "door", garage_door: "door", garage: "door", motion: "user", occupancy: "user", presence: "user", illuminance: "sun", light: "sun", smoke: "alert", gas: "alert", problem: "alert", safety: "alert", connectivity: "network", plug: "power", outlet: "power", timestamp: "clock" };
const haIcon = (s) => HA_KIND_ICONS[s?.kind] ?? HA_ICONS[s?.domain] ?? "chart";
/** Binary sensors whose "on" and "off" have words of their own */
const HA_BINARY = ["door", "window", "opening", "garage_door", "motion", "occupancy", "presence", "moisture", "smoke", "gas", "battery", "connectivity", "lock", "plug", "problem", "safety", "sound", "vibration", "light", "power", "running", "tamper", "cold", "heat"];
/** States in which a tile is lit */
const HA_LIT = new Set(["on", "open", "opening", "unlocked", "playing", "cleaning"]);

/** A sensor's number, shortened: 15.62 → 15.6; null — not a number */
function haNumber(text) {
  const n = Number(text);
  if (text === "" || text == null || !Number.isFinite(n)) return null;
  return n.toLocaleString(state.lang, { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2 });
}
const haWord = (st) => (has("ha.state." + st) ? t("ha.state." + st) : st);

function haStateText(s) {
  if (!s) return t("ha.tile.missing");
  if (s.state === "unavailable" || s.state === "unknown") return t("ha.state." + s.state);
  if (s.domain === "binary_sensor") return HA_BINARY.includes(s.kind) ? t(`ha.binary.${s.kind}.${s.state}`) : haWord(s.state);
  if (s.domain === "climate") return [s.current != null && `${haNumber(s.current)}°`, s.target != null && t("ha.climate.target", { t: haNumber(s.target) }), haWord(s.state)].filter(Boolean).join(" · ");
  if (s.domain === "light" && s.state === "on" && s.brightness != null) return t("ha.light.on", { n: s.brightness });
  if (s.kind === "timestamp" && !Number.isNaN(Date.parse(s.state))) return new Date(s.state).toLocaleString(state.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const n = haNumber(s.state);
  if (n != null) return s.unit ? `${n} ${s.unit}` : n;
  return haWord(s.state);
}

/** The state a tile shows large: a light's brightness, a thermostat's temperature; "" — none */
function haBigText(s) {
  if (s.state === "unavailable" || s.state === "unknown") return "";
  if (s.domain === "light" && s.state === "on" && s.brightness != null) return `${s.brightness}%`;
  if (s.domain === "climate" && s.current != null) return `${haNumber(s.current)}°`;
  return "";
}

/** The line under the name when the state is shown large */
function haSubText(s) {
  if (s.domain === "climate") return [s.target != null && t("ha.climate.target", { t: haNumber(s.target) }), haWord(s.state)].filter(Boolean).join(" · ");
  return haWord(s.state);
}

const haLit = (s) => !!s && (s.domain === "binary_sensor" || s.domain === "sensor" ? false : HA_LIT.has(s.state) || (s.domain === "climate" && s.state !== "off"));
const haGone = (s) => !s || s.state === "unavailable";

/** What one press on the tile does; null — nothing (a sensor), or the controls dialog */
function haPrimary(s) {
  if (haGone(s)) return null;
  const a = s.actions;
  if (a.includes("toggle")) return { action: "toggle" };
  if (a.includes("run")) return { action: "run" };
  if (a.includes("press")) return { action: "press" };
  // a door is not unlocked by a slip of the finger: that one asks
  if (s.domain === "lock") return { action: s.state === "locked" ? "unlock" : "lock", ask: s.state === "locked" };
  if (s.domain === "cover" || s.domain === "valve") {
    const open = s.state === "open" || s.state === "opening";
    return open ? (a.includes("close") ? { action: "close" } : null) : a.includes("open") ? { action: "open" } : null;
  }
  if (s.domain === "vacuum") return s.state === "cleaning" ? (a.includes("dock") ? { action: "dock" } : null) : a.includes("start") ? { action: "start" } : null;
  return null;
}

/** A press: Home Assistant is asked, and what it answers is shown at once — its event follows anyway */
async function haPress(server, s, action, value, el) {
  if (el) el.disabled = true;
  try {
    const next = await api("POST", `/api/ha/${server}/act`, { entity: s.id, action, ...(value !== undefined ? { value } : {}) });
    haSetState(server, next);
  } catch (e) {
    toast(errorText(e), "error");
  }
  if (el) el.disabled = false;
}

function haPressAsked(server, s, primary, el) {
  if (!primary.ask) return haPress(server, s, primary.action, undefined, el);
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t("ha.unlockTitle", { name: s.name })),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("ha.action.unlock"), { class: "primary", onclick: () => (dialog.close(), haPress(server, s, "unlock")) }, "lock")),
  );
}

/** A new state of one entity: the tile, the row of the server's page and the controls dialog follow */
function haSetState(server, s, entity = s?.id) {
  const key = `${server}/${entity}`;
  const o = state.overview;
  if (o?.ha && key in o.ha.states) {
    o.ha.states[key] = s;
    if (state.route.view === "home" && !gridUi.drag) {
      const at = locate(o.dashboard, "ha:" + key);
      const old = document.querySelector(`.ui-home-tile[data-key="${CSS.escape("ha:" + key)}"]`);
      const fresh = at && tile(at.item);
      if (old && fresh) old.replaceWith(fresh);
    }
  }
  if (haUi.entities && haUi.server?.id === server) {
    const i = haUi.entities.findIndex((one) => one.id === entity);
    if (s && i >= 0) haUi.entities[i] = s;
    else if (s) haUi.entities.push(s);
    else if (i >= 0) haUi.entities.splice(i, 1);
    const row = document.getElementById("ha-row-" + entity);
    if (row && s) row.replaceWith(haRow(server, s));
  }
  for (const listener of haUi.listeners ?? []) listener(server, s, entity);
}

function haEvent(event) {
  for (const [entity, s] of Object.entries(event.states ?? {})) haSetState(event.id, s, entity);
  if (!event.server) return;
  // the server came, went, or says something new about itself: whoever shows it asks again
  clearTimeout(haUi.timer);
  haUi.timer = setTimeout(() => {
    if (state.route.view === "home") void refresh();
    if (state.route.view === "ha" && state.route.id === event.id) void loadHa();
    if (state.route.view === "house") void loadHouse();
  }, 600);
}

/** Where a person opens a server: one on this machine as its app's tile does (by Hata's domain), else its address */
function haWebUrl(x) {
  if (x?.here) {
    const app = (state.overview?.apps ?? []).find((a) => Number(a.port) === x.port && appUrl(a));
    if (app) return appUrl(app).replace(/\/$/, "");
  }
  return x?.url ?? "";
}
/** Home Assistant opens the card of one entity by this address */
const haEntityUrl = (x, entity) => `${haWebUrl(x)}/?more-info-entity-id=${encodeURIComponent(entity)}`;
const haServerOf = (id) => (state.overview?.ha?.servers ?? []).find((x) => x.id === id) ?? (haUi.server?.id === id ? haUi.server : null) ?? (haUi.list?.servers ?? []).find((x) => x.id === id) ?? null;

const HA_BUTTON_ICONS = { open: "up", close: "down", stop: "stop", lock: "lock", unlock: "lock", run: "play", press: "play", playPause: "play", start: "play", dock: "home" };

/**
 * One entity: its state, what it can do, and — from a tile — where it opens and how the tile is moved or taken
 * off. Every tile of Home Assistant opens this, whatever the entity is.
 */
function haEntityDialog(server, s, item = null) {
  let dialog;
  let now = s;
  const x = haServerOf(server);
  const badge = h("span");
  const sub = h("span", { class: "muted small" });
  const body = h("div", { class: "stack" });
  const title = h("h2", { class: "clip" });
  // the name lives in Home Assistant: an administrator renames it there
  const rename = h("button", { type: "button", class: "icon-btn small", title: t("ha.rename"), "aria-label": t("ha.rename"), onclick: () => haRenameDialog(server, now) }, icon("edit"));
  const paint = () => {
    const gone = haGone(now) || !x?.online;
    title.textContent = now?.name ?? s.name;
    rename.hidden = !isAdmin() || gone;
    const a = now ? now.actions : [];
    const lit = haLit(now);
    put(badge, uiLead({ icon: haIcon(now ?? s), tone: lit ? "accent" : null }));
    sub.textContent = [now?.area, now?.haName && t("ha.inHa", { name: now.haName }), now?.at ? t("ha.changedAgo", { ago: ago(now.at) }) : null].filter(Boolean).join(" · ");
    const toggle = a.includes("toggle") && uiSwitch({ on: lit, label: now.name, disabled: gone, onchange: () => haPress(server, now, "toggle") });
    const level = now?.state === "on" ? (now.brightness ?? 100) : 0;
    const bright = a.includes("brightness") && uiRange({ value: level, label: t("ha.brightness"), disabled: gone, text: (v) => `${v}%`, onchange: (v) => haPress(server, now, "brightness", v) });
    const step = now?.step ?? 0.5;
    const temp = (delta) => () => haPress(server, now, "temperature", Math.min(now.max ?? 100, Math.max(now.min ?? -50, (now.target ?? now.current ?? 20) + delta)));
    const others = a.filter((one) => !["toggle", "brightness", "temperature"].includes(one));
    const main = haPrimary(now)?.action;
    put(
      body,
      uiReadout(x?.online === false ? t("ha.tile.away", { name: x.name }) : a.includes("temperature") ? [now.current != null && `${haNumber(now.current)}°`, haWord(now.state)].filter(Boolean).join(" · ") : haStateText(now), toggle),
      bright && uiField(t("ha.brightness"), bright),
      a.includes("temperature") && uiValueStepper({ value: now.target != null ? `${haNumber(now.target)}°` : "—", label: t("ha.asked"), disabled: gone, less: { label: t("ha.colder"), run: temp(-step) }, more: { label: t("ha.warmer"), run: temp(step) } }),
      others.length > 0 && uiButtonGrid(others.map((one) => button(t("ha.action." + one), { class: one === main ? "primary" : "", disabled: gone, onclick: (e) => (one === "unlock" ? haPressAsked(server, now, { action: one, ask: true }) : haPress(server, now, one, undefined, e.currentTarget)) }, HA_BUTTON_ICONS[one]))),
    );
  };
  const listener = (id, next, entity) => {
    if (id === server && entity === s.id && next) (now = next), paint();
  };
  (haUi.listeners ??= new Set()).add(listener);
  paint();
  const admin = isAdmin();
  const links = [
    admin && x && h("a", { class: "btn small", href: haEntityUrl(x, s.id), target: "_blank", rel: "noopener noreferrer" }, icon("external"), h("span", null, t("ha.openThere"))),
    admin && item && button(t("ha.offHome"), { class: "small danger", onclick: () => (dialog.close(), changeLayout((next) => void takeTile(next, tileKey(item)))) }, "trash"),
  ].filter(Boolean);
  dialog = openDialog("ha-entity", h("header", null, badge, h("div", { class: "grow" }, uiLine([title, rename]), sub), closeX(() => dialog)), body, links.length > 0 && h("footer", null, links));
  dialog.addEventListener("close", () => haUi.listeners.delete(listener));
}

function haRenameDialog(server, s) {
  const input = h("input", { maxlength: 100, value: s.name, placeholder: s.haName ?? s.id, "aria-label": t("ha.name") });
  const hint = h("p", { class: "muted small" });
  // as in Zigbee2MQTT: the name is Hata's, and a tick sends it to Home Assistant as well
  const there = h("input", { type: "checkbox", onchange: () => paint() });
  const paint = () => (hint.textContent = t(there.checked ? "ha.rename.hintThere" : "ha.rename.hint"));
  paint();
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  dialog = openDialog(
    "confirm",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            haSetState(server, await api("POST", `/api/ha/${server}/rename`, { entity: s.id, name: input.value.trim(), there: there.checked }));
            dialog.close();
            toast(t(there.checked ? "ha.rename.doneThere" : "ha.rename.done"));
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, t("ha.rename.title", { name: s.name })),
      h("p", { class: "muted" }, t("ha.rename.lead")),
      input,
      hint,
      s.renamable && uiCheck(t("ha.rename.there"), there),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("ha.rename"))),
    ),
  );
  input.focus();
  input.select();
}

// The tile of an entity on Home

function haTarget(item) {
  const o = state.overview;
  const server = (o.ha?.servers ?? []).find((one) => one.id === item.server);
  return server ? { server, state: o.ha.states[`${item.server}/${item.entity}`] ?? null } : null;
}

function haTile(item, target, title) {
  const s = target.state;
  const online = target.server.online;
  const primary = online ? haPrimary(s) : null;
  const cls = !online || haGone(s) ? "stopped" : haLit(s) ? "on" : "";
  const sub = online ? haStateText(s) : t("ha.tile.away", { name: target.server.name });
  // every tile of Home Assistant has the same button: the entity's own window
  const side = uiHomeTileOpen({ title: t("ha.tile.more"), "aria-label": `${t("ha.tile.more")}: ${title}`, onclick: () => haEntityDialog(item.server, s ?? { id: item.entity, name: title, domain: item.entity.split(".")[0], state: "unavailable", actions: [] }, item) });
  const content = tileContent(item, title, online && s && haBigText(s) ? haSubText(s) : sub, { big: online && s ? haBigText(s) : "" });
  // a press does what the entity is for; one with nothing to press (a sensor) opens its window
  const main = uiHomeTileMain({ title: primary ? t("ha.action." + primary.action) : t("ha.tile.more"), onclick: (e) => (primary ? haPressAsked(item.server, s, primary, e.currentTarget) : side.click()) }, content);
  return { cls, main, side };
}

/** The entities of the servers, to put some on Home */
async function haPickDialog() {
  const servers = state.overview.ha?.servers ?? [];
  if (!servers.length) return;
  let dialog;
  let server = servers[0].id;
  let list = [];
  let query = "";
  let extra = false;
  const chosen = new Set();
  const on = new Set((state.overview.ha?.states ? Object.keys(state.overview.ha.states) : []));
  const box = h("div", { class: "stack" });
  const add = h("button", { type: "button", class: "btn primary", disabled: true, onclick: () => {
    dialog.close();
    changeLayout((layout) => {
      for (const key of chosen) addCard(layout, { type: "ha", server: key.split("/")[0], entity: key.split("/")[1] });
    });
    toast(t("ha.pick.added", { n: chosen.size }));
  } }, t("ha.pick.add", { n: 0 }));
  const paint = () => {
    const q = query.trim().toLowerCase();
    const shown = list.filter((s) => (extra || !s.extra) && (!q || `${s.name} ${s.id} ${s.area}`.toLowerCase().includes(q)));
    const rooms = new Map();
    for (const s of shown) rooms.set(s.area, [...(rooms.get(s.area) ?? []), s]);
    put(
      box,
      !shown.length && h("p", { class: "muted" }, t("ha.pick.none")),
      [...rooms].map(([room, items]) =>
        h("div", { class: "stack-s" }, uiSubhead({ title: room || t("ha.noRoom") }),
          items.map((s) => {
            const key = `${server}/${s.id}`;
            const there = on.has(key);
            const box = h("input", { type: "checkbox", checked: there || chosen.has(key), disabled: there, onchange: (e) => (e.target.checked ? chosen.add(key) : chosen.delete(key), (add.disabled = !chosen.size), (add.textContent = t("ha.pick.add", { n: chosen.size }))) });
            return uiCheck(s.name, box, there ? t("ha.pick.there") : haStateText(s));
          }),
        ),
      ),
    );
  };
  const load = async () => {
    put(box, h("p", { class: "muted" }, t("ha.loading")));
    try {
      list = (await api("GET", `/api/ha/${server}/entities`)).entities;
    } catch (e) {
      return put(box, h("p", { class: "error" }, errorText(e)));
    }
    paint();
  };
  dialog = openDialog(
    "wide",
    h("header", null, h("h2", { class: "grow" }, t("ha.pick.title")), closeX(() => dialog)),
    servers.length > 1 && h("select", { onchange: (e) => ((server = e.target.value), load()) }, servers.map((s) => h("option", { value: s.id }, s.name))),
    h("input", { type: "search", placeholder: t("ha.search"), oninput: (e) => ((query = e.target.value), paint()) }),
    uiCheck(t("ha.showExtra"), h("input", { type: "checkbox", onchange: (e) => ((extra = e.target.checked), paint()) })),
    box,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), add),
  );
  void load();
}

// The servers under the machines, and the page of each

async function loadHa() {
  try {
    const id = state.route.id;
    if (state.route.view !== "ha" || !id) return;
    if (haUi.server?.id !== id) haUi.entities = null;
    haUi.server = await api("GET", `/api/ha/${id}`);
    if (!haUi.entities) haUi.entities = (await api("GET", `/api/ha/${id}/entities`)).entities;
    renderHaBody();
  } catch (e) {
    if (state.route.view !== "ha") return toast(errorText(e), "error");
    const box = document.getElementById("ha-body");
    if (box) put(box, uiCard({}, uiEmpty({ size: "error", title: errorText(e), action: button(t("attention.retry"), { onclick: () => void loadHa() }, "refresh") })));
  }
}

const haChip = (x) => uiState(x.online ? "ok" : x.error ? "bad" : "off", x.online ? t("ha.online") : x.error ? t("ha.offline") : t("ha.asking"));
const haError = (x) => (x.error ? (has("error." + x.error.code) ? t("error." + x.error.code, { name: x.name, message: x.error.message ?? "" }) : x.error.code) : "");

/** The kinds of things the house holds: where their list is asked, where the page draws, how one is connected */
const HOUSE = {
  ha: { tab: "ha", list: "/api/ha", body: "ha-body", icon: "bulb", name: "Home Assistant", found: "found", load: () => void loadHa(), add: (url) => haDialog(null, url) },
};
// services to connect are in the store, as apps are: the same button as in the head of Apps
const houseAdd = () => (isAdmin() && hasModule("integrations") ? storeButton("@") : button(t("house.connect"), { onclick: (e) => integrationsAddMenu(e.currentTarget) }, "plus"));

/** A tab of the house: the head, a switch between the servers when there are several, and the page of the one chosen */
/**
 * The head of a page of Integrations: the one head of the thing — its crumb back to Integrations, its icon, name and
 * state, its line, its actions; with several servers of a kind, they are its tabs
 */
/** The servers of the kind the page is about, for the tabs of its head */
const houseServers = { now: null };
function houseHead({ title, ...opts }) {
  const sv = houseServers.now;
  const tabs = sv && state.route.view === sv.view && sv.list.length > 1 && uiTabs(sv.list.map((x) => ({ label: x.name, href: `${sv.base}/${x.id}`, active: x.id === state.route.id })), { label: title });
  const head = pageHead({ id: "house-head", cls: "ui-area-head", crumbs: [{ label: t("area.house"), href: "#/house" }, { label: title }], title, tabs: tabs || null, ...opts });
  const old = document.getElementById("house-head") ?? document.querySelector("#view .ui-area-head");
  if (old) old.replaceWith(head);
  return head;
}

function houseShell(view) {
  shell(areaHead("house", HOUSE[view].tab, { actions: houseAdd() }), h("div", { id: HOUSE[view].body, class: "stack" }));
  void houseOpen(view);
}

async function houseOpen(view) {
  const k = HOUSE[view];
  const box = document.getElementById(k.body);
  let servers;
  try {
    servers = (await api("GET", k.list)).servers;
  } catch (e) {
    return state.route.view === view && box?.isConnected && put(box, uiCard({}, uiEmpty({ size: "error", title: errorText(e) })));
  }
  if (state.route.view !== view || !box?.isConnected) return;
  if (!servers.length) return houseEmpty(view, box);
  if (!servers.some((x) => x.id === state.route.id)) state.route.id = servers[0].id;
  houseServers.now = { view, list: servers, base: `#/house/${k.tab}` };
  k.load();
}

const haFoundUi = { found: null, address: "" };
/** Home Assistants that can be connected: the store's app of this server first, then what answers on the home network */
function haFound() {
  const { found, address } = haFoundUi;
  const out = [];
  const here = (state.overview?.apps ?? []).some((a) => a.name === "home-assistant") && `http://${address || location.hostname}:8123`;
  if (here) out.push({ name: "Home Assistant", kind: t("ha.foundHere"), icon: "bulb", url: here, connect: () => haDialog(null, here) });
  for (const f of found ?? []) if (!f.known && f.url !== here) out.push({ name: f.name, kind: "Home Assistant", icon: "bulb", url: f.url, connect: () => haDialog(null, f.url) });
  return out;
}

/** Nothing of the kind is connected yet: what it gives, the button, and what was found on this server and around */
function houseEmpty(view, box) {
  const k = HOUSE[view];
  const paint = () => {
    if (!box.isConnected) return;
    const found = haFound();
    put(
      box,
      uiCard({}, uiEmpty({ size: "big", icon: k.icon, title: t("house.none", { name: k.name }), text: t(`integrations.${view}.what`), action: button(t("house.connectOne", { name: k.name }), { class: "primary", onclick: () => k.add() }, "plus") })),
      found.length > 0 &&
        uiCard(
          { title: t("integrations.available"), lead: t("integrations.foundLead"), flush: true },
          h("div", { class: "ui-rows" }, found.map((f) => uiRow({ lead: { icon: f.icon }, name: f.name, sub: [f.kind, " · ", h("span", { class: "mono" }, f.url.replace(/^https?:\/\//, ""))], action: button(t("integrations.connect"), { class: "small", onclick: f.connect }, "plus") }))),
        ),
    );
  };
  paint();
  api("GET", k.list + "/found").then(
    (r) => (Object.assign(haFoundUi, { found: r.found, address: r.address }), paint()),
    () => {},
  );
}

// --- The overview of the section: everything connected, a tile each ---

const houseUi = { ha: null, bt: null, found: null, haFound: null, q: "", group: "all" };
/** The group a kind of service stands in; the store's descriptions say none yet */
const HOUSE_GROUPS = ["home", "media", "downloads", "network", "other"];
const KIND_GROUP = { frigate: "home", qbittorrent: "downloads", transmission: "downloads", sonarr: "downloads", radarr: "downloads", lidarr: "downloads", prowlarr: "downloads", bazarr: "downloads", jellyfin: "media", immich: "media", plex: "media", navidrome: "media", audiobookshelf: "media", syncthing: "network", "adguard-home": "network", pihole: "network", "uptime-kuma": "network" };
const HOUSE_GROUPS_FROM = 10;
const HOUSE_TOOLS_FROM = 13;

function renderHouse() {
  shell(areaHead("house", "overview", { actions: houseAdd() }), h("div", { id: "house-body", class: "stack" }, waitMark()));
  void loadHouse();
}

async function loadHouse() {
  const [ha, bt] = await Promise.all([hasModule("integrations") ? api("GET", "/api/ha").then((r) => r.servers, () => houseUi.ha ?? []) : [], hasModule("bluetooth") ? api("GET", "/api/bluetooth").catch(() => houseUi.bt) : null]);
  Object.assign(houseUi, { ha, bt });
  paintHouse();
  // what could be connected: asked once a visit, it may take a few seconds
  if (hasModule("integrations") && houseUi.found === null) {
    houseUi.found = [];
    const [found, haFound] = await Promise.all([api("GET", "/api/integrations/found").then((r) => r.found, () => []), api("GET", "/api/ha/found").catch(() => null)]);
    Object.assign(houseUi, { found, haFound });
    paintHouse();
  }
}

/** Everything the section holds, as the tiles show it: level bad / warn / ok, its group, a line and a warning */
function houseItems() {
  const items = [];
  const trouble = (pred) => (state.overview?.attention ?? []).filter(pred);
  // a tile is coloured only by what Needs attention holds for it, so its colour and the number by the section agree:
  // a service silent for a moment says so in its chip, and turns a colour once it is an item (after 5 min)
  const worst = (list) => (list.some((x) => x.severity === "danger") ? "bad" : list.length ? "warn" : "ok");
  for (const x of houseUi.ha ?? []) {
    const own = trouble((item) => item.code.startsWith("ha.") && item.detail?.host === x.id);
    items.push({ key: "ha:" + x.id, group: "home", href: `#/house/ha/${x.id}`, icon: "home", name: x.name, sub: ["Home Assistant", x.version].filter(Boolean).join(" · "), chip: haChip(x), line: x.online ? t("house.ha.line", { entities: x.entities, on: x.on }) : haError(x) || t("ha.offline"), warn: x.online && own.length ? attentionWords(own[0]).title : "", level: worst(own) });
  }
  if (hasModule("integrations"))
    for (const c of svcConnections()) {
      const spec = svcSpecNow(c.kind);
      const own = trouble((item) => item.code.startsWith("integration.") && item.detail?.host === c.id);
      let address = "";
      try {
        address = new URL(c.url).host;
      } catch {}
      items.push({ key: "x:" + c.id, group: KIND_GROUP[c.kind] ?? "other", href: `#/house/x-${c.kind}/${c.id}`, icon: c.icon, name: c.name, sub: c.title !== c.name ? c.title : address, chip: svcChip(c), line: c.online && spec ? svcNumbers(spec, c.values) : c.error ? t("service.offline") : "", warn: own.length ? attentionWords(own[0]).title : "", level: worst(own) });
    }
  if (hasModule("tv")) {
    const tv = state.tvNow;
    const line = tv?.page ? t("tv.page.showing", { name: tv.page.title || tv.page.url }) : tv?.playing ? t("tv.playing", { name: tv.playing.title }) : t(tv?.on ? "tv.nothingTitle" : "house.tv.off");
    items.push({ key: "tv", builtin: true, group: "media", href: "#/house/tv", icon: "tv", name: t("area.house.tv"), sub: t("house.builtin"), chip: uiState(tv?.on || tv?.page ? "ok" : "off", t(tv?.page ? "house.tv.browser" : tv?.on ? "house.tv.kodi" : "house.tv.offChip")), line, level: "ok" });
  }
  if (hasModule("music")) {
    const now = state.musicNow;
    items.push({ key: "music", builtin: true, group: "media", href: "#/house/music", icon: "music", name: t("area.house.music"), sub: t("house.builtin"), chip: now && uiState(now.paused ? "off" : "ok", t(now.paused ? "house.music.paused" : "house.music.playing")), line: now ? now.title : t("music.idle"), level: "ok" });
  }
  if (hasModule("bluetooth")) {
    const bt = houseUi.bt;
    const paired = (bt?.devices ?? []).filter((d) => d.paired);
    const line = !bt ? "" : bt.state === "ready" ? t("house.bt.line", { paired: paired.length, connected: paired.filter((d) => d.connected).length }) : t("house.bt." + bt.state);
    items.push({ key: "bt", builtin: true, group: "home", href: "#/house/bluetooth", icon: "bluetooth", name: t("area.house.bluetooth"), sub: t("house.builtin"), chip: bt && uiState(bt.state === "ready" ? "ok" : "off", t(bt.state === "ready" ? "house.bt.on" : "house.bt.offChip")), line, level: "ok" });
  }
  return items;
}

/** One tile: always the same height — every line one line, the warning's place kept when there is none */
const houseTile = (x) => uiTile({ icon: x.icon, name: x.name, sub: x.sub, state: x.chip, foot: x.line || " ", warn: x.warn || null, tone: x.level !== "ok" ? x.level : null, href: x.href });

/** Things that could be connected and are not: this server's apps of a known kind, Home Assistants around */
function houseFound() {
  const out = [];
  for (const f of houseUi.found ?? []) out.push({ name: f.title, where: t("house.found.here"), icon: f.icon, connect: () => svcConnectDialog(f.kind, null, f.url) });
  if (houseUi.haFound) {
    Object.assign(haFoundUi, { found: houseUi.haFound.found, address: houseUi.haFound.address });
    // the store's Home Assistant of this server is offered only while none of this server is connected
    const hereOn = (houseUi.ha ?? []).some((x) => x.here);
    for (const f of haFound()) if (!(hereOn && f.kind === t("ha.foundHere"))) out.push({ name: f.name, where: f.kind === "Home Assistant" ? t("house.found.around", { address: f.url.replace(/^https?:\/\//, "") }) : f.kind, icon: "home", connect: f.connect });
  }
  return out;
}

function paintHouse() {
  const box = document.getElementById("house-body");
  if (!box || state.route.view !== "house") return;
  // the search keeps its focus and its place while the tiles under it change
  const typing = document.activeElement?.id === "house-q";
  const all = houseItems();
  const q = houseUi.q.trim().toLowerCase();
  const matches = (x) => !q || `${x.name} ${x.sub} ${x.line}`.toLowerCase().includes(q);
  const troubled = all.filter((x) => x.level !== "ok");
  const grouped = all.length >= HOUSE_GROUPS_FROM;
  const tools = all.length >= HOUSE_TOOLS_FROM;
  const pick = tools ? houseUi.group : "all";
  const shownIn = (x) => matches(x) && (pick === "all" || (pick === "trouble" ? x.level !== "ok" : x.group === pick));
  const tiles = (list) => h("div", { class: "ui-tiles" }, list.map(houseTile));
  const groupCard = (id, list, total) => list.length > 0 && uiCard({ title: t("house.group." + id), count: total > list.length ? t("house.ofTotal", { n: list.length, total }) : list.length }, tiles(list));
  const parts = [];
  if (tools) {
    const counts = { all: all.length, trouble: troubled.length };
    for (const g of HOUSE_GROUPS) counts[g] = all.filter((x) => x.group === g).length;
    const segs = ["all", "trouble", ...HOUSE_GROUPS].filter((g) => g === "all" || counts[g] > 0);
    const field = h("input", { type: "search", id: "house-q", class: "ui-search", placeholder: t("house.search"), "aria-label": t("house.search"), value: houseUi.q, oninput: (e) => ((houseUi.q = e.target.value), paintHouse()) });
    parts.push(uiCard({}, uiLine([field, uiSegment(segs.map((g) => ({ value: g, label: t("house.group." + g), count: counts[g] })), pick, (g) => ((houseUi.group = g), paintHouse()), { label: t("house.search") })])));
  }
  // what needs attention is the section's usual list above (with its menu); the tiles keep their places and colours
  const rest = all.filter(shownIn);
  if (grouped) for (const g of HOUSE_GROUPS) parts.push(groupCard(g, rest.filter((x) => x.group === g), all.filter((x) => x.group === g).length));
  else if (rest.length) parts.push(uiCard({}, tiles(rest)));
  if (!all.length && hasModule("integrations")) parts.push(uiCard({}, uiEmpty({ size: "big", icon: "plug", title: t("house.nothing"), text: t("house.nothingLead"), action: houseAdd() })));
  else if (all.length && !parts.some(Boolean)) parts.push(uiCard({}, uiEmpty({ text: t("house.noMatch") })));
  const found = houseFound();
  if (found.length && localStorage.getItem("hata.house.foundHidden") !== String(found.length))
    parts.push(
      uiCard(
        { title: t("house.found.title"), lead: t("house.found.lead", { n: found.length }), flush: true, actions: button(t("house.found.hide"), { class: "small quiet", onclick: () => (localStorage.setItem("hata.house.foundHidden", String(found.length)), paintHouse()) }) },
        h("div", { class: "ui-rows" }, found.map((f) => uiRow({ lead: { icon: f.icon }, name: f.name, sub: f.where, action: button(t("integrations.connect"), { class: "small", onclick: f.connect }, "plus") }))),
      ),
    );
  put(box, ...parts.filter(Boolean));
  if (typing) {
    const field = document.getElementById("house-q");
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }
}

function renderHa() {
  if (haUi.server?.id !== state.route.id) (haUi.server = null), (haUi.entities = null);
  houseShell("ha");
}

function renderHaBody() {
  const box = document.getElementById("ha-body");
  const x = haUi.server;
  if (!box || !x) return;
  houseHead({
    icon: "bulb",
    title: x.name,
    state: haChip(x),
    facts: ["Home Assistant", x.version, x.url].filter(Boolean),
    actions: [{ label: t("ha.open"), icon: "external", href: haWebUrl(x), newTab: true }],
    more: [{ label: t("ha.change"), icon: "edit", run: () => haDialog(x) }, { label: t("ha.remove") + "…", icon: "trash", danger: true, run: () => removeHaDialog(x) }],
    menu: (at) => haMenu(x, at),
  });
  put(
    box,
    x.error && uiCard({}, uiNotice({ tone: "bad", text: [haError(x), t("pve.since", { ago: ago(x.error.since) })].join(" ") })),
    uiColumns(haDevices(x), haOverview(x), { sideFirst: true }),
  );
}

// --- Services: a store's description of a service, drawn with Hata's own blocks ---
// Nothing of a description runs here: it names fields, formats and blocks, and these functions draw them.

const svcUi = { conn: null, spec: null, rows: {}, params: {}, tab: "all", q: "", timer: 0, tick: 0, found: null };
const svcConnections = () => state.overview?.integrations?.connections ?? [];
const svcKinds = () => state.overview?.integrations?.kinds ?? [];
/** The descriptions in use, as the overview carries them; one not there is asked for */
const svcSpecNow = (kind) => state.overview?.integrations?.specs?.[kind] ?? null;
const svcSpecsAsked = new Map();
async function svcSpec(kind) {
  const there = svcSpecNow(kind);
  if (there) return there;
  if (!svcSpecsAsked.has(kind)) svcSpecsAsked.set(kind, api("GET", `/api/integrations/kinds/${kind}`).catch((e) => (svcSpecsAsked.delete(kind), Promise.reject(e))));
  return svcSpecsAsked.get(kind);
}
/** The app of this server a connection is, by its id: its page then lives with the app */
const serviceApp = (id) => Object.entries(state.overview?.integrations?.apps ?? {}).find(([, x]) => x.id === id)?.[0] ?? "";
/** Each kind with a connection that is nobody's app here has a tab of its own in Services */
const serviceTabs = () => {
  const out = [];
  for (const c of svcConnections()) if (!serviceApp(c.id) && !out.some((x) => x.kind === c.kind)) out.push({ id: `x-${c.kind}`, kind: c.kind, hash: `#/house/x-${c.kind}`, view: "service", module: "integrations", label: c.title });
  return out;
};
/** A text of a description in the page's language */
const svcText = (text) => (text ? (text[state.lang] ?? text.en ?? "") : "");

function svcFormat(v, as) {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.join(", ");
  // a time may come as words of ISO 8601
  if ((as === "time" || as === "ago") && typeof v === "string") v = Date.parse(v);
  if ((as === "time" || as === "ago") && !Number.isFinite(v)) return "";
  switch (as) {
    case "bytes":
      return bytes(v);
    case "rate":
      return `${bytes(v)}/s`;
    case "percent":
    case "progress":
      return `${v}%`;
    case "duration":
      return duration(Math.max(60, v));
    case "time":
      return new Date(v).toLocaleString(state.lang);
    case "ago":
      return ago(v);
    case "number":
      return Number(v).toLocaleString(state.lang);
    case "bool":
      return v ? "✓" : "—";
    default:
      return String(v);
  }
}

/** A template of a description, its places filled from a row or the values; an empty place stays empty */
const svcFill = (template, vars) => template.replace(/\{([A-Za-z_$@][A-Za-z0-9_.$@]*)(?:\|([a-z]+))?\}/g, (_, name, how) => svcFormat(vars[name], how));

function svcTest(c, row) {
  if (!c) return true;
  if (c.any) return c.any.some((x) => svcTest(x, row));
  if (c.all) return c.all.every((x) => svcTest(x, row));
  if (c.not) return !svcTest(c.not, row);
  const v = row[c.field];
  if (c.in && !c.in.some((x) => x === v)) return false;
  if (c.is !== undefined && (c.is === null ? v !== null && v !== undefined : v !== c.is)) return false;
  if (c.gt !== undefined && !(typeof v === "number" && v > c.gt)) return false;
  if (c.lt !== undefined && !(typeof v === "number" && v < c.lt)) return false;
  return true;
}

const svcSort = (rows, sort = []) =>
  [...rows].sort((a, b) => {
    for (const s of sort) {
      const x = a[s.field];
      const y = b[s.field];
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
      if (d) return s.desc ? -d : d;
    }
    return 0;
  });

const svcKey = (spec, list, row) => String(row[spec.lists[list]?.key ?? "id"]);
const svcPicture = (id, name, key, height, tick = "") => `/api/integrations/${id}/pictures/${name}/${encodeURIComponent(key)}?h=${height}${tick !== "" ? `&t=${tick}` : ""}`;
const svcLive = (id, name, key, height) => `/api/integrations/${id}/live/${name}/${encodeURIComponent(key)}?h=${height}&fps=${LIVE_FPS}`;
const svcChip = (x) => uiState(x.online ? "ok" : x.error ? "bad" : "off", t(x.online ? "service.online" : x.error ? "service.offline" : "service.asking"));
/** The tone of the system for a description's word: running, stopped, restarting or none */
const svcTone = (tone) => ({ running: "ok", restarting: "bad" })[tone] ?? "off";
const svcError = (x) => (x.error ? (has("error." + x.error.code) ? t("error." + x.error.code, { url: x.url, name: x.name, message: x.error.message ?? "" }) : x.error.code) : "");
/** The numbers a description puts in the head of its page, in a line */
const svcNumbers = (spec, values) =>
  spec.page
    .flatMap((b) => b.numbers ?? [])
    .map((n) => `${svcText(n.label)}: ${svcFormat(values[n.value], n.as) || "—"}`)
    .join(" · ");

/** The crumbs of a service that is an app of this server: Apps › the app › the service */
function svcCrumbs(x) {
  const app = serviceApp(x.id);
  const title = app && (state.overview?.apps ?? []).find((a) => a.name === app)?.title;
  return app ? [{ label: t("nav.apps"), href: "#/apps" }, { label: title ?? app, href: `#/apps/${app}` }, { label: x.title }] : null;
}

function renderService() {
  const route = state.route;
  if (svcUi.conn?.id !== route.id) Object.assign(svcUi, { conn: null, spec: null, rows: {}, params: {}, tab: "all", q: "" });
  // a connection that is an app of this server: a page of that app
  if (!route.house && route.id && serviceApp(route.id)) {
    shell(h("div", { id: "svc-body", class: "stack" }));
    return void loadService();
  }
  // the tabs and the list come with the overview: drawn again once it is there
  if (!state.overview?.integrations) return void refresh().then(() => state.route.view === "service" && state.overview?.integrations && renderService());
  const conn = svcConnections().find((c) => c.id === route.id);
  const kind = route.kind || conn?.kind || "";
  shell(areaHead("house", `x-${kind}`, { actions: houseAdd() }), h("div", { id: "svc-body", class: "stack" }));
  // in Integrations every connection of the kind is here, also one that is an app of this server
  const list = svcConnections().filter((c) => c.kind === kind);
  if (!list.length) return put(document.getElementById("svc-body"), uiCard({}, uiEmpty({ size: "big", icon: "plug", title: t("service.none"), action: h("a", { class: "btn", href: "#/house" }, t("house.back")) })));
  if (!list.some((c) => c.id === route.id)) state.route.id = list[0].id;
  houseServers.now = { view: "service", list, base: `#/house/x-${kind}` };
  void loadService();
}

/** Asked again every five seconds while the page is on screen */
async function loadService() {
  clearTimeout(svcUi.timer);
  const id = state.route.id;
  if (state.route.view !== "service" || !id) return;
  try {
    const conn = await api("GET", `/api/integrations/${id}`);
    const spec = await svcSpec(conn.kind);
    // a list of events is read with the page's own filter and a longer reach
    for (const b of spec.page) {
      if (!b.events) continue;
      const asked = { limit: "40", ...(svcUi.params[b.events.of] ?? {}) };
      const got = await api("GET", `/api/integrations/${id}/rows/${b.events.of}?${new URLSearchParams(asked)}`).catch(() => null);
      if (got) conn.lists[b.events.of] = got.rows;
    }
    if (state.route.view !== "service" || state.route.id !== id) return;
    const whole = !svcUi.conn;
    svcUi.conn = conn;
    svcUi.spec = spec;
    svcUi.tick++;
    paintService(whole);
  } catch (e) {
    const box = document.getElementById("svc-body");
    if (box) put(box, uiCard({}, uiEmpty({ size: "error", title: errorText(e), action: button(t("attention.retry"), { onclick: () => void loadService() }, "refresh") })));
    return;
  }
  svcUi.timer = setTimeout(loadService, 5000);
}

/** The head of a service's page: in Integrations it is the head of the page, on an app's page a card of its own */
function svcHead(x, spec) {
  const kinds = svcKinds().find((k) => k.id === x.kind);
  // what is done to the whole is offered when its condition of the values holds
  const general = Object.entries(spec.actions).filter(([, a]) => !a.on && svcTest(a.when, x.values));
  const opts = {
    logo: null,
    icon: x.icon || "plug",
    title: x.name,
    state: svcChip(x),
    facts: [x.title, x.values.version, x.url, x.online && svcNumbers(spec, x.values)].filter(Boolean),
    actions: [
      general[0] ? { label: svcText(general[0][1].label), icon: general[0][1].icon, primary: true, run: () => x.online && svcActionDialog(x, spec, general[0][0], []) } : { label: t("service.open", { kind: x.title }), icon: "external", href: x.url, newTab: true },
    ],
    more: () => [
      general[0] && { label: t("service.open", { kind: x.title }), icon: "external", run: () => window.open(x.url, "_blank", "noopener") },
      ...general.slice(1).map(([name, a]) => ({ label: svcText(a.label), icon: a.icon, off: !x.online, run: () => svcActionDialog(x, spec, name, []) })),
      { label: t("service.change"), icon: "edit", run: () => svcConnectDialog(x.kind, x) },
      { label: t("service.disconnect") + "…", icon: "trash", danger: true, run: () => svcDisconnectDialog(x) },
    ].filter(Boolean),
    menu: (at) => svcMenu(x, at),
  };
  const newer = kinds?.newer && uiCard({}, uiNotice({ tone: "info", icon: "up", text: t("service.newer", { kind: x.title, version: kinds.newer }), action: button(t("service.takeNewer"), { class: "small", onclick: () => svcTakeNewer(x.kind) }, "up") }));
  return { opts, newer };
}

async function svcTakeNewer(kind) {
  try {
    await api("POST", `/api/integrations/kinds/${kind}/update`);
    svcSpecsAsked.delete(kind);
    await refresh();
    svcUi.conn = null;
    void loadService();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function paintService(whole = true) {
  const box = document.getElementById("svc-body");
  const x = svcUi.conn;
  const spec = svcUi.spec;
  if (!box || !x || !spec) return;
  const { opts, newer } = svcHead(x, spec);
  const errorBox = [x.error && uiCard({}, uiNotice({ tone: "bad", text: [svcError(x), t("pve.since", { ago: ago(x.error.since) })].join(" ") })), newer].filter(Boolean);
  // in Integrations the service's head is the page's; on an app's page it is a card under the app's crumbs
  const inHouse = state.route.house || !serviceApp(x.id);
  const own = () => (inHouse ? (houseHead(opts), null) : pageHead({ ...opts, id: "svc-head", crumbs: svcCrumbs(x) }));
  // the field keeps its focus and the page its place: what changed is drawn again, the rest stays
  if (!whole && document.getElementById("svc-error")) {
    const head = own();
    if (head) document.getElementById("svc-head")?.replaceWith(head);
    put(document.getElementById("svc-error"), ...errorBox);
    spec.page.forEach((b, i) => svcBlockBody(b, i, x, spec));
    return;
  }
  put(
    box,
    own(),
    h("div", { id: "svc-error", class: "stack" }, ...errorBox),
    spec.page.map((b, i) => svcBlock(b, i, x, spec)),
  );
  spec.page.forEach((b, i) => svcBlockBody(b, i, x, spec));
}

/** The standing part of a block: its title and its tools; `svcBlockBody` fills the rest */
function svcBlock(b, i, x, spec) {
  if (b.numbers) return null;
  if (b.table) {
    const tb = b.table;
    const search = tb.search.length > 0 && h("input", { type: "search", placeholder: t("service.search"), value: svcUi.q, oninput: (e) => ((svcUi.q = e.target.value), svcBlockBody(b, i, svcUi.conn, spec)) });
    if (search) search.classList.add("ui-search");
    // the segment of the tabs is drawn with their counts by svcTable
    const tabs = tb.tabs && h("span", { id: `svc-b${i}-tabs` });
    return uiCard({ title: tb.title ? svcText(tb.title) : null, flush: true }, (tabs || search) && h("div", { class: "ui-filters" }, tabs, search), h("div", { id: `svc-b${i}`, class: "ui-rows" }));
  }
  if (b.pictures) return uiCard({ title: b.pictures.title ? svcText(b.pictures.title) : null }, h("div", { id: `svc-b${i}` }));
  if (b.events) {
    const ev = b.events;
    const filters = ev.filters.map((f) => {
      const [list, fieldName] = (f.options ?? "").split(".");
      const options = list ? [...new Set((x.lists[list] ?? []).map((r) => r[fieldName]).filter((v) => typeof v === "string"))] : [];
      return h("select", { onchange: (e) => ((svcUi.params[ev.of] = { ...(svcUi.params[ev.of] ?? {}), [f.param]: e.target.value }), void loadService()) }, h("option", { value: "" }, svcText(f.label)), options.map((o) => h("option", { value: o, selected: svcUi.params[ev.of]?.[f.param] === o }, o)));
    });
    return uiCard({ title: svcText(ev.title) || t("service.events"), actions: filters, flush: true }, h("div", { id: `svc-b${i}`, class: "ui-rows" }));
  }
  return null;
}

function svcBlockBody(b, i, x, spec) {
  const box = document.getElementById(`svc-b${i}`);
  if (!box) return;
  if (b.table) return put(box, svcTable(b.table, x, spec, box));
  if (b.pictures) {
    const p = b.pictures;
    const rows = x.lists[p.of] ?? [];
    return put(box, rows.length ? h("div", { class: "ui-tiles" }, rows.map((row) => svcPictureTile(x, spec, p, row))) : uiEmpty({ text: x.online ? t("service.nothing") : "—" }));
  }
  if (b.events) {
    const ev = b.events;
    const rows = x.lists[ev.of] ?? [];
    return put(box, rows.length ? rows.map((row) => svcEventRow(x, spec, ev, row)) : uiEmpty({ text: svcText(ev.empty) || t("service.nothing") }));
  }
}

function svcTable(tb, x, spec, box) {
  const all = x.lists[tb.of] ?? [];
  const inTab = (row, v) => !tb.tabs || v === "all" || row[tb.tabs.field] === v;
  const q = svcUi.q.trim().toLowerCase();
  const shown = all.filter((row) => inTab(row, svcUi.tab) && (!q || tb.search.some((f) => String(row[f] ?? "").toLowerCase().includes(q))));
  const tabsBox = document.getElementById(`${box.id}-tabs`);
  if (tabsBox && tb.tabs)
    put(tabsBox, uiSegment(tb.tabs.values.map((v) => ({ value: v, label: svcText(spec.words[tb.tabs.words]?.[v]?.label) || v, count: all.filter((row) => inTab(row, v)).length })), svcUi.tab, (v) => ((svcUi.tab = v), put(box, svcTable(tb, svcUi.conn, spec, box))), { label: svcText(tb.title) || null }));
  if (!shown.length) return uiEmpty({ text: all.length ? t("service.noneHere") : svcText(tb.empty) || t("service.nothing") });
  const cell = (c, row) => {
    const v = row[c.field];
    const said = c.words ? spec.words[c.words]?.[String(v)] : null;
    return [
      said
        ? uiState(svcTone(said.tone), svcText(said.label))
        : c.as === "progress"
          ? h("div", { class: "stack-s" }, h("div", { class: "small" }, c.note ? svcFill(c.note, row) : svcFormat(v, "percent")), uiMeter(Number(v) || 0, { kind: "progress" }))
          : [h("div", { class: c.field === tb.columns[0].field ? "strong" : c.as === "rate" ? "small" : "" }, svcFormat(v, c.as) || "—"), c.note && c.as !== "progress" && h("div", { class: "muted small" }, svcFill(c.note, row))],
      c.under && row[c.under.field] !== null && row[c.under.field] !== undefined && row[c.under.field] !== "" && h("div", { class: "muted small" + (c.under.as === "mono" ? " mono" : "") }, svcFormat(row[c.under.field], c.under.as)),
    ];
  };
  const tools = (row) =>
    uiLine(
      tb.actions.filter((n) => svcTest(spec.actions[n]?.when, row)).map((n) => {
        const a = spec.actions[n];
        const name = String(row.name ?? svcKey(spec, tb.of, row));
        return h("button", { type: "button", class: "icon-btn", title: svcText(a.label), "aria-label": `${svcText(a.label)}: ${name}`, onclick: () => svcActionDialog(x, spec, n, [row], tb.of) }, icon(a.icon));
      }),
      { end: true },
    );
  const columns = [...tb.columns.map((c) => ({ label: svcText(c.label) })), ...(tb.actions.length > 0 ? [{ label: "" }] : [])];
  return [
    uiTable(columns, shown.slice(0, tb.limit).map((row) => ({ cells: [...tb.columns.map((c) => h("div", null, cell(c, row))), ...(tb.actions.length > 0 ? [tools(row)] : [])] }))),
    shown.length > tb.limit && uiEmpty({ text: t("service.firstOnly", { n: shown.length, limit: tb.limit }) }),
  ];
}

function svcPictureTile(x, spec, p, row) {
  const key = svcKey(spec, p.of, row);
  const off = p.off && svcTest(p.off, row);
  const note = !off && p.note && svcFill(p.note, row);
  return uiTile({
    kind: "media",
    icon: x.icon,
    picture: off ? null : picture(svcPicture(x.id, p.picture, key, 360, svcUi.tick), String(row[p.caption] ?? "")),
    name: String(row[p.caption] ?? key),
    sub: note && note.trim() !== "fps" ? note : null,
    state: (row.online === false || off) && uiState("off", t("service.offline")),
    onclick: () => svcPictureDialog(x, p.picture, p.live, key, String(row[p.caption] ?? key)),
  });
}

/** One picture, larger: live while the dialog is open when the description has a stream, else renewed every two seconds */
function svcPictureDialog(x, still, live, key, title) {
  const img = live ? liveView(x, live, key, 1080, title, "ui-frame-picture") : picture(svcPicture(x.id, still, key, 720, "d0"), title, "ui-frame-picture");
  const frame = uiPictureFrame(img, { whole: true });
  let dialog;
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, title), closeX(() => dialog)), frame, h("p", { class: "muted small" }, live ? t(img.tagName === "VIDEO" ? "service.liveNoteRtc" : "service.liveNote", { fps: LIVE_FPS }) : t("service.stillNote")));
  let tick = 0;
  const every = !live && setInterval(() => (dialog.open ? (img.src = svcPicture(x.id, still, key, 720, `d${++tick}`)) : clearInterval(every)), 2000);
  dialog.addEventListener("close", () => live && frame.querySelectorAll("img, video").forEach(letLiveGo));
}

function svcEventRow(x, spec, ev, row) {
  const key = svcKey(spec, ev.of, row);
  const open = ev.open && spec.pictures[ev.open] && svcTest(spec.pictures[ev.open].when, row) ? ev.open : ev.picture;
  return uiRow({
    lead: { img: picture(svcPicture(x.id, ev.picture, key, 180), "") },
    name: svcFill(ev.name, row),
    sub: ev.note ? svcFill(ev.note, row) : null,
    state: row.going === true && uiState("ok", t("service.goingOn")),
    onclick: () => svcEventDialog(x, open, key, svcFill(ev.name, row), ev.note ? svcFill(ev.note, row) : ""),
  });
}

function svcEventDialog(x, name, key, title, note) {
  let dialog;
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, title), closeX(() => dialog)), uiPictureFrame(picture(svcPicture(x.id, name, key, 1080), title, "ui-frame-picture")), note && h("p", { class: "muted small" }, note));
}

/** An action as its description says: what it asks first, and a question before what destroys */
function svcActionDialog(x, spec, name, rows, list) {
  const a = spec.actions[name];
  const target = rows.map((r) => String(r.name ?? svcKey(spec, list, r)));
  const ids = rows.map((r) => svcKey(spec, list, r));
  const run = async (input = {}) => {
    await api("POST", `/api/integrations/${x.id}/actions/${name}`, { ids, input });
    if (a.done) toast(svcText(a.done));
    setTimeout(loadService, 600);
  };
  if (!a.ask.length && !a.confirm) return void run().catch((e) => toast(errorText(e), "error"));
  const inputs = a.ask.map((q) => {
    const el = q.kind === "check" ? h("input", { type: "checkbox" }) : q.kind === "lines" ? h("textarea", { rows: 4, class: "mono small", spellcheck: false }) : q.kind === "file" ? h("input", { type: "file", accept: q.check === "torrent" ? ".torrent,application/x-bittorrent" : "" }) : h("input", { autocomplete: "off" });
    return { q, el };
  });
  const values = async () => {
    const out = {};
    for (const { q, el } of inputs) {
      if (q.kind === "check") out[q.name] = el.checked;
      else if (q.kind === "file") {
        const f = el.files?.[0];
        if (f) out[q.name] = btoa(Array.from(new Uint8Array(await f.arrayBuffer()), (b) => String.fromCharCode(b)).join(""));
      } else out[q.name] = el.value;
    }
    return out;
  };
  const vars = { ...(rows[0] ?? {}), name: target.length > 1 ? `${target[0]} +${target.length - 1}` : (target[0] ?? x.name) };
  const title = a.confirm ? svcFill(svcText(a.confirm.title), vars) : svcText(a.label);
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      await run(await values());
      dialog.close();
    } catch (err) {
      error.textContent = errorText(err);
    }
    submit.disabled = false;
  };
  dialog = openDialog(
    a.confirm ? "confirm" : "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow wrap" }, title), closeX(() => dialog)),
      a.confirm?.lead && h("p", { class: "muted" }, svcFill(svcText(a.confirm.lead), vars)),
      inputs.map(({ q, el }) => (q.kind === "check" ? uiCheck(svcText(q.label), el, svcText(q.hint) || null) : uiField(svcText(q.label), el, svcText(q.hint) || null))),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn " + (a.effect === "destroy" ? "danger" : "primary") }, icon(a.icon), h("span", null, svcText(a.label)))),
    ),
  );
}

function svcMenu(x, at) {
  menuAt(at, menuHeader(x.name, x.url, x.icon), [
    { label: t("service.open", { kind: x.title }), icon: "external", run: () => window.open(x.url, "_blank", "noopener") },
    { label: t("service.change"), icon: "edit", run: () => svcConnectDialog(x.kind, x) },
    { label: t("service.disconnect") + "…", icon: "trash", danger: true, run: () => svcDisconnectDialog(x) },
  ]);
}

function svcDisconnectDialog(x) {
  confirmAction({
    title: t("service.disconnectTitle", { name: x.name }),
    lead: t("service.disconnectLead", { kind: x.title }),
    label: t("service.disconnect"),
    run: async () => {
      await api("DELETE", `/api/integrations/${x.id}`);
      go("#/house");
    },
  });
}

/** Connecting a service, or changing how it is reached: the address, and what its description asks for */
async function svcConnectDialog(kind, old = null, address = "") {
  let spec;
  try {
    spec = await svcSpec(kind);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const name = h("input", { value: old?.name ?? "", placeholder: spec.title, maxLength: 40 });
  const url = h("input", { value: old?.url ?? address, placeholder: `192.168.1.5:${spec.address.port}`, required: true, autocapitalize: "none", spellcheck: false, class: "mono" });
  const user = spec.ask.includes("user") && h("input", { value: old?.user ?? spec.defaults.user ?? "", autocapitalize: "none", spellcheck: false, autocomplete: "off", name: `${kind}-user` });
  const password = spec.ask.includes("password") && h("input", { type: "password", autocomplete: "new-password", name: `${kind}-password`, placeholder: old ? t("service.kept") : "" });
  const token = spec.ask.includes("token") && h("input", { type: "password", autocomplete: "off", name: `${kind}-token`, class: "mono", placeholder: old ? t("service.kept") : "" });
  const cert = h("div");
  const error = h("p", { class: "error", role: "alert" });
  let fingerprint = null;
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const data = { kind, name: name.value, url: url.value, ...(user ? { user: user.value } : {}), ...(password ? { password: password.value } : {}), ...(token ? { token: token.value } : {}), ...(fingerprint ? { fingerprint } : {}) };
      const saved = old ? await api("PATCH", `/api/integrations/${old.id}`, data) : await api("POST", "/api/integrations", data);
      dialog.close();
      toast(t(old ? "service.changed" : "service.added", { name: saved.name }));
      await refresh();
      if (!old) go(`#/service/${saved.id}`);
      else if (state.route.view === "service") void loadService();
    } catch (err) {
      if (err.code === "integration.confirmCert") {
        // the service's own certificate: the person compares it with what the service says, then it is kept
        put(cert, uiNotice({ tone: "warn", title: t("service.certTitle"), text: t("service.certLead", { subject: err.detail.subject || "—", issuer: err.detail.issuer || "—" }), foot: h("p", { class: "mono small wrap" }, err.detail.fingerprint) }));
        fingerprint = err.detail.fingerprint;
        submit.querySelector("span").textContent = t("service.certTrust");
      } else error.textContent = errorText(err);
    }
    submit.disabled = false;
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, old ? t("service.changeTitle", { name: old.name }) : t("service.addTitle", { kind: spec.title })), closeX(() => dialog)),
      !old && h("p", null, svcText(spec.what)),
      field(t("service.url"), url, t("service.urlHint", { port: spec.address.port, scheme: spec.address.scheme })),
      (user || password) && uiFields(user && field(t("service.user"), user), password && field(t("service.password"), password)),
      token && field(t("service.token"), token),
      spec.hint && h("p", { class: "small" }, svcText(spec.hint)),
      (password || token) && h("p", { class: "muted small" }, t("service.secretHint")),
      field(t("service.name"), name),
      cert,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, h("span", null, t(old ? "ha.save" : "integrations.connectIt")))),
    ),
  );
}

/** What can be connected: every kind the stores describe, and what runs on this server already */
function integrationsAddMenu(at) {
  // an entry: what it is, and a line of what it gives under it
  const entry = (label, hint, iconName, run) => ({ label: h("span", { class: "stack-s" }, h("span", null, label), h("span", { class: "muted small" }, hint)), icon: iconName, run });
  const found = svcUi.found ?? [];
  menuAt(at, h("header", null, h("h2", null, t("integrations.addWhat"))), [
    ...found.map((f) => entry(`${f.kindTitle}: ${f.title}`, t("ha.foundHere") + " · " + f.url.replace(/^https?:\/\//, ""), f.icon, () => svcConnectDialog(f.kind, null, f.url))),
    entry("Home Assistant", t("integrations.ha.what"), "bulb", () => haDialog()),
    ...svcKinds().map((k) => entry(k.title, k.what, k.icon, () => svcConnectDialog(k.id))),
    !svcKinds().length && { label: t("service.noKinds"), icon: "info", off: true, run: () => {} },
  ]);
  if (!svcUi.found) api("GET", "/api/integrations/found").then((r) => (svcUi.found = r.found), () => {});
}

/** The app runs a service that is connected: its widget's numbers, and the way to its page */
function appServiceCard(app) {
  const s = state.overview?.integrations?.apps?.[app.name];
  const x = s && svcConnections().find((c) => c.id === s.id);
  const spec = x && svcSpecNow(x.kind);
  return x && spec && uiCard({ title: x.title, lead: x.online ? svcNumbers(spec, x.values) : t("service.offline"), actions: h("a", { class: "btn small", href: `#/service/${x.id}` }, icon(x.icon), h("span", null, t("common.open"))) });
}

/** What the tile of such an app says under its name, as the description's `tile` words it */
function appServiceLine(app) {
  const s = state.overview?.integrations?.apps?.[app.name];
  const spec = s && svcSpecNow(s.kind);
  return s?.online && spec?.tile ? svcFill(spec.tile, s.values) : "";
}

/** A picture that failed says so instead of a broken image */
function picture(src, alt, cls) {
  const img = h("img", { src, alt, loading: "lazy", class: cls });
  img.addEventListener("error", () => img.classList.add("broken"));
  return img;
}

function haOverview(x) {
  const install = (u) => {
    const backup = u.backup && h("input", { type: "checkbox", checked: true });
    confirmAction({
      title: t("ha.installTitle", { name: u.title || u.name }),
      lead: `${u.installed || "—"} → ${u.latest}`,
      extra: backup && uiCheck(t("ha.withBackup"), backup),
      label: t("ha.install"),
      kind: "primary",
      iconName: "download",
      run: async () => {
        await api("POST", `/api/ha/${x.id}/updates`, { entity: u.entity, backup: backup ? backup.checked : false });
        toast(t("ha.installStarted", { name: u.title || u.name }));
        void loadHa();
      },
    });
  };
  const update = (u) =>
    uiRow({
      lead: { icon: "up" },
      name: u.title && !u.name.includes(u.title) ? `${u.name} · ${u.title}` : u.name,
      sub: [`${u.installed || "—"} → ${u.latest}`, u.summary].filter(Boolean).join(" · "),
      state: u.running ? uiState("info", u.percent != null ? t("ha.installingPct", { n: Math.round(u.percent) }) : t("ha.installing")) : null,
      value: !u.running && !u.install ? t("ha.notInstallable") : null,
      action: !u.running && u.install && button(t("ha.install") + "…", { class: "small primary", disabled: !x.online, onclick: () => install(u) }, "download"),
      more: u.url ? [{ label: t("ha.notes"), icon: "external", href: u.url, newTab: true }] : null,
    });
  const busy = x.backupState && x.backupState !== "idle";
  const backupNow = x.canBackup && button(t("ha.backupNow"), { class: "small", disabled: !x.online || busy, onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        await api("POST", `/api/ha/${x.id}/backups`, {});
        toast(t("ha.backupStarted"));
      } catch (err) {
        toast(errorText(err), "error");
        b.disabled = false;
      }
    } }, "archive");
  return h(
    "div",
    { class: "stack" },
    x.proxy === "missing" && haProxyCard(x),
    uiCard({ title: t("ha.updates"), count: x.updates.length || null, flush: true }, x.updates.length ? x.updates.map(update) : uiEmpty({ icon: x.online ? "check" : null, tone: x.online ? "ok" : null, text: x.online ? t("ha.noUpdates") : "—" })),
    x.low.length > 0 && uiCard({ title: t("ha.batteries"), flush: true }, x.low.map((b) => uiRow({ lead: { icon: "battery", tone: "warn" }, name: b.name, state: uiState("warn", b.level == null ? t("ha.batteryLowWord") : `${b.level}%`) }))),
    uiCard(
      { title: t("ha.backups"), marks: busy && uiState("info", t("ha.backupRunning")), flush: true, actions: backupNow },
      x.backups.length ? x.backups.map((b) => uiRow({ mode: "event", lead: { icon: "archive" }, name: b.name, sub: [b.size ? bytes(b.size) : null, b.automatic ? t("ha.backup.auto") : null].filter(Boolean).join(" · ") || null, time: new Date(b.date).toLocaleString(state.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })) : uiEmpty({ text: x.online ? t("ha.noBackups") : "—" }),
    ),
    haPeopleCard(x),
  );
}

/** Home Assistant on this server does not take Hata as its proxy: opened by Hata's address it answers 400 */
function haProxyCard(x) {
  const app = (state.overview?.apps ?? []).find((a) => Number(a.port) === x.port && appUrl(a));
  return uiCard({}, uiNotice({ tone: "warn", title: t("ha.proxy.title"), text: t("ha.proxy.lead", { address: app ? appAddress(app) : location.host }), action: button(t("ha.proxy.allow"), { class: "small primary", disabled: !x.online, onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await api("POST", `/api/ha/${x.id}/proxy`, {});
          toast(t("ha.proxy.asked", { name: x.name }));
        } catch (err) {
          toast(errorText(err), "error");
          b.disabled = false;
        }
      } }, "check") }));
}

/** Who sees the server's tiles on Home: administrators always; everybody, or the users chosen */
function haPeopleCard(x) {
  const card = uiCard({ title: t("ha.people.title"), lead: t("ha.people.lead"), actions: h("a", { class: "ui-link", href: "#/settings/users/access" }, t("access.givenShort"), icon("chevron")) });
  const paint = (users) => {
    const others = users.filter((u) => u.role !== "admin");
    let mode = x.people === "all" ? "all" : x.people.length ? "some" : "none";
    const picked = new Set(Array.isArray(x.people) ? x.people : []);
    const save = async () => {
      const people = mode === "all" ? "all" : mode === "some" ? [...picked] : [];
      try {
        haUi.server = { ...x, ...(await api("PATCH", `/api/ha/${x.id}`, { people })) };
        x.people = haUi.server.people;
        toast(t("ha.people.saved"));
      } catch (e) {
        toast(errorText(e), "error");
      }
    };
    const list = h("div", { class: "ui-rows", hidden: mode !== "some" }, others.map((u) => uiRow({ lead: { check: h("input", { type: "checkbox", checked: picked.has(u.id), "aria-label": u.name, onchange: (e) => (e.target.checked ? picked.add(u.id) : picked.delete(u.id), save()) }) }, name: u.name, sub: t("user.role." + u.role) })));
    const who = h("select", { "aria-label": t("ha.people.title"), onchange: (e) => ((mode = e.target.value), (list.hidden = mode !== "some"), save()) }, ["none", "all", "some"].map((v) => h("option", { value: v, selected: mode === v }, t("ha.people." + v))));
    card.append(...(others.length ? [uiSetting({ name: t("ha.people.who"), control: who }), list] : [uiEmpty({ text: t("ha.people.nobody") })]));
  };
  if (haUi.users) paint(haUi.users);
  else api("GET", "/api/users").then((users) => paint((haUi.users = users)), (e) => card.append(uiNotice({ tone: "bad", text: errorText(e) })));
  return card;
}

function haRow(server, s) {
  const primary = haPrimary(s);
  const home = haOnHome(server, s.id);
  return uiRow({
    id: "ha-row-" + s.id,
    lead: { icon: haIcon(s), tone: haLit(s) ? "accent" : null },
    name: s.name,
    sub: h("span", { class: "mono" }, s.id),
    value: haStateText(s),
    action: primary && button(t("ha.action." + primary.action), { class: "small", onclick: (e) => haPressAsked(server, s, primary, e.currentTarget) }),
    more: [
      { label: t("ha.tile.more"), icon: "sliders", run: () => haEntityDialog(server, s) },
      { label: t(home ? "ha.offHome" : "ha.onHome"), icon: "star", on: home, run: () => haHome(server, s.id, !home) },
    ],
  });
}

const haOnHome = (server, entity) => !!state.overview && !!locate(state.overview.dashboard, `ha:${server}/${entity}`);

async function haHome(server, entity, on) {
  if (!state.overview) await refresh();
  await changeLayout((layout) => {
    if (!on) return void takeTile(layout, `ha:${server}/${entity}`);
    addCard(layout, { type: "ha", server, entity });
  });
  // the page of Home asks the server for the new tile's state; here the row shows it is there
  await refresh();
  const s = haUi.entities?.find((one) => one.id === entity);
  if (s) haSetState(server, s);
  toast(t(on ? "ha.addedHome" : "ha.removedHome", { name: s?.name ?? entity }));
}

function haDevices(x) {
  const list = haUi.entities;
  if (!list) return uiCard({ flush: true }, uiEmpty({ size: "loading", text: t("ha.loading") }));
  const q = haUi.search.trim().toLowerCase();
  const shown = list.filter((s) => (haUi.extra || !s.extra) && (!q || `${s.name} ${s.id} ${s.area}`.toLowerCase().includes(q)));
  const rooms = new Map();
  for (const s of shown) rooms.set(s.area, [...(rooms.get(s.area) ?? []), s]);
  const body = h("div", { class: "stack" });
  const paint = () => renderHaBody();
  const find = h("input", { type: "search", placeholder: t("ha.search"), "aria-label": t("ha.search"), value: haUi.search, oninput: (e) => {
      haUi.search = e.target.value;
      clearTimeout(haUi.searchTimer);
      haUi.searchTimer = setTimeout(() => {
        paint();
        const field = document.querySelector("#ha-body input[type=search]");
        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      }, 250);
    } });
  const which = uiSegment([{ value: "main", label: t("ha.mainOnes") }, { value: "all", label: t("ha.allOnes") }], haUi.extra ? "all" : "main", (v) => ((haUi.extra = v === "all"), paint()));
  const room = ([name, items]) => {
    const open = q || haUi.opened.has(name);
    return uiGroup(
      { name: name || t("ha.noRoom"), count: items.length, open: !haUi.folded.has(name), onToggle: (on) => (on ? haUi.folded.delete(name) : haUi.folded.add(name), paint()) },
      ...(open ? items : items.slice(0, HA_ROOM_ROWS)).map((s) => haRow(x.id, s)),
      !open && items.length > HA_ROOM_ROWS && uiEmpty({ text: t("ha.moreInRoom", { n: items.length - HA_ROOM_ROWS }), action: button(t("ui.showMore"), { class: "small quiet", onclick: () => (haUi.opened.add(name), paint()) }, "down") }),
    );
  };
  put(
    body,
    uiCard(
      { title: t("ha.devices"), count: shown.length, flush: true },
      h("div", { class: "ui-filters" }, which, find),
      !x.online && h("div", { class: "ui-inset" }, uiNotice({ tone: "warn", text: t("ha.lastKnown") })),
      shown.length ? [...rooms].map(room) : uiEmpty({ text: t("ha.pick.none") }),
    ),
  );
  return body;
}

function haMenu(x, at) {
  menuAt(at, h("header", null, uiLead({ icon: "home" }), h("div", null, h("h2", null, x.name), haChip(x))), [
    { label: t("ha.open"), icon: "external", run: () => window.open(haWebUrl(x), "_blank", "noopener") },
    { label: t("ha.change"), icon: "edit", run: () => haDialog(x) },
    { label: t("ha.remove") + "…", icon: "trash", danger: true, run: () => removeHaDialog(x) },
  ]);
}

function removeHaDialog(x) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t("ha.removeTitle", { name: x.name })),
    h("p", { class: "muted" }, t("ha.removeLead")),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("ha.remove"), { class: "danger", onclick: async () => {
        try {
          await api("DELETE", `/api/ha/${x.id}`);
          dialog.close();
          go("#/house");
        } catch (e) {
          toast(errorText(e), "error");
        }
      } }, "trash")),
  );
}

/** Adding a server, or giving it a new address or token: by a person's sign-in or a token pasted */
function haDialog(old = null, address = "") {
  let mode = "login";
  let flow = null;
  const name = h("input", { value: old?.name ?? "", placeholder: "Home Assistant", maxLength: 40 });
  const url = h("input", { value: old?.url ?? address, placeholder: "192.168.1.5", required: true, autocapitalize: "none", spellcheck: false, class: "mono" });
  const user = h("input", { autocapitalize: "none", spellcheck: false, autocomplete: "off", name: "ha-user", required: !old });
  const password = h("input", { type: "password", autocomplete: "new-password", name: "ha-password", required: !old });
  const code = h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxLength: 8, class: "mono" });
  const codeRow = field(t("ha.code"), code, t("ha.codeHint"));
  codeRow.hidden = true;
  const token = h("textarea", { rows: 3, class: "mono small", spellcheck: false, autocomplete: "off", placeholder: "eyJhbGciOi…" });
  const found = uiLine([]);
  const error = h("p", { class: "error", role: "alert" });
  const loginPart = h("div", { class: "stack" }, uiFields(field(t("ha.user"), user), field(t("ha.password"), password)), codeRow, h("p", { class: "muted small" }, t(old ? "ha.loginLeadOld" : "ha.loginLead")));
  const tokenPart = h("div", { class: "stack" }, field(t("ha.token"), token, t("ha.tokenHint")));
  let dialog;
  const modes = h("div");
  const setMode = (m) => {
    mode = m;
    loginPart.hidden = m !== "login";
    tokenPart.hidden = m !== "token";
    user.required = password.required = m === "login" && !old;
    token.required = m === "token" && !old;
    put(modes, uiSegment(["login", "token"].map((v) => ({ value: v, label: t("ha.mode." + v) })), m, setMode, { wide: true }));
    error.textContent = "";
  };
  setMode(mode);
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    const data = { name: name.value, url: url.value };
    if (mode === "login" && flow && code.value) Object.assign(data, { flow, code: code.value });
    else if (mode === "login" && (password.value || !old)) Object.assign(data, { user: user.value, password: password.value });
    else if (mode === "token" && token.value.trim()) data.token = token.value.trim();
    try {
      const saved = old ? await api("PATCH", `/api/ha/${old.id}`, data) : await api("POST", "/api/ha", data);
      dialog.close();
      toast(t(old ? "ha.changed" : "ha.added", { name: saved.name }));
      if (!old) go(`#/ha/${saved.id}`);
      else if (state.route.view === "ha") void loadHa();
    } catch (err) {
      if (err.code === "ha.needCode" || err.code === "ha.badCode") {
        flow = err.detail.flow;
        codeRow.hidden = false;
        code.value = "";
        code.focus();
        if (err.code === "ha.badCode") error.textContent = errorText(err);
      } else error.textContent = errorText(err);
    }
    submit.disabled = false;
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, old ? t("ha.changeTitle", { name: old.name }) : t("ha.addTitle")), closeX(() => dialog)),
      !old && h("p", null, t("ha.addLead")),
      field(t("ha.url"), url, t("ha.urlHint")),
      !old && found,
      modes,
      loginPart,
      tokenPart,
      field(t("ha.name"), name, t("ha.nameHint")),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, h("span", null, old ? t("ha.save") : t("ha.add")))),
    ),
  );
  if (old) return;
  // what answers on the home network, and Home Assistant installed here from the store
  const chip = (label, address) => button([label, h("span", { class: "muted mono small" }, " " + address.replace(/^https?:\/\//, ""))], { class: "small", onclick: () => ((url.value = address), user.focus()) }, "home");
  const isHa = (state.overview?.apps ?? []).some((a) => a.name === "home-assistant");
  put(found, h("span", { class: "muted small" }, t("ha.looking")));
  api("GET", "/api/ha/found").then(
    ({ found: list, address: home }) => {
      const here = isHa && `http://${home || location.hostname}:8123`;
      const fresh = list.filter((f) => !f.known && f.url !== here);
      put(found, here && chip(t("ha.foundHere"), here), fresh.map((f) => chip(f.name, f.url)), !here && !fresh.length && h("span", { class: "muted small" }, t("ha.foundNone")));
    },
    () => put(found, isHa && chip(t("ha.foundHere"), `http://${location.hostname}:8123`)),
  );
}
