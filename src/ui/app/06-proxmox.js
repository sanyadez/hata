// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Proxmox servers ---
// Looked after through their API with a token: the list on the Machines page, a page of each

const PVE_TABS = ["overview", "guests", "templates", "tasks"];
const pveUi = { list: null, host: null, timer: null };

async function loadPve() {
  if (!hasModule("proxmox")) return;
  try {
    if (state.route.view === "proxmox") {
      pveUi.host = await api("GET", `/api/proxmox/${state.route.id}`);
      return renderPveBody();
    }
    pveUi.list = await api("GET", "/api/proxmox");
  } catch (e) {
    if (state.route.view === "proxmox") {
      pveUi.host = null;
      const box = document.getElementById("pve-body");
      if (box) put(box, h("nav", { class: "crumbs" }, h("a", { href: "#/machines" }, t("nav.machines"))), h("p", { class: "card pad muted" }, errorText(e)));
      return;
    }
    return toast(errorText(e), "error");
  }
  if (state.route.view === "machines") renderMachinesBody();
}

/** A Proxmox server said something new: the page that shows it asks again, at most every few seconds */
function pveEvent(event) {
  if (state.route.view === "proxmox" && state.route.id !== event.id) return;
  if (state.route.view === "guest") {
    clearTimeout(pveUi.timer);
    pveUi.timer = setTimeout(() => void loadGuest(), 800);
    return;
  }
  if (state.route.view !== "proxmox" && state.route.view !== "machines") return;
  clearTimeout(pveUi.timer);
  pveUi.timer = setTimeout(() => {
    void loadPve();
    if (state.route.view === "machines") void loadMachines();
  }, 800);
}

const pveChip = (x) => h("span", { class: "state " + (x.online ? "running" : "") }, x.online ? t("pve.online") : t("pve.offline"));
const guestChip = (g) => h("span", { class: "state " + (g.status === "running" ? "running" : g.status === "paused" ? "restarting" : "") }, t("pve.status." + (["running", "stopped", "paused"].includes(g.status) ? g.status : "unknown")));
const guestKind = (g) => (g.type === "lxc" ? "CT" : "VM") + " " + g.vmid;
/** Why a server does not answer, in the words of its error */
const pveError = (x) => (has("error." + x.error.code) ? t("error." + x.error.code, { name: x.name, message: "" }).replace(/[:\s]+$/, "") : x.error.code);
const pct = (used, total) => (total ? Math.round((used / total) * 100) : null);

function meterRow(label, percent, hint) {
  const fill = h("i", { class: level(percent ?? 0) });
  fill.style.width = (percent ?? 0) + "%";
  return h("div", { class: "machine-meter" }, h("div", { class: "kv" }, h("span", { class: "muted small" }, label), h("span", { class: "small" }, percent == null ? "—" : `${percent}%`, hint && h("span", { class: "muted" }, " · " + hint))), h("div", { class: "bar" }, fill));
}

/** Adding a server, or changing its token: the certificate is shown to be confirmed the first time */
function pveDialog(old = null) {
  const name = h("input", { value: old?.name ?? "", placeholder: t("pve.namePlaceholder"), maxLength: 40 });
  const url = h("input", { value: old?.url ?? "", placeholder: "192.168.1.10", required: true, autocapitalize: "none", spellcheck: false, class: "mono" });
  // not the browser's saved sign-in to Hata: these are Proxmox's, and a password field invites it
  const token = h("input", { value: old?.token ?? "", placeholder: "hata@pve!panel", required: true, autocapitalize: "none", spellcheck: false, autocomplete: "off", name: "pve-token-id", class: "mono" });
  const secret = h("input", { type: "password", placeholder: old ? t("pve.secretKeep") : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", autocomplete: "new-password", name: "pve-token-secret", class: "mono", required: !old });
  // a new server: by a person's sign-in (Hata makes its own token there) or by a token made by hand
  let mode = old ? "token" : "login";
  const user = h("input", { value: "root@pam", required: true, autocapitalize: "none", spellcheck: false, autocomplete: "off", name: "pve-user", class: "mono" });
  const password = h("input", { type: "password", autocomplete: "new-password", name: "pve-password", required: true });
  const otp = h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxLength: 8, class: "mono" });
  const otpRow = field(t("pve.otp"), otp, t("pve.otpHint"));
  otpRow.hidden = true;
  const level = h("select", null, ["manage", "pool", "read"].map((l) => h("option", { value: l }, t("pve.level." + l))));
  const levelHint = h("span", { class: "hint" }, t("pve.levelHint.manage"));
  level.addEventListener("change", () => (levelHint.textContent = t("pve.levelHint." + level.value)));
  const loginPart = h("div", { class: "stack" }, h("div", { class: "form-pair" }, field(t("pve.user"), user), field(t("pve.password"), password)), otpRow, h("label", { class: "field" }, h("span", { class: "label" }, t("pve.level")), level, levelHint), h("p", { class: "muted small" }, t("pve.loginLead")));
  const idsFrom = h("input", { type: "number", min: 100, value: old?.ids?.from ?? "", placeholder: "100" });
  const idsTo = h("input", { type: "number", min: 100, value: old?.ids?.to ?? "", placeholder: "999" });
  const cert = h("div");
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const tokenPart = h(
    "div",
    { class: "stack" },
    field(t("pve.token"), token, t("pve.tokenHint")),
    field(t("pve.secret"), secret, old ? t("pve.secretKeepHint") : null),
    !old && h("details", { class: "small" }, h("summary", null, t("pve.howTitle")), h("ol", { class: "stack-s" }, ["1", "2", "3", "4"].map((n) => h("li", null, t("pve.how." + n)))), h("p", { class: "muted" }, t("pve.howRights"))),
  );
  const modeTab = (m) => h("button", { type: "button", class: "btn" + (mode === m ? " active" : ""), "data-mode": m, onclick: () => setMode(m) }, t("pve.mode." + m));
  const setMode = (m) => {
    mode = m;
    loginPart.hidden = m !== "login";
    tokenPart.hidden = m !== "token";
    user.required = password.required = m === "login";
    token.required = m === "token";
    secret.required = m === "token" && !old;
    dialog?.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    error.textContent = "";
  };
  setMode(mode);
  let fingerprint = null;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    const ids = idsFrom.value && idsTo.value ? { from: Number(idsFrom.value), to: Number(idsTo.value) } : null;
    const data =
      mode === "login"
        ? { ids, name: name.value, url: url.value, user: user.value, password: password.value, level: level.value, ...(otp.value ? { otp: otp.value } : {}), ...(fingerprint ? { fingerprint } : {}) }
        : { ids, name: name.value, url: url.value, token: token.value, ...(secret.value ? { secret: secret.value } : {}), ...(fingerprint ? { fingerprint } : {}) };
    try {
      const saved = old ? await api("PATCH", `/api/proxmox/${old.id}`, data) : await api("POST", "/api/proxmox", data);
      dialog.close();
      toast(t(old ? "pve.changed" : "pve.added", { name: saved.name }));
      if (old) void loadPve();
      else go(`#/proxmox/${saved.id}`);
    } catch (err) {
      if (err.code === "pve.confirmCert") {
        // the server's own certificate: the person compares it with what Proxmox shows, then it is kept
        put(
          cert,
          h(
            "div",
            { class: "card pad stack-s warn-box" },
            h("strong", null, t("pve.certTitle")),
            h("p", { class: "small" }, t("pve.certLead", { subject: err.detail.subject || "—", issuer: err.detail.issuer || "—" })),
            h("p", { class: "mono small wrap" }, err.detail.fingerprint),
            h("p", { class: "muted small" }, t("pve.certWhere")),
          ),
        );
        fingerprint = err.detail.fingerprint;
        submit.querySelector("span").textContent = t("pve.certTrust");
      } else if (err.code === "pve.needOtp") {
        otpRow.hidden = false;
        otp.focus();
      } else error.textContent = errorText(err);
    }
    submit.disabled = false;
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, old ? t("pve.changeTitle", { name: old.name }) : t("pve.addTitle")), closeX(() => dialog)),
      !old && h("p", null, t("pve.addLead")),
      !old && h("div", { class: "seg" }, modeTab("login"), modeTab("token")),
      field(t("pve.url"), url, t("pve.urlHint")),
      loginPart,
      tokenPart,
      field(t("pve.name"), name, t("pve.nameHint")),
      h("div", { class: "field" }, h("span", { class: "label" }, t("pve.ids")), h("div", { class: "form-pair" }, idsFrom, idsTo), h("span", { class: "hint" }, t("pve.idsHint"))),
      cert,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, h("span", null, old ? t("pve.save") : t("pve.add")))),
    ),
  );
}

function pveMenu(x, at = null) {
  let dialog;
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    at ? "menu dropdown" : "menu",
    h("header", null, h("span", { class: "machine-icon" }, icon("server")), h("div", null, h("h2", null, x.name), pveChip(x))),
    item(t("pve.refresh"), "refresh", () => refreshPve(x)),
    item(t("pve.openWeb"), "external", () => window.open(x.url, "_blank", "noopener")),
    item(t("pve.change"), "edit", () => pveDialog(x)),
    item(t("pve.remove") + "…", "trash", () => removePveDialog(x), "danger"),
  );
  if (at) placeAt(dialog, at);
}

async function refreshPve(x, el) {
  if (el) el.disabled = true;
  try {
    const fresh = await api("POST", `/api/proxmox/${x.id}/refresh`, {});
    if (state.route.view === "proxmox") (pveUi.host = fresh), renderPveBody();
    else void loadPve();
  } catch (e) {
    toast(errorText(e), "error");
  }
  if (el) el.disabled = false;
}

function removePveDialog(x) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t("pve.removeTitle", { name: x.name })),
    h("p", { class: "muted" }, t("pve.removeLead")),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("pve.remove"), {
        class: "danger",
        onclick: async () => {
          try {
            await api("DELETE", `/api/proxmox/${x.id}`);
            dialog.close();
            go("#/machines");
          } catch (e) {
            toast(errorText(e), "error");
          }
        },
      }, "trash"),
    ),
  );
}

/** A new container on the server, with Hata's client in it: it becomes one of the machines */
async function pveNewDialog(x, kind = "lxc") {
  let o;
  try {
    o = await api("GET", `/api/proxmox/${x.id}/new`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (!o.offer) return toast(t("pve.new.denied", { name: x.name }), "error");
  const opt = (value, label = value) => h("option", { value }, label);
  const node = h("select", { onchange: () => fill() }, o.nodes.map((n) => opt(n)));
  const template = h("select");
  const source = h("select", { onchange: () => shape() });
  const storage = h("select");
  const bridge = h("select");
  const fill = () => {
    const n = node.value;
    const list = o.templates[n] ?? [];
    template.replaceChildren(...list.map((v) => opt(v, v.split("/").pop() + (/(^|\/)(debian|ubuntu|fedora|rockylinux|almalinux|centos)-/.test(v) ? "" : " — " + t("pve.new.noClientHere")))));
    const debian = list.find((v) => /\/debian-/.test(v));
    if (debian) template.value = debian;
    const images = o.images[n] ?? [];
    const isos = o.isos[n] ?? [];
    source.replaceChildren(
      ...[images.length > 0 && h("optgroup", { label: t("pve.vm.images") }, images.map((v) => opt(v, v.split("/").pop()))), isos.length > 0 && h("optgroup", { label: t("pve.vm.discs") }, isos.map((v) => opt(v, v.split("/").pop())))].filter(Boolean),
    );
    storage.replaceChildren(...((kind === "lxc" ? o.storages[n] : o.disks[n]) ?? []).map((v) => opt(v)));
    bridge.replaceChildren(...(o.bridges[n] ?? []).map((v) => opt(v)));
    shape();
  };
  const hostname = h("input", { required: true, placeholder: "docker-1", pattern: "[a-z0-9]([a-z0-9\\-]{0,61}[a-z0-9])?", autocapitalize: "none", spellcheck: false, class: "mono" });
  const vmid = h("input", { type: "number", required: true, min: o.ids?.from ?? 100, max: o.ids?.to ?? 999999999, value: o.next ?? "" });
  const disk = h("input", { type: "number", required: true, min: 2, max: 4096, value: 8 });
  const cores = h("input", { type: "number", required: true, min: 1, max: 128, value: 2 });
  const memory = h("select", null, [512, 1024, 2048, 4096, 8192, 16384].map((mb) => opt(String(mb), mb < 1024 ? `${mb} MB` : `${mb / 1024} GB`)));
  memory.value = "2048";
  const how = h("select", { onchange: () => (fixed.hidden = how.value !== "fixed") }, opt("dhcp", t("pve.new.dhcp")), opt("fixed", t("pve.new.fixed")));
  const address = h("input", { placeholder: "192.168.1.50/24", class: "mono" });
  const gateway = h("input", { placeholder: "192.168.1.1", class: "mono" });
  const fixed = h("div", { class: "stack-s", hidden: true }, field(t("pve.new.address"), address), field(t("pve.new.gateway"), gateway));
  const user = h("input", { value: "hata", autocapitalize: "none", spellcheck: false, class: "mono", autocomplete: "off" });
  const password = h("input", { type: "password", autocomplete: "new-password", minLength: 8 });
  const keys = h("textarea", { rows: 2, class: "mono small", spellcheck: false, placeholder: "ssh-ed25519 AAAA… me@laptop" });
  const pool = h("select", null, o.free && opt("", t("pve.new.noPool")), o.pools.map((p) => opt(p)));
  const tick = (label, hint, checked = true) => {
    const box = h("input", { type: "checkbox", checked });
    return [box, h("label", { class: "check" }, box, h("span", null, h("strong", null, label), hint && h("span", { class: "muted small block" }, hint)))];
  };
  const [client, clientRow] = tick(t("pve.new.client"), t("pve.new.clientHint"));
  const [docker, dockerRow] = tick(t("pve.new.docker"), t("pve.new.dockerHint"));
  const [onboot, onbootRow] = tick(t("pve.onboot"), null);
  const [start, startRow] = tick(t("pve.vm.start"), t("pve.vm.startHint"));
  const error = h("p", { class: "error", role: "alert" });
  const lead = h("p", { class: "muted small" });
  const clientHint = clientRow.querySelector(".block");
  const pair = (...items) => h("div", { class: "form-pair" }, ...items);
  const templateRow = field(t("pve.new.template"), template, (o.templates[node.value] ?? []).length ? null : t("pve.new.noTemplates"));
  const sourceRow = field(t("pve.vm.source"), source, (o.images[node.value] ?? []).length + (o.isos[node.value] ?? []).length ? null : t("pve.vm.noSource"));
  const signRow = h("div", { class: "stack-s" }, pair(field(t("pve.vm.user"), user, t("pve.vm.userHint")), field(t("pve.vm.password"), password, t("pve.vm.passwordHint"))), field(t("pve.vm.keys"), keys, t("pve.vm.keysHint")));
  const netRow = pair(field(t("pve.new.bridge"), bridge), field(t("pve.new.how"), how));
  const discNote = h("p", { class: "banner small" }, t("pve.vm.discNote"));
  const isDisc = () => kind === "qemu" && (o.isos[node.value] ?? []).includes(source.value);
  /** What the dialog shows for the kind and the source chosen */
  const shape = () => {
    const disc = isDisc();
    title.textContent = t(kind === "lxc" ? "pve.new.title" : "pve.vm.title", { name: x.name });
    lead.textContent = t(kind === "lxc" ? "pve.new.lead" : disc ? "pve.vm.discLead" : "pve.vm.lead");
    clientHint.textContent = t(kind === "lxc" ? "pve.new.clientHint" : "pve.vm.clientHint");
    templateRow.hidden = kind !== "lxc";
    sourceRow.hidden = kind === "lxc";
    signRow.hidden = kind === "lxc" || disc;
    how.closest(".field").hidden = disc;
    if (disc) fixed.hidden = true;
    else fixed.hidden = how.value !== "fixed";
    clientRow.hidden = dockerRow.hidden = disc;
    startRow.hidden = !disc;
    discNote.hidden = !disc;
    for (const b of seg.children) b.classList.toggle("active", b.dataset.kind === kind);
  };
  const title = h("h2", { class: "grow" });
  const seg = h(
    "div",
    { class: "seg" },
    ["lxc", "qemu"].map((k) => h("button", { type: "button", class: "btn", "data-kind": k, onclick: () => ((kind = k), fill()) }, t(k === "lxc" ? "pve.new.kindLxc" : "pve.new.kindVm"))),
  );
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    const disc = isDisc();
    const common = {
      node: node.value,
      vmid: Number(vmid.value),
      hostname: hostname.value.trim().toLowerCase(),
      storage: storage.value,
      disk: Number(disk.value),
      cores: Number(cores.value),
      memory: Number(memory.value),
      bridge: bridge.value,
      address: how.value === "fixed" ? address.value.trim() : "dhcp",
      gateway: gateway.value.trim(),
      pool: pool.value,
      client: !disc && client.checked,
      docker: !disc && docker.checked,
      onboot: onboot.checked,
    };
    try {
      const r =
        kind === "lxc"
          ? await api("POST", `/api/proxmox/${x.id}/guests`, { ...common, template: template.value })
          : await api("POST", `/api/proxmox/${x.id}/vms`, { ...common, source: source.value, user: user.value.trim(), password: password.value, sshKeys: keys.value, start: start.checked });
      dialog.close();
      const machine = !disc && client.checked;
      void jobDialog(r.job, "guest", hostname.value, () => {
        toast(t(machine ? "pve.new.doneMachine" : "pve.new.done", { name: hostname.value }));
        void loadPve();
        void loadMachines();
      });
    } catch (err) {
      error.textContent = err.code === "pve.badField" ? t("pve.new.bad." + err.detail.field) : errorText(err);
      submit.disabled = false;
    }
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, title, closeX(() => dialog)),
      seg,
      lead,
      pair(field(t("pve.new.hostname"), hostname, t("pve.new.hostnameHint")), field("ID", vmid, o.ids ? t("pve.new.idsHint", o.ids) : null)),
      o.nodes.length > 1 && field(t("pve.col.node"), node),
      templateRow,
      sourceRow,
      discNote,
      pair(field(t("pve.new.storage"), storage), field(t("pve.new.disk"), disk)),
      pair(field(t("pve.new.cores"), cores), field(t("pve.new.memory"), memory)),
      netRow,
      fixed,
      signRow,
      (o.pools.length > 0 || !o.free) && field(t("pve.pool"), pool, o.free ? null : t("pve.new.poolHint")),
      clientRow,
      dockerRow,
      startRow,
      onbootRow,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("plus"), h("span", null, t("pve.new.create")))),
    ),
  );
  fill();
}

// --- One Proxmox server ---

function renderPve() {
  if (pveUi.host?.id !== state.route.id) pveUi.host = null;
  shell(h("div", { id: "pve-body", class: "stack" }));
  if (pveUi.host) renderPveBody();
  void loadPve();
}

function renderPveBody() {
  const box = document.getElementById("pve-body");
  const x = pveUi.host;
  if (!box || !x) return;
  const tab = (id, iconName) => h("a", { class: "tab" + (state.route.tab === id ? " active" : ""), href: `#/proxmox/${x.id}${id === "overview" ? "" : "/" + id}` }, icon(iconName), t("pve.tab." + id));
  const body = state.route.tab === "guests" ? pveGuests(x) : state.route.tab === "tasks" ? pveTasks(x) : state.route.tab === "templates" ? pveTemplates(x) : pveOverview(x);
  put(
    box,
    // the head as the machine's: on a wallpaper it gets a panel of its own, or its words are lost
    h(
      "div",
      { id: "pve-head" },
      h("nav", { class: "crumbs" }, h("a", { href: "#/machines" }, t("nav.machines")), icon("chevron"), h("span", null, x.name)),
      h(
      "div",
      { class: "app-head", menu: (at) => pveMenu(x, at) },
      h("span", { class: "machine-icon" }, icon("server")),
      h("div", { class: "grow" }, h("div", { class: "app-title" }, h("h1", null, x.name), pveChip(x)), h("p", { class: "meta" }, ["Proxmox VE " + (x.version || ""), x.url, x.at ? t("pve.askedAgo", { ago: ago(x.at) }) : null].filter(Boolean).flatMap((part, i) => (i ? [h("span", { class: "dot-sep" }, "·"), part] : [part])))),
      h("div", { class: "actions" }, x.online && button(t("pve.new.button"), { class: "primary", onclick: async (e) => { const b = e.currentTarget; b.disabled = true; await pveNewDialog(x); b.disabled = false; } }, "plus"), button(t("pve.refresh"), { onclick: (e) => refreshPve(x, e.currentTarget) }, "refresh"), h("button", { type: "button", class: "btn square", "aria-label": t("app.more"), onclick: () => pveMenu(x) }, icon("more"))),
    ),
      h("div", { class: "tabs" }, tab("overview", "grid"), tab("guests", "box"), tab("templates", "archive"), tab("tasks", "logs")),
    ),
    x.error && h("p", { class: "card pad warn-box" }, pveError(x), " ", t("pve.since", { ago: ago(x.error.since) })),
    body,
  );
}

// --- Load over time ---

/**
 * A line chart of points over time: thin lines, one shared y-axis from zero, a crosshair that snaps to the
 * nearest point with every series in its readout. Series carry `cls` (s1, s2 — the colours) and `value`.
 */
function lineChart(points, series, { max = null, fmt, label, height = 150, head = true }) {
  const box = h("div", { class: "chart" });
  const tip = h("div", { class: "chart-tip", hidden: true });
  const draw = () => {
    const W = Math.max(280, box.clientWidth || 600);
    const H = height;
    const L = 52, R = 10, T = 10, B = 22;
    const values = points.flatMap((p) => series.map((s) => s.value(p))).filter((v) => v != null);
    const top = max ?? niceTop(Math.max(0, ...values));
    const t0 = points[0]?.t ?? 0;
    const t1 = points.at(-1)?.t ?? 1;
    const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - Math.min(1, v / (top || 1))) * (H - T - B);
    const el = (name, attrs, text) => {
      const e = document.createElementNS(SVG_NS, name);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (text != null) e.textContent = text;
      return e;
    };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": label });
    for (const f of [0, 0.5, 1]) {
      svg.append(el("line", { class: "grid", x1: L, x2: W - R, y1: y(top * f), y2: y(top * f) }));
      svg.append(el("text", { class: "axis", x: L - 6, y: y(top * f) + 3, "text-anchor": "end" }, fmt(top * f)));
    }
    const span = t1 - t0;
    for (let i = 0; i <= 3; i++) {
      const t = t0 + (span * i) / 3;
      const d = new Date(t);
      svg.append(el("text", { class: "axis", x: x(t), y: H - 6, "text-anchor": i === 0 ? "start" : i === 3 ? "end" : "middle" }, span > 2 * 86400_000 ? d.toLocaleDateString(state.lang, { day: "numeric", month: "short" }) : d.toLocaleTimeString(state.lang, { hour: "2-digit", minute: "2-digit" })));
    }
    for (const s of series) {
      let d = "";
      let pen = false;
      for (const p of points) {
        const v = s.value(p);
        if (v == null) {
          pen = false;
          continue;
        }
        d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)} ${y(v).toFixed(1)}`;
        pen = true;
      }
      svg.append(el("path", { class: "line " + s.cls, d }));
    }
    const cross = el("line", { class: "cross", y1: T, y2: H - B, visibility: "hidden" });
    const dots = series.map((s) => el("circle", { class: "dot " + s.cls, r: 4, visibility: "hidden" }));
    svg.append(cross, ...dots);
    const hit = el("rect", { class: "hit", x: L, y: 0, width: W - L - R, height: H });
    svg.append(hit);
    const show = (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      let best = 0;
      for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].t) - px) < Math.abs(x(points[best].t) - px)) best = i;
      const p = points[best];
      if (!p) return;
      cross.setAttribute("x1", x(p.t));
      cross.setAttribute("x2", x(p.t));
      cross.setAttribute("visibility", "visible");
      series.forEach((s, i) => {
        const v = s.value(p);
        dots[i].setAttribute("visibility", v == null ? "hidden" : "visible");
        if (v != null) (dots[i].setAttribute("cx", x(p.t)), dots[i].setAttribute("cy", y(v)));
      });
      put(tip, h("div", { class: "muted small" }, dateTime(p.t)), series.map((s) => h("div", { class: "small" }, h("i", { class: "series-key " + s.cls }), s.label, ": ", h("strong", null, s.value(p) == null ? "—" : (s.show ?? fmt)(s.value(p), p)))));
      tip.hidden = false;
      const left = (x(p.t) / W) * r.width;
      tip.style.left = Math.min(Math.max(0, left + 12), r.width - tip.offsetWidth) + "px";
    };
    const hide = () => {
      cross.setAttribute("visibility", "hidden");
      dots.forEach((d) => d.setAttribute("visibility", "hidden"));
      tip.hidden = true;
    };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", hide);
    box.replaceChildren(svg, tip);
  };
  // drawn at the width it has: the text of an SVG scaled down would shrink with it
  let drawn = 0;
  new ResizeObserver(() => {
    if (box.isConnected && Math.abs(box.clientWidth - drawn) > 16) ((drawn = box.clientWidth), draw());
  }).observe(box);
  return h(
    "div",
    { class: "chart-wrap" },
    head && h("div", { class: "chart-head" }, h("strong", null, label), series.length > 1 && h("span", { class: "chart-legend" }, series.map((s) => h("span", { class: "small muted" }, h("i", { class: "series-key " + s.cls }), s.label)))),
    points.some((p) => series.some((s) => s.value(p) != null)) ? box : h("p", { class: "muted small" }, t("pve.load.empty")),
  );
}

/** A round top for an axis: 1, 2 or 5 times a power of ten */
function niceTop(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v);
}

const rate = (v) => {
  const b = bytes(v);
  return b === "0 B" ? "0" : b + "/s";
};

/** The load of a node (`{ node }`) or a guest (`{ guest }`) over an hour, a day, a week or a month */
function pveLoadDialog(x, target, title) {
  let timeframe = "hour";
  const body = h("div", { class: "stack" }, h("p", { class: "muted" }, t("machines.loading")));
  const seg = h("div", { class: "seg" });
  const load = async () => {
    put(seg, ["hour", "day", "week", "month"].map((tf) => button(t("pve.load." + tf), { class: "small" + (tf === timeframe ? " on" : ""), "aria-pressed": String(tf === timeframe), onclick: () => ((timeframe = tf), load()) })));
    try {
      const q = new URLSearchParams({ timeframe, ...target });
      const { points } = await api("GET", `/api/proxmox/${x.id}/load?${q}`);
      const pctOf = (p) => (p.mem != null && p.maxmem ? (p.mem / p.maxmem) * 100 : null);
      put(
        body,
        lineChart(points, [{ cls: "s1", label: t("sys.cpu"), value: (p) => (p.cpu == null ? null : p.cpu * 100) }], { max: 100, fmt: (v) => Math.round(v) + "%", label: t("sys.cpu") }),
        lineChart(points, [{ cls: "s1", label: t("sys.memory"), value: pctOf, show: (v, p) => `${Math.round(v)}% · ${bytes(p.mem)} / ${bytes(p.maxmem)}` }], { max: 100, fmt: (v) => Math.round(v) + "%", label: t("sys.memory") }),
        lineChart(points, [{ cls: "s1", label: t("pve.load.in"), value: (p) => p.netin }, { cls: "s2", label: t("pve.load.out"), value: (p) => p.netout }], { fmt: rate, label: t("sys.network") }),
      );
    } catch (e) {
      put(body, h("p", { class: "error" }, errorText(e)));
    }
  };
  let dialog;
  dialog = openDialog("wide", h("header", null, h("h2", { class: "grow" }, t("pve.load.title", { name: title })), closeX(() => dialog)), seg, body, h("footer", null, closeButton(() => dialog)));
  void load();
}

// --- Templates of containers ---

/** The templates tab: drawn from what was read last, read again when older than five minutes or after a change */
function pveTemplates(x) {
  const box = h("div", { class: "stack" });
  const data = pveUi.templates?.id === x.id ? pveUi.templates : null;
  if (data) paintPveTemplates(x, box, data);
  else box.append(h("p", { class: "muted" }, t("machines.loading")));
  if (!data || Date.now() - data.at > 5 * 60_000) void loadPveTemplates(x);
  return box;
}

async function loadPveTemplates(x) {
  try {
    pveUi.templates = { id: x.id, at: Date.now(), ...(await api("GET", `/api/proxmox/${x.id}/templates`)) };
  } catch (e) {
    pveUi.templates = { id: x.id, at: Date.now(), error: errorText(e), nodes: [], offered: [], have: [], storages: [] };
  }
  if (state.route.view === "proxmox" && state.route.tab === "templates") renderPveBody();
}

function paintPveTemplates(x, box, d) {
  const where = h("select", null, d.storages.map((s) => h("option", { value: `${s.node}/${s.storage}` }, d.nodes.length > 1 ? `${s.storage} (${s.node})` : s.storage)));
  if (pveUi.templateWhere && d.storages.some((s) => `${s.node}/${s.storage}` === pveUi.templateWhere)) where.value = pveUi.templateWhere;
  where.addEventListener("change", () => (pveUi.templateWhere = where.value));
  const find = h("input", { type: "search", placeholder: t("pve.tpl.find"), value: pveUi.templateFind ?? "", oninput: () => ((pveUi.templateFind = find.value), filter()) });
  const haveNames = new Set(d.have.map((v) => v.name));
  const may = d.storages.length > 0;
  const rows = d.offered.map((o) => ({
    o,
    row: h(
      "tr",
      null,
      h("td", null, h("div", { class: "strong" }, o.headline || o.template), h("div", { class: "muted small mono wrap" }, o.template)),
      h("td", { class: "small" }, o.section === "turnkeylinux" ? "TurnKey" : o.section === "system" ? t("pve.tpl.system") : o.section, o.client && h("div", null, h("span", { class: "chip ok" }, t("pve.tpl.client")))),
      h("td", { class: "small muted" }, o.description),
      h(
        "td",
        null,
        haveNames.has(o.template)
          ? h("span", { class: "chip" }, t("pve.tpl.have"))
          : may &&
              button(t("pve.tpl.download"), {
                class: "small",
                onclick: async (e) => {
                  const el = e.currentTarget;
                  el.disabled = true;
                  const [node, storage] = where.value.split("/");
                  try {
                    const r = await api("POST", `/api/proxmox/${x.id}/templates`, { node, storage, template: o.template });
                    void jobDialog(r.job, "template", o.template, () => {
                      pveUi.templates = null;
                      renderPveBody();
                    });
                  } catch (err) {
                    toast(errorText(err), "error");
                    el.disabled = false;
                  }
                },
              }, "download"),
      ),
    ),
  }));
  const filter = () => {
    const q = find.value.trim().toLowerCase();
    for (const { o, row } of rows) row.hidden = !!q && !`${o.headline} ${o.template} ${o.os} ${o.description}`.toLowerCase().includes(q);
  };
  filter();
  const keptTable = (list) =>
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        null,
        h("thead", null, h("tr", null, h("th", null, t("pve.img.col.name")), h("th", null, t("pve.col.storage")), h("th", null, t("pve.tpl.col.size")), h("th"))),
        h(
          "tbody",
          null,
          list.map((v) =>
            h(
              "tr",
              null,
              h("td", { class: "mono small wrap" }, v.name),
              h("td", { class: "small" }, v.storage, d.nodes.length > 1 && h("span", { class: "muted" }, ` · ${v.node}`)),
              h("td", { class: "small" }, bytes(v.size)),
              h("td", null, d.removable.includes(v.storage) && button("", { class: "small ghost", title: t("pve.img.remove"), "aria-label": t("pve.img.remove"), onclick: () => pveTemplateRemove(x, v, "img") }, "trash")),
            ),
          ),
        ),
      ),
    );
  // where a file cannot be deleted from here, the page says why rather than leaving the person to look for a button
  const noRemove = (list) => list.some((v) => !d.removable.includes(v.storage)) && h("p", { class: "muted small pve-note" }, t("pve.img.noRemove", { storages: [...new Set(list.filter((v) => !d.removable.includes(v.storage)).map((v) => v.storage))].join(", ") }));
  const images = d.images ?? { have: [], storages: [], offered: [] };
  const isos = d.isos ?? { have: [], storages: [] };
  const imageNames = new Set(images.have.map((v) => v.name));
  const send = (kind, extra, el) => pveSendDialog({ host: x, kind, ...extra }, el);
  put(
    box,
    d.error && h("p", { class: "card pad warn-box" }, d.error),
    pveSection(
      t("pve.img.title"),
      h(
        "div",
        { class: "pve-note first stack-s" },
        h("p", { class: "muted small" }, t("pve.img.lead")),
        !images.storages.length && h("p", { class: "banner small" }, t("pve.img.noRight")),
      ),
      images.have.length > 0 && keptTable(images.have),
      noRemove(images.have),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", null, t("pve.img.col.system")), h("th", null, t("pve.img.col.file")), h("th"))),
          h(
            "tbody",
            null,
            images.offered.map((o) =>
              h(
                "tr",
                null,
                h("td", { class: "strong" }, o.name),
                h("td", { class: "muted small mono wrap" }, o.file),
                h("td", null, imageNames.has(o.file) ? h("span", { class: "chip" }, t("pve.tpl.have")) : images.storages.length > 0 && button(t("pve.tpl.download"), { class: "small", onclick: (e) => send("import", { image: o }, e.currentTarget) }, "download")),
              ),
            ),
          ),
        ),
      ),
      images.storages.length > 0 && h("div", { class: "pve-note actions" }, button(t("pve.img.fromLink"), { class: "small", onclick: (e) => send("import", {}, e.currentTarget) }, "link"), button(t("pve.img.fromComputer"), { class: "small", onclick: (e) => send("import", { local: true }, e.currentTarget) }, "upload")),
    ),
    pveSection(
      t("pve.iso.title"),
      h(
        "div",
        { class: "pve-note first stack-s" },
        h("p", { class: "muted small" }, t("pve.iso.lead")),
        !isos.storages.length && h("p", { class: "banner small" }, t("pve.iso.noRight")),
      ),
      isos.have.length > 0 && keptTable(isos.have),
      noRemove(isos.have),
      isos.storages.length > 0 && h("div", { class: "pve-note actions" }, button(t("pve.img.fromLink"), { class: "small", onclick: (e) => send("iso", {}, e.currentTarget) }, "link"), button(t("pve.img.fromComputer"), { class: "small", onclick: (e) => send("iso", { local: true }, e.currentTarget) }, "upload")),
    ),
    pveSection(
      t("pve.tpl.haveTitle"),
      d.have.length
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              null,
              h("thead", null, h("tr", null, h("th", null, t("pve.tpl.col.name")), h("th", null, t("pve.col.storage")), h("th", null, t("pve.tpl.col.size")), h("th"))),
              h(
                "tbody",
                null,
                d.have.map((v) =>
                  h(
                    "tr",
                    null,
                    h("td", { class: "mono small wrap" }, v.name),
                    h("td", { class: "small" }, v.storage, d.nodes.length > 1 && h("span", { class: "muted" }, ` · ${v.node}`)),
                    h("td", { class: "small" }, bytes(v.size)),
                    h("td", null, d.removable.includes(v.storage) && button("", { class: "small ghost", title: t("pve.tpl.remove"), "aria-label": t("pve.tpl.remove"), onclick: () => pveTemplateRemove(x, v) }, "trash")),
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "muted pve-note first" }, t("pve.tpl.none")),
      noRemove(d.have),
    ),
    pveSection(
      t("pve.tpl.offeredTitle"),
      h("div", { class: "pve-note first stack-s" }, !may && h("p", { class: "banner small" }, t("pve.tpl.noRight")), h("div", { class: "form-pair" }, field(t("pve.tpl.find"), find), may && field(t("pve.tpl.where"), where))),
      h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("pve.tpl.col.name")), h("th", null, t("pve.tpl.col.kind")), h("th", null, t("pve.tpl.col.about")), h("th"))), h("tbody", null, rows.map((r) => r.row)))),
    ),
  );
}

function pveTemplateRemove(x, v, kind = "tpl") {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t(`pve.${kind}.removeTitle`, { name: v.name })),
    h("p", { class: "muted" }, t(`pve.${kind}.removeLead`, { storage: v.storage })),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t(kind === "img" ? "pve.img.remove" : "pve.tpl.remove"), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api("DELETE", `/api/proxmox/${x.id}/templates`, { node: v.node, volid: v.volid });
            toast(t("pve.tpl.removed", { name: v.name }));
          } catch (err) {
            toast(errorText(err), "error");
          }
          dialog.close();
          pveUi.templates = null;
          renderPveBody();
        },
      }, "trash"),
    ),
  );
}

const PVE_SEND_RE = /\.(iso|img|qcow2|raw|vmdk)$/i;

/**
 * Puts a disk image or a disc on a storage of a Proxmox server: a cloud image Hata knows (`image`), a file
 * from a link, a file of this server (`path`, from Files) or one of this computer (`local`: the browser sends
 * it, passed on as it comes). Without `host` the person chooses the server.
 */
async function pveSendDialog({ host = null, kind = "import", image = null, path = "", local = false }, el = null) {
  if (el) el.disabled = true;
  let hosts;
  try {
    hosts = host ? [host] : (await api("GET", "/api/proxmox")).hosts.filter((x) => x.online);
  } catch (e) {
    if (el) el.disabled = false;
    return toast(errorText(e), "error");
  }
  if (el) el.disabled = false;
  if (!hosts.length) return toast(t("pve.send.noHost"), "error");
  const opt = (value, label = value) => h("option", { value }, label);
  const server = h("select", { onchange: () => void places() }, hosts.map((x) => opt(x.id, x.name)));
  const what = h("select", { onchange: () => void places() }, opt("iso", t("pve.send.iso")), opt("import", t("pve.send.import")));
  what.value = path ? (/\.iso$/i.test(path) ? "iso" : /\.(qcow2|raw|vmdk)$/i.test(path) ? "import" : kind) : kind;
  const where = h("select");
  const url = h("input", { type: "url", required: !image && !path, placeholder: "https://…", class: "mono", spellcheck: false });
  const checksum = h("input", { class: "mono small", spellcheck: false, placeholder: "sha256 / sha512" });
  const picked = h("input", { type: "file", required: local, accept: ".iso,.img,.qcow2,.raw,.vmdk", onchange: () => {
    const f = picked.files[0];
    if (f) what.value = /\.iso$/i.test(f.name) ? "iso" : /\.(qcow2|raw|vmdk)$/i.test(f.name) ? "import" : what.value;
    void places();
  } });
  const fill = h("i");
  const progress = h("div", { class: "stack-s", hidden: true }, h("div", { class: "bar" }, fill), h("p", { class: "muted small" }));
  const error = h("p", { class: "error", role: "alert" });
  const lists = new Map();
  const places = async () => {
    error.textContent = "";
    let d = lists.get(server.value);
    if (!d) {
      try {
        d = await api("GET", `/api/proxmox/${server.value}/templates`);
        lists.set(server.value, d);
      } catch (e) {
        error.textContent = errorText(e);
        return;
      }
    }
    const list = (what.value === "iso" ? d.isos : d.images)?.storages ?? [];
    where.replaceChildren(...list.map((s) => opt(`${s.node}/${s.storage}`, `${d.nodes.length > 1 ? `${s.storage} (${s.node})` : s.storage} · ${t("pve.send.free", { size: bytes(s.free) })}`)));
    if (!list.length) error.textContent = t(what.value === "iso" ? "pve.iso.noRight" : "pve.img.noRight");
  };
  let dialog;
  const submit = async (e) => {
    e.preventDefault();
    const go = dialog.querySelector("button[type=submit]");
    if (!where.value) return;
    go.disabled = true;
    error.textContent = "";
    const [node, storage] = where.value.split("/");
    if (local) return sendLocal(node, storage, go);
    try {
      const r = await api("POST", `/api/proxmox/${server.value}/files`, { kind: what.value, node, storage, ...(image ? { image: image.id } : path ? { path } : { url: url.value.trim() }), checksum: checksum.value.trim() });
      dialog.close();
      const name = image ? image.file : (path || url.value).split("/").pop();
      void jobDialog(r.job, "upload", name, () => {
        toast(t("pve.send.done", { name }));
        pveUi.templates = null;
        if (state.route.view === "proxmox") renderPveBody();
      });
    } catch (err) {
      error.textContent = errorText(err);
      go.disabled = false;
    }
  };
  /** The browser sends the file itself; the answer comes once Proxmox has put it in place */
  const sendLocal = (node, storage, go) => {
    const f = picked.files[0];
    if (!f) return void (go.disabled = false);
    progress.hidden = false;
    const said = progress.querySelector("p");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/proxmox/${server.value}/files/upload?${new URLSearchParams({ kind: what.value, node, storage, name: f.name })}`);
    xhr.upload.onprogress = (e) => {
      const percent = e.total ? Math.floor((e.loaded / e.total) * 100) : 0;
      fill.style.width = percent + "%";
      said.textContent = percent < 100 ? t("pve.send.sending", { done: bytes(e.loaded), size: bytes(f.size) }) : t("pve.send.placing");
    };
    const failed = (text) => ((error.textContent = text), (progress.hidden = true), (go.disabled = false), dialog.removeEventListener("cancel", stay));
    xhr.onerror = () => failed(t("error.network"));
    xhr.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status < 200 || xhr.status >= 300) return failed(errorText(new ApiError(xhr.status, payload.error?.code ?? "request.failed", payload.error?.detail)));
      dialog.removeEventListener("cancel", stay);
      dialog.close();
      toast(t("pve.send.done", { name: payload.name ?? f.name }));
      pveUi.templates = null;
      if (state.route.view === "proxmox") renderPveBody();
    };
    // Escape would cut the sending off
    dialog.addEventListener("cancel", stay);
    xhr.send(f);
  };
  const stay = (e) => e.preventDefault();
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: submit },
      h("header", null, h("h2", { class: "grow wrap" }, image ? t("pve.send.imageTitle", { name: image.name }) : path ? t("pve.send.fileTitle", { name: path.split("/").pop() }) : local ? t("pve.send.localTitle") : t(kind === "iso" ? "pve.send.isoTitle" : "pve.send.linkTitle")), closeX(() => dialog)),
      h("p", { class: "muted small" }, t(image ? "pve.send.imageLead" : path ? "pve.send.fileLead" : local ? "pve.send.localLead" : "pve.send.linkLead")),
      hosts.length > 1 && field(t("pve.send.server"), server),
      local && field(t("pve.send.file"), picked),
      (path || local) && field(t("pve.send.what"), what),
      !image && !path && !local && field(t("pve.send.url"), url, t(kind === "iso" ? "pve.send.urlIsoHint" : "pve.send.urlHint")),
      field(t("pve.send.where"), where),
      !image && !local && field(t("pve.send.checksum"), checksum, t("pve.send.checksumHint")),
      progress,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("upload"), h("span", null, t("pve.send.go")))),
    ),
  );
  await places();
}

/** What a storage holds, the largest first: whose each thing is, what is left of guests that are gone */
async function pveStorageDialog(x, s) {
  let dialog;
  const body = h("div", { class: "stack" }, h("p", { class: "muted" }, t("machines.loading")));
  dialog = openDialog("wide", h("header", null, h("h2", { class: "grow" }, t("pve.content.title", { storage: s.name })), closeX(() => dialog)), body, h("footer", null, closeButton(() => dialog)));
  const paint = async () => {
    let d;
    try {
      d = await api("GET", `/api/proxmox/${x.id}/content?${new URLSearchParams({ node: s.node, storage: s.name })}`);
    } catch (e) {
      return put(body, h("p", { class: "error" }, errorText(e)));
    }
    const kinds = {};
    for (const v of d.items) kinds[v.content] = (kinds[v.content] ?? 0) + v.size;
    const left = d.items.filter((v) => v.orphan);
    put(
      body,
      h("p", { class: "muted small" }, t("sys.free", { free: bytes(d.total - d.used), total: bytes(d.total) }), " · ", Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${t("pve.content." + k)} ${bytes(n)}`).join(" · ")),
      h("p", { class: "muted small" }, t("pve.content.scope")),
      left.length > 0 && h("p", { class: "banner small" }, t("pve.content.orphans", { n: left.length, size: bytes(left.reduce((a, v) => a + v.size, 0)) })),
      d.items.length
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              null,
              h("thead", null, h("tr", null, h("th", null, t("pve.content.col.name")), h("th", null, t("pve.col.content")), h("th", null, t("pve.content.col.whose")), h("th", null, t("pve.tpl.col.size")), h("th"))),
              h(
                "tbody",
                null,
                d.items.map((v) =>
                  h(
                    "tr",
                    null,
                    h("td", null, h("div", { class: "mono small wrap" }, v.volid.replace(/^[^:]+:/, "")), (v.at > 0 || v.notes) && h("div", { class: "muted small" }, [v.at ? dateTime(v.at) : "", v.notes].filter(Boolean).join(" · "))),
                    h("td", { class: "small" }, t("pve.content." + v.content)),
                    h("td", { class: "small" }, v.orphan ? h("span", { class: "chip warn" }, t("pve.content.gone", { vmid: v.vmid })) : v.guest ? `${v.guest} (${v.vmid})` : "—", v.protected && h("span", { class: "chip" }, t("pve.protected"))),
                    h("td", { class: "small" }, bytes(v.size)),
                    h("td", null, v.deletable && button("", { class: "small ghost", title: t("pve.content.remove"), "aria-label": t("pve.content.remove"), onclick: () => pveVolumeRemove(x, s, v, paint) }, "trash")),
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "muted" }, t("pve.content.empty")),
    );
  };
  void paint();
}

function pveVolumeRemove(x, s, v, after) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t("pve.content.removeTitle", { name: v.volid.replace(/^[^:]+:/, "") })),
    h("p", { class: "muted" }, t(v.content === "backup" ? "pve.content.removeBackup" : v.orphan ? "pve.content.removeOrphan" : "pve.content.removeLead", { storage: s.name, size: bytes(v.size) })),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("pve.content.remove"), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api("DELETE", `/api/proxmox/${x.id}/content`, { node: s.node, storage: s.name, volid: v.volid });
            toast(t("pve.content.removed"));
          } catch (err) {
            toast(errorText(err), "error");
          }
          dialog.close();
          void after();
        },
      }, "trash"),
    ),
  );
}

/** A node's versions: Proxmox, the kernel, a newer kernel waiting for a restart, packages with newer versions */
function pveVersionsLine(x, node, v) {
  return h(
    "div",
    { class: "stack-s" },
    h("p", { class: "muted small" }, t("pve.ver.line", { manager: v.manager, kernel: v.running })),
    v.reboot && h("p", { class: "small" }, h("span", { class: "chip warn" }, t("pve.ver.reboot", { kernel: v.newest }))),
    (v.newer.length > 0 || v.all) && h("a", { class: "link small", href: "#", onclick: (e) => (e.preventDefault(), pveUpdatesDialog(x, node, v)) }, v.all ? t("pve.ver.all", { n: v.all }) : t("pve.ver.newer", { n: v.newer.length })),
  );
}

function pveUpdatesDialog(x, node, v) {
  let dialog;
  dialog = openDialog(
    "wide",
    h("header", null, h("h2", { class: "grow" }, t("pve.ver.title", { node })), closeX(() => dialog)),
    h("p", { class: "muted small" }, t(v.all === null ? "pve.ver.leadProxmox" : "pve.ver.leadAll", { n: v.all ?? 0 })),
    v.newer.length > 0 && h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("pve.ver.col.package")), h("th", null, t("pve.ver.col.now")), h("th", null, t("pve.ver.col.new")))), h("tbody", null, v.newer.map((p) => h("tr", null, h("td", { class: "mono small" }, p.name), h("td", { class: "mono small muted" }, p.from), h("td", { class: "mono small" }, p.to)))))),
    h("p", { class: "muted small" }, t("pve.ver.how"), " ", h("a", { class: "link", href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.url)),
    h("footer", null, closeButton(() => dialog)),
  );
}

/** A part of the server's page: its title and what it shows in one card */
const pveSection = (title, ...body) => h("section", { class: "card pve-section" }, h("header", { class: "pve-section-head" }, h("h2", null, title)), ...body);

function pveOverview(x) {
  const storages = x.storages;
  const self = x.guests.find((g) => g.id === x.self);
  return h(
    "div",
    { class: "stack" },
    self && h("p", { class: "card pve-self" }, icon("home"), h("span", null, t("pve.selfHere", { guest: `${guestKind(self)} ${self.name}`, node: self.node }))),
    x.trouble.length > 0 && h("section", { class: "card pad stack area-attention" }, h("div", { class: "section-head" }, h("h2", null, t("attention.title"), h("span", { class: "pill" }, x.trouble.length))), h("div", { class: "attention-list" }, x.trouble.map(attentionItem))),
    pveSection(
      t("pve.nodesTitle"),
      h(
        "div",
        { class: "pve-nodes" },
        x.nodes.map((n) =>
          h(
            "div",
            { class: "pve-node" },
            h(
              "div",
              { class: "pve-node-about" },
              h("div", { class: "machine-title" }, icon("server"), h("strong", { class: "clip" }, n.name), pveChip(n), n.online && button("", { class: "small ghost", title: t("pve.load.button"), "aria-label": t("pve.load.button"), onclick: () => pveLoadDialog(x, { node: n.name }, n.name) }, "chart")),
              h("p", { class: "muted small" }, n.online ? t("pve.up", { time: duration(n.uptime) }) : "—"),
              x.versions?.[n.name] && pveVersionsLine(x, n.name, x.versions[n.name]),
            ),
            h(
              "div",
              { class: "pve-node-meters" },
              meterRow(t("sys.cpu"), n.online ? Math.round(n.cpu * 100) : null, t("sys.cores", { n: n.cores })),
              meterRow(t("sys.memory"), n.online ? pct(n.memory.used, n.memory.total) : null, bytes(n.memory.total)),
              meterRow(t("pve.rootDisk"), n.online ? pct(n.disk.used, n.disk.total) : null, t("sys.free", { free: bytes(n.disk.total - n.disk.used), total: bytes(n.disk.total) })),
            ),
          ),
        ),
      ),
    ),
    pveSection(
      t("pve.storagesTitle"),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", null, t("pve.col.storage")), h("th", null, t("pve.col.type")), h("th", null, t("pve.col.content")), h("th", null, t("pve.col.use")))),
          h(
            "tbody",
            null,
            storages.map((s) => {
              const p = pct(s.used, s.total);
              const fill = h("i", { class: level(p ?? 0) });
              fill.style.width = (p ?? 0) + "%";
              return h(
                "tr",
                s.active ? { class: "clickable", onclick: () => pveStorageDialog(x, s) } : null,
                h("td", null, h("div", { class: "strong" }, s.name), x.nodes.length > 1 && h("div", { class: "muted small" }, s.node)),
                h("td", { class: "small" }, s.type, s.shared && h("span", { class: "muted" }, " · " + t("pve.shared"))),
                h("td", { class: "small muted" }, s.content.map((c) => t("pve.content." + c)).join(", ")),
                h("td", null, s.active ? [h("div", { class: "small" }, `${p ?? 0}% · ${t("sys.free", { free: bytes(s.total - s.used), total: bytes(s.total) })}`), h("div", { class: "bar" }, fill)] : h("span", { class: "chip warn" }, t("pve.inactive"))),
              );
            }),
          ),
        ),
      ),
    ),
    x.disks.length > 0 &&
      pveSection(
        t("pve.disksTitle"),
        h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("pve.col.disk")), h("th", null, t("pve.col.node")), h("th", null, t("pve.col.health")))), h("tbody", null, x.disks.map((d) => h("tr", null, h("td", null, h("div", null, d.model || d.device), h("div", { class: "muted small mono" }, d.device)), h("td", { class: "small" }, d.node), h("td", null, h("span", { class: "chip " + (/^(PASSED|OK)$/i.test(d.health) ? "ok" : /^UNKNOWN$/i.test(d.health) || !d.health ? "" : "danger") }, d.health || "—"))))))),
      ),
    pveSection(t("pve.jobsTitle"), h("div", { id: "pve-jobs" }, h("p", { class: "muted pve-note first" }, t("machines.loading")))),
    loadPveJobs(x),
    pveSection(t("pve.sched.title"), pveScheduleBody(x)),
  );
}

/** Hata's own schedule of backups: what it does, how it last went, and its buttons */
function pveScheduleBody(x) {
  const s = x.schedule;
  const who = (sc) => (sc.guests === "all" ? t("pve.sched.all") : sc.guests.map((id) => x.guests.find((g) => g.vmid === id)?.name ?? id).join(", "));
  const last = x.last && h("p", { class: "small " + (x.last.ok ? "muted" : "error") }, t("pve.sched.last", { when: dateTime(x.last.at), result: x.last.ok ? t("pve.sched.lastOk", { n: x.last.guests, pruned: x.last.pruned }) : t("pve.sched.lastFailed", { message: x.last.message }) }));
  return h(
    "div",
    { class: "stack-s pve-note first" },
    h("p", { class: "muted small" }, t("pve.sched.lead")),
    h("p", null, s?.on ? t("pve.sched.on", { time: s.time, guests: who(s), storage: s.storage, keep: s.keep }) : t("pve.sched.off")),
    last,
    h(
      "div",
      { class: "row-actions" },
      button(t("pve.sched.edit"), { class: "small", onclick: () => pveScheduleDialog(x) }, "sliders"),
      s?.storage && button(t("pve.sched.run"), {
        class: "small",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            const r = await api("POST", `/api/proxmox/${x.id}/schedule/run`, {});
            void jobDialog(r.job, "backup", x.name, () => void loadPve());
          } catch (err) {
            toast(errorText(err), "error");
          }
          el.disabled = false;
        },
      }, "play"),
    ),
  );
}

function pveScheduleDialog(x) {
  const s = x.schedule ?? { on: false, time: "03:30", storage: x.scheduleStorages[0] ?? "", keep: 3, guests: "all" };
  const on = h("input", { type: "checkbox", checked: s.on || !x.schedule });
  const time = h("input", { type: "time", required: true, value: s.time });
  const opt = (value) => h("option", { value }, value);
  const storage = h("select", null, x.scheduleStorages.map((v) => opt(v)));
  storage.value = x.scheduleStorages.includes(s.storage) ? s.storage : (x.scheduleStorages[0] ?? "");
  const keep = h("input", { type: "number", required: true, min: 1, max: 30, value: s.keep });
  const radio = (value, checked) => h("input", { type: "radio", name: "pve-sched", value, checked, onchange: () => (list.hidden = all.checked) });
  const all = radio("all", s.guests === "all");
  const chosen = radio("chosen", s.guests !== "all");
  const mine = x.guests.filter((g) => !g.template && g.may.backup);
  const boxes = mine.map((g) => ({ g, box: h("input", { type: "checkbox", checked: s.guests !== "all" && s.guests.includes(g.vmid) }) }));
  const list = h("div", { class: "stack-s pve-pick", hidden: s.guests === "all" }, boxes.map(({ g, box }) => h("label", { class: "check" }, box, h("span", null, `${g.name} (${g.vmid})`))));
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    try {
      await api("PUT", `/api/proxmox/${x.id}/schedule`, { on: on.checked, time: time.value, storage: storage.value, keep: Number(keep.value), guests: all.checked ? "all" : boxes.filter(({ box }) => box.checked).map(({ g }) => g.vmid) });
      dialog.close();
      toast(t("pve.sched.saved"));
      void loadPve();
    } catch (err) {
      error.textContent = errorText(err);
    }
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, t("pve.sched.dialog", { name: x.name })), closeX(() => dialog)),
      h("p", { class: "muted small" }, t("pve.sched.lead")),
      !x.scheduleStorages.length && h("p", { class: "banner small" }, t("pve.sched.noStorage")),
      h("label", { class: "check" }, on, h("span", null, h("strong", null, t("pve.sched.enable")))),
      h("div", { class: "form-pair" }, field(t("pve.sched.time"), time), field(t("pve.sched.storage"), storage)),
      field(t("pve.sched.keep"), keep),
      h("div", { class: "stack-s" }, h("span", { class: "label" }, t("pve.sched.guests")), h("label", { class: "check" }, all, h("span", null, t("pve.sched.guestsAll"))), h("label", { class: "check" }, chosen, h("span", null, t("pve.sched.guestsChosen"))), list),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("check"), h("span", null, t("settings.save")))),
    ),
  );
}

/** The backup jobs come with a request of their own, after the page is drawn */
function loadPveJobs(x) {
  queueMicrotask(async () => {
    const box = document.getElementById("pve-jobs");
    if (!box) return;
    try {
      const { jobs } = await api("GET", `/api/proxmox/${x.id}/jobs`);
      // the guests no job covers close the same card: a line of their own would stand on the wallpaper
      const left = x.unprotected?.length > 0 && h("p", { class: "muted small pve-note" }, t("pve.unprotected", { guests: x.unprotected.map((g) => `${g.name || g.vmid} (${g.vmid})`).join(", ") }));
      const who = (j) => (j.guests === "all" ? t("pve.jobAll") : j.guests.startsWith("pool:") ? t("pve.jobPool", { pool: j.guests.slice(5) }) : j.guests.split(",").map((id) => x.guests.find((g) => String(g.vmid) === id)?.name ?? id).join(", "));
      box.replaceChildren(
        jobs.length
          ? h("div", null, h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("pve.col.schedule")), h("th", null, t("pve.col.guests")), h("th", null, t("pve.col.storage")), h("th", null, t("pve.col.next")))), h("tbody", null, jobs.map((j) => h("tr", null, h("td", null, h("div", { class: "mono" }, j.schedule), !j.enabled && h("span", { class: "chip" }, t("pve.jobOff")), j.comment && h("div", { class: "muted small" }, j.comment)), h("td", { class: "small" }, who(j), j.exclude && h("div", { class: "muted small" }, t("pve.jobExclude", { list: j.exclude }))), h("td", { class: "small" }, j.storage), h("td", { class: "small" }, j.enabled && j.next ? dateTime(j.next) : "—")))))), left)
          : h("div", null, h("p", { class: "muted pve-note first" }, t("pve.noJobs")), left),
      );
    } catch (e) {
      box.replaceChildren(h("p", { class: "muted pve-note first" }, errorText(e)));
    }
  });
  return null;
}

function pveGuests(x) {
  const guests = x.guests.filter((g) => !g.template);
  const templates = x.guests.filter((g) => g.template);
  const note =
    templates.length > 0 &&
    h(
      "p",
      { class: "muted small pve-note" },
      t("pve.templatesLead"),
      " ",
      templates.flatMap((g, i) => [i ? ", " : "", g.may.clone ? h("a", { class: "link", href: "#", title: t("pve.clone.button"), onclick: (e) => (e.preventDefault(), pveCloneDialog(x, g)) }, `${g.name} (${g.vmid})`) : `${g.name} (${g.vmid})`]),
    );
  const small = (label, iconName, onclick, off) => h("button", { type: "button", class: "icon-btn", title: label, "aria-label": label, disabled: off, onclick: (e) => (e.stopPropagation(), onclick(e.currentTarget)) }, icon(iconName));
  const machineOf = (g) => machinesUi.list?.machines.find((m) => m.pve?.host === x.id && m.pve?.id === g.id);
  const row = (g) => {
    const up = g.status === "running";
    const m = machineOf(g);
    return h(
      "tr",
      { class: "clickable", onclick: () => go(m ? `#/machines/${m.id}` : `#/guest/${x.id}/${g.id}`) },
      h("td", { class: "mono" }, g.vmid),
      h("td", null, h("div", { class: "strong" }, g.name, g.id === x.self && h("span", { class: "chip accent pve-here" }, t("pve.selfChip"))), h("div", { class: "muted small" }, [g.type === "lxc" ? t("pve.container") : t("pve.vm"), x.nodes.length > 1 ? g.node : null, g.config?.addresses[0], g.lock ? t("pve.locked", { lock: g.lock }) : null].filter(Boolean).join(" · ")), m && h("a", { class: "link small", href: `#/machines/${m.id}`, onclick: (e) => e.stopPropagation() }, icon("server"), " ", t("pve.isMachine", { name: m.name }))),
      h("td", null, guestChip(g)),
      h("td", { class: "small" }, up ? `${Math.round(g.cpu * 100)}% · ${bytes(g.memory.used)} / ${bytes(g.memory.total)}` : `${t("sys.cores", { n: g.cores })} · ${bytes(g.memory.total)}`),
      h("td", { class: "small muted" }, up ? duration(g.uptime) : "—"),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" },
          g.may.power && !up && small(t("pve.start"), "play", (el) => pvePower(x, g, g.status === "paused" ? "resume" : "start", el)),
          g.may.power && up && small(t("pve.shutdown"), "stop", () => pvePowerDialog(x, g, "shutdown")),
          g.may.power && up && small(t("pve.reboot"), "refresh", () => pvePowerDialog(x, g, "reboot")),
          up && g.may.console && small(t(g.type === "lxc" ? "pve.console" : "pve.screen"), "terminal", () => pveConsoleDialog(x, g)),
          !m && g.id !== x.self && small(t("pve.client.button"), "download", () => pveClientDialog(x, g)),
          small(t("common.open"), "more", () => go(m ? `#/machines/${m.id}` : `#/guest/${x.id}/${g.id}`)),
        ),
      ),
    );
  };
  return h(
    "div",
    { class: "stack" },
    guests.length
      ? h("section", { class: "card" }, h("div", { class: "table-wrap" }, h("table", { class: "pve-guests" }, h("thead", null, h("tr", null, h("th", null, "ID"), h("th", null, t("pve.col.name")), h("th", null, t("app.col.state")), h("th", null, t("pve.col.load")), h("th", null, t("pve.col.uptime")), h("th"))), h("tbody", null, guests.map(row)))), note)
      : h("section", { class: "card" }, h("p", { class: "muted pve-note first" }, t("pve.noGuests")), note),
  );
}

async function pvePower(x, g, action, el) {
  if (el) el.disabled = true;
  try {
    const r = await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/power`, { action });
    toast(t(r.done ? "pve.done." + action : "pve.going", { name: g.name }));
  } catch (e) {
    toast(errorText(e), "error");
  }
  if (el) el.disabled = false;
  void loadPve();
}

/** Shutting down, restarting or pulling the plug: asked first, the hard stop said for what it is */
function pvePowerDialog(x, g, action, then) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t(`pve.${action}Title`, { name: g.name })),
    h("p", { class: "muted" }, t(`pve.${action}Lead`)),
    // the guest Hata itself runs in: the page goes with it
    g.id === x.self && h("p", { class: "card pad warn-box" }, t(action === "reboot" ? "pve.selfReboot" : "pve.selfDown")),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("pve." + action), {
        class: action === "stop" ? "danger" : "primary",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          dialog.close();
          await pvePower(x, g, action);
          then?.();
        },
      }, action === "reboot" ? "refresh" : "stop"),
    ),
  );
}

/** The commands that put Hata's client on a guest of this system, typed in its console as root; null — it cannot have it */
function clientLineFor(os, address, code) {
  const line = `curl -fsSL ${address}/client/${code} | sh`;
  if (/^(debian|ubuntu)$/.test(os)) return `apt-get update && apt-get install -y curl ca-certificates && ${line}`;
  if (/^(fedora|centos|rocky|alma)/.test(os)) return `dnf install -y curl && ${line}`;
  // a virtual machine says only "l26"; the line works wherever curl is
  if (!os || os === "l26") return line;
  return null;
}

/** A container's console from Proxmox, in Hata's own terminal */
function pveConsoleDialog(x, g) {
  let dialog;
  if (g.type === "qemu") {
    dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, `${g.name} · ${guestKind(g)}`), closeX(() => dialog)), h("p", { class: "muted small" }, t("pve.screenHint")), h("div", { class: "term-holder" }, h("iframe", { class: "term-frame", src: "/screen.html?" + new URLSearchParams({ pve: x.id, guest: g.id, lang: state.lang }), title: t("pve.screen") })));
    return;
  }
  dialog = openDialog("xwide", h("header", null, h("h2", { class: "clip grow" }, `${g.name} · ${guestKind(g)}`), closeX(() => dialog)), h("p", { class: "muted small" }, t("pve.consoleHint")), h("div", { class: "term-holder" }, terminalFrame({ pve: x.id, guest: g.id })));
}

/**
 * Hata's client put on a guest that is there already: Proxmox runs no command inside one for a token,
 * so the person pastes a line into its console — opened in Proxmox's own page — and Hata waits for it.
 */
async function pveClientDialog(x, g) {
  let invite;
  try {
    invite = await api("POST", "/api/machines/invite", {});
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const os = g.config?.os ?? "";
  // a running container whose console and options the token may use: Hata types the line itself
  const auto = g.type === "lxc" && g.status === "running" && g.may.console;
  const rootPassword = h("input", { type: "password", autocomplete: "new-password", name: "pve-root-password", placeholder: t("pve.client.rootPassword") });
  const known = new Set((machinesUi.list?.machines ?? []).map((m) => m.id));
  // the guest is on the home network: the server's own number reaches it first
  const addresses = [...new Set([invite.lan, location.origin, invite.local].filter(Boolean).map((a) => a.replace(/\/$/, "")))];
  let address = addresses[0];
  const line = () => clientLineFor(os, address, invite.code);
  const cmd = h("span", { class: "grow mono machine-line" }, line() ?? "");
  const waiting = h("p", { class: "machine-wait" }, h("span", { class: "machine-pulse" }), t("pve.client.waiting"));
  const consoleUrl = `${x.url}/?console=${g.type === "lxc" ? "lxc" : "kvm"}&${g.type === "lxc" ? "xtermjs=1&" : "novnc=1&"}vmid=${g.vmid}&vmname=${encodeURIComponent(g.name)}&node=${encodeURIComponent(g.node)}`;
  let dialog;
  dialog = openDialog(
    "wide",
    h("header", null, h("h2", { class: "grow" }, t("pve.client.title", { name: g.name })), closeX(() => dialog)),
    h("p", null, t("pve.client.lead")),
    h("ul", { class: "stack-s small pve-gives" }, ["apps", "files", "terminal", "backups", "power"].map((k) => h("li", null, t("pve.client.gives." + k)))),
    line() === null
      ? h("p", { class: "card pad warn-box" }, t("pve.client.unsupported", { os }))
      : [
          auto &&
            h(
              "div",
              { class: "card pad pve-offer" },
              h("div", { class: "grow stack-s" }, h("strong", null, t("pve.client.auto")), h("p", { class: "muted small" }, t("pve.client.autoLead")), rootPassword),
              button(t("pve.client.autoButton"), {
                class: "primary",
                onclick: async (e) => {
                  if (!rootPassword.value) return rootPassword.focus();
                  const el = e.currentTarget;
                  el.disabled = true;
                  try {
                    const r = await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/client`, { password: rootPassword.value });
                    dialog.close();
                    void jobDialog(r.job, "client", g.name, () => {
                      toast(t("pve.client.done", { name: g.name }));
                      void loadPve();
                      void loadMachines();
                    });
                  } catch (err) {
                    toast(errorText(err), "error");
                    el.disabled = false;
                  }
                },
              }, "download"),
            ),
          h("p", { class: "strong" }, t(auto ? "pve.client.howHand" : "pve.client.how")),
          h("ol", { class: "stack-s small" }, h("li", null, t("pve.client.step1"), " ", h("a", { class: "link", href: consoleUrl, target: "_blank", rel: "noopener noreferrer" }, t("pve.client.openConsole"))), h("li", null, t("pve.client.step2")), h("li", null, t(g.status === "running" ? "pve.client.step3" : "pve.client.step3stopped"))),
          addresses.length > 1 && h("select", { onchange: (e) => ((address = e.target.value), (cmd.textContent = line())) }, addresses.map((a) => h("option", { value: a }, a))),
          h("p", { class: "cmd whole" }, cmd, h("button", { type: "button", class: "icon-btn", title: t("twofa.copy"), "aria-label": t("twofa.copy"), onclick: () => copyText(line()) }, icon("copy"))),
          h("p", { class: "muted small" }, t("machines.addHint", { minutes: Math.round(invite.valid / 60000) })),
          waiting,
        ],
    h("footer", null, closeButton(() => dialog)),
  );
  const look = async () => {
    const list = await api("GET", "/api/machines").catch(() => null);
    const fresh = list?.machines.find((m) => !known.has(m.id));
    if (!fresh) return;
    machinesUi.list = list;
    waiting.replaceChildren(icon("check"), h("span", null, t("machines.addDone", { name: fresh.name })), h("a", { class: "btn small primary", href: `#/machines/${fresh.id}`, onclick: () => dialog.close() }, t("common.open")));
    waiting.classList.add("done");
    clearInterval(timer);
    void loadPve();
  };
  const timer = setInterval(look, 3000);
  dialog.addEventListener("close", () => clearInterval(timer));
}

/** One guest: what it is, its power, its snapshots and backups */
/** What is known of a guest and what can be done with it: on its page, or on the page of the machine it is */
function pveGuestParts(x, g) {
  const up = g.status === "running";
  const c = g.config;
  const row = (label, value, mono) => value && h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("span", { class: mono ? "mono" : "" }, value));
  const m = machinesUi.list?.machines.find((mm) => mm.pve?.host === x.id && mm.pve?.id === g.id);
  const snaps = h("div", { class: "stack-s" }, h("p", { class: "muted small" }, t("machines.loading")));
  const backs = h("div", { class: "stack-s" }, h("p", { class: "muted small" }, t("machines.loading")));
  const again = () => pveGuestDialog(x, pveUi.host?.guests.find((y) => y.id === g.id) ?? g);
  const act = (label, iconName, action, cls = "") => g.may.power && button(label, { class: "small " + cls, onclick: async (e) => (action === "start" || action === "resume" ? (await pvePower(x, g, action, e.currentTarget), again()) : (pvePowerDialog(x, g, action))) }, iconName);
  const parts = [
    h(
      "div",
      { class: "row-actions wrap" }, foldActions([
      !up && act(t("pve.start"), "play", g.status === "paused" ? "resume" : "start", "primary"),
      up && act(t("pve.shutdown"), "stop", "shutdown"),
      up && act(t("pve.reboot"), "refresh", "reboot"),
      up && g.type === "qemu" && act(t("pve.suspend"), "clock", "suspend"),
      up && act(t("pve.stop"), "x", "stop", "danger"),
      button(t("pve.load.button"), { class: "small", onclick: () => (pveLoadDialog(x, { guest: g.id }, g.name)) }, "chart"),
      up && g.may.console && button(t(g.type === "lxc" ? "pve.console" : "pve.screen"), { class: "small", onclick: () => (pveConsoleDialog(x, g)) }, "terminal"),
      !g.may.power && h("span", { class: "muted small" }, t("pve.noPower")),
      (g.may.configure || g.may.cpu || g.may.memory || g.may.disk) && button(t("pve.edit.button"), { class: "small", onclick: () => (pveEditDialog(x, g)) }, "sliders"),
      g.id === x.self && h("span", { class: "chip accent" }, t("pve.selfChip")),
      g.may.clone && button(t("pve.clone.button"), { class: "small", onclick: () => (pveCloneDialog(x, g)) }, "copy"),
      g.may.remove && g.status === "stopped" && !g.template && g.id !== x.self && button(t("pve.tmpl.button"), { class: "small", onclick: () => (pveTemplateDialog(x, g)) }, "archive"),
      g.may.remove && g.status === "stopped" && g.id !== x.self && button(t("pve.guestRemove"), { class: "small danger", onclick: () => (pveRemoveDialog(x, g)) }, "trash"),])
    ),
    h(
      "section",
      { class: "stack-s" },
      row(t("pve.kind"), g.type === "lxc" ? t("pve.container") + (c?.unprivileged ? " · " + t("pve.unprivileged") : "") : t("pve.vm")),
      row(t("pve.col.node"), g.node),
      row(t("machines.os"), c?.os),
      row(t("machines.address"), c?.addresses.join(", "), true),
      row(t("pve.onboot"), c ? t(c.onboot ? "pve.yes" : "pve.no") : ""),
      row(t("pve.resources"), `${t("sys.cores", { n: g.cores })} · ${bytes(g.memory.total)}${g.disk.total ? " · " + bytes(g.disk.total) : ""}`),
      row(t("pve.pool"), g.pool),
      row(t("pve.tags"), g.tags.join(", ")),
      m && h("div", { class: "kv" }, h("span", { class: "muted" }, t("nav.machines")), h("a", { class: "link", href: `#/machines/${m.id}` }, m.name)),
      !m && g.id !== x.self && h("div", { class: "card pad pve-offer" }, h("div", { class: "grow" }, h("strong", null, t("pve.client.offer")), h("p", { class: "muted small" }, t("pve.client.offerLead"))), button(t("pve.client.button"), { class: "small", onclick: () => (pveClientDialog(x, g)) }, "download")),
      c?.description && h("p", { class: "muted small wrap" }, c.description),
    ),
    h("div", { class: "section-head" }, h("h3", null, t("pve.snapshots")), g.may.snapshot && button(t("pve.snapshotTake"), { class: "small", onclick: () => (pveSnapshotDialog(x, g)) }, "plus")),
    snaps,
    h("div", { class: "section-head" }, h("h3", null, t("pve.backups")), g.may.backup && x.storages.some((st) => st.node === g.node && st.active && st.backup) && button(t("pve.backupTake"), { class: "small", onclick: (e) => pveBackupNow(x, g, e.currentTarget) }, "plus")),
    backs,
  ];
  const load = async () => {
    try {
      const { snapshots } = await api("GET", `/api/proxmox/${x.id}/guests/${g.id}/snapshots`);
      put(
        snaps,
        snapshots.length
          ? snapshots.map((s) =>
              h(
                "div",
                { class: "pve-row" },
                h("div", { class: "grow" }, h("div", null, h("span", { class: "mono strong" }, s.name), s.memory && h("span", { class: "chip" }, t("pve.withMemory"))), h("div", { class: "muted small" }, [s.at ? dateTime(s.at) : "", s.description].filter(Boolean).join(" · "))),
                h("div", { class: "row-actions" }, g.may.rollback && button(t("pve.rollback"), { class: "small", onclick: () => (pveSnapshotAct(x, g, s, "rollback")) }, "undo"), g.may.snapshot && button("", { class: "small ghost", title: t("pve.snapshotRemove"), "aria-label": t("pve.snapshotRemove"), onclick: () => (pveSnapshotAct(x, g, s, "delete")) }, "trash")),
              ),
            )
          : h("p", { class: "muted small" }, t("pve.noSnapshots")),
      );
    } catch (e) {
      snaps.replaceChildren(h("p", { class: "muted small" }, errorText(e)));
    }
    try {
      const r = await api("GET", `/api/proxmox/${x.id}/guests/${g.id}/backups`);
      put(
        backs,
        r.backups.length ? r.backups.slice(0, 10).map((b) => h("div", { class: "pve-row" }, h("div", { class: "grow" }, h("div", null, dateTime(b.at), b.protected && h("span", { class: "chip" }, t("pve.protected"))), b.notes && h("div", { class: "muted small" }, b.notes)), h("span", { class: "muted small" }, `${b.storage} · ${bytes(b.size)}`), g.may.remove && button(t("pve.restore.button"), { class: "small", onclick: () => (pveRestoreDialog(x, g, b)) }, "undo"))) : h("p", { class: "muted small" }, r.storages.length ? t("pve.noBackups") : t("pve.noBackupStorages")),
        r.backups.length > 10 && h("p", { class: "muted small" }, t("pve.moreBackups", { n: r.backups.length - 10 })),
        r.unreachable.length > 0 && h("p", { class: "muted small" }, t("pve.storagesUnreachable", { list: r.unreachable.join(", ") })),
      );
    } catch (e) {
      backs.replaceChildren(h("p", { class: "muted small" }, errorText(e)));
    }
  };
  return { header: () => h("header", null, h("span", { class: "machine-icon" }, icon(g.type === "lxc" ? "box" : "server")), h("div", { class: "grow" }, h("h2", null, g.name), h("p", { class: "muted small" }, guestKind(g), " · ", guestChip(g))), ), parts, load };
}


/** The same as a window, where a guest is not on a page of its own */
function pveGuestDialog(x, g) {
  // on a page that shows the guest already, that page is simply drawn again
  if (state.route.view === "guest") return void loadGuest();
  if (state.route.view === "machine" && machinesUi.current?.pve?.id === g.id) return paintMachineExtra();
  go(`#/guest/${x.id}/${g.id}`);
}

/** Reads the server and puts a guest's parts into a box */
async function paintGuestParts(box, hostId, guestId) {
  try {
    pveUi.host = await api("GET", `/api/proxmox/${hostId}`);
  } catch (e) {
    return put(box, h("p", { class: "card pad muted" }, errorText(e)));
  }
  const g = pveUi.host.guests.find((y) => y.id === guestId);
  if (!g) return put(box, h("p", { class: "card pad muted" }, t("instance.gone")));
  const { parts, load } = pveGuestParts(pveUi.host, g);
  put(box, h("section", { class: "card pad stack-s pve-guest-page" }, parts));
  void load();
  return g;
}

function renderGuest() {
  shell(h("div", { id: "guest-head", class: "card pad thing-head" }), h("div", { id: "guest-body", class: "stack" }));
  void loadGuest();
}

async function loadGuest() {
  const box = document.getElementById("guest-body");
  const head = document.getElementById("guest-head");
  if (!box || !head) return;
  const { host, guest } = state.route;
  const g = await paintGuestParts(box, host, guest);
  const x = pveUi.host;
  if (!g || !x) return;
  // with Hata's client it is a computer: the same address, more tabs
  const m = machinesUi.list?.machines.find((y) => y.pve?.host === host && y.pve?.id === guest);
  if (m) return asMachine(m.id, `#/guest/${host}/${guest}`);
  put(
    head,
    h("nav", { class: "crumbs" }, h("a", { href: "#/machines" }, t("nav.machines")), icon("chevron"), h("a", { href: `#/proxmox/${x.id}` }, x.name), icon("chevron"), h("span", null, g.name)),
    h("div", { class: "app-head" }, h("span", { class: "machine-icon" }, icon(g.type === "lxc" ? "box" : "screen")), h("div", { class: "grow" }, h("div", { class: "app-title" }, h("h1", null, g.name), guestChip(g)), h("p", { class: "meta" }, [guestKind(g), g.config?.os, g.config?.addresses?.[0]].filter(Boolean).join(" · ")))),
  );
}

/** A guest's settings: name, processor, memory, disks made larger, start with the server, tags and notes */
async function pveEditDialog(x, g) {
  let r;
  try {
    r = await api("GET", `/api/proxmox/${x.id}/guests/${g.id}/settings`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const s = r.settings;
  const lxc = g.type === "lxc";
  const num = (value, min, max, may) => h("input", { type: "number", required: true, min, max, value, disabled: !may });
  const name = h("input", { required: true, value: s.name, pattern: lxc ? "[A-Za-z0-9]([A-Za-z0-9\\-]{0,61}[A-Za-z0-9])?" : "[A-Za-z0-9]([A-Za-z0-9.\\-]{0,61}[A-Za-z0-9])?", autocapitalize: "none", spellcheck: false, class: "mono", disabled: !r.may.configure });
  const cores = num(s.cores, 1, 512, r.may.cpu);
  const memory = num(s.memory, 64, 4194304, r.may.memory);
  const swap = lxc && num(s.swap, 0, 4194304, r.may.memory);
  const disks = s.disks.map((d) => ({ d, input: num(Math.ceil(d.size - 0.001), Math.ceil(d.size - 0.001), 65536, r.may.disk) }));
  const onboot = h("input", { type: "checkbox", checked: s.onboot, disabled: !r.may.configure });
  const tags = h("input", { value: s.tags.join(" "), placeholder: "web media", autocapitalize: "none", spellcheck: false, class: "mono", disabled: !r.may.configure });
  const notes = h("textarea", { rows: 4, maxLength: 8000, disabled: !r.may.configure });
  notes.value = s.description;
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    const grow = Object.fromEntries(disks.filter(({ d, input }) => Number(input.value) > Math.ceil(d.size - 0.001)).map(({ d, input }) => [d.key, Number(input.value)]));
    try {
      const done = await api("PUT", `/api/proxmox/${x.id}/guests/${g.id}/settings`, {
        ...(r.may.configure ? { name: name.value.trim(), onboot: onboot.checked, tags: tags.value.split(/[\s,;]+/).filter(Boolean), description: notes.value } : {}),
        ...(r.may.cpu ? { cores: Number(cores.value) } : {}),
        ...(r.may.memory ? { memory: Number(memory.value), ...(lxc ? { swap: Number(swap.value) } : {}) } : {}),
        ...(Object.keys(grow).length ? { disks: grow } : {}),
      });
      dialog.close();
      toast(!done.changed.length ? t("pve.edit.nothing") : done.pending.length ? t("pve.edit.pending", { name: g.name, list: done.pending.join(", ") }) : t("pve.edit.done", { name: g.name }));
      await loadPve();
      pveGuestDialog(x, pveUi.host?.guests.find((y) => y.id === g.id) ?? g);
    } catch (err) {
      error.textContent = errorText(err);
      submit.disabled = false;
    }
  };
  const pair = (...items) => h("div", { class: "form-pair" }, ...items);
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, t("pve.edit.title", { name: g.name })), closeX(() => dialog)),
      r.pending.length > 0 && h("p", { class: "banner small" }, t("pve.edit.waiting", { list: r.pending.join(", ") })),
      field(t(lxc ? "pve.new.hostname" : "pve.edit.name"), name),
      pair(field(t("pve.new.cores"), cores), field(t("pve.edit.memory"), memory, r.running && !lxc ? t("pve.edit.vmRestart") : null)),
      lxc && field(t("pve.edit.swap"), swap),
      disks.map(({ d, input }) => field(t("pve.edit.disk", { disk: d.key, storage: d.storage }), input, t("pve.edit.diskHint"))),
      h("label", { class: "check" }, onboot, h("span", null, h("strong", null, t("pve.onboot")))),
      field(t("pve.tags"), tags, t("pve.edit.tagsHint")),
      field(t("pve.edit.notes"), notes),
      !(r.may.configure && r.may.cpu && r.may.memory && r.may.disk) && h("p", { class: "muted small" }, t("pve.edit.someRefused")),
      error,
      h("footer", null, closeButton(() => (dialog.close(), pveGuestDialog(x, g), dialog), t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("check"), h("span", null, t("settings.save")))),
    ),
  );
}

/** A copy of a guest as a new one: from a template linked or whole, otherwise whole */
async function pveCloneDialog(x, g) {
  let o;
  try {
    o = await api("GET", `/api/proxmox/${x.id}/guests/${g.id}/clone`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const blocked = g.type === "lxc" && !g.template && g.status !== "stopped";
  const opt = (value, label = value) => h("option", { value }, label);
  const vmid = h("input", { type: "number", required: true, min: o.ids?.from ?? 100, max: o.ids?.to ?? 999999999, value: o.next ?? "" });
  const name = h("input", { required: true, value: `${g.name.replace(/[^A-Za-z0-9.-]/g, "-").slice(0, 56)}-copy`, autocapitalize: "none", spellcheck: false, class: "mono" });
  const storage = h("select", null, o.storages.map((v) => opt(v)));
  storage.value = o.storage;
  const pool = h("select", null, o.free && opt("", t("pve.new.noPool")), o.pools.map((p) => opt(p)));
  pool.value = o.pools.includes(o.pool) ? o.pool : (pool.options[0]?.value ?? "");
  const linked = h("input", { type: "checkbox", checked: g.template, onchange: () => (storage.disabled = linked.checked) });
  storage.disabled = g.template;
  const start = h("input", { type: "checkbox" });
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const submit = dialog.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const r = await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/clone`, { vmid: Number(vmid.value), name: name.value.trim(), linked: g.template && linked.checked, storage: storage.value, pool: pool.value, start: start.checked });
      dialog.close();
      void jobDialog(r.job, "clone", name.value.trim(), () => {
        toast(t("pve.clone.done", { name: name.value.trim() }));
        void loadPve();
      });
    } catch (err) {
      error.textContent = errorText(err);
      submit.disabled = false;
    }
  };
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, t("pve.clone.title", { name: g.name })), closeX(() => dialog)),
      h("p", { class: "muted small" }, t(g.template ? "pve.clone.leadTemplate" : "pve.clone.lead")),
      blocked && h("p", { class: "banner small" }, t("pve.clone.stopFirst", { name: g.name })),
      h("div", { class: "form-pair" }, field(t(g.type === "lxc" ? "pve.new.hostname" : "pve.edit.name"), name), field("ID", vmid, o.ids ? t("pve.new.idsHint", o.ids) : null)),
      g.template && h("label", { class: "check" }, linked, h("span", null, h("strong", null, t("pve.clone.linked")), h("span", { class: "muted small block" }, t("pve.clone.linkedHint")))),
      h("div", { class: "form-pair" }, field(t("pve.restore.storage"), storage), (o.pools.length > 0 || !o.free) && field(t("pve.pool"), pool)),
      h("label", { class: "check" }, start, h("span", null, h("strong", null, t("pve.clone.start")))),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary", disabled: blocked }, icon("copy"), h("span", null, t("pve.clone.go")))),
    ),
  );
}

/** A stopped guest made a template: its name typed, because Proxmox cannot turn it back */
function pveTemplateDialog(x, g) {
  const typed = h("input", { autocomplete: "off", spellcheck: false, class: "mono", oninput: () => (go.disabled = typed.value !== g.name) });
  let dialog;
  const go = button(t("pve.tmpl.button"), {
    class: "danger",
    disabled: true,
    onclick: async () => {
      go.disabled = true;
      try {
        await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/template`, { name: typed.value });
        dialog.close();
        toast(t("pve.tmpl.done", { name: g.name }));
        void loadPve();
      } catch (e) {
        toast(errorText(e), "error");
        go.disabled = false;
      }
    },
  }, "archive");
  dialog = openDialog("confirm", h("h2", { class: "wrap" }, t("pve.tmpl.title", { name: g.name })), h("p", { class: "muted" }, t("pve.tmpl.lead")), field(t("pve.typeName", { name: g.name }), typed), h("footer", null, closeButton(() => dialog, t("common.cancel")), go));
}

/** A backup put back: as a new guest beside the old one, or instead of it (stopped, its name typed) */
async function pveRestoreDialog(x, g, b) {
  let o;
  try {
    o = await api("GET", `/api/proxmox/${x.id}/guests/${g.id}/restore`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const stopped = g.status === "stopped";
  const radio = (value, checked, disabled) => h("input", { type: "radio", name: "pve-restore", value, checked, disabled, onchange: () => paint() });
  const asNew = radio("new", true, false);
  const instead = radio("replace", false, o.self || !stopped);
  const opt = (value, label = value) => h("option", { value }, label);
  const vmid = h("input", { type: "number", required: true, min: o.ids?.from ?? 100, max: o.ids?.to ?? 999999999, value: o.next ?? "" });
  const storage = h("select", null, g.type === "qemu" && opt("", t("pve.restore.storageAsBackup")), o.storages.map((v) => opt(v)));
  storage.value = g.type === "qemu" ? "" : o.storage;
  const pool = h("select", null, o.free && opt("", t("pve.new.noPool")), o.pools.map((p) => opt(p)));
  pool.value = o.pools.includes(o.pool) ? o.pool : (pool.options[0]?.value ?? "");
  const start = h("input", { type: "checkbox" });
  const typed = h("input", { autocomplete: "off", spellcheck: false, class: "mono", oninput: () => paint() });
  const newPart = h("div", { class: "stack-s" }, h("div", { class: "form-pair" }, field("ID", vmid, o.ids ? t("pve.new.idsHint", o.ids) : null), (o.pools.length > 0 || !o.free) && field(t("pve.pool"), pool)));
  const replacePart = h("div", { class: "stack-s", hidden: true }, field(t("pve.typeName", { name: g.name }), typed));
  const error = h("p", { class: "error", role: "alert" });
  const go = h("button", { type: "submit", class: "btn primary" }, icon("undo"), h("span", null, t("pve.restore.go")));
  const paint = () => {
    newPart.hidden = !asNew.checked;
    replacePart.hidden = asNew.checked;
    go.className = "btn " + (asNew.checked ? "primary" : "danger");
    go.disabled = !asNew.checked && typed.value !== g.name;
  };
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    go.disabled = true;
    try {
      const r = await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/restore`, { volid: b.volid, replace: instead.checked, name: typed.value, vmid: Number(vmid.value), storage: storage.value, pool: pool.value, start: start.checked });
      dialog.close();
      void jobDialog(r.job, "restore", g.name, () => {
        toast(t("pve.restore.done", { name: g.name }));
        void loadPve();
      });
    } catch (err) {
      error.textContent = errorText(err);
      go.disabled = false;
    }
  };
  const choice = (input, title, hint) => h("label", { class: "check" }, input, h("span", null, h("strong", null, title), h("span", { class: "muted small block" }, hint)));
  dialog = openDialog(
    "wide",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow wrap" }, t("pve.restore.title", { name: g.name, when: dateTime(b.at) })), closeX(() => dialog)),
      h("p", { class: "muted small mono" }, `${b.volid} · ${bytes(b.size)}`),
      choice(asNew, t("pve.restore.new"), t("pve.restore.newHint")),
      newPart,
      choice(instead, t("pve.restore.replace", { name: g.name }), o.self ? t("pve.restore.selfNo") : !stopped ? t("pve.restore.stopFirst", { name: g.name }) : t("pve.restore.replaceHint", { name: g.name })),
      replacePart,
      field(t("pve.restore.storage"), storage),
      h("label", { class: "check" }, start, h("span", null, h("strong", null, t("pve.restore.start")))),
      error,
      h("footer", null, closeButton(() => (dialog.close(), pveGuestDialog(x, g), dialog), t("common.cancel")), go),
    ),
  );
  paint();
}

function pveSnapshotDialog(x, g) {
  const name = h("input", { placeholder: t("pve.snapshotNameAuto"), pattern: "[A-Za-z][A-Za-z0-9_\\-]{1,39}", maxLength: 40, class: "mono" });
  const about = h("input", { maxLength: 500 });
  let dialog;
  dialog = openDialog(
    "",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          const submit = dialog.querySelector("button[type=submit]");
          submit.disabled = true;
          try {
            const r = await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/snapshots`, { name: name.value, description: about.value });
            dialog.close();
            toast(t(r.done ? "pve.snapshotDone" : "pve.going", { name: g.name }));
            pveGuestDialog(x, g);
          } catch (err) {
            toast(errorText(err), "error");
            submit.disabled = false;
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("pve.snapshotTitle", { name: g.name })), closeX(() => dialog)),
      h("p", { class: "muted small" }, t("pve.snapshotLead")),
      field(t("pve.snapshotName"), name, t("pve.snapshotNameHint")),
      field(t("pve.snapshotAbout"), about),
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("plus"), h("span", null, t("pve.snapshotTake")))),
    ),
  );
}

function pveSnapshotAct(x, g, s, action) {
  let dialog;
  dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, t(action === "rollback" ? "pve.rollbackTitle" : "pve.snapshotRemoveTitle", { name: g.name, snapshot: s.name })),
    h("p", { class: "muted" }, t(action === "rollback" ? "pve.rollbackLead" : "pve.snapshotRemoveLead", { snapshot: s.name })),
    h(
      "footer",
      null,
      closeButton(() => (dialog.close(), pveGuestDialog(x, g), dialog), t("common.cancel")),
      button(t(action === "rollback" ? "pve.rollbackGo" : "pve.snapshotRemove"), {
        class: "danger",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const r = await api(action === "rollback" ? "POST" : "DELETE", `/api/proxmox/${x.id}/guests/${g.id}/snapshots/${encodeURIComponent(s.name)}`, action === "rollback" ? {} : undefined);
            toast(t(r.done ? (action === "rollback" ? "pve.rollbackDone" : "pve.snapshotRemoved") : "pve.going", { name: g.name, snapshot: s.name }));
          } catch (err) {
            toast(errorText(err), "error");
          }
          dialog.close();
          pveGuestDialog(x, g);
        },
      }, action === "rollback" ? "undo" : "trash"),
    ),
  );
}

/** Deleting a guest with its disks: its name typed first */
function pveRemoveDialog(x, g) {
  const typed = h("input", { autocomplete: "off", spellcheck: false, class: "mono", oninput: () => (go.disabled = typed.value !== g.name) });
  let dialog;
  const go = button(t("pve.guestRemove"), {
    class: "danger",
    disabled: true,
    onclick: async () => {
      go.disabled = true;
      try {
        const r = await api("DELETE", `/api/proxmox/${x.id}/guests/${g.id}`, { name: typed.value });
        dialog.close();
        toast(t(r.done ? "pve.guestRemoved" : "pve.going", { name: g.name }));
        void loadPve();
      } catch (e) {
        toast(errorText(e), "error");
        go.disabled = false;
      }
    },
  }, "trash");
  dialog = openDialog("confirm", h("h2", { class: "wrap" }, t("pve.guestRemoveTitle", { name: g.name })), h("p", { class: "muted" }, t("pve.guestRemoveLead", { kind: guestKind(g), name: x.name })), field(t("pve.typeName", { name: g.name }), typed), h("footer", null, closeButton(() => dialog, t("common.cancel")), go));
}

async function pveBackupNow(x, g, el) {
  el.disabled = true;
  try {
    await api("POST", `/api/proxmox/${x.id}/guests/${g.id}/backups`, {});
    toast(t("pve.backupStarted", { name: g.name }));
  } catch (e) {
    toast(errorText(e), "error");
    el.disabled = false;
  }
}

function pveTasks(x) {
  const name = (task) => {
    const g = x.guests.find((y) => String(y.vmid) === task.id);
    // a task of the node itself (its shell, its updates) is about no guest
    return g ? `${g.name} (${g.vmid})` : task.id || task.node;
  };
  return x.tasks.length
    ? h(
        "div",
        { class: "table-wrap card" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", null, t("pve.col.when")), h("th", null, t("pve.col.task")), h("th", null, t("pve.col.target")), h("th", null, t("pve.col.user")), h("th", null, t("app.col.state")))),
          h(
            "tbody",
            null,
            x.tasks.map((task) =>
              h(
                "tr",
                { class: "clickable", onclick: () => pveTaskDialog(x, task, name(task)) },
                h("td", { class: "small" }, dateTime(task.start * 1000)),
                h("td", null, has("pve.task." + task.type) ? t("pve.task." + task.type) : h("span", { class: "mono" }, task.type)),
                h("td", { class: "small" }, name(task), x.nodes.length > 1 && h("span", { class: "muted" }, " · " + task.node)),
                h("td", { class: "small muted mono" }, task.user),
                h("td", null, task.end === null ? h("span", { class: "state restarting" }, t("pve.taskRunning")) : task.failed ? h("span", { class: "chip danger clip" }, task.status) : h("span", { class: "chip ok" }, task.status === "OK" ? "OK" : task.status)),
              ),
            ),
          ),
        ),
      )
    : h("p", { class: "card pad muted" }, t("pve.noTasks"));
}

async function pveTaskDialog(x, task, target) {
  const log = h("pre", { class: "log" }, t("machines.loading"));
  let dialog;
  dialog = openDialog("wide", h("header", null, h("h2", { class: "grow" }, (has("pve.task." + task.type) ? t("pve.task." + task.type) : task.type) + (target ? " · " + target : "")), closeX(() => dialog)), h("p", { class: "muted small" }, dateTime(task.start * 1000), " · ", task.user, " · ", task.end === null ? t("pve.taskRunning") : task.status), log, h("footer", null, closeButton(() => dialog)));
  try {
    const { lines } = await api("GET", `/api/proxmox/${x.id}/tasks/log?upid=${encodeURIComponent(task.upid)}`);
    log.textContent = lines.join("\n") || "—";
  } catch (e) {
    log.textContent = errorText(e);
  }
}
