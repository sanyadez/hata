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
  if (!fixed) put(document.getElementById("apps-meta"), [t("apps.meta.installed", { n: all.length }), t("apps.meta.running", { n: count("running") }), count("updates") > 0 && t("apps.meta.updates", { n: count("updates") })].filter(Boolean).flatMap((part, i) => (i ? [h("span", { class: "dot-sep" }, "·"), part] : [part])));
  if (!fixed) put(document.getElementById("apps-actions"), isAdmin() && newer.length > 0 && button(t("apps.updateAll", { n: newer.length }), { onclick: () => confirmAction({ title: t("apps.updateAll", { n: newer.length }), lead: t("apps.updateAllLead", { names: newer.map((row) => row.app.title).join(", ") }), label: t("app.update"), kind: "primary", iconName: "up", run: () => newer.forEach(({ app }) => void startAction(app, "update")) }) }, "up"), state.user.role !== "guest" && storeButton());
  if (!all.length) return put(box, h("section", { class: "card pad empty-state" }, h("h2", null, t("apps.none")), h("p", { class: "muted" }, t("apps.noneLead")), state.user.role !== "guest" && h("a", { class: "btn primary", href: "#/store" }, icon("store"), h("span", null, t("area.apps.store")))));
  const machines = fixed ? [] : [...new Map(all.filter((row) => row.machine).map((row) => [row.machine.id, row.machine.name])).entries()];
  const shown = all.filter(appShown[appsUi.show]).filter((row) => !appsUi.machine || (appsUi.machine === "." ? !row.machine : row.machine?.id === appsUi.machine));
  const hostname = state.overview.system?.hostname ?? t("tree.thisServer");
  const where = machines.length > 0 && h("select", { "aria-label": t("apps.col.machine"), onchange: (e) => ((appsUi.machine = e.target.value), renderAppsBody()) }, h("option", { value: "" }, t("apps.allMachines")), h("option", { value: ".", selected: appsUi.machine === "." }, hostname), machines.map(([id, name]) => h("option", { value: id, selected: appsUi.machine === id }, name)));
  const state_ = ({ app }) => {
    const st = appState(app);
    const tone = st === "running" ? "running" : st === "busy" || st === "partial" ? "busy" : st === "restarting" ? "restarting" : "";
    const words = app.job ? t("status.busy") : appNewer(app) && st === "running" ? t("apps.hasUpdate") : t("status." + st);
    return h("span", { class: "with-dot" + (st === "restarting" || st === "partial" || (appNewer(app) && st === "running") ? " warn-text" : st === "stopped" || st === "unknown" ? " muted" : "") }, h("i", { class: "dot " + (appNewer(app) && st === "running" ? "partial" : tone) }), words);
  };
  const row = (r) => {
    const { app, machine } = r;
    const menu = (anchor, at) => (machine ? go(r.page) : isAdmin() ? appTileMenu(app, anchor, at) : null);
    return h(
      "tr",
      { menu: machine || !isAdmin() ? true : (at) => appTileMenu(app, null, at) },
      h("td", null, h("a", { class: "with-icon strong", href: r.page }, appIcon(app, "sm"), h("span", { class: "clip" }, app.title))),
      h("td", { class: "muted mono small" }, r.address ? h("span", { class: "clip" }, r.address, app.protected || app.guarded ? ` · ${t("apps.behindSignIn")}` : "") : "—"),
      machines.length > 0 && h("td", { class: "muted" }, machine ? h("a", { href: `#/machines/${machine.id}` }, machine.name) : hostname),
      h("td", null, state_(r)),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions end" },
          r.url ? h("a", { class: "btn small", href: r.url, target: "_blank", rel: "noopener noreferrer" }, icon("external"), h("span", null, t("app.open"))) : !machine && isAdmin() && app.status === "stopped" && !app.job ? button(t("app.start"), { class: "small", onclick: () => startAction(app, "start") }, "play") : null,
          isAdmin() && h("button", { type: "button", class: "btn small square", "aria-label": t("app.more"), "aria-haspopup": "menu", onclick: (e) => menu(e.currentTarget) }, icon("more")),
        ),
      ),
    );
  };
  put(
    box,
    h(
      "div",
      { class: "card filter-bar" },
      h("div", { class: "seg-pills" }, APP_SHOWS.filter((id) => id === "all" || id === appsUi.show || count(id) > 0).map((id) => h("button", { type: "button", class: "seg-pill" + (appsUi.show === id ? " active" : ""), "aria-pressed": String(appsUi.show === id), onclick: () => ((appsUi.show = id), renderAppsBody()) }, t("apps.show." + id), " ", h("span", { class: "muted" }, String(count(id)))))),
      where && h("label", { class: "pair" }, h("span", { class: "muted small" }, t("apps.col.machine")), where),
    ),
    h(
      "div",
      { class: "card table-wrap" },
      shown.length
        ? h("table", { class: "apps-table" }, h("thead", null, h("tr", null, h("th", null, t("apps.col.app")), h("th", null, t("apps.col.address")), machines.length > 0 && h("th", null, t("apps.col.machine")), h("th", null, t("apps.col.state")), h("th"))), h("tbody", null, shown.map(row)))
        : h("p", { class: "pad muted" }, t("apps.noneShown")),
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
  shell(
    areaHead("apps", "store", { meta: " ", metaId: "store-meta", actions: isAdmin() && [button(t("store.sync"), { class: "ghost", onclick: syncStores }, "refresh"), button(t("store.custom"), { onclick: customDialog }, "plus")] }),
    h("div", { class: "search wide" }, icon("search"), search),
    h("div", { class: "store" }, h("nav", { class: "cats fold", id: "cats", "aria-label": t("store.categories") }), h("div", { id: "store-list" })),
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
  document.getElementById("store-meta")?.replaceChildren(t("store.meta", { stores: state.store.stores.length, apps: all.length }), synced ? h("span", { class: "dot-sep" }, "·") : "", synced ? t("store.syncedAgo", { time: ago(synced) }) : "");

  const cat = (value, label, n) =>
    h(
      "button",
      {
        type: "button",
        class: "cat" + (category === value ? " active" : ""),
        "aria-pressed": String(category === value),
        onclick: () => {
          state.storeFilter.category = value;
          renderStoreList();
        },
      },
      h("span", null, label),
      h("span", { class: "muted small" }, n),
    );
  cats.replaceChildren(
    h("div", { class: "cat-title" }, t("store.categories")),
    cat("", t("store.all"), all.length),
    cat("*", t("store.recommended"), all.filter((a) => a.recommended).length),
    ...state.store.categories.map((c) => cat(c, c, all.filter((a) => a.category === c).length)).filter((_, i) => all.some((a) => a.category === state.store.categories[i])),
    h("div", { class: "cat-title" }, t("store.onServer")),
    cat("+", t("store.installed"), all.filter((a) => installed.has(a.name)).length),
    ...(storeKinds().length > 0 ? [h("div", { class: "cat-title" }, t("store.connect")), cat("@", t("store.allIntegrations"), storeKinds().length)] : []),
  );
  if (category === "@") return list.replaceChildren(storeIntegrationCards(storeKinds(), query));

  // the same app in two stores: each card says whose it is
  const twice = new Set(all.filter((a, i) => all.findIndex((b) => b.name === a.name) !== i).map((a) => a.name));
  const q = query.trim().toLowerCase();
  const inCategory = (a) => category === "" || (category === "*" ? a.recommended : category === "+" ? installed.has(a.name) : a.category === category);
  const apps = all.filter((a) => (!q || `${a.title} ${a.name} ${a.tagline}`.toLowerCase().includes(q)) && inCategory(a));
  if (!all.length) {
    const busy = state.store.stores.some((s) => s.syncing);
    return list.replaceChildren(h("div", { class: "empty" }, h("p", null, t(busy ? "store.syncing" : "store.empty")), !busy && button(t("store.sync"), { class: "primary", onclick: syncStores }, "refresh")));
  }
  // a search over everything finds the services to connect too
  const kindsFound = q && category === "" ? storeKinds().filter((k) => `${k.title} ${k.what}`.toLowerCase().includes(q)) : [];
  if (!apps.length && !kindsFound.length) return list.replaceChildren(h("p", { class: "empty" }, t("store.nothing")));
  list.replaceChildren(
    ...(kindsFound.length > 0 ? [storeIntegrationCards(kindsFound, "")] : []),
    h(
      "div",
      { class: "cards" },
      apps.map((a) =>
        h(
          "button",
          { type: "button", class: "store-card" + (a.supported ? "" : " unsupported"), onclick: () => (installed.has(a.name) ? go(`#/apps/${a.name}`) : storeDialog(a)), menu: (at) => storeCardMenu(a, installed.has(a.name), at) },
          h("span", { class: "store-card-head" }, appIcon(a), h("span", { class: "grow" }, h("span", { class: "tile-name" }, a.title), h("span", { class: "muted small" }, twice.has(a.name) ? `${a.category} · ${a.storeName}` : a.category)), installed.has(a.name) ? (state.overview?.apps?.find((one) => one.name === a.name)?.job?.kind === "install" ? h("span", { class: "chip" }, t("store.installing")) : h("span", { class: "chip ok" }, icon("check"), t("store.installed"))) : h("span", { class: "chip" }, t("store.install"))),
          h("span", { class: "tagline" }, a.tagline),
        ),
      ),
    ),
  );
}

/** The services an administrator can connect, as the stores describe them, and Home Assistant, which is Hata's own */
function storeKinds() {
  if (!isAdmin() || !hasModule("integrations")) return [];
  return [{ id: "", title: "Home Assistant", icon: "bulb", what: t("integrations.ha.what"), apps: ["home-assistant"], screenshots: [] }, ...svcKinds()];
}

const kindConnected = (k) => (k.id ? svcConnections().filter((c) => c.kind === k.id) : (state.overview?.ha?.servers ?? []));

function storeIntegrationCards(kinds, query) {
  const q = query.trim().toLowerCase();
  const shown = kinds.filter((k) => !q || `${k.title} ${k.what}`.toLowerCase().includes(q));
  if (!shown.length) return h("p", { class: "empty" }, t("store.nothing"));
  return h(
    "div",
    { class: "cards" },
    shown.map((k) => {
      const on = kindConnected(k).length > 0;
      return h(
        "button",
        { type: "button", class: "store-card", onclick: () => storeIntegrationDialog(k) },
        h("span", { class: "store-card-head" }, h("span", { class: "app-icon plus" }, icon(k.icon)), h("span", { class: "grow" }, h("span", { class: "tile-name" }, k.title), h("span", { class: "muted small" }, t("store.integration"))), on ? h("span", { class: "chip ok" }, icon("check"), t("store.connected")) : h("span", { class: "chip" }, t("store.connectIt"))),
        h("span", { class: "tagline" }, k.what),
      );
    }),
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
    h("header", null, h("span", { class: "app-icon plus lg" }, icon(k.icon)), h("div", { class: "grow" }, h("h2", null, k.title), h("p", { class: "muted" }, k.what), h("p", { class: "muted small" }, [t("store.integration"), k.version && t("store.descVersion", { version: k.version })].filter(Boolean).join(" · "))), closeX(() => dialog)),
    k.screenshots?.length > 0 && shotsView(k.screenshots),
    h(
      "div",
      { class: "store-app-body" },
      h("p", null, t("store.integrationLead")),
      there.length > 0 &&
        h(
          "div",
          { class: "tips" },
          h("strong", null, t("store.connectedHere")),
          h("ul", null, there.map((c) => h("li", null, h("a", { class: "link", href: k.id ? `#/service/${c.id}` : `#/house/ha/${c.id}`, onclick: () => dialog.close() }, c.name ?? c.title ?? k.title)))),
        ),
      apps.length > 0 &&
        h(
          "div",
          { class: "tips" },
          h("strong", null, t("store.integrationApps")),
          h(
            "ul",
            null,
            apps.map((a) => h("li", null, h("button", { type: "button", class: "link", onclick: () => (dialog.close(), installed.has(a.name) ? go(`#/apps/${a.name}`) : storeDialog(a)) }, a.title), " — ", installed.has(a.name) ? t("store.installed") : t("store.integrationAppHint"))),
          ),
        ),
    ),
    h("footer", null, h("span", { class: "grow" }), closeButton(() => dialog, t("common.cancel")), connect),
  );
  connect.focus();
}

function formSection(title, hint, rows) {
  return rows.length > 0 && h("section", { class: "form-section" }, h("div", { class: "form-head" }, h("h3", null, title), hint && h("span", { class: "muted small" }, hint)), rows);
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
        ? h("span", { class: "with-pick" }, input, h("button", { type: "button", class: "icon-btn", title: t("edit.pickFolder"), "aria-label": t("edit.pickFolder"), onclick: () => folderPicker({ title: t("edit.pickFolder"), start: input.value.startsWith("/") ? input.value : "", confirmLabel: t("edit.pickHere"), action: (path) => void (input.value = path) }) }, icon("folder")))
        : s.type === "port"
          ? h("span", { class: "pair" }, input, s.busy && h("span", { class: "chip warn" }, t("store.portMoved", { port: s.busy })))
          : input;
    return formRow(s.label, control, s.hint);
  };
  const rows = settings.filter((s) => !s.advanced).map(rowOf).filter(Boolean);
  const more = settings.filter((s) => s.advanced).map(rowOf).filter(Boolean);
  return {
    rows,
    more: more.length > 0 && h("details", { class: "form-more" }, h("summary", null, t("store.more")), more),
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
    return formRow(p.description || t("store.port"), h("span", { class: "pair" }, input, h("span", { class: "muted small mono" }, `→ ${p.target}/${p.protocol}`), p.busy && h("span", { class: "chip warn" }, t("store.portBusy"))));
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
    h(
      "div",
      { class: "store-where grow" },
      h("label", { for: "store-target" }, t("store.where")),
      targets.length > 0
        ? h("select", { id: "store-target", onchange: (e) => (dialog.close(), void storeDialog(entry, e.target.value)) }, h("option", { value: "", selected: !target }, here), targets.map((m) => h("option", { value: m.id, selected: m.id === target }, t("store.whereMachine", { name: m.name }))))
        : h("span", null, here),
      targets.length === 0 && h("a", { class: "link small", href: "#/machines", title: t(machinesUi.list?.machines?.length ? "store.whereNoneReady" : "store.whereNone"), onclick: () => dialog.close() }, t("store.whereOther")),
    );
  const hasForm = isAdmin() && (settingsForm ? settingsForm.rows.length > 0 || settingsForm.more : ports.length + volumes.length + envs.length > 0);
  // what the app asks of the server beyond its folders and ports, said before it is installed
  const permissions = app.permissions.length > 0 && h("div", { class: "tips prose" }, h("strong", null, t("store.permissions")), h("ul", null, app.permissions.map((p) => h("li", null, h("strong", null, t(`store.permission.${p.id}`)), " — ", p.why))));
  dialog = openDialog(
    "xwide store-app",
    h("header", null, appIcon(app, "lg"), h("div", { class: "grow" }, h("h2", null, app.title), h("p", { class: "muted" }, app.tagline), h("p", { class: "muted small" }, [app.category, app.developer && t("store.by", { developer: app.developer }), app.version && t("store.version", { version: app.version })].filter(Boolean).join(" · "))), closeX(() => dialog)),
    !supported && h("p", { class: "banner" }, t("store.unsupported", { arch: arch ?? "" })),
    app.screenshots.length > 0 && shotsView(app.screenshots),
    // one column, the description across the whole width and what is asked under it (the user's wish, 2026-10-18):
    // two columns squeezed long descriptions with commands into a narrow strip
    h(
      "div",
      { class: "store-app-body" },
      h("div", { class: "description prose" }, md(app.description)),
      app.tips && h("div", { class: "tips prose" }, h("strong", null, t("store.tips")), md(app.tips)),
      hasForm && settingsForm && h("div", { class: "stack install-form" }, formSection(t("store.settings"), t("store.settingsHint"), settingsForm.rows), settingsForm.more),
      hasForm && !settingsForm && h("div", { class: "stack install-form" }, formSection(t("store.ports"), target ? t("store.portsOn", { name: targets.find((m) => m.id === target)?.name ?? "" }) : t("store.portsHint"), ports), formSection(t("store.volumes"), target ? t("store.volumesHint", { path: app.form.volumes[0]?.source.split("/AppData/")[0] || "/DATA" }) : state.settings ? t("store.volumesHint", { path: state.settings.dataRoot }) : "", volumes), formSection(t("store.envs"), t("store.envsHint"), envs)),
      permissions,
      app.website && h("a", { class: "link", href: app.website, target: "_blank", rel: "noopener noreferrer" }, app.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), icon("external")),
      h("p", { class: "cmd small" }, icon("terminal"), `docker compose -p ${app.name} up -d`),
    ),
    error,
    h("footer", null, where, closeButton(() => dialog, t("common.cancel")), install),
  );
  // the dialog would otherwise put the focus ring on its close button
  (install.disabled ? dialog : install).focus();
}

/** An app's screenshots one at a time across the whole width: arrows, a swipe, the arrow keys */
function shotsView(list) {
  let shots = list.map((src) => h("a", { href: src, target: "_blank", rel: "noopener noreferrer", draggable: "false" }, h("img", { src, alt: "", referrerPolicy: "no-referrer", draggable: "false" })));
  let at = 0;
  const stage = h("div", { class: "shot-stage", tabindex: "0", "aria-roledescription": "carousel" });
  const count = h("span", { class: "shot-count" });
  const step = (by) => show(at + by);
  const prev = h("button", { type: "button", class: "icon-btn shot-prev", "aria-label": t("store.shotPrev"), onclick: () => step(-1) }, icon("chevron", "flip"));
  const next = h("button", { type: "button", class: "icon-btn shot-next", "aria-label": t("store.shotNext"), onclick: () => step(1) }, icon("chevron"));
  const view = h("div", { class: "shot-view" }, stage, prev, next, count);
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
  const area = h("textarea", { class: "code", spellcheck: false, wrap: "off", required: true, placeholder: "services:\n  web:\n    image: nginx:alpine\n    ports:\n      - 8088:80\n" });
  const memoryTotal = Math.round((state.overview?.system.memory.total ?? 0) / 1024 / 1024);
  // the first service of a new app has no name of its own: it takes the app's
  let form = appSettingsForm({ title: "", icon: "", web: { scheme: "http", host: "", port: "", path: "/" }, services: [blankService("")] }, memoryTotal);
  const holder = h("div", null, form.el);
  const error = h("p", { class: "error", role: "alert" });
  const lead = h("p", { class: "muted small" });
  const modes = h("div", { class: "modes" });
  const notice = h("div", { class: "banner stack", hidden: true });
  const file = field(t("store.customCompose"), area);
  // the third way in: a command from an app's instructions, read into the form
  const command = h("textarea", { class: "code", spellcheck: false, placeholder: "docker run -d --name whoami -p 8088:80 traefik/whoami" });
  const run = h("div", { class: "stack" }, field(t("run.command"), command));
  const submit = h("button", { class: "btn primary" }, t("store.install"));
  /** form | file | run */
  let current = "form";
  const fromRun = (read) => {
    form = appSettingsForm({ ...read.edit, services: read.edit.services.map((service) => ({ ...service, name: "" })) }, memoryTotal);
    holder.replaceChildren(form.el);
    if (!name.value.trim()) name.value = read.name;
    put(notice, read.ignored.length > 0 && [h("p", { class: "small" }, t("run.ignored")), read.ignored.map((option) => h("p", { class: "mono small" }, option))]);
  };
  const mode = (next) => {
    current = next;
    put(modes, ["form", "file", "run"].map((value) => h("button", { type: "button", class: "mode" + (value === next ? " active" : ""), onclick: () => mode(value) }, t(`store.custom.${value}`))));
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
    h("div", { class: "stack import", id: "import-body" }),
  );
  renderImportBody();
}

const importWarnings = (warnings) => warnings.length > 0 && h("div", { class: "banner stack" }, warnings.map((code) => h("p", { class: "small" }, t("import.warn." + code))));

/** Shows the compose file an import would write; `confirm` gets the (possibly edited) text and the name */
function importDialog({ title, lead, name, compose, warnings, editable, action, steps, confirm }) {
  const nameInput = name != null && h("input", { required: true, pattern: "[a-z0-9][a-z0-9_\\-]*", autocapitalize: "none", spellcheck: false, class: "mono", value: name });
  const area = h("textarea", { class: "code", spellcheck: false, wrap: "off", required: true, readOnly: !editable, value: compose, "aria-label": "compose.yml" });
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
      steps && h("ol", { class: "steps muted small" }, steps.map((step) => h("li", null, step))),
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
  return h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("import.casaos.title", { n: ready.length }))),
    h("p", { class: "muted" }, t("import.casaos.lead")),
    casaos.apps.length > 0 &&
      h("div", { class: "table-wrap" }, h("table", null, h("tbody", null, casaos.apps.map((app) => h("tr", null, h("td", null, h("div", { class: "strong" }, app.title), h("div", { class: "muted small mono" }, app.source)), h("td", { class: "num" }, h("span", { class: "chip" + (app.status === "ready" ? " ok" : " warn") }, app.status === "ready" && icon("check"), t("import.casaos.status." + app.status)))))))),
    h("label", { class: "check" }, stop, h("span", null, h("strong", null, t("import.casaos.stop")), h("span", { class: "muted small block" }, casaos.units.length ? t("import.casaos.stopHint", { units: casaos.units.join(", ") }) : t("import.casaos.stopped")))),
    error,
    h("footer", { class: "section-head" }, h("p", { class: "cmd" }, icon("terminal"), "sudo hata migrate casaos --undo"), move),
  );
}

function renderImportBody() {
  const box = document.getElementById("import-body");
  if (!box || !state.import) return;
  box.replaceChildren(...importParts(state.import, h("div", { class: "card empty" }, icon("check", "ok"), h("p", null, t("import.nothing")))));
}

/** What runs on this machine and is not an app here yet; `nothing` stands in when there is none */
function importParts(data, nothing) {
  const problem = (item) => item.problem && h("span", { class: "chip warn", title: t("import.problem." + item.problem) }, t("import.problem." + item.problem));
  const table = (rows) => h("div", { class: "card table-wrap" }, h("table", null, h("tbody", null, rows)));

  const parts = [
    data.casaos && casaosCard(data.casaos),
    data.projects.length > 0 &&
      h(
        "section",
        { class: "stack" },
        h("div", { class: "section-head" }, h("h2", null, t("import.projects"), h("span", { class: "muted small" }, t("import.projectsHint")))),
        table(
          data.projects.map((p) =>
            h(
              "tr",
              null,
              h("td", null, h("div", { class: "strong" }, p.name), h("div", { class: "muted small mono clip" }, p.files.length ? p.files.join(", ") : p.images.join(", "))),
              h("td", null, h("span", { class: "state " + (p.running === 0 ? "stopped" : p.running === p.containers ? "running" : "partial") }, t("import.running", { running: p.running, n: p.containers }))),
              h("td", null, h("div", { class: "row-actions" }, problem(p) || button(t("import.take"), { class: "small", onclick: () => importProject(p) }))),
            ),
          ),
        ),
      ),
    data.containers.length > 0 &&
      h(
        "section",
        { class: "stack" },
        h("div", { class: "section-head" }, h("h2", null, t("import.containers"), h("span", { class: "muted small" }, t("import.containersHint")))),
        table(
          data.containers.map((c) =>
            h(
              "tr",
              null,
              h("td", null, h("div", { class: "strong" }, c.name), h("div", { class: "muted small mono clip" }, c.image)),
              h("td", null, h("span", { class: "state " + (c.state === "running" ? "running" : c.state === "restarting" ? "restarting" : "stopped"), title: c.status }, c.status)),
              h("td", null, h("div", { class: "row-actions" }, problem(c) || button(t("import.rebuild"), { class: "small", onclick: () => importContainer(c) }))),
            ),
          ),
        ),
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
  const item = (id, i) => {
    const inner = [h("span", { class: "welcome-num" }, i < at ? icon("check") : String(i + 1)), h("span", { class: "grow" }, h("strong", null, t(`welcome.step.${id}`)), h("span", { class: "muted small block" }, id === "admin" && state.user ? state.user.name : t(`welcome.step.${id}.hint`)))];
    // the administrator is made once; the other steps can be visited in any order
    return h("li", { class: i === at ? "current" : i < at ? "done" : "" }, state.user && id !== "admin" ? h("a", { href: `#/welcome/${id}`, "aria-current": i === at ? "step" : null }, inner) : h("span", null, inner));
  };
  $app.replaceChildren(
    h(
      "header",
      { class: "top" },
      h("span", { class: "brand" }, logo(), "hata"),
      h("span", { class: "muted welcome-label" }, t("welcome.title")),
      h(
        "div",
        { class: "top-right" },
        languageSelect(() => state.user && void loadWelcome()),
        state.user &&
          button(t("welcome.leave"), {
            class: "quiet",
            onclick: async () => {
              await endWelcome().catch((e) => toast(errorText(e), "error"));
              go("#/");
            },
          }),
      ),
    ),
    h("div", { class: "welcome" }, h("ol", { class: "welcome-steps" }, WELCOME_STEPS.map(item)), h("main", { class: "welcome-main stack" }, h("p", { class: "eyebrow" }, t("welcome.stepOf", { n: at + 1, of: WELCOME_STEPS.length })), content)),
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
  return [error, h("footer", { class: "welcome-foot" }, at > 1 ? h("a", { class: "btn", href: `#/welcome/${WELCOME_STEPS[at - 1]}` }, t("welcome.back")) : h("span"), next)];
}

/** Docker in one card: there and running, or what is missing with the button that brings it */
function welcomeDocker() {
  const d = state.overview?.docker;
  if (!d) return null;
  if (d.available) return h("section", { class: "card pad welcome-fact" }, h("span", { class: "badge-icon ok" }, icon("check")), h("div", { class: "grow" }, h("strong", null, t("welcome.docker.ok")), h("p", { class: "muted small" }, [d.version && `Docker ${d.version}`, d.compose && `Compose ${d.compose}`].filter(Boolean).join(" · "))));
  const stopped = d.state === "stopped";
  return h(
    "section",
    { class: "card pad welcome-fact" },
    h("span", { class: "badge-icon warn" }, icon("alert")),
    h("div", { class: "grow" }, h("strong", null, t(stopped ? "attention.docker.stopped.title" : "attention.docker.missing.title")), h("p", { class: "muted small" }, t(stopped ? "welcome.docker.stopped" : "docker.why"))),
    stopped ? dockerStartButton() : button(t("docker.install"), { class: "small primary", onclick: dockerDialog }, "download"),
  );
}

function paintWelcome() {
  const box = document.getElementById("welcome-body");
  const step = state.route.step;
  const s = state.settings;
  if (!box) return;
  const head = [h("h1", null, t(`welcome.${step}.title`)), h("p", { class: "muted welcome-lead" }, t(`welcome.${step}.lead`))];
  const waiting = waitMark();

  if (step === "server") {
    if (!s) return put(box, ...head, waiting);
    const name = h("input", { value: s.local.name, maxLength: 253, placeholder: "hata.local", spellcheck: false, autocapitalize: "none", class: "mono", required: true });
    const tz = h("input", { value: s.timezone, spellcheck: false, placeholder: s.systemTimezone, class: "mono" });
    const port = state.local && state.local.port !== 80 ? ":" + state.local.port : "";
    return put(
      box,
      ...head,
      h(
        "section",
        { class: "card pad" },
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
      const tick = h("input", { type: "checkbox", checked: wanted(m), onchange: () => ((picks[m.id] = tick.checked), label.classList.toggle("picked", tick.checked)) });
      ticks.set(m.id, tick);
      const label = h(
        "label",
        { class: "card module-pick" + (tick.checked ? " picked" : "") },
        tick,
        icon(MODULE_ICONS[m.id]),
        h("span", { class: "grow" }, h("strong", { class: "block" }, moduleName(m.id)), h("span", { class: "muted small block" }, t(`modules.${m.id}.what`)), m.needs.length > 0 && h("span", { class: "muted small block" }, "↳ ", t("modules.needsModule", { needs: m.needs.map(moduleName).join(", ") })), found.map((f) => h("span", { class: "small block module-found" }, findWords(f)))),
      );
      return label;
    };
    const foundNames = finds ? list.filter((m) => !m.on && findsFor(m.id).length > 0).map((m) => moduleName(m.id)) : [];
    return put(
      box,
      ...head,
      MODULE_GROUPS.map((group) => {
        const mine = list.filter((m) => m.group === group);
        return mine.length > 0 && h("div", { class: "stack" }, h("div", { class: "cat-title" }, t("modules.group." + group)), h("div", { class: "module-picks" }, mine.map(pick)));
      }),
      h("p", { class: "banner quiet" }, !finds ? t("welcome.modules.looking") : foundNames.length ? t("welcome.modules.found", { n: foundNames.length, names: foundNames.join(", ") }) : t("welcome.modules.nothing")),
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
    return put(box, ...head, welcomeDocker() ?? waiting, ...(found ? importParts(found, h("section", { class: "card pad welcome-fact" }, h("span", { class: "badge-icon ok" }, icon("check")), h("div", { class: "grow" }, h("strong", null, t("welcome.existing.nothing")), h("p", { class: "muted small" }, t("welcome.existing.nothingHint"))))) : []), ...welcomeFoot(step));
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
      return h(
        "section",
        { class: "card pad welcome-fact" },
        h("span", { class: "badge-icon" }, icon("disk")),
        h("div", { class: "grow" }, h("strong", null, diskTitle(disk)), h("p", { class: "muted small" }, diskMeta(disk)), h("p", { class: "muted small" }, holds.length ? t("mounting.foundHolds", { what: holds.map((v) => [v.label, v.fstype].filter(Boolean).join(" · ")).join("; ") }) : t("mounting.foundEmpty"))),
        h("div", { class: "row-actions" }, connectable.length > 0 && button(t("mounting.connect"), { class: "small", onclick: () => connectDialog(disk, connectable[0]) }), canPrepare(disk) && button(t("mounting.format"), { class: "small", onclick: () => formatDialog(disk) })),
      );
    };
    return put(
      box,
      ...head,
      h(
        "section",
        { class: "card pad welcome-fact" },
        h("span", { class: "badge-icon" }, icon("folder")),
        h(
          "div",
          { class: "grow" },
          h("strong", { class: "mono" }, s.dataRoot),
          h("p", { class: "muted small" }, place ? t("welcome.data.on", { device: place.device, path: place.path, free: bytes(Math.max(0, place.total - place.used)), total: bytes(place.total) }) : t("welcome.data.unknown")),
          place?.path === "/" && h("p", { class: "muted small" }, t("welcome.data.system")),
        ),
        h("div", { class: "row-actions" }, button(t("data.choose"), { class: "small", onclick: () => pickDataRoot() }, "folder")),
      ),
      h("div", { class: "section-head" }, h("h2", null, t("welcome.data.disks")), h("a", { class: "link small", href: "#/settings/storage" }, t("welcome.data.all"))),
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
    const same = h("p", { class: "banner" }, t("welcome.backups.sameDisk"));
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
      h(
        "section",
        { class: "card pad stack" },
        h("label", { class: "check" }, enabled, h("span", null, h("strong", null, t("backup.enable")), h("span", { class: "muted small block" }, t("backup.enableHint")))),
        h("div", { class: "field-row" }, field(`${t("backup.time")} · ${s.timezone || s.systemTimezone}`, time), field(t("backup.keep"), keep)),
        field(t("backup.dir"), dir, t("backup.dirHint")),
        places.length > 0 && h("div", { class: "row-actions wrap" }, places.map((path) => button(`${path}/Backups`, { class: "small mono", onclick: () => ((dir.value = `${path}/Backups`), check()) }))),
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
        ? h(
            "div",
            { class: "cards" },
            offered.map((a) =>
              h(
                "button",
                { type: "button", class: "store-card", onclick: () => (installed.has(a.name) ? go(`#/apps/${a.name}`) : storeDialog(a)), menu: (at) => storeCardMenu(a, installed.has(a.name), at) },
                h("span", { class: "store-card-head" }, appIcon(a), h("span", { class: "grow" }, h("span", { class: "tile-name" }, a.title), h("span", { class: "muted small" }, twice.has(a.name) ? `${a.category} · ${a.storeName}` : a.category)), installed.has(a.name) ? (state.overview?.apps?.find((one) => one.name === a.name)?.job?.kind === "install" ? h("span", { class: "chip" }, t("store.installing")) : h("span", { class: "chip ok" }, icon("check"), t("store.installed"))) : h("span", { class: "chip" }, t("store.install"))),
                h("span", { class: "tagline" }, a.tagline),
              ),
            ),
          )
        : h("div", { class: "card empty" }, h("p", null, t(busy ? "store.syncing" : "store.empty")), !busy && button(t("store.sync"), { class: "primary", onclick: async () => (await syncStores(), loadWelcome()) }, "refresh")),
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
    const found = [...document.querySelectorAll(".settings :is(h2, h3, strong)")].find((el) => el.textContent.trim().startsWith(card));
    if (found) return found.scrollIntoView({ block: "center" });
    if (++tries < 20) setTimeout(look, 200);
  };
  setTimeout(look, 100);
}
