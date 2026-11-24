// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- The settings form of an app ---------------------------------------------------------------
// The compose file as fields. The server reads the file into rows and puts
// the answers back; a row carries `from` — the entry of the file it shows — so what is not touched stays.

const formRow = (label, control, note) => uiFormRow(label, control, note);

/** A select that also offers the value the file has when it is not one of the usual ones */
function choice(value, options, label) {
  const all = options.some(([v]) => v === value) ? options : [...options, [value, value]];
  return h("select", { "aria-label": label }, all.map(([v, text]) => h("option", { value: v, selected: v === value }, text)));
}

/** A list of the form: rows of inputs, each with a button to take it out, and a button to add one */
function rowList(title, hint, items, cells) {
  const rows = [];
  const box = h("div", { class: "stack-s" });
  const add = (item, focus) => {
    const row = {};
    const remove = h("button", { type: "button", class: "icon-btn", "aria-label": t("app.remove"), title: t("app.remove"), onclick: () => (rows.splice(rows.indexOf(row), 1), row.el.remove()) }, icon("trash"));
    if (item.raw !== undefined) {
      row.el = uiAffix(...[uiReadOnly(item.raw, t("edit.rawHint")), remove]);
      row.value = () => item;
    } else {
      const inputs = cells.map((c) => (c.options ? choice(item[c.key], c.options, c.label) : h("input", { value: item[c.key] ?? "", placeholder: c.label, "aria-label": c.label, class: "mono " + (c.class ?? ""), spellcheck: false, autocapitalize: "none", autocomplete: "off" })));
      // a folder of the server can be chosen instead of typed: the disks are offered there too
      const cellsOf = inputs.map((input, i) =>
        cells[i].pick
          ? uiAffix(...[
              input,
              h("button", {
                type: "button",
                class: "icon-btn",
                title: t("edit.pickFolder"),
                "aria-label": t("edit.pickFolder"),
                onclick: () => folderPicker({ title: t("edit.pickFolder"), start: input.value.startsWith("/") ? input.value : "", confirmLabel: t("edit.pickHere"), action: (path) => void (input.value = path) }),
              }, icon("folder")),
            ], { tight: true })
          : input,
      );
      row.el = uiAffix(...[...cellsOf, remove]);
      row.value = () => ({ ...(item.from === undefined ? {} : { from: item.from }), ...Object.fromEntries(cells.map((c, i) => [c.key, inputs[i].value])) });
      // a row added and left empty was not meant
      row.empty = () => item.from === undefined && inputs.every((input) => input.tagName === "SELECT" || input.value.trim() === "");
      if (focus) setTimeout(() => inputs[0].focus());
    }
    rows.push(row);
    box.append(row.el);
  };
  items.forEach((item) => add(item));
  const blank = Object.fromEntries(cells.map((c) => [c.key, c.options ? c.options[0][0] : ""]));
  return {
    el: uiFormRow(title, [box, h("div", null, button(t("edit.add"), { class: "small", onclick: () => add(blank, true) }, "plus"))], hint, { group: true }),
    value: () => rows.filter((row) => !row.empty?.()).map((row) => row.value()),
  };
}

const CAPABILITIES = "AUDIT_CONTROL AUDIT_WRITE BLOCK_SUSPEND CHOWN DAC_OVERRIDE DAC_READ_SEARCH FOWNER FSETID IPC_LOCK IPC_OWNER KILL LEASE LINUX_IMMUTABLE MAC_ADMIN MAC_OVERRIDE MKNOD NET_ADMIN NET_BIND_SERVICE NET_BROADCAST NET_RAW SETFCAP SETGID SETPCAP SETUID SYSLOG SYS_ADMIN SYS_BOOT SYS_CHROOT SYS_MODULE SYS_NICE SYS_PACCT SYS_PTRACE SYS_RAWIO SYS_RESOURCE SYS_TIME SYS_TTY_CONFIG WAKE_ALARM".split(" ");

function serviceForm(service, memoryTotal) {
  const text = (value, attrs = {}) => h("input", { value, spellcheck: false, autocapitalize: "none", autocomplete: "off", class: "mono", ...attrs });
  const image = text(service.image, { placeholder: "nginx:alpine" });
  const network = choice(service.network, [["", t("edit.networkOwn")], ["bridge", "bridge"], ["host", "host"], ["none", "none"]], t("edit.network"));
  const ports = rowList(t("edit.ports"), "", service.ports, [
    { key: "host", label: t("edit.host") },
    { key: "container", label: t("edit.container") },
    { key: "protocol", label: t("edit.protocol"), options: [["tcp", "TCP"], ["udp", "UDP"], ["both", "TCP + UDP"]] },
  ]);
  const pair = [
    { key: "host", label: t("edit.host") },
    { key: "container", label: t("edit.container") },
  ];
  const volumes = rowList(t("edit.volumes"), t("edit.volumesHint"), service.volumes, [{ ...pair[0], pick: true }, pair[1]]);
  const envs = rowList(t("edit.envs"), "", service.envs, [
    { key: "name", label: t("edit.key") },
    { key: "value", label: t("edit.value") },
  ]);
  const devices = rowList(t("edit.devices"), "", service.devices, pair);
  const command = rowList(t("edit.command"), t("edit.commandHint"), service.command.map((value) => ({ value })), [{ key: "value", label: t("edit.argument") }]);
  const privileged = h("input", { type: "checkbox", checked: service.privileged });

  const max = Math.max(memoryTotal, service.memory);
  const memory = h("input", { type: "number", min: 0, max, step: 1, value: service.memory || "", placeholder: "0", class: "short mono", "aria-label": t("edit.memory") });
  const slider = uiSlider({ min: 0, max, step: 64, value: service.memory, label: t("edit.memory"), oninput: () => (memory.value = Number(slider.value) || "") });
  memory.addEventListener("input", () => (slider.value = Number(memory.value) || 0));

  const cpu = choice(String(service.cpuShares), [["0", t("edit.notSet")], ["10", t("edit.cpuLow")], ["50", t("edit.cpuMedium")], ["90", t("edit.cpuHigh")]], t("edit.cpuShares"));
  const restart = choice(service.restart, [["", t("edit.notSet")], ["no", "no"], ["on-failure", "on-failure"], ["always", "always"], ["unless-stopped", "unless-stopped"]], t("edit.restart"));
  const caps = text(service.capAdd.join(", "), { placeholder: "NET_ADMIN, SYS_TIME", list: "capabilities" });
  const hostname = text(service.hostname);

  return {
    el: uiForm(
      formRow(t("edit.image"), image),
      formRow(t("edit.network"), network),
      ports.el,
      volumes.el,
      envs.el,
      devices.el,
      command.el,
      formRow(t("edit.privileged"), h("span", null, privileged), t("edit.privilegedHint")),
      formRow(t("edit.memory"), uiAffix(...[slider, memory, h("span", { class: "muted small" }, "MB")]), t("edit.memoryHint", { total: bytes(memoryTotal * 1024 * 1024) })),
      formRow(t("edit.cpuShares"), cpu),
      formRow(t("edit.restart"), restart),
      formRow(t("edit.capAdd"), caps, t("edit.capAddHint")),
      formRow(t("edit.hostname"), hostname),
    ),
    value: () => ({
      image: image.value,
      network: network.value,
      ports: ports.value(),
      volumes: volumes.value(),
      envs: envs.value(),
      devices: devices.value(),
      command: command.value().map((row) => row.value),
      privileged: privileged.checked,
      memory: Math.max(0, Math.round(Number(memory.value) || 0)),
      cpuShares: Number(cpu.value),
      restart: restart.value,
      capAdd: caps.value.split(/[\s,]+/).filter(Boolean),
      hostname: hostname.value,
    }),
  };
}

const blankService = (name) => ({ name, image: "", network: "", ports: [], volumes: [], envs: [], devices: [], command: [], privileged: false, memory: 0, cpuShares: 0, restart: "unless-stopped", capAdd: [], hostname: "" });

/** Sends a picture as the app's own icon; returns its address */
async function uploadAppIcon(name, picture) {
  const res = await fetch(`/api/apps/${name}/icon`, { method: "PUT", body: picture, headers: { "content-type": "application/octet-stream" } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "request.failed", data?.error?.detail ?? {});
  return data.icon;
}

/**
 * The icon of the form: an address, or a picture of one's own, which wins. For an installed app (`app`)
 * the picture is saved at once; for an app that is not there yet it waits in `picked` until it is.
 */
function iconField(model, app) {
  const url = h("input", { value: model.icon, type: "url", spellcheck: false, class: "mono", placeholder: "https://…", "aria-label": t("edit.iconUrl"), oninput: () => paint() });
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/avif,image/svg+xml", hidden: true });
  const preview = uiLead({ icon: "image" });
  const actions = uiLine([]);
  const note = h("span", { class: "muted small" });
  const field = { el: null, url, picked: null };
  let own = model.ownIcon ?? "";
  const paint = () => {
    const src = own || url.value.trim() || model.storeIcon || "";
    put(preview, src ? h("img", { src, alt: "", referrerPolicy: "no-referrer", onerror: (e) => e.target.remove() }) : icon("image"));
    put(actions, button(t(own ? "edit.iconReplace" : "edit.iconUpload"), { class: "small", onclick: () => file.click() }, "upload"), own && button(t("edit.iconRemove"), { class: "small ghost", onclick: remove }, "trash"));
    note.textContent = t(own ? "edit.iconOwn" : "edit.iconHint");
    note.classList.remove("error");
  };
  const fail = (e) => {
    note.textContent = errorText(e);
    note.classList.add("error");
  };
  const remove = async () => {
    try {
      if (app) await api("DELETE", `/api/apps/${app}/icon`);
      field.picked = null;
      own = "";
      paint();
      if (app) void loadApp(true);
    } catch (e) {
      fail(e);
    }
  };
  file.addEventListener("change", async () => {
    const picture = file.files[0];
    file.value = "";
    if (!picture) return;
    try {
      if (app) {
        own = await uploadAppIcon(app, picture);
        void loadApp(true);
      } else {
        if (picture.size > 1024 * 1024) throw new ApiError(413, "icon.tooLarge", { max: 1 });
        field.picked = picture;
        // shown from memory until there is an app to keep it
        own = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new ApiError(400, "icon.notImage"));
          reader.readAsDataURL(picture);
        });
      }
      paint();
    } catch (e) {
      fail(e);
    }
  });
  paint();
  field.el = uiFormRow(t("edit.icon"), [uiAffix(...[preview, url, actions, file]), note], null, { group: true });
  return field;
}

function appSettingsForm(model, memoryTotal, app, installed) {
  const title = h("input", { value: model.title, maxLength: 80 });
  const iconField_ = iconField(model, app);
  const iconUrl = iconField_.url;
  const scheme = choice(model.web.scheme, [["http", "http://"], ["https", "https://"]], t("edit.webUi"));
  const host = h("input", { value: model.web.host, spellcheck: false, autocapitalize: "none", class: "mono", placeholder: t("edit.webHostHere"), "aria-label": t("edit.webHost") });
  const port = h("input", { value: model.web.port, inputMode: "numeric", class: "short mono", placeholder: t("edit.port"), "aria-label": t("edit.port") });
  const path = h("input", { value: model.web.path, spellcheck: false, autocapitalize: "none", class: "mono", placeholder: "/", "aria-label": t("edit.webPath") });
  // under Hata's domain and its name on the home network the app has a name of its own, which can be chosen
  const domains = [state.overview?.site?.domain, state.overview?.site?.local].filter(Boolean);
  const usual = (app ?? "").replace(/_/g, "-");
  const domain = h("input", { value: model.web.domain ?? "", spellcheck: false, autocapitalize: "none", class: "mono", maxLength: 63, placeholder: usual || t("edit.webDomainUsual"), "aria-label": t("edit.webDomain") });
  const domainHint = h("span", { class: "muted small" });
  const sayDomain = () => {
    const label = domain.value.trim().toLowerCase() || usual;
    const names = domains.map((name) => `${label || "…"}.${name}`).join(", ");
    domainHint.textContent = t(installed?.hostname || host.value.trim() ? "edit.webDomainElsewhere" : "edit.webDomainHint", { names });
  };
  domain.addEventListener("input", sayDomain);
  host.addEventListener("input", sayDomain);
  sayDomain();
  // the services are tabs: one is added by name, the one shown can be taken out
  const services = model.services.map((service) => ({ name: service.name, form: serviceForm(service, memoryTotal) }));
  let shown = 0;
  const tabs = h("div");
  const body = h("div", null, services.map((service) => service.form.el));
  const paint = () => {
    put(
      tabs,
      uiChips(
        services.map((service, i) => {
          const label = service.name || t("edit.mainService");
          // the last service stays: an app without one is removed as a whole
          return uiChip({ label, active: i === shown, onclick: () => ((shown = i), paint()), remove: services.length > 1 && { label: `${t("edit.removeService")}: ${label}`, run: () => confirmRemove(i, label) } });
        }),
        button(t("edit.addService"), { class: "small ghost", onclick: addService }, "plus"),
      ),
    );
    services.forEach((service, i) => (service.form.el.hidden = i !== shown));
  };
  const addService = () =>
    nameDialog(t("edit.addService"), "", t("edit.add"), (name) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) || services.some((service) => service.name === name)) throw new ApiError(400, "edit.badService");
      const service = { name, form: serviceForm(blankService(name), memoryTotal) };
      services.push(service);
      body.append(service.form.el);
      shown = services.length - 1;
      paint();
    });
  const confirmRemove = (index, label) => {
    const dialog = openDialog(
      "confirm",
      h("h2", null, t("edit.removeServiceTitle", { name: label })),
      h("p", { class: "muted" }, t("edit.removeServiceLead")),
      h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("app.remove"), { class: "danger", onclick: () => (dialog.close(), removeService(index)) })),
    );
  };
  const removeService = (index) => {
    services.splice(index, 1)[0].form.el.remove();
    shown = Math.min(index < shown ? shown - 1 : shown, services.length - 1);
    paint();
  };
  paint();
  return {
    el: uiForm(
      h("datalist", { id: "capabilities" }, CAPABILITIES.map((cap) => h("option", { value: cap }))),
      formRow(t("edit.title"), title),
      iconField_.el,
      formRow(t("edit.webUi"), uiAffix(...[scheme, host, h("span", { class: "muted" }, ":"), port, path]), t("edit.webUiHint")),
      domains.length > 0 && formRow(t("edit.webDomain"), [uiAffix(...[domain, h("span", { class: "muted mono" }, "." + domains[0])]), domainHint]),
      uiFormRow(t("edit.services"), tabs, null, { group: true }),
      body,
    ),
    pickedIcon: () => iconField_.picked,
    value: () => ({ title: title.value, icon: iconUrl.value, web: { scheme: scheme.value, host: host.value, port: port.value, path: path.value, domain: domain.value.trim().toLowerCase() === usual ? "" : domain.value.trim() }, services: services.map((service) => ({ name: service.name, ...service.form.value() })) }),
  };
}

async function appSettingsTab(app, box) {
  let model;
  try {
    model = await api("GET", `/api/apps/${app.name}/settings?lang=${state.lang}`);
  } catch (e) {
    return box.replaceChildren(h("p", { class: "error" }, e.code === "app.badCompose" ? t("edit.broken") : errorText(e)));
  }
  const form = appSettingsForm(model, model.memoryTotal, app.name, app);
  // an app of Hata's format: its own settings, kept in .env, come first
  const env = model.settings ? settingFields(model.settings, false) : null;
  const error = h("p", { class: "error", role: "alert" });
  put(
    box,
    uiCard(
      { lead: t("edit.lead") },
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            const res = await api("PUT", `/api/apps/${app.name}/settings?lang=${state.lang}`, env ? { ...form.value(), env: env.value() } : form.value());
            jobDialog(res.job, "apply", app.title, () => (loadApp(true), state.route.tab === "settings" && appSettingsTab(app, box)));
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      env && env.rows.length > 0 && uiForm(formSection(t("store.settings"), t("edit.envHint"), env.rows), env.more),
      env && env.rows.length === 0 && env.more,
      form.el,
      error,
      uiFoot(uiCommand(`docker compose -p ${app.name} up -d --remove-orphans`), h("button", { class: "btn primary" }, t("app.saveApply"))),
    ),
    ),
  );
}

async function appComposeTab(app, box) {
  let text;
  try {
    text = (await api("GET", `/api/apps/${app.name}/compose`)).compose;
  } catch (e) {
    return box.replaceChildren(h("p", { class: "error" }, errorText(e)));
  }
  const area = uiCodeArea({ value: text, label: "compose.yml", page: true });
  const error = h("p", { class: "error", role: "alert" });
  const save = button(t("app.saveApply"), {
    class: "primary",
    disabled: true,
    onclick: async () => {
      error.textContent = "";
      try {
        const res = await api("PUT", `/api/apps/${app.name}/compose`, { compose: area.value });
        text = area.value;
        save.disabled = true;
        jobDialog(res.job, "apply", app.title);
      } catch (e) {
        error.textContent = errorText(e);
      }
    },
  });
  area.addEventListener("input", () => (save.disabled = area.value === text));
  put(box, uiCard({ title: h("span", { class: "mono" }, app.composeFile), lead: t("app.composeLead"), actions: save }, area, error, uiCommand(`docker compose -p ${app.name} up -d --remove-orphans`)));
}

/** Ends a running operation that can be ended before its time */
function stopButton(id) {
  return button(t("job.stopIt"), {
    onclick: async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      try {
        await api("POST", `/api/jobs/${id}/stop`);
      } catch (err) {
        el.disabled = false;
        toast(errorText(err), "error");
      }
    },
  }, "x");
}

/** Follows a running operation without a dialog of its own: every line as it comes, then the job as it ended */
function followJob(id, onLine) {
  // the window that follows it tells of it: no card beside while it is open; closed while the work runs, the card takes over
  const shownIn = [...document.querySelectorAll("dialog[open]")].pop();
  if (shownIn) {
    jobsUi.logs.add(id);
    paintJobs();
    shownIn.addEventListener(
      "close",
      () => {
        jobsUi.logs.delete(id);
        const e = jobsUi.list.get(id);
        if (e && jobEnded(e)) closeJob(id);
        else paintJobs();
      },
      { once: true },
    );
  }
  return new Promise((resolve) => {
    let next = -1;
    const pending = [];
    const end = async () => {
      jobListeners.delete(listener);
      resolve(await api("GET", `/api/jobs/${id}`).catch((e) => ({ status: "failed", error: errorText(e) })));
    };
    const consume = (event) => {
      if (event.line !== undefined) {
        if (event.n >= next) (onLine(event.line), (next = event.n + 1));
      } else if (event.job.status !== "running") void end();
    };
    const listener = (event) => event.job.id === id && (next < 0 ? pending.push(event) : consume(event));
    jobListeners.add(listener);
    api("GET", `/api/jobs/${id}`).then(
      (job) => {
        job.log.forEach(onLine);
        next = job.lineCount;
        if (job.status !== "running") void end();
        else pending.forEach(consume);
      },
      () => void end(),
    );
  });
}

// --- Work in the background: a card for what runs out of sight, wherever the person goes ---------------

const JOB_STEPS = ["check", "download", "start"];
const JOB_CLOSED = "hata.jobs.closed";
const JOB_HIDDEN = "hata.jobs.hidden";
const JOB_MIN = "hata.jobs.min";
const JOB_ROWS = 4;
const JOB_LINGER_S = 10;
const jobsUi = {
  list: new Map(),
  // a phone has no room to spare: there the card starts folded
  min: (localStorage.getItem(JOB_MIN) ?? (innerWidth <= 760 ? "1" : "0")) === "1",
  all: false,
  lost: false,
  hold: false,
  logs: new Set(),
  places: {},
  ready: new Set(),
  sig: "",
};
const storedIds = (store, key) => {
  try {
    return JSON.parse(store.getItem(key) ?? "[]");
  } catch {
    return [];
  }
};
const remember = (store, key, id) => store.setItem(key, JSON.stringify([...storedIds(store, key).filter((one) => one !== id), id].slice(-40)));

const jobPercent = (p) => (p?.total ? Math.min(99, Math.floor(((p.bytes ?? 0) / p.total) * 100)) : p?.layers ? Math.floor(((p.done ?? 0) / p.layers) * 100) : null);
/** A copy or a move of files going on in the background */
const isFileJob = (e) => e.kind === "filecopy" || e.kind === "filemove";
const jobEnded = (e) => e.status !== "running";
const jobWaits = (e) => e.status === "failed" && !e.stopped;

/** What a tile says of an app being installed: the number first, so that a cut leaves it */
function jobShort(job, machine = "") {
  const p = job?.progress;
  const pct = jobPercent(p);
  // a copy or a move of files has no steps: how much of how much
  if (job && isFileJob(job)) return p?.total ? t("jobs.copied", { done: bytes(p.bytes ?? 0), total: bytes(p.total), pct }) : t("jobs.counting");
  if (machine) return pct === null ? t("jobs.short.machineBusy", { machine }) : t("jobs.short.machine", { machine, pct });
  if (p?.step === "download" && pct !== null) return t("jobs.short.downloading", { pct });
  return t(p?.step ? `jobs.short.${p.step}` : "jobs.short.check");
}

function jobName(e) {
  const o = state.overview;
  return o?.apps?.find((a) => a.name === e.app)?.title ?? o?.machineApps?.find((a) => a.key === e.app)?.title ?? e.title ?? jobKeyName(e);
}

/** A name for work this page did not start, from the key the server keeps it under: "incus:web" is web, "pve:<server>:243" is 243 */
function jobKeyName(e) {
  const key = e.app ?? "";
  if (!key) return e.target ?? "";
  if (key === "incus" || key === "incus-vm") return "Incus";
  if (key === "tv") return "Kodi";
  if (key.startsWith("incus-disc:")) return key.split("/").pop();
  if (key.startsWith("incus:")) return key.slice(6);
  if (key.startsWith("pve:")) return key.endsWith(":schedule") ? "Proxmox" : key.split(":").slice(2).pop();
  if (key.startsWith("@system")) return "";
  return key.replace(/@incus$/, "");
}

function jobHeading(e) {
  const app = jobName(e);
  if (e.status === "failed" && !e.stopped && e.kind === "install") return t("jobs.couldNot", { app });
  if (e.status === "done" && e.kind === "install") return t("jobs.ready", { app });
  if (e.status === "done" && e.kind === "update") return t("jobs.updated", { app });
  return has("job." + e.kind) ? t("job." + e.kind, { app }) : app;
}

/** How it ended, in one line: the end of the last line is where compose says why */
function jobReason(e) {
  const text = e.error ?? e.last ?? "";
  if (has("error." + text)) return t("error." + text);
  const line = text.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
  return line.length > 110 ? "…" + line.slice(-110) : line;
}

/** How to reach the store's words on an app just installed; the card waits for the person while there are some */
function jobNotes(e) {
  if (e.status !== "done" || e.kind !== "install") return null;
  const o = state.overview;
  const here = o?.apps?.find((a) => a.name === e.app);
  if (here?.notes) return () => appNotesDialog(here.name, here.title);
  const there = o?.machineApps?.find((a) => a.key === e.app);
  return there?.tips ? () => notesDialog(there.title, there.tips) : null;
}

/** What the page knows of how to sign in to an app just installed, by job: asked once, the tray is redrawn when it comes */
const jobLogins = new Map();

/** `{ login, ask }` for a finished install of an app with a `login`; none for a member or while it is being asked */
function jobLogin(e) {
  if (e.status !== "done" || e.kind !== "install" || !isAdmin()) return null;
  const o = state.overview;
  const there = o?.machineApps?.find((a) => a.key === e.app);
  if (there) return there.login ? { login: there.login, ask: loginAsker(there.name, there.machine.id) } : null;
  const here = o?.apps?.find((a) => a.name === e.app);
  if (!here?.login) return null;
  if (!jobLogins.has(e.id)) {
    jobLogins.set(e.id, null);
    api("GET", `/api/apps/${here.name}?lang=${state.lang}`).then(({ login }) => {
      jobLogins.set(e.id, login && { login, ask: loginAsker(here.name) });
      paintJobs();
    }).catch(() => {});
  }
  return jobLogins.get(e.id);
}

const jobUrl = (e) => {
  const app = state.overview?.apps?.find((a) => a.name === e.app);
  return app && isUp(app) ? appUrl(app) : null;
};

function jobSub(e) {
  if (e.status === "running") {
    if (jobsUi.lost) return t("jobs.lost");
    if (isFileJob(e)) return e.progress?.total ? t("jobs.copied", { done: bytes(e.progress.bytes ?? 0), total: bytes(e.progress.total), pct: jobPercent(e.progress) }) : t("jobs.counting");
    if (e.kind !== "install" || !e.progress?.step) return e.kind === "install" ? t("job.running") : e.last ?? t("job.running");
    const line = `${t("jobs.step." + e.progress.step)} · ${t("jobs.stepOf", { n: JOB_STEPS.indexOf(e.progress.step) + 1, m: JOB_STEPS.length })}`;
    return e.machine ? `${t("jobs.onMachine", { machine: e.machine })} · ${line}` : line;
  }
  if (e.stopped) return t("job.stopped");
  if (e.status === "failed") return e.kind === "install" ? "" : t("job.failed");
  const app = state.overview?.apps?.find((a) => a.name === e.app);
  return e.kind === "install" && app && appAddress(app) ? appAddress(app) : t("job.done");
}

function jobDetail(e, row = false) {
  if (jobWaits(e)) return row && jobReason(e).length > 60 ? "…" + jobReason(e).slice(-60) : jobReason(e);
  const p = e.progress;
  if (e.status !== "running" || e.kind !== "install" || p?.step !== "download" || !p.layers) return "";
  const count = t(p.layers === 1 ? "jobs.layersOne" : "jobs.layers", { done: p.done ?? 0, total: p.layers, pct: jobPercent(p) });
  return p.bytes ? `${count} · ${t("jobs.downloaded", { size: bytes(p.bytes) })}` : count;
}

/** The parts of the bar: an install has its three steps, anything else one */
function jobBars(e) {
  const paint = uiWorkSeg;
  return { paint, count: e.kind === "install" ? JOB_STEPS.length : 1 };
}

function paintJobBar(bar, e) {
  const { paint } = jobBars(e);
  const parts = [...bar.children];
  if (e.kind !== "install") {
    const pct = jobPercent(e.progress);
    return parts[0] && paint(parts[0], jobsUi.lost ? "frozen" : pct === null ? "moving" : "known", pct);
  }
  const at = Math.max(0, JOB_STEPS.indexOf(e.progress?.step ?? "check"));
  parts.forEach((part, i) => {
    if (i < at) return paint(part, "full");
    if (i > at) return paint(part, "");
    if (jobsUi.lost) return paint(part, "frozen");
    const pct = e.progress?.step === "download" ? jobPercent(e.progress) : null;
    paint(part, pct === null ? "moving" : "known", pct);
  });
}

const jobBar = (e) => {
  const bar = uiWorkBar(jobBars(e).count);
  paintJobBar(bar, e);
  return bar;
};

const jobLog = (e) => jobDialog(e.id, e.kind, jobName(e));

function closeJob(id) {
  remember(localStorage, JOB_CLOSED, id);
  jobsUi.list.delete(id);
  paintJobs();
  void refresh();
}

/** Where the words of a job stand, to be changed without drawing anything anew: a button under the pointer stays */
function patchJobs() {
  for (const e of jobsUi.list.values()) {
    for (const root of document.querySelectorAll(`[data-job="${e.id}"]`)) {
      const sub = root.querySelector(".ui-work-sub");
      if (sub) sub.textContent = jobSub(e);
      const detail = root.querySelector(".ui-work-detail");
      if (detail) detail.textContent = jobDetail(e, root.classList.contains("row"));
      const short = root.querySelector(".ui-work-short");
      if (short) short.textContent = e.status === "running" ? jobShort(e) : jobSub(e) || t("job.failed");
      const bar = root.querySelector(".ui-work-bar");
      if (bar && e.status === "running") paintJobBar(bar, e);
    }
    if (e.status !== "running") continue;
    for (const bar of document.querySelectorAll(`[data-tile-job="${e.id}"]`)) paintTileBar(bar, e, e.kind === "install");
    for (const short of document.querySelectorAll(`[data-job-short="${e.id}"]`)) short.textContent = jobShort(e);
  }
}

/** A copy or a move ended before its time: what it copied so far goes, the original stays whole */
const stopFileJob = (e) => api("POST", `/api/jobs/${e.id}/stop`).catch((err) => toast(errorText(err), "error"));

function jobCard(e, row = false) {
  const ended = jobEnded(e);
  const url = e.status === "done" && e.kind === "install" ? jobUrl(e) : null;
  const page = e.status === "done" && e.kind === "install" && !e.machine ? `#/apps/${e.app}` : null;
  const notes = jobNotes(e);
  const signIn = jobLogin(e);
  const lead = appIcon({ name: e.app, title: jobName(e), icon: e.icon }, row ? "sm" : "");
  const tool = (label, iconName, onclick, attrs = {}) => h(attrs.href ? "a" : "button", { type: attrs.href ? null : "button", class: "icon-btn", title: label, "aria-label": `${label}: ${jobName(e)}`, onclick, ...attrs }, icon(iconName));
  return uiWork({
    id: e.id,
    row,
    status: e.status,
    stopped: !!e.stopped,
    lead,
    title: jobHeading(e),
    sub: jobSub(e),
    subMono: e.kind !== "install" && !isFileJob(e) && !ended,
    tools: [
      row && (url || page) && tool(t("common.open"), "external", () => closeJob(e.id), { href: url ?? page, ...(url ? { target: "_blank", rel: "noopener noreferrer" } : {}) }),
      row && signIn && signIn.login.kind !== "none" && tool(t("app.login"), "key", () => loginDialog(jobName(e), signIn.login, signIn.ask)),
      row && !ended && isFileJob(e) && tool(t("jobs.stopFiles"), "stop", () => stopFileJob(e)),
      row && tool(t("jobs.showLog"), "logs", () => jobLog(e)),
      ended
        ? tool(t("jobs.dismiss"), "x", () => closeJob(e.id))
        : !row && h("button", { type: "button", class: "icon-btn", title: t("jobs.minimise"), "aria-label": t("jobs.minimise"), onclick: () => minimiseJobs(true) }, icon("down")),
    ],
    bar: !ended && jobBar(e),
    why: jobWaits(e),
    extra: [
      !row && jobWaits(e) && e.kind === "install" && h("p", { class: "muted small" }, t("jobs.leftOver")),
      !row && signIn && uiProse([signIn.login.kind !== "none" && h("strong", { class: "small" }, t("app.login")), loginBlock(signIn.login, signIn.ask)], { soft: true }),
    ],
    actions: !row && [
      button(t("jobs.showLog"), { class: "small", onclick: () => jobLog(e) }),
      !ended && isFileJob(e) && button(t("jobs.stopFiles"), { class: "small", onclick: () => stopFileJob(e) }, "stop"),
      notes && button(t("app.notes"), { class: "small", onclick: notes }, "info"),
      (url || page) && h("a", { class: "btn small primary", href: url ?? page, ...(url ? { target: "_blank", rel: "noopener noreferrer" } : {}), onclick: () => closeJob(e.id) }, icon("external"), t("common.open")),
    ],
  });
}

function minimiseJobs(min) {
  jobsUi.min = min;
  localStorage.setItem(JOB_MIN, min ? "1" : "0");
  paintJobs();
}

function jobStrip(shown) {
  const running = shown.filter((e) => !jobEnded(e));
  const failed = shown.filter(jobWaits);
  const first = shown[0];
  const words = shown.length === 1 ? jobName(first) : failed.length && running.length ? t("jobs.counts", { n: running.length, m: failed.length }) : failed.length ? t("jobs.countsFailed", { m: failed.length }) : running.length ? t("jobs.countsRunning", { n: running.length }) : t("job.done");
  return uiWorkStrip({ id: first.id, label: `${t("jobs.restore")}: ${words}`, onclick: () => minimiseJobs(false), lead: appIcon({ name: first.app, title: jobName(first), icon: first.icon }, "sm"), title: words, short: shown.length === 1, bar: !jobEnded(first) && jobBar(first) });
}

function paintJobs() {
  let tray = document.getElementById("job-tray");
  const shown = !state.user || !isAdmin() ? [] : [...jobsUi.list.values()].filter((e) => !jobsUi.logs.has(e.id)).sort((a, b) => jobWaits(b) - jobWaits(a) || jobEnded(a) - jobEnded(b));
  document.body.classList.toggle("has-jobs", shown.length > 0);
  if (!shown.length) {
    tray?.remove();
    jobsUi.sig = "";
    jobsUi.hold = false;
    return;
  }
  if (!tray) {
    tray = h("aside", { id: "job-tray", "aria-label": t("jobs.tray"), onmouseenter: () => (jobsUi.hold = true), onmouseleave: () => (jobsUi.hold = false), onfocusin: () => (jobsUi.hold = true), onfocusout: () => (jobsUi.hold = false) });
    document.body.append(tray);
    new ResizeObserver(() => document.documentElement.style.setProperty("--jobs-h", tray.offsetHeight + "px")).observe(tray);
  }
  const sig = JSON.stringify([jobsUi.min, jobsUi.all, jobsUi.lost, state.lang, shown.map((e) => [e.id, e.status, e.stopped, jobHeading(e), e.icon, e.status === "done" && jobUrl(e), !!jobNotes(e), jobLogin(e)?.login.kind ?? ""])]);
  if (sig !== jobsUi.sig) {
    jobsUi.sig = sig;
    tray.className = jobsUi.min ? "min" : "";
    if (jobsUi.min) tray.replaceChildren(jobStrip(shown));
    else if (shown.length === 1) tray.replaceChildren(jobCard(shown[0]));
    else {
      const running = shown.filter((e) => !jobEnded(e)).length;
      const failed = shown.filter(jobWaits).length;
      const counted = failed && running ? t("jobs.counts", { n: running, m: failed }) : failed ? t("jobs.countsFailed", { m: failed }) : running ? t("jobs.countsRunning", { n: running }) : t("job.done");
      const rows = jobsUi.all ? shown : shown.slice(0, JOB_ROWS);
      tray.replaceChildren(uiWorkList(
        [h("strong", null, counted), h("button", { type: "button", class: "icon-btn", title: t("jobs.minimise"), "aria-label": t("jobs.minimise"), onclick: () => minimiseJobs(true) }, icon("down"))],
        rows.map((e) => jobCard(e, true)),
        shown.length > rows.length && button(t("jobs.showMore", { n: shown.length - rows.length }), { class: "quiet", onclick: () => ((jobsUi.all = true), paintJobs()) }),
      ));
    }
  }
  patchJobs();
}

/**
 * Work whose card is not shown by itself: over in seconds, and the tile says it meanwhile. Every other kind shows in
 * every tab and on every device of an administrator — also what a schedule or an agent started: a phone that did not
 * start the work showed nothing of it.
 */
const JOBS_UNSEEN = ["start", "stop", "restart", "apply"];

/** A job as the server tells of it. Tracked: every kind but those above wherever it was started, and what somebody sent to the background here */
function takeJob(job, line) {
  if (!isAdmin()) return;
  const known = jobsUi.list.get(job.id);
  if (!known && JOBS_UNSEEN.includes(job.kind) && !storedIds(sessionStorage, JOB_HIDDEN).includes(job.id)) return;
  if (!known && storedIds(localStorage, JOB_CLOSED).includes(job.id)) return;
  const e = known ?? { id: job.id, left: JOB_LINGER_S };
  const was = e.status;
  const step = e.progress?.step;
  for (const [key, value] of Object.entries(job)) if (value !== undefined && key !== "title") e[key] = value;
  e.title = job.title ?? e.title;
  if (line !== undefined) e.last = line;
  jobsUi.list.set(job.id, e);
  if (was === "running" && e.status !== "running") {
    if (e.status === "done") {
      e.onDone?.();
      jobsUi.ready.add(e.app);
    }
    // a failure opens the card once; afterwards folding it is the person's choice
    if (jobWaits(e)) minimiseJobs(false);
  }
  // a new tile, a step that changes what the tile says, the end of the work: the page looks again
  if (!known || was !== e.status || step !== e.progress?.step) {
    clearTimeout(appsTimer);
    appsTimer = setTimeout(refresh, 150);
  }
  paintJobs();
}

/** What the server says runs or ended lately: after a reload, a lost connection, or a restart of the server */
function seedJobs(jobs) {
  if (!isAdmin()) return;
  const there = new Set(jobs.map((j) => j.id));
  for (const job of jobs) takeJob(job);
  for (const e of jobsUi.list.values()) if (!there.has(e.id) && !jobEnded(e) && e.status) jobsUi.list.delete(e.id);
  paintJobs();
}

/** An install that failed leaves no app, yet its tile stays as long as the card that tells why */
function failedTiles(o) {
  o.failedApps = [];
  for (const e of jobsUi.list.values()) {
    if (!jobWaits(e) || e.kind !== "install" || e.machine || o.apps.some((a) => a.name === e.app)) continue;
    o.failedApps.push({ name: e.app, title: jobName(e), icon: e.icon, failedJob: e.id, status: "stopped" });
    o.dashboard.cards.push({ type: "app", name: e.app, ...(jobsUi.places[e.app] ?? gridFit(o.dashboard.cards.map(boxOf), 1, 1)), w: 1, h: 1 });
  }
}

/** Off to the background, with no window: the card and the tile tell the rest */
function jobInBackground(id, kind, title, onDone) {
  remember(sessionStorage, JOB_HIDDEN, id);
  const e = jobsUi.list.get(id) ?? { id, kind, status: "running", app: "", left: JOB_LINGER_S };
  e.title = title;
  if (e.status === "running") e.onDone = onDone;
  else if (e.status === "done") onDone?.();
  jobsUi.list.set(id, e);
  paintJobs();
  void refresh();
}

function jobStopDialog(id, app) {
  let dialog;
  dialog = openDialog("confirm", h("h2", null, t("jobs.stopTitle", { app })), h("p", { class: "muted" }, t("jobs.stopLead")),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("jobs.stopInstalling"), { class: "danger", onclick: async () => {
      dialog.close();
      await api("POST", `/api/jobs/${id}/stop`).catch((err) => toast(errorText(err), "error"));
    } })));
}

/** The menu of a tile that is no app yet */
function jobTileMenu(app, at) {
  const failed = app.failedJob;
  const id = failed ?? app.job.id;
  menuAt(at, null, [
    { label: t("jobs.showLog"), icon: "logs", run: () => jobDialog(id, "install", app.title) },
    failed ? { label: t("jobs.dismiss"), icon: "x", run: () => closeJob(id) } : app.job.stoppable && { label: t("jobs.stopInstalling"), icon: "stop", danger: true, run: () => jobStopDialog(id, app.title) },
  ].filter(Boolean));
}

setInterval(() => {
  if (document.hidden || jobsUi.hold) return;
  for (const e of [...jobsUi.list.values()]) {
    if (!jobEnded(e) || !e.status || jobWaits(e) || jobNotes(e) || (jobLogin(e) && jobLogin(e).login.kind !== "none") || jobsUi.logs.has(e.id)) continue;
    if (--e.left <= 0) closeJob(e.id);
  }
}, 1000);

/** Shows a running operation: its console output and how it ended */
async function jobDialog(id, kind, title, onDone) {
  const log = uiOutput();
  const status = h("span", null, uiState("info", t("job.running")));
  let running = true;
  let dialog;
  const close = button(t("job.hide"), { onclick: () => dialog.close() });
  const stop = stopButton(id);
  stop.hidden = true;

  const append = (line) => {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.append(line + "\n");
    if (stick) log.scrollTop = log.scrollHeight;
  };
  const finish = (job) => {
    running = false;
    put(status, job.status === "done" ? uiState("ok", t("job.done")) : job.stopped ? uiState("warn", t("job.stopped")) : uiState("bad", t("job.failed")));
    close.lastChild.textContent = t("common.close");
    stop.hidden = true;
    jobListeners.delete(listener);
    if (job.status === "done") onDone?.();
  };
  // Events may arrive while the snapshot below is still loading. Lines are numbered, so the ones the
  // snapshot already holds are skipped and none is lost.
  let next = -1;
  const pending = [];
  const consume = (event) => {
    if (event.line !== undefined) {
      if (event.n >= next) {
        append(event.line);
        next = event.n + 1;
      }
    } else if (event.job.status !== "running") finish(event.job);
    else if (event.job.stoppable && !event.job.stopped) stop.hidden = false;
  };
  const listener = (event) => {
    if (event.job.id !== id) return;
    if (next < 0) pending.push(event);
    else consume(event);
  };
  jobListeners.add(listener);

  dialog = openDialog("wide", h("h2", null, t("job." + kind, { app: title })), log, h("footer", null, status, stop, close));
  jobsUi.logs.add(id);
  paintJobs();
  dialog.addEventListener("close", () => {
    jobListeners.delete(listener);
    jobsUi.logs.delete(id);
    // closed while it runs: it goes on out of sight, and the card keeps telling
    if (running && !jobsUi.list.has(id)) jobInBackground(id, kind, title, onDone);
    const e = jobsUi.list.get(id);
    if (e) e.left = JOB_LINGER_S;
    paintJobs();
  });

  try {
    const job = await api("GET", `/api/jobs/${id}`);
    for (const line of job.log) append(line);
    next = job.lineCount;
    if (job.status !== "running") finish(job);
    else {
      stop.hidden = !job.stoppable || !!job.stopped;
      pending.forEach(consume);
    }
  } catch (e) {
    next = 0;
    append(errorText(e));
  }
}

function removeDialog(app) {
  const path = `${state.settings?.dataRoot ?? ""}/AppData/${app.name}`.replace(/^\/\//, "/");
  const withData = h("input", { type: "checkbox" });
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("app.removeTitle", { title: app.title })),
    h("p", { class: "muted" }, t("app.removeLead")),
    uiCheck(t("app.removeData", { path }), withData),
    uiCommand(`docker compose -p ${app.name} down`),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("app.remove"), {
        class: "danger",
        onclick: async () => {
          dialog.close();
          try {
            const res = await api("DELETE", `/api/apps/${app.name}${withData.checked ? "?data=1" : ""}`);
            jobDialog(res.job, "remove", app.title, () => go("#/"));
          } catch (e) {
            toast(errorText(e), "error");
          }
        },
      }),
    ),
  );
}
