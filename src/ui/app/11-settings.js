// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Apps: what is installed, here and on the computers ------------------------------------------------

const appsUi = { show: "all", machine: "" };
const APP_SHOWS = ["all", "running", "stopped", "trouble", "updates"];

/** Every installed app as one row: this server's and, for an administrator, the computers' */
function installedApps() {
  const o = state.overview;
  const here = (o?.apps ?? []).map((app) => ({ app, machine: null, key: app.name, url: isUp(app) ? appUrl(app) : null, address: appAddress(app), page: `#/apps/${app.name}` }));
  const there = (isAdmin() ? (o?.machineApps ?? []) : []).map((app) => ({ app, machine: app.machine, key: app.key, url: app.status === "running" || app.status === "partial" ? machineAppUrl(app.machine, app) : null, address: app.guarded ? `${location.hostname}:${app.guarded}` : app.port && app.machine.ip ? `${app.machine.ip}:${app.port}` : "", page: `#/apps/${app.name}@${app.machine.id}` }));
  return [...here, ...there].sort((a, b) => a.app.title.localeCompare(b.app.title));
}
const appTrouble = (app) => appState(app) === "restarting" || app.status === "partial" || app.status === "unknown";
const appNewer = (app) => !!app.update || app.newer?.length > 0;
const appShown = {
  all: () => true,
  running: ({ app }) => app.status === "running" || app.status === "partial",
  stopped: ({ app }) => app.status === "stopped",
  trouble: ({ app }) => appTrouble(app),
  updates: ({ app }) => appNewer(app),
};

function renderApps() {
  shell(areaHead("apps", "installed", { meta: " ", metaId: "apps-meta", actionsId: "apps-actions" }), h("div", { class: "stack", id: "apps-body" }));
  renderAppsBody();
}

function renderAppsBody() {
  const box = document.getElementById("apps-body");
  if (!box) return;
  if (!state.overview) return put(box, waitMark());
  // on the page of this server: its own apps alone, and nothing of the section's head
  const fixed = state.route.view === "server";
  const all = installedApps().filter((row) => !fixed || !row.machine);
  const count = (id) => all.filter(appShown[id]).length;
  // an update from the store asks about every app by itself: only newer images go all at once
  const newer = all.filter((row) => !row.machine && !row.app.update && row.app.newer?.length > 0 && !row.app.job);
  if (!fixed) put(document.getElementById("apps-meta"), [t("apps.meta.installed", { n: all.length }), t("apps.meta.running", { n: count("running") }), count("updates") > 0 && t("apps.meta.updates", { n: count("updates") })].filter(Boolean).flatMap((part, i) => (i ? [h("span", { class: "ui-dot-sep" }, "·"), part] : [part])));
  if (!fixed) put(document.getElementById("apps-actions"), isAdmin() && newer.length > 0 && button(t("apps.updateAll", { n: newer.length }), { onclick: () => confirmAction({ title: t("apps.updateAll", { n: newer.length }), lead: t("apps.updateAllLead", { names: newer.map((row) => row.app.title).join(", ") }), label: t("app.update"), kind: "primary", iconName: "up", run: () => newer.forEach(({ app }) => void startAction(app, "update")) }) }, "up"), state.user.role !== "guest" && storeButton());
  if (!all.length) return put(box, uiCard({}, uiEmpty({ size: "big", icon: "store", title: t("apps.none"), text: t("apps.noneLead"), action: state.user.role !== "guest" && h("a", { class: "btn primary", href: "#/store" }, icon("store"), h("span", null, t("area.apps.store"))) })));
  const machines = fixed ? [] : [...new Map(all.filter((row) => row.machine).map((row) => [row.machine.id, row.machine.name])).entries()];
  const shown = all.filter(appShown[appsUi.show]).filter((row) => !appsUi.machine || (appsUi.machine === "." ? !row.machine : row.machine?.id === appsUi.machine));
  const hostname = state.overview.system?.hostname ?? t("tree.thisServer");
  const where = machines.length > 0 && h("select", { "aria-label": t("apps.col.machine"), onchange: (e) => ((appsUi.machine = e.target.value), renderAppsBody()) }, h("option", { value: "" }, t("apps.allMachines")), h("option", { value: ".", selected: appsUi.machine === "." }, hostname), machines.map(([id, name]) => h("option", { value: id, selected: appsUi.machine === id }, name)));
  const stateOf = ({ app }) => appStateBadge(app);
  const row = (r) => {
    const { app, machine } = r;
    const more = isAdmin() && (machine ? () => go(r.page) : (e) => appTileMenu(app, e.currentTarget));
    const open = r.url ? h("a", { class: "btn small", href: r.url, target: "_blank", rel: "noopener noreferrer" }, icon("external"), h("span", null, t("app.open"))) : !machine && isAdmin() && app.status === "stopped" && !app.job ? button(t("app.start"), { class: "small", onclick: () => startAction(app, "start") }, "play") : null;
    const address = r.address ? r.address + (app.protected || app.guarded ? ` · ${t("apps.behindSignIn")}` : "") : "";
    return {
      href: r.page,
      menu: machine || !isAdmin() ? true : (at) => appTileMenu(app, null, at),
      cells: [
        uiCell({ lead: { logo: appIcon(app, "row") }, name: app.title }),
        address ? h("span", { class: "mono small", title: address }, address) : "—",
        machines.length > 0 && (machine ? machine.name : hostname),
        stateOf(r),
        (() => {
          const tail = uiLine([open, more && h("button", { type: "button", class: "btn small square ui-more", "aria-label": t("app.more"), "aria-haspopup": "menu", onclick: more }, icon("more"))], { end: true });
          tail.onclick = (e) => e.stopPropagation();
          return tail;
        })(),
      ].filter((c) => c !== false),
      sub: [address, machines.length > 0 && (machine ? machine.name : hostname)].filter(Boolean).join(" · "),
    };
  };
  const filters = uiSegment(APP_SHOWS.filter((id) => id === "all" || id === appsUi.show || count(id) > 0).map((id) => ({ value: id, label: t("apps.show." + id), count: count(id) })), appsUi.show, (v) => ((appsUi.show = v), renderAppsBody()), { label: t("apps.col.state") });
  const columns = [{ label: t("apps.col.app") }, { label: t("apps.col.address") }, machines.length > 0 && { label: t("apps.col.machine") }, { label: t("apps.col.state") }, { label: "" }].filter(Boolean);
  put(
    box,
    uiCard(
      { flush: true },
      h("div", { class: "ui-filters" }, filters, where),
      shown.length ? uiTable(columns, shown.map(row)) : uiEmpty({ text: t("apps.noneShown") }),
    ),
  );
}

function renderStore() {
  const search = h("input", {
    type: "search",
    placeholder: t("store.search"),
    "aria-label": t("store.search"),
    value: state.storeFilter.query,
    oninput: () => {
      state.storeFilter.query = search.value;
      renderStoreList();
    },
  });
  search.classList.add("ui-search");
  shell(
    areaHead("apps", "store", { meta: " ", metaId: "store-meta", search, more: isAdmin() && [{ label: t("store.sync"), icon: "refresh", run: syncStores }, { label: t("store.custom"), icon: "plus", run: customDialog }] }),
    (() => {
      const page = uiWithSide({ mainId: "store-list" });
      page.firstChild.append(uiSide([], { id: "cats", label: t("store.categories") }));
      return page;
    })(),
  );
  renderStoreList();
}

function renderStoreList() {
  const list = document.getElementById("store-list");
  const cats = document.getElementById("cats");
  if (!list || !state.store) return;
  const { query, category } = state.storeFilter;
  const all = state.store.apps;
  const installed = new Set((state.overview?.apps ?? []).map((a) => a.name));

  const synced = Math.max(0, ...state.store.stores.map((s) => s.syncedAt));
  document.getElementById("store-meta")?.replaceChildren([t("store.meta", { stores: state.store.stores.length, apps: all.length }), synced ? t("store.syncedAgo", { time: ago(synced) }) : ""].filter(Boolean).join(" · "));

  const cat = (value, label, n) =>
    uiSideItem({
      label,
      count: n,
      active: category === value,
      onclick: () => {
        state.storeFilter.category = value;
        renderStoreList();
      },
    });
  cats.replaceChildren(
    uiSideTitle(t("store.categories")),
    cat("", t("store.all"), all.length),
    cat("*", t("store.recommended"), all.filter((a) => a.recommended).length),
    ...state.store.categories.map((c) => cat(c, c, all.filter((a) => a.category === c).length)).filter((_, i) => all.some((a) => a.category === state.store.categories[i])),
    uiSideTitle(t("store.onServer")),
    cat("+", t("store.installed"), all.filter((a) => installed.has(a.name)).length),
    ...(storeKinds().length > 0 ? [uiSideTitle(t("store.connect")), cat("@", t("store.allIntegrations"), storeKinds().length)] : []),
  );
  if (category === "@") return list.replaceChildren(storeIntegrationCards(storeKinds(), query));

  // the same app in two stores: each card says whose it is
  const twice = new Set(all.filter((a, i) => all.findIndex((b) => b.name === a.name) !== i).map((a) => a.name));
  const q = query.trim().toLowerCase();
  const inCategory = (a) => category === "" || (category === "*" ? a.recommended : category === "+" ? installed.has(a.name) : a.category === category);
  const apps = all.filter((a) => (!q || `${a.title} ${a.name} ${a.tagline}`.toLowerCase().includes(q)) && inCategory(a));
  if (!all.length) {
    const busy = state.store.stores.some((s) => s.syncing);
    return list.replaceChildren(uiCard({}, busy ? uiEmpty({ size: "loading", text: t("store.syncing") }) : uiEmpty({ size: "big", icon: "store", title: t("store.empty"), action: button(t("store.sync"), { class: "primary", onclick: syncStores }, "refresh") })));
  }
  // a search over everything finds the services to connect too
  const kindsFound = q && category === "" ? storeKinds().filter((k) => `${k.title} ${k.what}`.toLowerCase().includes(q)) : [];
  if (!apps.length && !kindsFound.length) return list.replaceChildren(uiCard({}, uiEmpty({ text: t("store.nothing") })));
  // a long list comes in pieces: 213 cards on a phone were 30 000 px of scrolling
  const key = `${category}|${q}`;
  if (storeShown.key !== key) Object.assign(storeShown, { key, n: STORE_PIECE });
  const left = apps.length - storeShown.n;
  const stateOf = (a) => {
    if (!installed.has(a.name)) return null;
    return state.overview?.apps?.find((one) => one.name === a.name)?.job?.kind === "install" ? uiState("info", t("store.installing")) : uiState("ok", t("store.installed"));
  };
  list.replaceChildren(
    ...(kindsFound.length > 0 ? [storeIntegrationCards(kindsFound, "")] : []),
    uiTiles(
      apps.slice(0, storeShown.n).map((a) =>
        uiTile({
          logo: appIcon(a),
          name: a.title,
          sub: twice.has(a.name) ? `${a.category} · ${a.storeName}` : a.category,
          state: stateOf(a),
          desc: a.tagline,
          onclick: () => (installed.has(a.name) ? go(`#/apps/${a.name}`) : storeDialog(a)),
          menu: (at) => storeCardMenu(a, installed.has(a.name), at),
          tone: a.supported ? null : "off",
        }),
      ),
      { kind: "described" },
    ),
    ...(left > 0 ? [uiCard({}, uiEmpty({ text: t("store.more", { n: left }), action: button(t("load.more", { n: Math.min(left, STORE_PIECE) }), { class: "quiet small", onclick: () => ((storeShown.n += STORE_PIECE), renderStoreList()) }) }))] : []),
  );
}
const STORE_PIECE = 48;
const storeShown = { key: "", n: STORE_PIECE };

/** The services an administrator can connect, as the stores describe them, and Home Assistant, which is Hata's own */
function storeKinds() {
  if (!isAdmin() || !hasModule("integrations")) return [];
  return [{ id: "", title: "Home Assistant", icon: "bulb", what: t("integrations.ha.what"), apps: ["home-assistant"], screenshots: [] }, ...svcKinds()];
}

const kindConnected = (k) => (k.id ? svcConnections().filter((c) => c.kind === k.id) : (state.overview?.ha?.servers ?? []));

function storeIntegrationCards(kinds, query) {
  const q = query.trim().toLowerCase();
  const shown = kinds.filter((k) => !q || `${k.title} ${k.what}`.toLowerCase().includes(q));
  if (!shown.length) return uiCard({}, uiEmpty({ text: t("store.nothing") }));
  return uiTiles(
    shown.map((k) => uiTile({ icon: k.icon, name: k.title, sub: t("store.integration"), state: kindConnected(k).length > 0 ? uiState("ok", t("store.connected")) : null, desc: k.what, onclick: () => storeIntegrationDialog(k) })),
    { kind: "described" },
  );
}

/** A service to connect: what Hata shows of it, how it looks, the app that runs it, and the button */
function storeIntegrationDialog(k) {
  const there = kindConnected(k);
  const apps = (k.apps ?? []).map((name) => state.store?.apps.find((a) => a.name === name)).filter(Boolean);
  const installed = new Set((state.overview?.apps ?? []).map((a) => a.name));
  let dialog;
  const connect = button(t(there.length ? "store.connectAnother" : "store.connectIt"), { class: "primary", onclick: () => (dialog.close(), k.id ? svcConnectDialog(k.id) : haDialog()) }, "plus");
  dialog = openDialog(
    "xwide store-app",
    h("header", null, uiLead({ icon: k.icon }), h("div", { class: "grow" }, h("h2", null, k.title), h("p", { class: "muted" }, k.what), h("p", { class: "muted small" }, [t("store.integration"), k.version && t("store.descVersion", { version: k.version })].filter(Boolean).join(" · "))), closeX(() => dialog)),
    k.screenshots?.length > 0 && shotsView(k.screenshots),
    h(
      "div",
      { class: "stack" },
      h("p", null, t("store.integrationLead")),
      there.length > 0 &&
        uiProse(
          h("ul", null, there.map((c) => h("li", null, h("a", { class: "link", href: k.id ? `#/service/${c.id}` : `#/house/ha/${c.id}`, onclick: () => dialog.close() }, c.name ?? c.title ?? k.title)))),
          { title: t("store.connectedHere"), soft: true },
        ),
      apps.length > 0 &&
        uiProse(
          h(
            "ul",
            null,
            apps.map((a) => h("li", null, h("button", { type: "button", class: "link", onclick: () => (dialog.close(), installed.has(a.name) ? go(`#/apps/${a.name}`) : storeDialog(a)) }, a.title), " — ", installed.has(a.name) ? t("store.installed") : t("store.integrationAppHint"))),
          ),
          { title: t("store.integrationApps"), soft: true },
        ),
    ),
    h("footer", null, h("span", { class: "grow" }), closeButton(() => dialog, t("common.cancel")), connect),
  );
  connect.focus();
}

function formSection(title, hint, rows) {
  return rows.length > 0 && h("section", { class: "stack-s" }, uiSubhead({ title, lead: hint }), rows);
}

/**
 * The settings of an app of Hata's format: each one a variable of the app's `.env`. On install a secret
 * is made by Hata and not shown; afterwards a secret or a password is left as it is unless typed anew.
 * Returns the rows, the advanced ones under "More", and the answers by name.
 */
function settingFields(settings, installing) {
  const inputs = [];
  const rowOf = (s) => {
    if (s.type === "secret" && installing) return null;
    let input;
    if (s.type === "switch") input = h("input", { type: "checkbox", checked: s.value === "true" });
    else if (s.type === "choice") input = choice(s.value, s.options.map((o) => [o.value, o.label]), s.label);
    else {
      const hidden = s.type === "secret" || s.type === "password";
      input = h("input", {
        value: s.value,
        type: hidden ? "password" : s.type === "url" ? "url" : "text",
        inputMode: s.type === "port" || s.type === "number" ? "numeric" : undefined,
        class: "mono" + (s.type === "port" ? " short" : ""),
        spellcheck: false,
        autocapitalize: "none",
        autocomplete: hidden ? "new-password" : "off",
        required: s.required && !s.set,
        placeholder: hidden && s.set ? t("store.settingKept") : "",
      });
    }
    inputs.push({ name: s.name, type: s.type, input });
    const control =
      s.type === "folder"
        ? uiAffix(input, h("button", { type: "button", class: "icon-btn", title: t("edit.pickFolder"), "aria-label": t("edit.pickFolder"), onclick: () => folderPicker({ title: t("edit.pickFolder"), start: input.value.startsWith("/") ? input.value : "", confirmLabel: t("edit.pickHere"), action: (path) => void (input.value = path) }) }, icon("folder")))
        : s.type === "port"
          ? uiAffix(input, s.busy && uiState("warn", t("store.portMoved", { port: s.busy })))
          : input;
    return formRow(s.label, control, s.hint);
  };
  const rows = settings.filter((s) => !s.advanced).map(rowOf).filter(Boolean);
  const more = settings.filter((s) => s.advanced).map(rowOf).filter(Boolean);
  return {
    rows,
    more: more.length > 0 && uiDetails(t("store.more"), more),
    value: () => Object.fromEntries(inputs.map(({ name, type, input }) => [name, type === "switch" ? input.checked : input.value])),
  };
}

/** `target` — the machine to install on; "" — this server */
async function storeDialog(entry, target = state.installTarget ?? "") {
  // the machines an app can go to: connected, with Docker
  if (isAdmin() && hasModule("machines") && !machinesUi.list) machinesUi.list = await api("GET", "/api/machines").catch(() => null);
  const targets = isAdmin() ? (machinesUi.list?.machines ?? []).filter((m) => m.online && m.info?.docker?.available) : [];
  if (target && !targets.some((m) => m.id === target)) target = "";
  let app;
  try {
    app = await api("GET", `/api/store/${entry.store}/apps/${entry.name}?lang=${state.lang}${target ? "&machine=" + target : ""}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const arch = target ? (targets.find((m) => m.id === target)?.info.arch === "arm64" ? "arm64" : "amd64") : state.overview?.arch;
  const supported = app.architectures.length === 0 || app.architectures.includes(arch);
  const settingsForm = app.form.settings ? settingFields(app.form.settings, true) : null;
  const inputs = { ports: [], volumes: [], envs: [] };
  const ports = app.form.ports.map((p) => {
    const input = h("input", { value: p.published, inputMode: "numeric", pattern: "[0-9]*", class: "short mono" });
    inputs.ports.push({ service: p.service, target: p.target, protocol: p.protocol, input });
    return formRow(p.description || t("store.port"), uiAffix(input, `→ ${p.target}/${p.protocol}`, p.busy && uiState("warn", t("store.portBusy"))));
  });
  const volumes = app.form.volumes.map((v) => {
    const input = h("input", { value: v.source, spellcheck: false, class: "mono" });
    inputs.volumes.push({ service: v.service, target: v.target, input });
    return formRow(v.description || v.target, input, `→ ${v.target}`);
  });
  const envs = app.form.envs.map((e) => {
    const secret = /pass|secret|token|key/i.test(e.name);
    const input = h("input", { value: e.value, spellcheck: false, autocomplete: "off", class: "mono", type: secret && e.value === "" ? "password" : "text" });
    inputs.envs.push({ service: e.service, name: e.name, input });
    return formRow(h("span", { class: "mono small" }, e.name), input, e.description);
  });

  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const install = button(t(app.installed ? "store.installed" : "store.install"), {
    class: "primary",
    disabled: app.installed || !supported || !isAdmin(),
    onclick: async () => {
      install.disabled = true;
      error.textContent = "";
      const form = settingsForm
        ? { settings: settingsForm.value() }
        : {
            ports: inputs.ports.map(({ input, ...p }) => ({ ...p, published: input.value })),
            volumes: inputs.volumes.map(({ input, ...v }) => ({ ...v, source: input.value })),
            envs: inputs.envs.map(({ input, ...e }) => ({ ...e, value: input.value })),
          };
      try {
        const res = await api("POST", target ? `/api/machines/${target}/apps` : "/api/apps", { store: app.store, name: app.name, form });
        dialog.close();
        state.installTarget = "";
        jobInBackground(res.job, "install", app.title);
      } catch (e) {
        error.textContent = errorText(e);
        install.disabled = false;
      }
    },
  });

  // where it goes, next to the button that puts it there; with no machine ready, the way to connect one
  const here = t("store.whereHere", { name: state.overview?.system.hostname ?? "Hata" });
  const where =
    isAdmin() &&
    uiLine(
      [
        h("label", { for: "store-target", class: "strong" }, t("store.where")),
        targets.length > 0
          ? h("select", { id: "store-target", onchange: (e) => (dialog.close(), void storeDialog(entry, e.target.value)) }, h("option", { value: "", selected: !target }, here), targets.map((m) => h("option", { value: m.id, selected: m.id === target }, t("store.whereMachine", { name: m.name }))))
          : h("span", null, here),
        targets.length === 0 && h("a", { class: "link small", href: "#/machines", title: t(machinesUi.list?.machines?.length ? "store.whereNoneReady" : "store.whereNone"), onclick: () => dialog.close() }, t("store.whereOther")),
      ],
      { cls: "grow" },
    );
  const hasForm = isAdmin() && (settingsForm ? settingsForm.rows.length > 0 || settingsForm.more : ports.length + volumes.length + envs.length > 0);
  // what the app asks of the server beyond its folders and ports, said before it is installed
  const permissions = app.permissions.length > 0 && uiProse(h("ul", null, app.permissions.map((p) => h("li", null, h("strong", null, t(`store.permission.${p.id}`)), " — ", p.why))), { title: t("store.permissions"), soft: true });
  dialog = openDialog(
    "xwide store-app",
    h("header", null, appIcon(app, "lg"), h("div", { class: "grow" }, h("h2", null, app.title), h("p", { class: "muted" }, app.tagline), h("p", { class: "muted small" }, [app.category, app.developer && t("store.by", { developer: app.developer }), app.version && t("store.version", { version: app.version })].filter(Boolean).join(" · "))), closeX(() => dialog)),
    !supported && uiNotice({ tone: "warn", text: t("store.unsupported", { arch: arch ?? "" }) }),
    app.screenshots.length > 0 && shotsView(app.screenshots),
    // one column, the description across the whole width and what is asked under it (the user's wish, 2026-10-18):
    // two columns squeezed long descriptions with commands into a narrow strip
    h(
      "div",
      { class: "stack" },
      uiProse(md(app.description)),
      app.tips && uiProse(md(app.tips), { title: t("store.tips"), soft: true }),
      hasForm && settingsForm && uiBox(formSection(t("store.settings"), t("store.settingsHint"), settingsForm.rows), settingsForm.more),
      hasForm && !settingsForm && uiBox(formSection(t("store.ports"), target ? t("store.portsOn", { name: targets.find((m) => m.id === target)?.name ?? "" }) : t("store.portsHint"), ports), formSection(t("store.volumes"), target ? t("store.volumesHint", { path: app.form.volumes[0]?.source.split("/AppData/")[0] || "/DATA" }) : state.settings ? t("store.volumesHint", { path: state.settings.dataRoot }) : "", volumes), formSection(t("store.envs"), t("store.envsHint"), envs)),
      permissions,
      app.website && h("a", { class: "link", href: app.website, target: "_blank", rel: "noopener noreferrer" }, app.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), icon("external")),
      uiCommand(`docker compose -p ${app.name} up -d`),
    ),
    error,
    h("footer", null, where, closeButton(() => dialog, t("common.cancel")), install),
  );
  // the dialog would otherwise put the focus ring on its close button
  (install.disabled ? dialog : install).focus();
}

/** An app's screenshots one at a time across the whole width: arrows, a swipe, the arrow keys */
function shotsView(list) {
  const { view, stage, count, prev, next } = uiShots({ prev: () => step(-1), next: () => step(1) });
  let shots = list.map((src) => h("a", { href: src, target: "_blank", rel: "noopener noreferrer", draggable: "false" }, h("img", { src, alt: "", referrerPolicy: "no-referrer", draggable: "false" })));
  let at = 0;
  const step = (by) => show(at + by);
  const show = (i) => {
    if (!shots.length) return view.remove();
    at = (i + shots.length) % shots.length;
    stage.replaceChildren(shots[at]);
    count.textContent = `${at + 1} / ${shots.length}`;
    prev.hidden = next.hidden = count.hidden = shots.length < 2;
  };
  // a picture that does not load leaves the row
  for (const a of shots) a.firstChild.addEventListener("error", () => ((shots = shots.filter((x) => x !== a)), show(Math.min(at, shots.length - 1))));
  stage.addEventListener("keydown", (e) => (e.key === "ArrowLeft" || e.key === "ArrowRight") && (e.preventDefault(), step(e.key === "ArrowLeft" ? -1 : 1)));
  let from = null;
  let swiped = false;
  stage.addEventListener("pointerdown", (e) => ((from = e.clientX), (swiped = false)));
  stage.addEventListener("pointerup", (e) => {
    const moved = from === null ? 0 : e.clientX - from;
    from = null;
    if (Math.abs(moved) > 40 && shots.length > 1) ((swiped = true), step(moved < 0 ? 1 : -1));
  });
  // a swipe is not a click on the picture, which opens it whole
  stage.addEventListener("click", (e) => swiped && e.preventDefault(), true);
  show(0);
  return view;
}

function customDialog() {
  const name = h("input", { required: true, pattern: "[a-z0-9][a-z0-9_\\-]*", autocapitalize: "none", spellcheck: false, class: "mono" });
  const area = uiCode({ wrap: "off", required: true, placeholder: "services:\n  web:\n    image: nginx:alpine\n    ports:\n      - 8088:80\n" });
  const memoryTotal = Math.round((state.overview?.system.memory.total ?? 0) / 1024 / 1024);
  // the first service of a new app has no name of its own: it takes the app's
  let form = appSettingsForm({ title: "", icon: "", web: { scheme: "http", host: "", port: "", path: "/" }, services: [blankService("")] }, memoryTotal);
  const holder = h("div", null, form.el);
  const error = h("p", { class: "error", role: "alert" });
  const lead = h("p", { class: "muted small" });
  const modes = h("div");
  const notice = h("div", { hidden: true });
  const file = field(t("store.customCompose"), area);
  // the third way in: a command from an app's instructions, read into the form
  const command = uiCode({ placeholder: "docker run -d --name whoami -p 8088:80 traefik/whoami" });
  const run = h("div", { class: "stack" }, field(t("run.command"), command));
  const submit = h("button", { class: "btn primary" }, t("store.install"));
  /** form | file | run */
  let current = "form";
  const fromRun = (read) => {
    form = appSettingsForm({ ...read.edit, services: read.edit.services.map((service) => ({ ...service, name: "" })) }, memoryTotal);
    holder.replaceChildren(form.el);
    if (!name.value.trim()) name.value = read.name;
    put(notice, read.ignored.length > 0 && uiNotice({ tone: "warn", text: [h("p", { class: "small" }, t("run.ignored")), read.ignored.map((option) => h("p", { class: "mono small" }, option))] }));
  };
  const mode = (next) => {
    current = next;
    put(modes, uiSegment(["form", "file", "run"].map((value) => ({ value, label: t(`store.custom.${value}`) })), next, mode, { wide: true }));
    lead.textContent = t(`store.custom.${next}Lead`);
    holder.hidden = next !== "form";
    notice.hidden = next !== "form" || !notice.hasChildNodes();
    file.hidden = next !== "file";
    run.hidden = next !== "run";
    // a hidden field must not hold the form back
    area.required = next === "file";
    command.required = next === "run";
    name.required = next !== "run";
    submit.textContent = t(next === "run" ? "run.read" : "store.install");
  };
  const dialog = openDialog(
    "wide",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          const app = name.value.trim();
          try {
            if (current === "run") {
              fromRun(await api("POST", "/api/dockerrun", { command: command.value }));
              return mode("form");
            }
            const asForm = current === "form";
            const settings = form.value();
            for (const service of settings.services) service.name ||= app;
            const res = await api("POST", `/api/apps?lang=${state.lang}`, asForm ? { name: app, settings } : { name: app, compose: area.value });
            dialog.close();
            const picture = asForm ? form.pickedIcon() : null;
            jobInBackground(res.job, "install", (asForm && settings.title) || app, async () => {
              if (picture) await uploadAppIcon(app, picture).catch((err) => toast(errorText(err), "error"));
            });
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("store.customTitle")), lead), closeX(() => dialog)),
      modes,
      notice,
      field(t("store.customName"), name, t("store.customNameHint")),
      holder,
      file,
      run,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), submit),
    ),
  );
  mode("form");
  name.focus();
}

// --- Import -------------------------------------------------------------------------------------
// What already runs on the machine and is not an app here yet: CasaOS's apps, compose projects started
// elsewhere, containers without a compose file.

async function loadImport() {
  try {
    state.import = await api("GET", "/api/import");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "import") renderImportBody();
  if (state.route.view === "welcome") paintWelcome();
}

function renderImport() {
  shell(
    areaHead("apps", "import", { meta: t("import.lead") }),
    h("div", { class: "stack", id: "import-body" }),
  );
  renderImportBody();
}

const importWarnings = (warnings) => warnings.length > 0 && uiNotice({ tone: "warn", text: warnings.map((code) => h("p", { class: "small" }, t("import.warn." + code))) });

/** Shows the compose file an import would write; `confirm` gets the (possibly edited) text and the name */
function importDialog({ title, lead, name, compose, warnings, editable, action, steps, confirm }) {
  const nameInput = name != null && h("input", { required: true, pattern: "[a-z0-9][a-z0-9_\\-]*", autocapitalize: "none", spellcheck: false, class: "mono", value: name });
  const area = uiCode({ wrap: "off", required: true, readOnly: !editable, value: compose, "aria-label": "compose.yml" });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "wide",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await confirm(nameInput ? nameInput.value.trim() : null, area.value, () => dialog.close());
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, title), h("p", { class: "muted small" }, lead)), closeX(() => dialog)),
      importWarnings(warnings),
      nameInput && field(t("store.customName"), nameInput, t("store.customNameHint")),
      field(t("store.customCompose"), area),
      steps && uiProse(h("ol", { class: "muted small" }, steps.map((step) => h("li", null, step)))),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, action)),
    ),
  );
}

async function importProject(project) {
  let draft;
  try {
    draft = await api("GET", `/api/import/projects/${project.name}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  importDialog({
    title: t("import.projectTitle", { name: project.name }),
    lead: t("import.source." + draft.source),
    compose: draft.compose,
    warnings: draft.warnings,
    editable: false,
    action: t("import.take"),
    confirm: async (_name, _text, close) => {
      await api("POST", `/api/import/projects/${project.name}`, {});
      close();
      toast(t("import.taken", { name: project.name }));
      go(`#/apps/${project.name}`);
    },
  });
}

async function importContainer(container) {
  let draft;
  try {
    draft = await api("GET", `/api/import/containers/${container.id}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  importDialog({
    title: t("import.containerTitle", { name: draft.container }),
    lead: t("import.containerLead"),
    name: draft.name,
    compose: draft.compose,
    warnings: draft.warnings,
    editable: true,
    action: t("import.rebuild"),
    steps: [t("import.step.stop", { name: draft.container }), t("import.step.start"), t("import.step.remove"), t("import.step.undo")],
    confirm: async (name, text, close) => {
      const res = await api("POST", `/api/import/containers/${container.id}`, { name, compose: text });
      close();
      jobDialog(res.job, "import", name, () => go(`#/apps/${name}`));
    },
  });
}

function casaosCard(casaos) {
  const ready = casaos.apps.filter((app) => app.status === "ready");
  const stop = h("input", { type: "checkbox", checked: casaos.units.length > 0, disabled: casaos.units.length === 0 });
  const error = h("p", { class: "error", role: "alert" });
  const move = button(ready.length ? t("import.casaos.move", { n: ready.length }) : t("import.casaos.stopOnly"), {
    class: "primary",
    onclick: async () => {
      error.textContent = "";
      move.disabled = true;
      try {
        const result = await api("POST", "/api/import/casaos", { stop: stop.checked });
        toast(t("import.casaos.done", { n: result.moved.length }));
        if (result.stuck.length) toast(t("import.casaos.stuck", { units: result.stuck.join(", ") }), "error");
        await refresh();
      } catch (e) {
        error.textContent = errorText(e);
        move.disabled = false;
      }
    },
  }, "arrow");
  return uiCard(
    { title: t("import.casaos.title", { n: ready.length }), lead: t("import.casaos.lead") },
    casaos.apps.length > 0 && uiRowsIn(casaos.apps.map((app) => uiRow({ lead: { icon: "box" }, name: app.title, sub: h("span", { class: "mono" }, app.source), state: uiState(app.status === "ready" ? "ok" : "warn", t("import.casaos.status." + app.status)) }))),
    uiCheck(h("strong", null, t("import.casaos.stop")), stop, casaos.units.length ? t("import.casaos.stopHint", { units: casaos.units.join(", ") }) : t("import.casaos.stopped")),
    error,
    uiFoot(uiCommand("sudo hata migrate casaos --undo"), move),
  );
}

function renderImportBody() {
  const box = document.getElementById("import-body");
  if (!box || !state.import) return;
  box.replaceChildren(...importParts(state.import, uiCard({}, uiEmpty({ size: "big", icon: "check", title: t("import.nothing") }))));
}

/** What runs on this machine and is not an app here yet; `nothing` stands in when there is none */
function importParts(data, nothing) {
  // a thing that cannot be taken over says why where its button would be
  const problem = (item) => item.problem && uiState("warn", t("import.problem." + item.problem), { title: t("import.problem." + item.problem) });
  const tone = (running, all) => (running === 0 ? "off" : running === all ? "ok" : "warn");
  const parts = [
    data.casaos && casaosCard(data.casaos),
    data.projects.length > 0 &&
      uiCard(
        { title: t("import.projects"), count: data.projects.length, lead: t("import.projectsHint"), flush: true },
        data.projects.map((p) => uiRow({ lead: { icon: "box" }, name: p.name, sub: h("span", { class: "mono" }, p.files.length ? p.files.join(", ") : p.images.join(", ")), state: problem(p) || uiState(tone(p.running, p.containers), t("import.running", { running: p.running, n: p.containers })), action: !p.problem && button(t("import.take") + "…", { class: "small", onclick: () => importProject(p) }) })),
      ),
    data.containers.length > 0 &&
      uiCard(
        { title: t("import.containers"), count: data.containers.length, lead: t("import.containersHint"), flush: true },
        data.containers.map((c) => uiRow({ lead: { icon: "box" }, name: c.name, sub: h("span", { class: "mono" }, c.image), state: problem(c) || uiState(c.state === "running" ? "ok" : c.state === "restarting" ? "warn" : "off", c.status, { title: c.status }), action: !c.problem && button(t("import.rebuild") + "…", { class: "small", onclick: () => importContainer(c) }) })),
      ),
    !data.casaos && !data.projects.length && !data.containers.length && nothing,
  ];
  return parts.filter(Boolean);
}

// --- First run ----------------------------------------------------------------------------------
// The walk through a new server: every step only opens what the pages have anyway, so nothing here
// is the one place a thing can be done.

const WELCOME_STEPS = ["admin", "server", "existing", "modules", "data", "backups", "apps"];
const welcomeUi = {};

/** The language of this browser; `then` — what to load again in it */
function languageSelect(then) {
  const select = h(
    "select",
    {
      "aria-label": t("settings.language"),
      onchange: async () => {
        localStorage.setItem("hata.lang", select.value);
        await loadLanguage(select.value);
        state.store = null;
        await refresh();
        render();
        then?.();
      },
    },
    state.languages.map((code) => h("option", { value: code, selected: code === state.lang }, LANGUAGE_NAMES[code] ?? code)),
  );
  return select;
}

async function endWelcome() {
  if (state.welcome) state.settings = await api("PUT", "/api/settings", { welcome: false });
  state.welcome = false;
}

function welcomeFrame(step, ...content) {
  const at = WELCOME_STEPS.indexOf(step);
  // the administrator is made once; the other steps can be visited in any order
  const steps = WELCOME_STEPS.map((id, i) => ({ name: t(`welcome.step.${id}`), hint: id === "admin" && state.user ? state.user.name : t(`welcome.step.${id}.hint`), href: state.user && id !== "admin" ? `#/welcome/${id}` : null, current: i === at, done: i < at }));
  $app.replaceChildren(
    ...uiWizard({
      title: t("welcome.title"),
      right: [
        languageSelect(() => state.user && void loadWelcome()),
        state.user &&
          button(t("welcome.leave"), {
            class: "quiet",
            onclick: async () => {
              await endWelcome().catch((e) => toast(errorText(e), "error"));
              go("#/");
            },
          }),
      ],
      steps,
      eyebrow: t("welcome.stepOf", { n: at + 1, of: WELCOME_STEPS.length }),
      body: content,
    }),
  );
}

function renderWelcome() {
  welcomeFrame(state.route.step, h("div", { class: "stack", id: "welcome-body" }));
  paintWelcome();
}

async function loadWelcome() {
  const step = state.route.step;
  const quiet = (path) => api("GET", path).catch(() => null);
  const [settings, local, found, disks, store] = await Promise.all([
    quiet("/api/settings"),
    step === "server" ? quiet("/api/local") : state.local,
    step === "existing" ? quiet("/api/import") : state.import,
    step === "data" || step === "backups" ? quiet("/api/disks") : state.disks,
    step === "apps" ? quiet(`/api/store?lang=${state.lang}`) : state.store,
  ]);
  if (step === "modules") {
    state.modulesList = (await quiet("/api/modules"))?.modules ?? state.modulesList;
    // the look around takes a few seconds: the step shows at once and says what was found when it is known
    void loadModuleFinds().then(() => state.route.view === "welcome" && state.route.step === "modules" && paintWelcome());
  }
  Object.assign(state, { settings: settings ?? state.settings, local, import: found, disks, store });
  if (state.route.view === "welcome" && state.route.step === step) paintWelcome();
}

/** The file system a folder lies on: the deepest mount point above it */
const placeOf = (folder, mounts) => mounts.filter((m) => m.path === "/" || folder === m.path || folder.startsWith(m.path + "/")).sort((a, b) => b.path.length - a.path.length)[0] ?? null;

function welcomeFoot(step, save) {
  const at = WELCOME_STEPS.indexOf(step);
  const last = at === WELCOME_STEPS.length - 1;
  const error = h("p", { class: "error", role: "alert" });
  const next = button(t(last ? "welcome.finish" : "welcome.next"), {
    class: "primary",
    onclick: async () => {
      next.disabled = true;
      error.textContent = "";
      try {
        await save?.();
        if (last) await endWelcome();
        go(last ? "#/" : `#/welcome/${WELCOME_STEPS[at + 1]}`);
      } catch (e) {
        error.textContent = errorText(e);
        next.disabled = false;
      }
    },
  });
  return [error, uiWizardFoot(at > 1 && h("a", { class: "btn", href: `#/welcome/${WELCOME_STEPS[at - 1]}` }, t("welcome.back")), next)];
}

/** Docker in one card: there and running, or what is missing with the button that brings it */
function welcomeDocker() {
  const d = state.overview?.docker;
  if (!d) return null;
  if (d.available) return uiCard({ flush: true }, uiRow({ lead: { icon: "check", tone: "ok" }, name: t("welcome.docker.ok"), sub: [d.version && `Docker ${d.version}`, d.compose && `Compose ${d.compose}`].filter(Boolean).join(" · ") }));
  const stopped = d.state === "stopped";
  return uiCard(
    { flush: true },
    uiRow({
      lead: { icon: "alert", tone: "warn" },
      name: t(stopped ? "attention.docker.stopped.title" : "attention.docker.missing.title"),
      sub: t(stopped ? "welcome.docker.stopped" : "docker.why"),
      action: stopped ? dockerStartButton() : button(t("docker.install"), { class: "small primary", onclick: dockerDialog }, "download"),
    }),
  );
}

function paintWelcome() {
  const box = document.getElementById("welcome-body");
  const step = state.route.step;
  const s = state.settings;
  if (!box) return;
  const head = [h("h1", null, t(`welcome.${step}.title`)), h("p", { class: "muted" }, t(`welcome.${step}.lead`))];
  const waiting = waitMark();

  if (step === "server") {
    if (!s) return put(box, ...head, waiting);
    const name = h("input", { value: s.local.name, maxLength: 253, placeholder: "hata.local", spellcheck: false, autocapitalize: "none", class: "mono", required: true });
    const tz = h("input", { value: s.timezone, spellcheck: false, placeholder: s.systemTimezone, class: "mono" });
    const port = state.local && state.local.port !== 80 ? ":" + state.local.port : "";
    return put(
      box,
      ...head,
      uiCard(
        {},
        settingRow(t("welcome.server.name"), t("local.nameHint"), name),
        settingRow(t("settings.timezone"), t("settings.timezoneHint", { tz: s.systemTimezone }), tz),
        state.local?.addresses.length > 0 && settingRow(t("welcome.server.address"), t("welcome.server.addressHint"), h("span", { class: "mono" }, state.local.addresses.map((a) => `http://${a}${port}`).join(", "))),
      ),
      ...welcomeFoot(step, async () => {
        const patch = { timezone: tz.value.trim(), language: state.lang };
        if (name.value.trim().toLowerCase() !== s.local.name) patch.local = { name: name.value };
        state.settings = await api("PUT", "/api/settings", patch);
      }),
    );
  }

  if (step === "modules") {
    const list = state.modulesList;
    if (!list) return put(box, ...head, waiting);
    const finds = state.moduleFinds;
    // what the person ticked stays through a repaint; what was found is ticked until they say otherwise
    const picks = (welcomeUi.picks ??= {});
    const wanted = (m) => picks[m.id] ?? (m.on || findsFor(m.id).length > 0);
    const ticks = new Map();
    const pick = (m) => {
      const found = m.on ? [] : findsFor(m.id);
      const tick = h("input", { type: "checkbox", checked: wanted(m), onchange: () => (picks[m.id] = tick.checked) });
      ticks.set(m.id, tick);
      return uiOption({
        input: tick,
        icon: MODULE_ICONS[m.id],
        name: moduleName(m.id),
        lines: [t(`modules.${m.id}.what`), m.needs.length > 0 && "↳ " + t("modules.needsModule", { needs: m.needs.map(moduleName).join(", ") })],
        found: found.map(findWords),
      });
    };
    const foundNames = finds ? list.filter((m) => !m.on && findsFor(m.id).length > 0).map((m) => moduleName(m.id)) : [];
    return put(
      box,
      ...head,
      MODULE_GROUPS.map((group) => {
        const mine = list.filter((m) => m.group === group);
        return mine.length > 0 && h("div", { class: "stack" }, uiSubhead({ title: t("modules.group." + group) }), uiFields(...mine.map(pick)));
      }),
      uiNotice({ tone: "info", text: !finds ? t("welcome.modules.looking") : foundNames.length ? t("welcome.modules.found", { n: foundNames.length, names: foundNames.join(", ") }) : t("welcome.modules.nothing") }),
      h("p", { class: "muted small" }, t("welcome.modules.more"), " ", h("a", { class: "link", href: "#/settings/modules" }, t("modules.title"))),
      ...welcomeFoot(step, async () => {
        let now = list;
        for (const m of list) {
          const want = ticks.get(m.id).checked;
          // one turned on a moment ago because another stands on it stays on
          if (want === now.find((x) => x.id === m.id).on || (!want && list.some((x) => ticks.get(x.id).checked && x.needs.includes(m.id)))) continue;
          now = (await api("PUT", `/api/modules/${m.id}`, { on: want, withNeeds: true })).modules;
        }
        state.modulesList = now;
        state.modules = Object.fromEntries(now.map((m) => [m.id, m.on]));
      }),
    );
  }

  if (step === "existing") {
    const found = state.import;
    return put(box, ...head, welcomeDocker() ?? waiting, ...(found ? importParts(found, uiCard({}, uiEmpty({ size: "big", icon: "check", title: t("welcome.existing.nothing"), text: t("welcome.existing.nothingHint") }))) : []), ...welcomeFoot(step));
  }

  if (step === "data") {
    if (!s) return put(box, ...head, waiting);
    const disks = state.disks;
    const place = disks && placeOf(s.dataRoot, disks.mounts);
    const unused = (disks?.mounting?.unused ?? []).map((u) => u.id);
    const fresh = (disks?.disks ?? []).filter((d) => unused.includes(d.serial || d.name) && (canPrepare(d) || canConnect(d).length > 0));
    const diskRow = (disk) => {
      const holds = disk.volumes.filter((v) => v.fstype);
      const connectable = canConnect(disk);
      return uiCard(
        { flush: true },
        uiRow({
          lead: { icon: "disk" },
          name: diskTitle(disk),
          sub: [h("div", null, diskMeta(disk)), h("div", null, holds.length ? t("mounting.foundHolds", { what: holds.map((v) => [v.label, v.fstype].filter(Boolean).join(" · ")).join("; ") }) : t("mounting.foundEmpty"))],
          action: uiLine([connectable.length > 0 && button(t("mounting.connect"), { class: "small", onclick: () => connectDialog(disk, connectable[0]) }), canPrepare(disk) && button(t("mounting.format"), { class: "small", onclick: () => formatDialog(disk) })]),
        }),
      );
    };
    return put(
      box,
      ...head,
      uiCard(
        { flush: true },
        uiRow({
          lead: { icon: "folder" },
          name: h("span", { class: "mono" }, s.dataRoot),
          sub: [h("div", null, place ? t("welcome.data.on", { device: place.device, path: place.path, free: bytes(Math.max(0, place.total - place.used)), total: bytes(place.total) }) : t("welcome.data.unknown")), place?.path === "/" && h("div", null, t("welcome.data.system"))],
          action: button(t("data.choose"), { class: "small", onclick: () => pickDataRoot() }, "folder"),
        }),
      ),
      uiSubhead({ title: t("welcome.data.disks"), actions: h("a", { class: "link small", href: "#/settings/storage" }, t("welcome.data.all")) }),
      !disks ? waiting : fresh.length ? fresh.map(diskRow) : h("p", { class: "muted" }, t("welcome.data.noDisks")),
      fresh.length > 0 && h("p", { class: "muted small" }, t("welcome.data.how")),
      ...welcomeFoot(step),
    );
  }

  if (step === "backups") {
    if (!s) return put(box, ...head, waiting);
    const b = s.backup;
    const mounts = state.disks?.mounts ?? [];
    // offered switched on: the step is here to be answered, and the answer is saved only by "Continue"
    const enabled = h("input", { type: "checkbox", checked: b.enabled || state.welcome });
    const time = h("input", { type: "time", value: b.time, required: true });
    const keep = h("input", { type: "number", min: 1, max: 365, value: b.keep, required: true, class: "short" });
    const dir = h("input", { value: b.dir, spellcheck: false, placeholder: `${s.dataRoot}/Backups`, class: "mono" });
    const same = uiNotice({ tone: "warn", text: t("welcome.backups.sameDisk") });
    const check = () => {
      const [data, copy] = [placeOf(s.dataRoot, mounts), placeOf(dir.value.trim() || `${s.dataRoot}/Backups`, mounts)];
      same.hidden = !data || !copy || data.path !== copy.path;
    };
    dir.addEventListener("input", check);
    check();
    const places = Object.keys(state.disks?.mounting?.ours ?? {}).filter((path) => !(s.dataRoot + "/").startsWith(path + "/"));
    return put(
      box,
      ...head,
      uiCard(
        {},
        uiCheck(h("strong", null, t("backup.enable")), enabled, t("backup.enableHint")),
        uiFields(field(`${t("backup.time")} · ${s.timezone || s.systemTimezone}`, time), field(t("backup.keep"), keep)),
        field(t("backup.dir"), dir, t("backup.dirHint")),
        places.length > 0 && uiLine(places.map((path) => button(`${path}/Backups`, { class: "small mono", onclick: () => ((dir.value = `${path}/Backups`), check()) }))),
        same,
      ),
      h("p", { class: "muted small" }, t("welcome.backups.more"), " ", h("a", { class: "link", href: "#/settings/backups" }, t("nav.backups"))),
      ...welcomeFoot(step, async () => {
        state.settings = await api("PUT", "/api/settings", { backup: { enabled: enabled.checked, time: time.value, keep: Number(keep.value), dir: dir.value.trim() } });
      }),
    );
  }

  // the last step: whoever got here has seen the choices, the server stops opening with them
  if (state.welcome) void endWelcome().catch(() => {});
  const store = state.store;
  const docker = state.overview?.docker;
  const installed = new Set((state.overview?.apps ?? []).map((a) => a.name));
  const offered = (store?.apps ?? []).filter((a) => a.recommended && a.supported).slice(0, 9);
  // the same app in two stores: each card says whose it is
  const twice = new Set(offered.filter((a, i) => offered.findIndex((b) => b.name === a.name) !== i).map((a) => a.name));
  const busy = store?.stores.some((x) => x.syncing);
  put(
    box,
    ...head,
    docker && !docker.available && welcomeDocker(),
    !store
      ? waiting
      : offered.length
        ? uiTiles(
            offered.map((a) => {
              const isIn = installed.has(a.name);
              const busyNow = isIn && state.overview?.apps?.find((one) => one.name === a.name)?.job?.kind === "install";
              // the one place a tile has a button: there is no window behind it in the walk
              return uiTile({ logo: appIcon(a), name: a.title, sub: twice.has(a.name) ? `${a.category} · ${a.storeName}` : a.category, desc: a.tagline, menu: (at) => storeCardMenu(a, isIn, at), state: isIn ? uiState(busyNow ? "info" : "ok", t(busyNow ? "store.installing" : "store.installed")) : null, tail: !isIn && button(t("store.install"), { class: "small", onclick: () => storeDialog(a) }, "download"), href: isIn ? `#/apps/${a.name}` : null });
            }),
            { kind: "described" },
          )
        : uiCard({}, busy ? uiEmpty({ size: "loading", text: t("store.syncing") }) : uiEmpty({ size: "big", icon: "store", title: t("store.empty"), action: button(t("store.sync"), { class: "primary", onclick: async () => (await syncStores(), loadWelcome()) }, "refresh") })),
    h("p", { class: "muted small" }, t("welcome.apps.more"), " ", h("a", { class: "link", href: "#/store" }, t("nav.store"))),
    ...welcomeFoot(step),
  );
}

// --- Settings -----------------------------------------------------------------------------------

async function loadSettings() {
  try {
    state.account = await api("GET", "/api/account");
    if (isAdmin()) state.settings = await api("GET", "/api/settings");
    if (isAdmin()) state.update = await api("GET", "/api/update").catch(() => null);
    if (isAdmin()) state.notify = await api("GET", "/api/notify").catch(() => null);
    if (isAdmin() && showsSection("notifications")) state.hiddenItems = (await api("GET", "/api/attention/hidden").catch(() => null))?.hidden ?? null;
    if (isAdmin() && showsSection("apps")) state.images = await api("GET", "/api/images").catch(() => null);
    if (isAdmin() && showsSection("network")) state.network = await api("GET", "/api/network").catch(() => null);
    if (isAdmin() && showsSection("remote") && hasModule("remote")) [state.remote, state.wireguard] = await Promise.all([api("GET", "/api/tailscale").catch(() => null), api("GET", "/api/wireguard").catch(() => null)]);
    if (isAdmin() && showsSection("bluetooth") && hasModule("bluetooth")) state.bluetooth = await api("GET", "/api/bluetooth").catch((e) => ({ error: errorText(e) }));
    if (isAdmin() && showsSection("schedule")) [state.schedule, state.power] = await Promise.all([api("GET", "/api/schedule").catch((e) => ({ error: errorText(e) })), api("GET", "/api/power").catch(() => null)]);
    if (isAdmin() && showsSection("tools")) [state.tools, sysUpdates[""]] = await Promise.all([api("GET", "/api/tools").catch(() => null), api("GET", "/api/system/updates").catch((e) => ({ error: errorText(e) }))]);
    // counting the volumes takes a while: the page is shown first
    if (isAdmin() && showsSection("docker")) void loadSpace();
    if (isAdmin() && STORAGE_SECTIONS.includes(state.route.section)) [state.disks, state.places] = await Promise.all([api("GET", "/api/disks").catch(() => null), hasModule("netplaces") ? api("GET", "/api/netplaces").catch(() => null) : null]);
    if (isAdmin() && showsSection("shares") && hasModule("shares")) state.shares = await api("GET", "/api/shares").catch(() => null);
    if (isAdmin() && showsSection("agents") && hasModule("assistant")) state.agents = await api("GET", "/api/agents").catch(() => null);
    if (isAdmin() && showsSection("modules")) state.modulesList = (await api("GET", "/api/modules").catch(() => null))?.modules ?? null;
    if (isAdmin() && showsSection("assistant") && hasModule("assistant")) state.assistant = await api("GET", "/api/assistant").catch(() => null);
    if (!state.store && isAdmin()) state.store = await api("GET", `/api/store?lang=${state.lang}`).catch(() => null);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "settings") renderSettings();
  // "N hidden" under the list leads straight to them
  if (showsSection("notifications") && location.hash.endsWith("/hidden")) document.getElementById("hidden")?.scrollIntoView({ block: "start" });
}

const LANGUAGE_NAMES = { en: "English", uk: "Українська" };
/** The sections of Settings by what they are about; a member sees those without `admin` */
const SECTIONS = [
  { id: "account", icon: "user", group: "you" },
  { id: "general", icon: "sliders", group: "server" },
  { id: "schedule", icon: "clock", group: "server", admin: true },
  { id: "appearance", icon: "image", group: "server", admin: true },
  { id: "notifications", icon: "bell", group: "server", admin: true },
  { id: "modules", icon: "modules", group: "server", admin: true },
  { id: "bluetooth", icon: "bluetooth", group: "server", admin: true },
  { id: "tools", icon: "terminal", group: "server", admin: true },
  { id: "about", icon: "info", group: "server" },
  { id: "users", icon: "users", group: "people", admin: true, label: "nav.users" },
  { id: "apps", icon: "grid", group: "apps", admin: true },
  { id: "stores", icon: "store", group: "apps", admin: true },
  { id: "docker", icon: "box", group: "apps", admin: true },
  { id: "storage", icon: "disk", group: "storage", admin: true },
  { id: "shares", icon: "share", group: "storage", admin: true },
  { id: "places", icon: "network", group: "storage", admin: true },
  { id: "protection", icon: "shield", group: "storage", admin: true },
  { id: "backups", icon: "archive", group: "storage", admin: true, label: "nav.backups" },
  { id: "network", icon: "network", group: "network", admin: true },
  { id: "remote", icon: "globe", group: "network", admin: true },
  { id: "https", icon: "lock", group: "network", admin: true },
  { id: "ports", icon: "plug", group: "network", admin: true },
  { id: "dns", icon: "signpost", group: "network", admin: true },
  { id: "adblock", icon: "ban", group: "network", admin: true },
  { id: "agents", icon: "key", group: "automation", admin: true },
  { id: "assistant", icon: "chat", group: "automation", admin: true },
];
const SECTION_GROUPS = ["you", "server", "people", "apps", "storage", "network", "automation"];
/** The sections that read the disks' report */
const STORAGE_SECTIONS = ["storage", "places", "protection"];
const onStorageSection = () => state.route.view === "settings" && STORAGE_SECTIONS.includes(state.route.section);
const sectionTitle = (item) => t(item.label ?? "settings." + item.id);

/** What "Find a setting" looks through: each section's cards by their strings, and the words a person may think of (`settings.find.<id>`) */
const SECTION_CARDS = {
  account: ["account.password", "twofa.title", "passkey.title", "account.sessions"],
  general: ["settings.language", "settings.port", "welcome.again"],
  users: ["access.title", "invite.title2", "signins.title"],
  backups: ["backup.server", "backup.schedule", "offsite.title"],
  appearance: ["appearance.colours", "appearance.picture"],
  apps: ["settings.dataRoot", "settings.timezone", "images.title", "state.title"],
  docker: ["docker.images", "docker.volumes"],
  bluetooth: ["bt.devices", "bt.add"],
  storage: ["disks.title", "disks.fs.title"],
  shares: ["shares.title", "shares.users.title", "shares.how.title"],
  places: ["netplace.title"],
  protection: ["array.title", "raid.title"],
  remote: ["remote.networks", "remote.devices", "wg.in.title", "wg.out.title"],
  https: ["local.title", "names.title", "https.checkTitle", "https.addresses"],
  ports: ["ports.title"],
  dns: ["dns.upTitle", "dns.namesTitle", "dns.usageTitle"],
  adblock: ["adblock.lists", "adblock.own", "adblock.log", "adblock.import"],
  notifications: ["notify.telegram.title", "notify.ntfy.title", "notify.email.title", "notify.webhook.title"],
  agents: ["agents.title", "agents.how.title", "agents.levels.title"],
  tools: ["sysupdates.title"],
};

/** Sections and cards whose names hold the words typed; a section's other words lead to the section itself */
function findSettings(typed) {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  return SECTIONS.filter((item) => !item.admin || isAdmin()).flatMap((item) => {
    // a section of a module that is off is found too: it is where the module is turned on
    const off = SECTION_MODULE[item.id] && !hasModule(SECTION_MODULE[item.id]) ? SECTION_MODULE[item.id] : "";
    const cards = (SECTION_CARDS[item.id] ?? []).map((key) => t(key)).filter((text) => text.toLowerCase().includes(q));
    const named = sectionTitle(item).toLowerCase().includes(q) || t("settings.find." + item.id).toLowerCase().includes(q);
    return cards.length || named ? [{ item, cards: off ? [] : cards, off }] : [];
  });
}

/** A piece of text with the words typed marked */
function markFound(text, typed) {
  const at = text.toLowerCase().indexOf(typed.trim().toLowerCase());
  if (at < 0) return text;
  const end = at + typed.trim().length;
  return [text.slice(0, at), h("mark", null, text.slice(at, end)), text.slice(end)];
}

/** Opens a section and brings the card asked for into view: the section may draw it a moment later */
function openSettingsCard(item, card) {
  go(sectionHash(item.id));
  if (!card) return;
  let tries = 0;
  const look = () => {
    const found = [...document.querySelectorAll(".ui-settings-frame :is(h2, h3, strong)")].find((el) => el.textContent.trim().startsWith(card));
    if (found) return found.scrollIntoView({ block: "center" });
    if (++tries < 20) setTimeout(look, 200);
  };
  setTimeout(look, 100);
}
