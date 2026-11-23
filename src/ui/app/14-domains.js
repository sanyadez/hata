// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Names under the domain -------------------------------------------------------------------------

/** The domain names are under, as this page would open them: the HTTPS one, else the local name */
function namesDomain() {
  const https = state.settings?.https;
  if (https && https.mode !== "off" && https.domain) return { domain: https.domain, scheme: "https", port: "" };
  const local = state.settings?.local;
  if (local?.enabled && local.name) return { domain: local.name, scheme: "http", port: location.port ? ":" + location.port : "" };
  return null;
}

const nameUrl = (label) => {
  const d = namesDomain();
  return d ? `${d.scheme}://${label}.${d.domain}${d.port}/` : "";
};

/** A name's target in words: what it is, and where */
function nameTargetWords(n) {
  return t("names.kind." + n.kind, { name: n.title });
}

/**
 * Names under the domain for what is not an app of this server: containers, virtual machines, guests of
 * Proxmox, machines, their apps and any address; Hata passes the request on, its sign-in in front when asked
 */
function namesCard() {
  const body = h("div", { class: "stack" }, waitMark());
  const paint = async () => {
    let data;
    try {
      data = await api("GET", "/api/domains");
    } catch (e) {
      return put(body, h("p", { class: "error" }, errorText(e)));
    }
    if (!data.names.length) return put(body, h("p", { class: "muted small" }, t("names.none")));
    put(
      body,
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", null, t("names.col.name")), h("th", null, t("names.col.to")), h("th", null, t("names.col.access")), h("th"))),
          h(
            "tbody",
            null,
            data.names.map((n) =>
              h(
                "tr",
                null,
                h("td", null, nameUrl(n.label) ? h("a", { class: "link mono", href: nameUrl(n.label), target: "_blank", rel: "noopener noreferrer" }, nameUrl(n.label).replace(/^https?:\/\/|\/$/g, "")) : h("span", { class: "mono" }, n.label)),
                h("td", null, h("div", null, nameTargetWords(n)), h("div", { class: "muted small mono" }, n.away ? t("error." + n.away) : `${n.https ? "https" : "http"}://${n.at}`)),
                h("td", { class: "small" }, t(n.inherits ? "names.signedInApp" : n.protect ? "names.signedIn" : "names.open")),
                h("td", null, h("div", { class: "row-actions" }, button(t("names.change"), { class: "small", onclick: () => domainNameDialog(n, null, paint) }, "edit"))),
              ),
            ),
          ),
        ),
      ),
    );
  };
  void paint();
  return h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("names.title")), h("div", { class: "actions" }, button(t("names.add"), { class: "small", onclick: () => domainNameDialog(null, null, paint) }, "plus"))),
    h("p", { class: "muted small" }, t(namesDomain() ? "names.lead" : "names.noDomain")),
    body,
  );
}

/**
 * The server's address as people would type it, for "<server>:2222": its name on the home network, else the
 * address this page is at — never the HTTPS domain, which may lead to a proxy that passes on web pages only
 */
const serverHost = () => (state.settings?.local?.enabled && state.settings.local.name) || location.hostname;

/** Ports of this server passed on to a container, a guest, a machine or an address */
function portsCard() {
  const body = h("div", { class: "stack" }, waitMark());
  const paint = async () => {
    let data;
    try {
      data = await api("GET", "/api/domains");
    } catch (e) {
      return put(body, h("p", { class: "error" }, errorText(e)));
    }
    if (!data.forwards.length) return put(body, h("p", { class: "muted small" }, t("ports.none")));
    put(
      body,
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", null, t("ports.col.port")), h("th", null, t("names.col.to")), h("th", null, t("ports.col.how")), h("th"))),
          h(
            "tbody",
            null,
            data.forwards.map((f) =>
              h(
                "tr",
                null,
                h("td", null, h("div", { class: "mono strong" }, `${serverHost()}:${f.port}`), h("div", { class: "muted small" }, [t("ports.proto." + f.proto), f.note].filter(Boolean).join(" · "))),
                h("td", null, h("div", null, t("names.kind." + f.kind, { name: f.title }) + " : " + f.to), h("div", { class: f.error || f.away ? "error small" : "muted small mono" }, f.error ? f.error : f.away ? t("error." + f.away) : f.by === "incus" ? t("ports.byIncus") : f.at)),
                h("td", { class: "small" }, t(f.outside ? "ports.outsideToo" : "ports.homeOnly")),
                h("td", null, h("div", { class: "row-actions" }, button(t("names.change"), { class: "small", onclick: () => forwardDialog(f, null, paint) }, "edit"))),
              ),
            ),
          ),
        ),
      ),
    );
  };
  void paint();
  return h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("ports.title")), h("div", { class: "actions" }, button(t("ports.add"), { class: "small", onclick: () => forwardDialog(null, null, paint) }, "plus"))),
    h("p", { class: "muted small" }, t("ports.lead")),
    body,
  );
}

/** Opens a port of this server towards a target (or changes one) */
async function forwardDialog(existing, preset, after) {
  let data;
  try {
    data = await api("GET", "/api/domains");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const pick = targetPicker(data.targets, existing?.target ?? preset?.target, existing?.title);
  const port = h("input", { type: "number", min: 1, max: 65535, value: existing?.port ?? "", required: true, placeholder: "2222", class: "mono" });
  const to = h("input", { type: "number", min: 1, max: 65535, value: existing?.to ?? "", required: true, placeholder: "22", class: "mono" });
  const proto = h("select", null, ["tcp", "udp", "both"].map((p) => h("option", { value: p, selected: (existing?.proto ?? "tcp") === p }, t("ports.proto." + p))));
  const note = h("input", { value: existing?.note ?? "", maxLength: 60, placeholder: "SSH" });
  const [outside, outsideRow] = tickRow(t("ports.outside"), t("ports.outsideHint"), existing?.outside ?? false);
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const payload = { port: Number(port.value), proto: proto.value, target: pick.value(), to: Number(to.value), note: note.value.trim(), outside: outside.checked };
    try {
      await api(existing ? "PUT" : "POST", existing ? `/api/ports/${existing.port}` : "/api/ports", payload);
      dialog.close();
      toast(t(existing ? "ports.saved" : "ports.added", { port: payload.port }));
      after?.();
    } catch (err) {
      error.textContent = errorText(err);
    }
  };
  const remove = existing && button(t("names.remove"), {
    class: "danger-text",
    onclick: async () => {
      try {
        await api("DELETE", `/api/ports/${existing.port}`);
        dialog.close();
        toast(t("ports.removed", { port: existing.port }));
        after?.();
      } catch (err) {
        error.textContent = errorText(err);
      }
    },
  }, "trash");
  dialog = openDialog(
    "",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, t(existing ? "ports.changeTitle" : "ports.addTitle")), closeX(() => dialog)),
      h("p", { class: "muted small" }, t("ports.dialogLead")),
      // the hints stand under the whole row: under one half they pushed its field out of line with the other
      h("div", { class: "stack-tight" }, h("div", { class: "form-pair port-pair" }, field(t("ports.port"), h("span", { class: "port-at" }, h("span", { class: "muted mono clip" }, serverHost() + ":"), port)), field(t("ports.proto"), proto)), h("span", { class: "hint" }, t("ports.portHint"))),
      field(t("names.to"), pick.select),
      pick.hostRow,
      h("div", { class: "stack-tight" }, h("div", { class: "form-pair port-pair" }, field(t("ports.to"), to), field(t("ports.note"), note)), h("span", { class: "hint" }, t("ports.toHint"))),
      outsideRow,
      error,
      h("footer", null, remove, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t(existing ? "settings.save" : "ports.addGo"))),
    ),
  );
  port.focus();
}

/** The list a name or a forwarded port picks its target from, with a field for an address of one's own */
function targetPicker(tg, start, title, onchange) {
  const key = (target) => JSON.stringify(target);
  const option = (target, label, extra) => h("option", { value: key(target) }, label + (extra ? ` — ${extra}` : ""));
  const select = h(
    "select",
    { onchange: () => onchange?.() },
    tg.containers.length > 0 && h("optgroup", { label: t("names.group.containers") }, tg.containers.map((c) => option({ kind: "container", name: c.name }, c.name, c.address || t("names.noAddress")))),
    tg.guests.length > 0 && h("optgroup", { label: t("names.group.guests") }, tg.guests.map((g) => option({ kind: "guest", host: g.host, guest: g.id }, `${g.name} (${g.hostName})`, g.address || t("names.noAddress")))),
    tg.machines.length > 0 && h("optgroup", { label: t("names.group.machines") }, tg.machines.map((m) => option({ kind: "machine", id: m.id }, m.name, m.ip || t("machines.offline")))),
    tg.machineApps.length > 0 && h("optgroup", { label: t("names.group.machineApps") }, tg.machineApps.map((a) => option({ kind: "machineApp", id: a.id, app: a.app }, `${a.title} (${a.machine})`, a.port ? String(a.port) : ""))),
    h("optgroup", { label: t("names.group.other") }, h("option", { value: "address" }, t("names.address"))),
  );
  if (start && start.kind !== "address") {
    if (![...select.options].some((o) => o.value === key(start))) select.prepend(option(start, title ?? start.name ?? start.id, ""));
    select.value = key(start);
  } else select.value = "address";
  const host = h("input", { class: "mono", value: start?.kind === "address" ? start.host : "", placeholder: "192.168.1.1", spellcheck: false, autocapitalize: "none" });
  const hostRow = field(t("names.host"), host, t("names.hostHint"));
  const shape = () => {
    hostRow.hidden = select.value !== "address";
    host.required = select.value === "address";
  };
  shape();
  return { select, hostRow, key, shape, value: () => (select.value === "address" ? { kind: "address", host: host.value.trim() } : JSON.parse(select.value)) };
}

/** Gives a name (or changes one): what it leads to, the port, HTTPS, the sign-in */
async function domainNameDialog(existing, preset, after) {
  let data;
  try {
    data = await api("GET", "/api/domains");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const d = namesDomain();
  const tg = data.targets;
  const pick = targetPicker(tg, existing?.target ?? preset?.target, existing?.title, () => shape(true));
  const { select: to, hostRow, key } = pick;
  const label = h("input", { class: "mono", value: existing?.label ?? (preset?.label ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""), required: true, pattern: "[a-z0-9]([a-z0-9\\-]{0,61}[a-z0-9])?", spellcheck: false, autocapitalize: "none" });
  const port = h("input", { type: "number", min: 1, max: 65535, value: existing?.port ?? 80, required: true, class: "short mono" });
  const [https, httpsRow] = tickRow(t("names.https"), t("names.httpsHint"), existing?.https ?? false);
  const [protect, protectRow] = tickRow(t("names.protect"), t("names.protectHint"), existing?.protect ?? false);
  const shape = (picked) => {
    pick.shape();
    // a machine's app has its own port: offered once it is chosen
    const app = to.value !== "address" && JSON.parse(to.value).kind === "machineApp" ? tg.machineApps.find((a) => key({ kind: "machineApp", id: a.id, app: a.app }) === to.value) : null;
    if (picked && app?.port) port.value = String(app.port);
  };
  shape(!existing);
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  const send = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const target = pick.value();
    const payload = { label: label.value.trim().toLowerCase(), target, port: Number(port.value), https: https.checked, protect: protect.checked, allowed: existing?.allowed ?? "all" };
    try {
      await api(existing ? "PUT" : "POST", existing ? `/api/domains/${existing.label}` : "/api/domains", payload);
      dialog.close();
      toast(t(existing ? "names.saved" : "names.added", { name: payload.label }));
      after?.();
    } catch (err) {
      error.textContent = errorText(err);
    }
  };
  const remove = existing && button(t("names.remove"), {
    class: "danger-text",
    onclick: async () => {
      try {
        await api("DELETE", `/api/domains/${existing.label}`);
        dialog.close();
        toast(t("names.removed", { name: existing.label }));
        after?.();
      } catch (err) {
        error.textContent = errorText(err);
      }
    },
  }, "trash");
  dialog = openDialog(
    "",
    h(
      "form",
      { class: "stack", onsubmit: send },
      h("header", null, h("h2", { class: "grow" }, t(existing ? "names.changeTitle" : "names.addTitle")), closeX(() => dialog)),
      !d && h("p", { class: "banner small" }, t("names.noDomain")),
      field(t("names.label"), h("span", { class: "web-address" }, label, d && h("span", { class: "muted mono" }, "." + d.domain)), t("names.labelHint")),
      field(t("names.to"), to),
      hostRow,
      field(t("names.port"), port, t("names.portHint")),
      httpsRow,
      protectRow,
      error,
      h("footer", null, remove, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t(existing ? "settings.save" : "names.addGo"))),
    ),
  );
  label.focus();
}

// --- DNS server -------------------------------------------------------------------------------------

const DNS_UPSTREAMS = ["system", "quad9", "cloudflare", "google", "adguard", "custom"];

/** Hata as the home's DNS server: on or off, where it listens, where the rest goes, the names it answers */
function dnsSection() {
  const box = h("div", { class: "stack" }, h("section", { class: "card pad" }, waitMark()));
  let alive = true;
  cleanups.push(() => (alive = false));
  const load = async () => {
    try {
      const d = await api("GET", "/api/dns");
      if (alive) paintDns(box, d, load);
    } catch (e) {
      put(box, h("section", { class: "card pad" }, h("p", { class: "error" }, errorText(e))));
    }
  };
  void load();
  return [box];
}

function paintDns(box, d, load) {
  const s = d.settings;
  const error = h("p", { class: "error", role: "alert" });
  const send = async (patch, el) => {
    if (el) el.disabled = true;
    error.textContent = "";
    try {
      paintDns(box, await api("PUT", "/api/dns", patch), load);
    } catch (e) {
      error.textContent = errorText(e);
      if (el) el.disabled = false;
    }
  };
  const when = (ts) => (ts ? new Date(ts).toLocaleTimeString(state.lang, { hour: "2-digit", minute: "2-digit" }) : "—");
  const address = d.listening[0] ?? d.wanted[0] ?? location.hostname;
  // on or off, where it listens, and whether this device asks it
  const status = h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("dns.title"), " ", s.enabled && h("span", { class: "state " + (d.failed.length ? "restarting" : "running") }, t(d.failed.length ? "dns.partly" : "dns.working"))), h("div", { class: "actions" }, button(t(s.enabled ? "dns.turnOff" : "dns.turnOn"), { class: s.enabled ? "" : "primary", onclick: (e) => (s.enabled ? confirmDnsOff(() => send({ enabled: false })) : send({ enabled: true }, e.currentTarget)) }, "power"))),
    h("p", { class: "muted small" }, t("dns.lead")),
    !s.enabled && h("ul", { class: "muted small" }, ["router", "names", "split", "wg"].map((k) => h("li", null, t("dns.what." + k)))),
    s.enabled && d.listening.length > 0 && settingRow(t("dns.listening"), "", h("span", { class: "mono" }, d.listening.map((a) => `${a}:${d.port}`).join(", "))),
    ...d.failed.map((f) => h("p", { class: "banner small" }, t(f.holder ? "dns.failedHolder" : "dns.failed", { address: f.address, holder: f.holder, error: f.error }))),
    s.enabled && h("p", { class: d.you.seen ? "banner small ok" : "banner small" }, t(d.you.seen ? "dns.youUse" : "dns.youDont", { address: d.you.address, when: when(d.you.seen) })),
    h("p", { class: "muted small" }, t("dns.blockLead"), " ", h("a", { class: "link", href: "#/settings/adblock" }, t("settings.adblock"))),
    s.enabled && h("div", { class: "stack-s" }, h("strong", null, t("dns.routerTitle")), h("p", { class: "muted small" }, t("dns.router", { address })), h("p", { class: "muted small" }, t("dns.routerOne"))),
    error,
  );
  // where the questions not answered here go
  const choice = h("select", null, DNS_UPSTREAMS.map((u) => h("option", { value: u, selected: s.upstream === u }, t("dns.up." + u))));
  const [doh, dohRow] = tickRow(t("dns.doh"), t("dns.dohHint"), s.doh);
  const servers = h("textarea", { rows: 3, class: "mono", placeholder: "9.9.9.9\nhttps://dns.example/dns-query", spellcheck: false }, s.servers.join("\n"));
  const serversRow = field(t("dns.servers"), servers, t("dns.serversHint"));
  const shape = () => {
    dohRow.hidden = ["system", "custom"].includes(choice.value);
    serversRow.hidden = choice.value !== "custom";
  };
  choice.addEventListener("change", shape);
  shape();
  const upstream = h(
    "section",
    { class: "card pad stack" },
    h("h2", null, t("dns.upTitle")),
    h("p", { class: "muted small" }, t("dns.upLead")),
    field(t("dns.upChoice"), choice, choice.value === "system" ? t("dns.upSystem", { list: d.system.join(", ") || "—" }) : ""),
    dohRow,
    serversRow,
    h("div", { class: "actions" }, button(t("settings.save"), { class: "primary", onclick: (e) => send({ upstream: choice.value, doh: doh.checked, servers: servers.value.split(/[\s,]+/).filter(Boolean) }, e.currentTarget) })),
    d.looping.length > 0 && h("p", { class: "banner small" }, t("dns.looping", { list: d.looping.join(", ") })),
    s.enabled && h("div", { class: "stack-s" }, h("strong", null, t("dns.upNow")), ...d.upstreams.map((u) => h("div", { class: "activity-item" }, icon(u.fail > u.ok ? "x" : u.ok ? "check" : "clock", u.fail > u.ok ? "danger" : u.ok ? "ok" : ""), h("div", { class: "grow" }, h("div", { class: "mono" }, u.kind === "doh" ? u.url : u.kind === "dot" ? `${u.host} · TLS (${u.name})` : u.host), h("div", { class: "muted small" }, u.fail > u.ok ? t("dns.upFailed", { error: u.error }) : u.ok ? t("dns.upOk", { when: when(u.ok) }) : t("dns.upNotYet")))))),
  );
  // the names answered here
  const name = h("input", { class: "mono", placeholder: "printer.lan", spellcheck: false, autocapitalize: "none" });
  const type = h("select", null, h("option", { value: "A" }, "IPv4 (A)"), h("option", { value: "AAAA" }, "IPv6 (AAAA)"));
  const value = h("input", { class: "mono", placeholder: "192.168.1.40", spellcheck: false });
  const recError = h("p", { class: "error", role: "alert" });
  const names = h(
    "section",
    { class: "card pad stack" },
    h("h2", null, t("dns.namesTitle")),
    h("p", { class: "muted small" }, t("dns.namesLead")),
    ...d.domains.map((dom) => settingRow(`${dom}, *.${dom}`, t("dns.ownDomain"), h("span", { class: "muted" }, t("dns.toHata")))),
    d.domains.length === 0 && h("p", { class: "muted small" }, t("dns.noDomains")),
    ...s.records.map((r) => h("div", { class: "activity-item" }, icon("globe"), h("div", { class: "grow" }, h("div", { class: "mono" }, r.name), h("div", { class: "muted small mono" }, `${r.type} ${r.value}`)), button("", { class: "small ghost", title: t("names.remove"), "aria-label": t("names.remove"), onclick: async () => paintDns(box, await api("DELETE", `/api/dns/records/${r.type}/${r.name}`), load) }, "trash"))),
    h(
      "form",
      {
        class: "stack-s",
        onsubmit: async (e) => {
          e.preventDefault();
          recError.textContent = "";
          try {
            paintDns(box, await api("POST", "/api/dns/records", { name: name.value.trim(), type: type.value, value: value.value.trim() }), load);
          } catch (err) {
            recError.textContent = errorText(err);
          }
        },
      },
      h("div", { class: "web-address" }, name, type, value, h("button", { class: "btn" }, icon("plus"), t("dns.addRecord"))),
      recError,
    ),
  );
  // how it is used
  const st = d.stats;
  const usage = s.enabled && h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("dns.usageTitle")), button(t("dns.refresh"), { class: "small", onclick: () => load() }, "refresh")),
    h("p", { class: "muted small" }, t("dns.usage", { queries: st.queries, own: st.own, cached: st.cached, upstream: st.upstream, failed: st.failed, refused: st.refused, kept: st.kept })),
    d.clients.length > 0 && h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("dns.col.device")), h("th", null, t("dns.col.queries")), h("th", null, t("dns.col.last")))), h("tbody", null, d.clients.map((c) => h("tr", null, h("td", { class: "mono" }, c.address), h("td", null, String(c.count)), h("td", null, when(c.last))))))),
  );
  put(box, status, upstream, names, usage);
}

/** Turning it off takes the names away from every device that asks it */
function confirmDnsOff(go) {
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("dns.offTitle")), closeX(() => dialog)),
    h("p", null, t("dns.offLead")),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("dns.turnOff"), { class: "danger", onclick: () => (dialog.close(), go()) })),
  );
}

// --- Blocking by name ---------------------------------------------------------------------------

const adblockUi = { q: "", outcome: "", client: "", check: null };
const PAUSES = [5, 30, 60, 240, 1440];

const blockUntil = (ts) => new Date(ts).toLocaleTimeString(state.lang, { hour: "2-digit", minute: "2-digit" });

function adblockSection() {
  const box = h("div", { class: "stack" }, h("section", { class: "card pad" }, waitMark()));
  let alive = true;
  let timer = 0;
  cleanups.push(() => ((alive = false), clearTimeout(timer)));
  const typing = () => box.contains(document.activeElement) && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName);
  const load = async () => {
    clearTimeout(timer);
    try {
      const d = await api("GET", "/api/dns/block");
      if (!alive) return;
      if (!typing()) paintAdblock(box, d, load);
      // a list being downloaded: its numbers are on the way
      if (d.lists.some((l) => l.busy) || (d.settings.enabled && d.lists.some((l) => l.enabled && !l.counts && !l.error))) timer = setTimeout(load, 3000);
    } catch (e) {
      put(box, h("section", { class: "card pad" }, h("p", { class: "error" }, errorText(e))));
    }
  };
  void load();
  return [box];
}

function paintAdblock(box, d, load) {
  const s = d.settings;
  const error = h("p", { class: "error", role: "alert" });
  const act = async (method, path, body, el) => {
    if (el) el.disabled = true;
    error.textContent = "";
    try {
      paintAdblock(box, await api(method, path, body), load);
      if (method !== "GET") setTimeout(load, 1500);
    } catch (e) {
      error.textContent = errorText(e);
      if (el) el.disabled = false;
    }
  };
  const share = d.day.questions ? Math.round((d.day.blocked / d.day.questions) * 100) : 0;
  const mode = h("select", { onchange: () => act("PUT", "/api/dns/block", { mode: mode.value }) }, ["zero", "nxdomain"].map((m) => h("option", { value: m, selected: s.mode === m }, t("adblock.mode." + m))));
  const pauseMenu = (el) => menuAt(underButton(el), null, PAUSES.map((minutes) => ({ label: t("adblock.pauseFor", { what: pauseWords(minutes) }), icon: "clock", run: () => act("POST", "/api/dns/block/pause", { minutes }) })));
  const status = h(
    "section",
    { class: "card pad stack" },
    h(
      "div",
      { class: "section-head" },
      h("h2", null, t("adblock.title"), " ", s.enabled && h("span", { class: "state " + (d.paused ? "restarting" : "running") }, d.paused ? t("adblock.pausedUntil", { when: blockUntil(s.pausedUntil) }) : t("adblock.working"))),
      h(
        "div",
        { class: "actions" },
        s.enabled && (d.paused ? button(t("adblock.resume"), { class: "primary", onclick: (e) => act("POST", "/api/dns/block/pause", { minutes: 0 }, e.currentTarget) }, "power") : button(t("adblock.pause"), { onclick: (e) => pauseMenu(e.currentTarget) }, "clock")),
        button(t(s.enabled ? "dns.turnOff" : "dns.turnOn"), { class: s.enabled ? "" : "primary", onclick: (e) => act("PUT", "/api/dns/block", { enabled: !s.enabled }, e.currentTarget) }, "power"),
      ),
    ),
    h("p", { class: "muted small" }, t("adblock.lead")),
    s.enabled && d.lists.length === 0 && s.rules.length === 0 && h("p", { class: "banner small" }, t("adblock.nothingYet")),
    h("div", { id: "adblock-serving" }),
    s.enabled && d.day.questions > 0 && h("p", null, t("adblock.today", { questions: d.day.questions, blocked: d.day.blocked, share })),
    d.hours.length >= 2 && lineChart(d.hours.map((p) => ({ t: p.at, ...p })), [{ cls: "s1", label: t("adblock.chart.questions"), value: (p) => p.questions }, { cls: "s2", label: t("adblock.chart.blocked"), value: (p) => p.blocked }], { fmt: (v) => String(Math.round(v)), label: t("adblock.chart.title"), height: 130, head: false }),
    settingRow(t("adblock.modeTitle"), t("adblock.modeHint"), mode),
    settingRow(t("adblock.memory"), t("adblock.memoryHint", { process: bytes(d.memory.process) }), h("span", { class: "mono" }, bytes(d.memory.lists))),
    error,
  );
  void api("GET", "/api/dns").then((dns) => {
    const at = status.querySelector("#adblock-serving");
    if (at && s.enabled && !dns.settings.enabled) put(at, h("p", { class: "banner small" }, t("adblock.serverOff"), " ", h("a", { class: "link", href: "#/settings/dns" }, t("adblock.serverOpen"))));
    else if (at && s.enabled && !dns.clients.length) put(at, h("p", { class: "banner small" }, t("adblock.nobodyAsks"), " ", h("a", { class: "link", href: "#/settings/dns" }, t("adblock.serverOpen"))));
  }).catch(() => {});
  // the lists
  const updated = (l) => (l.updated ? new Date(l.updated).toLocaleString(state.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const countsLine = (l) => {
    if (l.busy) return t("adblock.list.downloading");
    if (!l.counts) return l.error ? "" : t("adblock.list.waiting");
    const c = l.counts;
    return [t("adblock.list.names", { n: c.names.toLocaleString(state.lang) }), c.rules > 0 && t("adblock.list.rules", { n: c.rules.toLocaleString(state.lang) }), (c.cosmetic + c.notDns) > 0 && t("adblock.list.notDns", { n: (c.cosmetic + c.notDns).toLocaleString(state.lang) }), c.broken > 0 && t("adblock.list.broken", { n: c.broken.toLocaleString(state.lang) }), c.overLimit > 0 && t("adblock.list.over", { n: c.overLimit.toLocaleString(state.lang) }), l.memory > 0 && bytes(l.memory), t("adblock.list.updated", { when: updated(l) })].filter(Boolean).join(" · ");
  };
  const listRow = (l) =>
    h(
      "div",
      { class: "activity-item adblock-list" },
      h("input", { type: "checkbox", checked: l.enabled, "aria-label": l.name, onchange: (e) => act("PATCH", `/api/dns/block/lists/${l.id}`, { enabled: e.currentTarget.checked }, e.currentTarget) }),
      h("div", { class: "grow" }, h("div", null, h("strong", null, l.name), l.allow && h("span", { class: "pill" }, t("adblock.list.exceptions"))), h("div", { class: "muted small adblock-url" }, l.url), h("div", { class: "muted small" }, countsLine(l)), l.error && h("div", { class: "error small" }, t("adblock.list.failed", { error: l.error }))),
      button("", { class: "small ghost", disabled: l.busy, title: t("adblock.list.refresh"), "aria-label": t("adblock.list.refresh"), onclick: (e) => act("POST", `/api/dns/block/lists/${l.id}/refresh`, undefined, e.currentTarget) }, "refresh"),
      button("", { class: "small ghost", title: t("names.remove"), "aria-label": t("names.remove"), onclick: () => confirmAction({ title: t("adblock.list.removeTitle", { name: l.name }), lead: t("adblock.list.removeLead"), label: t("names.remove"), run: () => act("DELETE", `/api/dns/block/lists/${l.id}`) }) }, "trash"),
    );
  const [auto, autoRow] = tickRow(t("adblock.update"), t("adblock.updateHint"), s.update);
  auto.addEventListener("change", () => act("PUT", "/api/dns/block", { update: auto.checked }));
  const lists = h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("adblock.lists")), h("div", { class: "actions" }, d.lists.length > 0 && button(t("adblock.list.refreshAll"), { class: "small", onclick: (e) => act("POST", "/api/dns/block/refresh", undefined, e.currentTarget) }, "refresh"), button(t("adblock.list.add"), { class: "small primary", onclick: () => addBlockListDialog(d, (fresh) => (paintAdblock(box, fresh, load), load())) }, "plus"))),
    d.lists.length ? h("div", { class: "stack-s" }, d.lists.map(listRow)) : h("p", { class: "muted small" }, t("adblock.list.none")),
    d.lists.length > 0 && h("p", { class: "muted small" }, t("adblock.list.total", { n: d.names.toLocaleString(state.lang) })),
    autoRow,
  );
  // the person's own rules
  const rules = h("textarea", { rows: Math.min(14, Math.max(5, s.rules.length + 1)), class: "mono", spellcheck: false, autocapitalize: "none", placeholder: "||ads.example.com^\n@@||good.example.com^\n/^ad[0-9]+\\./\n||kids.example^$client=192.168.1.20" }, s.rules.join("\n"));
  const own = h(
    "section",
    { class: "card pad stack" },
    h("h2", null, t("adblock.own")),
    h("p", { class: "muted small" }, t("adblock.ownLead")),
    rules,
    ...d.own.trouble.map((x) => h("p", { class: "banner small" }, h("code", null, x.line), " — ", t("adblock.own." + x.why))),
    h("details", { class: "muted small" }, h("summary", null, t("adblock.syntax")), h("ul", null, ["sub", "exact", "allow", "wild", "regex", "important", "dnstype", "client", "rewrite", "badfilter"].map((k) => h("li", null, h("code", null, t("adblock.syntax." + k + ".code")), " — ", t("adblock.syntax." + k))))),
    h("div", { class: "actions" }, button(t("settings.save"), { class: "primary", onclick: (e) => { const go = e.currentTarget; rules.blur(); return act("PUT", "/api/dns/block/rules", { text: rules.value }, go); } })),
  );
  // what was asked, and what a name would get
  const logBody = h("div");
  const paintLog = async () => {
    try {
      const params = new URLSearchParams({ q: adblockUi.q, outcome: adblockUi.outcome, client: adblockUi.client, limit: "100" });
      const list = await api("GET", `/api/dns/block/log?${params}`);
      paintBlockLog(logBody, list, d, (name, allow) => act("POST", "/api/dns/block/name", { name, allow }));
    } catch (e) {
      put(logBody, h("p", { class: "error" }, errorText(e)));
    }
  };
  const search = h("input", { type: "search", placeholder: t("adblock.log.search"), value: adblockUi.q, oninput: () => ((adblockUi.q = search.value), void paintLog()) });
  const outcome = h("select", { onchange: () => ((adblockUi.outcome = outcome.value), void paintLog()) }, ["", "blocked", "allowed", "rewritten", "passed", "own", "failed"].map((o) => h("option", { value: o, selected: adblockUi.outcome === o }, t("adblock.log.only." + (o || "all")))));
  const device = h("select", { onchange: () => ((adblockUi.client = device.value), void paintLog()) }, h("option", { value: "" }, t("adblock.log.allDevices")), d.devices.map((x) => h("option", { value: x.address, selected: adblockUi.client === x.address }, x.name ? `${x.name} (${x.address})` : x.address)));
  const [keep, keepRow] = tickRow(t("adblock.log.keep"), t("adblock.log.keepHint"), s.log);
  keep.addEventListener("change", () => act("PUT", "/api/dns/block", { log: keep.checked }));
  const checkName = h("input", { class: "mono", placeholder: "ads.example.com", spellcheck: false, autocapitalize: "none" });
  const checkOut = h("div");
  const runCheck = async (e) => {
    e.preventDefault();
    try {
      const r = await api("GET", `/api/dns/block/check?${new URLSearchParams({ name: checkName.value.trim() })}`);
      put(checkOut, h("p", { class: "banner small" + (r.hit?.action === "block" ? "" : " ok") }, r.hit ? t("adblock.check." + r.hit.action, { name: r.name, rule: r.hit.rule, source: r.hit.source === "own" ? t("adblock.own") : (r.hit.listName ?? "") }) : t("adblock.check.none", { name: r.name })));
    } catch (err) {
      put(checkOut, h("p", { class: "error" }, errorText(err)));
    }
  };
  const logCard = h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("adblock.log")), button(t("dns.refresh"), { class: "small", onclick: () => void paintLog() }, "refresh")),
    h("form", { class: "web-address", onsubmit: runCheck }, checkName, h("button", { class: "btn" }, icon("search"), t("adblock.check"))),
    checkOut,
    h("div", { class: "adblock-filter" }, search, outcome, device),
    logBody,
    keepRow,
  );
  void paintLog();
  // most blocked, devices
  const top = d.top.length > 0 && h(
    "section",
    { class: "card pad stack" },
    h("h2", null, t("adblock.top")),
    h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("adblock.col.name")), h("th", null, t("adblock.col.times")), h("th", null, ""))), h("tbody", null, d.top.map((x) => h("tr", null, h("td", { class: "mono" }, x.name), h("td", null, String(x.count)), h("td", null, button(t("adblock.allow"), { class: "small", onclick: (e) => act("POST", "/api/dns/block/name", { name: x.name, allow: true }, e.currentTarget) })))))),
  ));
  const newAddress = h("input", { class: "mono", placeholder: "192.168.1.20", spellcheck: false });
  const newName = h("input", { placeholder: t("adblock.device.namePlace") });
  const devices = h(
    "section",
    { class: "card pad stack" },
    h("h2", null, t("adblock.devices")),
    h("p", { class: "muted small" }, t("adblock.devicesLead")),
    d.devices.length
      ? h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, t("dns.col.device")), h("th", null, t("dns.col.queries")), h("th", null, t("adblock.col.blocked")), h("th", null, t("adblock.col.on")), h("th", null, ""))), h("tbody", null, d.devices.map((x) => h("tr", null, h("td", null, h("strong", null, x.name || "—"), h("div", { class: "muted small mono" }, x.address)), h("td", null, String(x.count)), h("td", null, String(x.blocked)), h("td", null, h("input", { type: "checkbox", checked: x.on, "aria-label": t("adblock.col.on"), onchange: (e) => act("PUT", "/api/dns/block/device", { address: x.address, name: x.name, on: e.currentTarget.checked }, e.currentTarget) })), h("td", null, button(t("adblock.device.name"), { class: "small", onclick: () => blockDeviceDialog(x, (name) => act("PUT", "/api/dns/block/device", { address: x.address, name, on: x.on })) })))))))
      : h("p", { class: "muted small" }, t("adblock.devicesNone")),
    h("form", { class: "web-address", onsubmit: (e) => { e.preventDefault(); void act("PUT", "/api/dns/block/device", { address: newAddress.value.trim(), name: newName.value.trim(), on: true }); } }, newAddress, newName, h("button", { class: "btn" }, icon("plus"), t("dns.addRecord"))),
  );
  // moving in
  const moveIn = h("section", { class: "card pad stack" }, h("h2", null, t("adblock.import")), h("p", { class: "muted small" }, t("adblock.importLead")));
  const planError = h("p", { class: "error", role: "alert" });
  const planFrom = async (promise) => {
    planError.textContent = "";
    try {
      blockImportDialog(await promise, (fresh) => (paintAdblock(box, fresh, load), load()));
    } catch (e) {
      planError.textContent = errorText(e);
    }
  };
  const picked = h("input", {
    type: "file",
    hidden: true,
    onchange: async () => {
      const f = picked.files[0];
      if (!f) return;
      picked.value = "";
      await planFrom(fetch("/api/dns/block/import/file", { method: "POST", body: f }).then(async (r) => {
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) throw new ApiError(r.status, payload.error?.code ?? "request.failed", payload.error?.detail);
        return payload;
      }));
    },
  });
  const appsBox = h("div", { class: "stack-s" });
  moveIn.append(h("div", { class: "actions" }, button(t("adblock.importFile"), { onclick: () => picked.click() }, "upload"), picked), appsBox, planError);
  void api("GET", "/api/dns/block/import/apps").then((apps) => {
    put(appsBox, ...apps.map((a) => h("div", { class: "activity-item" }, icon("box"), h("div", { class: "grow" }, h("strong", null, a.title || a.name), h("div", { class: "muted small" }, t(a.found ? "adblock.importApp" : "adblock.importAppNoFile", { kind: a.kind === "pihole" ? "Pi-hole" : "AdGuard Home" }))), a.found && button(t("adblock.importTake"), { class: "small", onclick: () => planFrom(api("POST", "/api/dns/block/import/app", { name: a.name })) }, "download"))));
  }).catch(() => {});
  put(box, status, lists, own, logCard, top, devices, moveIn);
}

const pauseWords = (minutes) => (minutes < 60 ? t("adblock.minutes", { n: minutes }) : t("adblock.hours", { n: minutes / 60 }));

function paintBlockLog(body, list, d, rule) {
  if (!list.length) return void put(body, h("p", { class: "muted small" }, t(d.settings.log ? "adblock.log.empty" : "adblock.log.off")));
  const nameOf = (address) => d.devices.find((x) => x.address === address)?.name || address;
  const typeName = { 1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 64: "SVCB", 65: "HTTPS" };
  put(
    body,
    h(
      "div",
      { class: "table-wrap adblock-log" },
      h(
        "table",
        null,
        h("thead", null, h("tr", null, h("th", null, t("dns.col.last")), h("th", null, t("dns.col.device")), h("th", null, t("adblock.col.name")), h("th", null, t("adblock.col.outcome")), h("th", null, ""))),
        h(
          "tbody",
          null,
          list.map((e) => {
            const cut = e.outcome === "blocked";
            return h(
              "tr",
              null,
              h("td", { class: "small" }, new Date(e.at).toLocaleTimeString(state.lang)),
              h("td", { class: "small" }, nameOf(e.client)),
              h("td", null, h("span", { class: "mono" }, e.name), " ", h("span", { class: "muted small" }, typeName[e.type] ?? String(e.type))),
              h("td", null, h("span", { class: "adblock-outcome " + e.outcome }, t("adblock.outcome." + e.outcome)), e.rule && h("div", { class: "muted small adblock-why" }, e.source === "own" ? t("adblock.own") : (e.listName ?? ""), " ", h("span", { class: "mono" }, e.rule))),
              h("td", null, cut ? button(t("adblock.allow"), { class: "small", onclick: () => rule(e.name, true) }) : e.outcome === "passed" || e.outcome === "allowed" ? button(t("adblock.block"), { class: "small", onclick: () => rule(e.name, false) }) : null),
            );
          }),
        ),
      ),
    ),
  );
}

function blockDeviceDialog(x, save) {
  const name = h("input", { value: x.name, maxlength: 40, placeholder: t("adblock.device.namePlace") });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, x.address), closeX(() => dialog)),
    field(t("adblock.device.name"), name, t("adblock.device.nameHint")),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("settings.save"), { class: "primary", onclick: () => (dialog.close(), save(name.value.trim())) })),
  );
}

/** Lists anyone may choose from, none ticked; or any address */
function addBlockListDialog(d, done) {
  const have = new Set(d.lists.map((l) => l.url));
  const offered = d.known.filter((k) => !have.has(k.url)).map((k) => {
    const [box, row] = tickRow(k.name, `${t("adblock.known." + k.what)} · ${t("adblock.size." + k.size)}`, false);
    return { k, box, row };
  });
  const url = h("input", { class: "mono", type: "url", placeholder: "https://example.com/list.txt", spellcheck: false });
  const name = h("input", { placeholder: t("adblock.list.namePlace") });
  const [allow, allowRow] = tickRow(t("adblock.list.exceptionsTick"), t("adblock.list.exceptionsHint"), false);
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("adblock.list.add")), closeX(() => dialog)),
    offered.length > 0 && h("div", { class: "stack-s" }, h("strong", null, t("adblock.known")), h("p", { class: "muted small" }, t("adblock.knownLead")), offered.map((o) => o.row)),
    h("div", { class: "stack-s" }, h("strong", null, t("adblock.byAddress")), field(t("adblock.list.url"), url, t("adblock.list.urlHint")), field(t("adblock.list.name"), name), allowRow),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("adblock.list.add"), {
        class: "primary",
        onclick: async (e) => {
          const go = e.currentTarget;
          const chosen = offered.filter((o) => o.box.checked).map((o) => ({ url: o.k.url, name: o.k.name }));
          if (url.value.trim()) chosen.push({ url: url.value.trim(), name: name.value.trim(), allow: allow.checked });
          if (!chosen.length) return void (error.textContent = t("adblock.list.chooseOne"));
          go.disabled = true;
          try {
            let fresh = null;
            for (const one of chosen) fresh = await api("POST", "/api/dns/block/lists", one);
            dialog.close();
            done(fresh);
          } catch (err) {
            error.textContent = errorText(err);
            go.disabled = false;
          }
        },
      }),
    ),
  );
}

/** What a Pi-hole or an AdGuard Home brings, part by part; what has no place in Hata is said */
function blockImportDialog(plan, done) {
  const kind = plan.from === "pihole" ? "Pi-hole" : "AdGuard Home";
  const part = (key, n, words) => {
    if (!n) return null;
    const [box, row] = tickRow(t("adblock.part." + key, { n }), words, true);
    return { key, box, row };
  };
  const upstreamText = plan.upstream ? (plan.upstream.preset ? t("dns.up." + plan.upstream.preset) + (plan.upstream.doh ? " · TLS" : "") : plan.upstream.servers.join(", ")) : "";
  const parts = [
    part("lists", plan.lists.length, plan.lists.slice(0, 6).map((l) => l.name).join(", ") + (plan.lists.length > 6 ? " …" : "")),
    part("rules", plan.rules.length, plan.rules.slice(0, 3).join("  ")),
    part("records", plan.records.length, plan.records.slice(0, 3).map((r) => r.name).join(", ")),
    part("devices", plan.devices.length, plan.devices.slice(0, 4).map((x) => x.name || x.address).join(", ")),
    plan.mode && part("mode", 1, t("adblock.mode." + plan.mode)),
    plan.upstream && part("upstream", 1, upstreamText),
  ].filter(Boolean);
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("adblock.importTitle", { kind })), closeX(() => dialog)),
    h("p", { class: "muted small" }, t("adblock.importPlan")),
    parts.length ? h("div", { class: "stack-s" }, parts.map((p) => p.row)) : h("p", null, t("adblock.importNothing")),
    plan.leftOut.length > 0 && h("details", { class: "muted small" }, h("summary", null, t("adblock.leftOut", { n: plan.leftOut.length })), h("ul", null, plan.leftOut.slice(0, 40).map((x) => h("li", null, t("adblock.left." + x.code), x.detail && [" ", h("code", null, x.detail)])))),
    h("p", { class: "muted small" }, t("adblock.importPort", { kind })),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      parts.length > 0 && button(t("adblock.importGo"), {
        class: "primary",
        onclick: async (e) => {
          const go = e.currentTarget;
          go.disabled = true;
          try {
            const fresh = await api("POST", "/api/dns/block/import/apply", { id: plan.id, parts: Object.fromEntries(parts.map((p) => [p.key, p.box.checked])) });
            dialog.close();
            done(fresh);
          } catch (err) {
            error.textContent = errorText(err);
            go.disabled = false;
          }
        },
      }),
    ),
  );
}

/** The block on Home: what was blocked in a day, and the pause within reach */
function adblockBlock(el, b) {
  if (!b) return;
  const share = b.questions ? Math.round((b.blocked / b.questions) * 100) : 0;
  const send = async (path, body) => {
    try {
      await api("POST", path, body);
      await refresh();
    } catch {}
  };
  put(
    el,
    h("div", { class: "section-head" }, h("h2", null, h("a", { href: "#/settings/adblock" }, t("adblock.title"))), b.enabled && h("span", { class: "state " + (b.paused ? "restarting" : b.serving ? "running" : "stopped") }, b.paused ? t("adblock.pausedUntil", { when: blockUntil(b.pausedUntil) }) : t(b.serving ? "adblock.working" : "adblock.notServing"))),
    b.enabled
      ? [
          h("p", { class: "adblock-numbers" }, h("strong", null, b.blocked.toLocaleString(state.lang)), " ", h("span", { class: "muted small" }, t("adblock.block.ofDay", { questions: b.questions.toLocaleString(state.lang), share }))),
          meterBar(share),
          h("p", { class: "muted small" }, t("adblock.list.total", { n: b.names.toLocaleString(state.lang) })),
          h("div", { class: "actions" }, b.paused ? button(t("adblock.resume"), { class: "small", onclick: () => send("/api/dns/block/pause", { minutes: 0 }) }, "power") : button(t("adblock.pauseFor", { what: pauseWords(30) }), { class: "small", onclick: () => send("/api/dns/block/pause", { minutes: 30 }) }, "clock")),
          b.top?.length > 0 && h("div", { class: "adblock-top fits" }, h("div", { class: "muted small" }, t("adblock.block.most")), b.top.map((x) => h("div", { class: "mono small clip" }, x.name, " · ", x.count.toLocaleString(state.lang)))),
        ]
      : h("p", { class: "muted small" }, t("adblock.block.off"), " ", h("a", { class: "link", href: "#/settings/adblock" }, t("common.open"))),
  );
}

// --- Notifications ------------------------------------------------------------------------------

/** Browsers offer notifications only to a page opened over HTTPS */
const pushSupported = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const keyBytes = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pushSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function pushSubscribe(key) {
  if ((await Notification.requestPermission()) !== "granted") throw new Error("denied");
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  // a subscription made for another server key (Hata was set up anew) cannot be carried over
  const old = await registration.pushManager.getSubscription();
  if (old) await old.unsubscribe();
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api("POST", `/api/notify/push?lang=${state.lang}`, { subscription: subscription.toJSON(), label: deviceName(navigator.userAgent) });
  localStorage.setItem("hata.push", subscription.endpoint);
}

/**
 * The browser replaced this device's subscription without telling the service worker which one it was:
 * the new one is told to Hata when the page is opened, in place of the old. A device removed from the
 * list on purpose keeps its old subscription here, so it is left alone.
 */
async function pushResync() {
  const known = localStorage.getItem("hata.push");
  if (!isAdmin() || !pushSupported() || Notification.permission !== "granted") return;
  const local = await pushSubscription().catch(() => null);
  if (!local || local.endpoint === known) return;
  const info = await api("GET", "/api/notify/push").catch(() => null);
  // subscribed before this was remembered: remembered now
  if (!known) return void (info?.devices.some((d) => d.endpoint === local.endpoint) && localStorage.setItem("hata.push", local.endpoint));
  if (!info || info.devices.some((d) => d.endpoint === local.endpoint)) return localStorage.setItem("hata.push", local.endpoint);
  if (!info.devices.some((d) => d.endpoint === known)) return;
  try {
    await api("POST", "/api/notify/push/renew", { old: known, subscription: local.toJSON() });
    localStorage.setItem("hata.push", local.endpoint);
  } catch {}
}

function devicesCard() {
  const box = h("div", { class: "stack" });
  const error = h("p", { class: "error", role: "alert" });
  let alive = true;
  cleanups.push(() => (alive = false));
  const attempt = async (action) => {
    error.textContent = "";
    try {
      await action();
    } catch (e) {
      error.textContent = e instanceof ApiError ? errorText(e) : t(e.message === "denied" ? "notify.denied" : "notify.pushFailed", { message: e.message });
    }
    void paint();
  };
  const paint = async () => {
    if (!pushSupported()) return put(box, h("p", { class: "muted" }, t(window.isSecureContext ? "notify.pushUnsupported" : "notify.pushNeedsHttps")));
    const [info, sub] = await Promise.all([api("GET", "/api/notify/push").catch(() => null), pushSubscription().catch(() => null)]);
    if (!alive || !info) return;
    const here = sub && info.devices.some((d) => d.endpoint === sub.endpoint);
    put(
      box,
      info.devices.map((device) => {
        const own = sub?.endpoint === device.endpoint;
        return settingRow(
          device.label + (own ? ` · ${t("account.thisDevice")}` : ""),
          `${device.service} · ${dateTime(device.createdAt)}`,
          h(
            "span",
            { class: "row-actions" },
            button(t("notify.test"), { class: "small", onclick: () => attempt(async () => (await api("POST", "/api/notify/test", { channel: "push", device: device.id }), toast(t("notify.testSent")))) }),
            button(t("app.remove"), { class: "small", onclick: () => attempt(async () => (own && (await sub.unsubscribe().catch(() => {}), localStorage.removeItem("hata.push")), await api("DELETE", `/api/notify/push?id=${device.id}`))) }),
          ),
        );
      }),
      !here && h("div", null, button(t("notify.pushHere"), { class: "primary", onclick: () => attempt(() => pushSubscribe(info.key)) }, "bell")),
    );
  };
  void paint();
  return h("section", { class: "card pad" }, h("h2", null, t("notify.push.title")), h("p", { class: "muted small" }, t("notify.push.lead")), box, error);
}

function channelCard(channel, rows, values) {
  const config = state.notify.config[channel];
  const last = state.notify.last[channel];
  const enabled = h("input", { type: "checkbox", checked: config.enabled });
  const error = h("p", { class: "error", role: "alert" });
  const attempt = async (test) => {
    error.textContent = "";
    try {
      state.notify = await api("PUT", "/api/notify", { [channel]: { enabled: enabled.checked, ...values() } });
      if (test) state.notify = await api("POST", "/api/notify/test", { channel });
      toast(t(test ? "notify.testSent" : "settings.saved"));
      renderSettings();
    } catch (err) {
      error.textContent = errorText(err);
    }
  };
  return h(
    "form",
    { class: "card pad", onsubmit: (e) => (e.preventDefault(), void attempt(false)) },
    h("h2", null, t(`notify.${channel}.title`)),
    h("p", { class: "muted small" }, t(`notify.${channel}.lead`)),
    settingRow(t("notify.enabled"), "", enabled),
    rows,
    last?.error && h("p", { class: "error" }, t("notify.lastError", { time: ago(last.at), message: last.error })),
    error,
    h("footer", { class: "pair" }, button(t("notify.test"), { onclick: () => attempt(true) }), h("button", { class: "btn primary" }, t("settings.save"))),
  );
}

/** A saved token never comes back to the page: only one typed anew is sent, an empty field keeps what is saved */
const typedToken = (input) => (input.value.trim() ? { token: input.value } : {});

function telegramCard() {
  const config = state.notify.config.telegram;
  const token = h("input", { type: "password", autocomplete: "off", spellcheck: false, class: "mono", placeholder: config.saved ? t("notify.tokenSaved") : "123456789:AA…" });
  const chat = h("input", { value: config.chat, spellcheck: false, class: "mono", placeholder: "123456789" });
  const found = h("div", { class: "pair" });
  const find = async () => {
    try {
      const chats = await api("POST", "/api/notify/telegram/chats", { token: token.value.trim() });
      if (chats.length === 1) chat.value = chats[0].id;
      put(found, chats.length === 0 ? h("p", { class: "muted small" }, t("notify.telegram.noChats")) : chats.length > 1 && chats.map((c) => button(c.title, { class: "small", onclick: () => (chat.value = c.id) })));
    } catch (e) {
      put(found, h("p", { class: "error" }, errorText(e)));
    }
  };
  return channelCard(
    "telegram",
    [settingRow(t("notify.telegram.token"), t("notify.telegram.tokenHint"), token), settingRow(t("notify.telegram.chat"), t("notify.telegram.chatHint"), h("span", { class: "pair" }, chat, button(t("notify.telegram.find"), { class: "small", onclick: find }, "search"))), found],
    () => ({ ...typedToken(token), chat: chat.value }),
  );
}

/** Mail through an SMTP server: the provider's one (with an app password) or a relay of your own */
function emailCard() {
  const config = state.notify.config.email;
  const host = h("input", { value: config.host, spellcheck: false, class: "mono", placeholder: "smtp.gmail.com" });
  const port = h("input", { type: "number", min: 1, max: 65535, value: config.port, class: "mono port" });
  const security = h("select", null, ["starttls", "tls", "none"].map((value) => h("option", { value, selected: config.security === value }, t("notify.email.security." + value))));
  // the usual port follows the choice, unless one of one's own was typed
  security.addEventListener("change", () => {
    if (["", "25", "465", "587"].includes(port.value)) port.value = security.value === "tls" ? "465" : security.value === "starttls" ? "587" : "25";
  });
  const user = h("input", { value: config.user, spellcheck: false, autocomplete: "off", class: "mono" });
  const password = h("input", { type: "password", autocomplete: "new-password", spellcheck: false, class: "mono", placeholder: config.saved ? t("notify.tokenSaved") : "" });
  const forget = config.saved && button(t("notify.tokenForget"), { class: "small", onclick: async () => {
    try {
      state.notify = await api("PUT", "/api/notify", { email: { password: "" } });
      renderSettings();
    } catch (err) {
      toast(errorText(err), "error");
    }
  } });
  const from = h("input", { type: "email", value: config.from, spellcheck: false, class: "mono", placeholder: "hata@example.org" });
  const to = h("input", { value: config.to.join(", "), spellcheck: false, class: "mono", placeholder: "me@example.org" });
  return channelCard(
    "email",
    [
      settingRow(t("notify.email.host"), t("notify.email.hostHint"), h("span", { class: "pair" }, host, port)),
      settingRow(t("notify.email.securityTitle"), t("notify.email.securityHint"), security),
      settingRow(t("notify.email.user"), t("notify.email.userHint"), user),
      settingRow(t("notify.email.password"), t("notify.email.passwordHint"), forget ? h("span", { class: "pair" }, password, forget) : password),
      settingRow(t("notify.email.from"), t("notify.email.fromHint"), from),
      settingRow(t("notify.email.to"), t("notify.email.toHint"), to),
    ],
    () => ({ host: host.value, port: Number(port.value), security: security.value, user: user.value, from: from.value, to: to.value, ...(password.value ? { password: password.value } : {}) }),
  );
}

function notificationsSection() {
  const n = state.notify;
  if (!n) return [waitMark()];
  const error = h("p", { class: "error", role: "alert" });
  const toggle = (key) => {
    const box = h("input", {
      type: "checkbox",
      checked: n.config[key],
      onchange: async () => {
        error.textContent = "";
        try {
          state.notify = await api("PUT", "/api/notify", { [key]: box.checked });
          toast(t("settings.saved"));
        } catch (err) {
          box.checked = !box.checked;
          error.textContent = errorText(err);
        }
      },
    });
    return box;
  };
  const ntfyUrl = h("input", { type: "url", value: n.config.ntfy.url, spellcheck: false, class: "mono", placeholder: "https://ntfy.sh/my-topic" });
  const ntfyToken = h("input", { type: "password", autocomplete: "off", spellcheck: false, class: "mono", placeholder: n.config.ntfy.saved ? t("notify.tokenSaved") : "" });
  const forget = n.config.ntfy.saved && button(t("notify.tokenForget"), { class: "small", onclick: () => attemptForget() });
  const attemptForget = async () => {
    try {
      state.notify = await api("PUT", "/api/notify", { ntfy: { token: "" } });
      renderSettings();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };
  const hook = h("input", { type: "url", value: n.config.webhook.url, spellcheck: false, class: "mono", placeholder: "https://…" });
  return [
    h("section", { class: "card pad" }, h("h2", null, t("settings.notifications")), h("p", { class: "muted small" }, t("notify.lead")), settingRow(t("notify.problems"), t("notify.problemsHint"), toggle("problems")), settingRow(t("notify.resolved"), t("notify.resolvedHint"), toggle("resolved")), settingRow(t("notify.backups"), t("notify.backupsHint"), toggle("backups")), error),
    hiddenItemsCard(),
    devicesCard(),
    telegramCard(),
    channelCard("ntfy", [settingRow(t("notify.ntfy.url"), t("notify.ntfy.urlHint"), ntfyUrl), settingRow(t("notify.ntfy.token"), t("notify.ntfy.tokenHint"), forget ? h("span", { class: "pair" }, ntfyToken, forget) : ntfyToken)], () => ({ url: ntfyUrl.value, ...typedToken(ntfyToken) })),
    emailCard(),
    channelCard("webhook", [settingRow(t("notify.webhook.url"), t("notify.webhook.urlHint"), hook)], () => ({ url: hook.value })),
  ];
}

/** What is put off from "Needs attention", with a way to bring each back at once */
function hiddenItemsCard() {
  const list = state.hiddenItems;
  if (!list) return null;
  const back = async (entry, el) => {
    el.disabled = true;
    try {
      state.hiddenItems = (await api("POST", "/api/attention/wake", { id: entry.id })).hidden;
      toast(t("attention.hidden.backDone"));
      renderSettings();
      void refresh();
    } catch (err) {
      el.disabled = false;
      toast(errorText(err), "error");
    }
  };
  const row = (entry) => {
    // put off by an older version, which kept no words: said by its key
    const words = entry.code ? attentionWords(entry) : { title: t("attention.hidden.old"), text: entry.id };
    return h(
      "div",
      { class: "hidden-item " + entry.severity, menu: true },
      icon(entry.code ? attentionIcon(entry.code) : "alert"),
      h("div", { class: "grow" }, h("strong", null, words.title), words.text && h("p", { class: "muted small" }, words.text), h("p", { class: "small muted" }, entry.once ? t("attention.hidden.once") : entry.until === 0 ? t("attention.hidden.forever") : t("attention.hidden.until", { date: shortDate(entry.until) }))),
      button(t("attention.hidden.back"), { class: "small", onclick: (e) => back(entry, e.currentTarget) }, "bell"),
    );
  };
  return h(
    "section",
    { class: "card pad", id: "hidden" },
    h("h2", null, t("attention.hidden.title")),
    h("p", { class: "muted small" }, t("attention.hidden.lead")),
    list.length ? h("div", { class: "hidden-items" }, list.map(row)) : h("p", { class: "muted" }, t("attention.hidden.none")),
  );
}
