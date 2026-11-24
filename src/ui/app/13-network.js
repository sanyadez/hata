// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Settings → Network: the interfaces of the server ---------------------------------------------

async function loadNetwork() {
  state.network = await api("GET", "/api/network").catch(() => state.network);
  if (state.route.view === "settings" && showsSection("network")) renderSettings();
}

/**
 * A change of the network is on trial: this page keeps it as soon as it reaches the server again. When
 * the address itself changed the page cannot follow it — the link with the token does, opened by hand.
 */
function trialDialog(pending, after) {
  let over = false;
  const left = h("strong", null, "");
  const note = h("p", { class: "muted small" }, t("network.trial.checking"));
  const moved = pending.address && pending.address !== location.hostname && /^[\d.]+$/.test(location.hostname);
  const link = moved && `http://${pending.address}${location.port ? ":" + location.port : ""}/network/confirm?token=${pending.token}`;
  const finish = (message, kind) => {
    over = true;
    dialog.close();
    toast(message, kind);
    void loadNetwork();
    after?.();
  };
  const dialog = openDialog(
    "",
    h("header", null, h("h2", null, t("network.trial.title", { nic: pending.nic }))),
    h("p", null, t("network.trial.lead"), " ", left),
    note,
    link && h("div", { class: "banner stack" }, h("p", null, t("network.trial.moved", { address: pending.address })), h("a", { class: "link", href: link }, link.replace(/\?.*/, ""), icon("external"))),
    h(
      "footer",
      null,
      button(t("network.trial.revert"), {
        onclick: async () => {
          await api("POST", "/api/network/revert", {}).catch(() => {});
          finish(t("network.trial.reverted"));
        },
      }),
    ),
  );
  dialog.addEventListener("cancel", (e) => e.preventDefault());
  const tick = async () => {
    if (over) return;
    const seconds = Math.round((pending.until - Date.now()) / 1000);
    left.textContent = t("network.trial.left", { n: Math.max(0, seconds) });
    // a few seconds for the change to take hold, so that what answers is the new state and not the old
    if (pending.until - Date.now() < (state.network.trial - 8) * 1000 && seconds % 3 === 0) {
      const now = await fetch("/api/network").then((r) => (r.ok ? r.json() : null), () => null);
      if (over) return;
      if (now?.pending?.token === pending.token) {
        const kept = await api("POST", "/api/network/confirm", {}).catch(() => null);
        if (kept) return finish(t("network.trial.kept"));
      } else if (now && !now.pending) return finish(t(seconds > 0 ? "network.trial.kept" : "network.trial.back"), seconds > 0 ? undefined : "error");
    }
    if (seconds < -15) return finish(t("network.trial.back"), "error");
    setTimeout(tick, 1000);
  };
  void tick();
}

function nicDialog(nic) {
  const auto = h("input", { type: "radio", name: "method", value: "auto", checked: nic.dynamic && !nic.shares });
  const manual = h("input", { type: "radio", name: "method", value: "manual", checked: !nic.dynamic && !nic.shares });
  const shared = h("input", { type: "radio", name: "method", value: "shared", checked: !!nic.shares });
  const canShare = !nic.wifi && nic.internet !== "main";
  const needs = h("div");
  const address = h("input", { class: "mono", value: nic.addresses[0] ?? "", placeholder: "192.168.1.10/24", spellcheck: false });
  const gateway = h("input", { class: "mono", value: nic.gateway, placeholder: "192.168.1.1", spellcheck: false });
  const dns = h("input", { class: "mono", value: nic.dynamic ? "" : nic.dns.join(", "), placeholder: "192.168.1.1, 1.1.1.1", spellcheck: false });
  const fixed = h("div", { class: "stack", hidden: !manual.checked }, field(t("network.address"), address, t("network.addressHint")), field(t("network.gateway"), gateway));
  const dnsField = field(t("network.dns"), dns, t("network.dnsHint"));
  dnsField.hidden = shared.checked;
  const own = h("input", { class: "mono", value: nic.shares ? (nic.addresses[0] ?? "") : "", placeholder: "10.42.0.1/24", spellcheck: false });
  const ownField = field(t("network.shareAddress"), own, t("network.shareAddressHint"));
  ownField.hidden = !shared.checked;
  // IPv6 is sent only when the profile has a setting this form knows, or the person chose one
  let touched6 = nic.v6.method !== "";
  const method6 = h("select", { onchange: () => ((touched6 = true), show6()) }, ["auto", "manual", "off"].map((m) => h("option", { value: m, selected: (nic.v6.method || "auto") === m }, t("network.v6." + m))));
  const address6 = h("input", { class: "mono", value: nic.v6.address, placeholder: "2001:db8::10/64", spellcheck: false });
  const gateway6 = h("input", { class: "mono", value: nic.v6.gateway, placeholder: "fe80::1", spellcheck: false });
  const dns6 = h("input", { class: "mono", value: nic.v6.dns.join(", "), placeholder: "2606:4700:4700::1111", spellcheck: false });
  const fixed6 = h("div", { class: "stack" }, field(t("network.address"), address6, t("network.address6Hint")), field(t("network.gateway"), gateway6));
  const dns6Field = field(t("network.dns"), dns6, t("network.dns6Hint"));
  const six = h("div", { class: "stack" }, field("IPv6", method6), fixed6, dns6Field);
  const show6 = () => {
    six.hidden = shared.checked;
    fixed6.hidden = method6.value !== "manual";
    dns6Field.hidden = method6.value === "off";
  };
  show6();
  auto.onchange = manual.onchange = shared.onchange = () => {
    fixed.hidden = !manual.checked;
    dnsField.hidden = shared.checked;
    ownField.hidden = !shared.checked;
    show6();
  };
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            needs.replaceChildren();
            const pending = await api("PUT", `/api/network/${nic.name}`, { method: shared.checked ? "shared" : auto.checked ? "auto" : "manual", address: shared.checked ? own.value : address.value, gateway: gateway.value, dns: dns.value, ...(touched6 && !shared.checked ? { v6: { method: method6.value, address: address6.value, gateway: gateway6.value, dns: dns6.value } } : {}) });
            dialog.close();
            trialDialog(pending);
          } catch (err) {
            if (err.code === "network.needsPackage") needs.replaceChildren(hotspotNeeds(err.detail, error));
            else error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("network.change.title", { nic: nic.name })), closeX(() => dialog)),
      h("label", { class: "check" }, auto, h("span", null, h("strong", null, t("network.auto")), h("span", { class: "muted small block" }, t("network.autoHint")))),
      h("label", { class: "check" }, manual, h("span", null, h("strong", null, t("network.manual")), h("span", { class: "muted small block" }, t("network.manualHint")))),
      fixed,
      canShare && h("label", { class: "check" }, shared, h("span", null, h("strong", null, t("network.share")), h("span", { class: "muted small block" }, t("network.shareHint")))),
      ownField,
      dnsField,
      six,
      needs,
      h("p", { class: "banner small" }, t("network.trial.promise", { n: state.network.trial })),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("network.apply"))),
    ),
  );
}

function handOverDialog(nic) {
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("network.handover.title", { nic: nic.name })), closeX(() => dialog)),
    h("p", null, t("network.handover.lead")),
    h("p", { class: "muted small" }, t(nic.manager === "ifupdown" ? "network.handover.howIfupdown" : "network.handover.how", { nic: nic.name })),
    h("p", { class: "banner small" }, t("network.trial.promise", { n: state.network.trial })),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("network.handover.go"), {
        class: "primary",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const pending = await api("POST", `/api/network/${nic.name}/handover`, {});
            dialog.close();
            trialDialog(pending);
          } catch (err) {
            error.textContent = errorText(err);
            e.target.closest("button").disabled = false;
          }
        },
      }),
    ),
  );
}

/** Why a card cannot become the home bridge (the server's `bridgeRefusal`); "" — it can */
const bridgeWhy = (nic) => (nic.kind === "wifi" ? "wifi" : nic.kind === "modem" ? "modem" : nic.ports || nic.port ? "already" : nic.outside ? "outside" : nic.manager !== "nm" ? "notNm" : !nic.addresses.length ? "noAddress" : "");

/**
 * The home network for containers and virtual machines: the server's card goes into a bridge, as with
 * Proxmox's vmbr0. Without a card given, the cards are read and the one that leads to the internet offered.
 */
async function homeBridgeDialog(nic, after) {
  try {
    state.network = await api("GET", "/api/network");
  } catch (err) {
    return toast(errorText(err), "error");
  }
  const cards = state.network.nics.filter((n) => n.kind !== "modem" && !n.port && !n.ports);
  const fit = cards.filter((n) => !bridgeWhy(n));
  const pick = h("select", null, fit.map((n) => h("option", { value: n.name, selected: nic ? n.name === nic.name : n.internet === "main" }, `${n.name} — ${n.addresses.join(", ")}`)));
  const error = h("p", { class: "error", role: "alert" });
  const go = button(t("bridge.go"), {
    class: "primary",
    disabled: !fit.length || state.network.tool !== "ok",
    onclick: async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      error.textContent = "";
      try {
        const pending = await api("POST", `/api/network/${pick.value}/bridge`, {});
        dialog.close();
        trialDialog(pending, after);
      } catch (err) {
        error.textContent = errorText(err);
        el.disabled = false;
      }
    },
  });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("bridge.title")), closeX(() => dialog)),
    h("p", null, t("bridge.lead")),
    h("ul", { class: "muted small" }, ["router", "card", "nat", "wifi"].map((k) => h("li", null, t("bridge.what." + k)))),
    state.network.tool !== "ok" && h("p", { class: "banner small" }, t("bridge.needsNm")),
    fit.length ? field(t("bridge.card"), pick, t("bridge.cardHint")) : h("p", { class: "banner small" }, t("bridge.noCard")),
    cards.filter((n) => bridgeWhy(n)).length > 0 && h("ul", { class: "muted small" }, cards.filter((n) => bridgeWhy(n)).map((n) => h("li", null, `${n.name}: ${t("error.network.bridge." + bridgeWhy(n))}`))),
    h("p", { class: "muted small" }, t("bridge.how", { bridge: "hatalan0" })),
    h("p", { class: "banner small" }, t("network.trial.promise", { n: state.network.trial })),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
}

/** Takes the home bridge apart: its card gets the address back */
function bridgeApartDialog(nic) {
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("bridge.apartTitle")), closeX(() => dialog)),
    h("p", null, t("bridge.apartLead", { card: (nic.ports ?? [])[0] ?? "" })),
    h("p", { class: "banner small" }, t("network.trial.promise", { n: state.network.trial })),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("bridge.apartGo"), {
        class: "primary",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            const pending = await api("DELETE", "/api/network/bridge");
            dialog.close();
            trialDialog(pending);
          } catch (err) {
            error.textContent = errorText(err);
            el.disabled = false;
          }
        },
      }),
    ),
  );
}

/** Marks an interface as the side the internet comes in on: what stops answering there, and the firewall it takes */
function outsideDialog(nic) {
  const error = h("p", { class: "error", role: "alert" });
  const needs = state.network.firewall;
  const go = button(t("outside.go"), {
    class: "primary",
    disabled: !!needs,
    onclick: async (e) => {
      e.currentTarget.disabled = true;
      error.textContent = "";
      try {
        state.network = await api("PUT", `/api/network/${nic.name}/side`, { side: "outside" });
        dialog.close();
        renderSettings();
      } catch (err) {
        error.textContent = errorText(err);
        e.target.closest("button").disabled = false;
      }
    },
  });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("outside.title", { nic: nic.name })), closeX(() => dialog)),
    h("p", null, t("outside.lead")),
    h("ul", { class: "muted small" }, ["pages", "folders", "announce", "remote"].map((key) => h("li", null, t("outside.what." + key)))),
    h("p", { class: "muted small" }, t("outside.still")),
    needs &&
      h(
        "div",
        { class: "banner stack" },
        h("strong", null, t("outside.needs.what")),
        h("p", { class: "muted small" }, t("outside.needs.why")),
        needs.install ? h("p", { class: "cmd" }, icon("terminal"), needs.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: needs.package })),
        needs.install &&
          button(t("mounting.needs.install", { package: needs.package }), {
            class: "small",
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              error.textContent = "";
              try {
                state.network = await api("POST", "/api/network/package", { package: needs.package });
                dialog.close();
                outsideDialog(nic);
              } catch (err) {
                error.textContent = errorText(err);
                e.target.closest("button").disabled = false;
              }
            },
          }),
      ),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
}

/** Gives an interface handed over to NetworkManager back to the service that had it */
function handBackDialog(nic) {
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h("header", null, h("h2", { class: "grow" }, t("network.handback.title", { nic: nic.name })), closeX(() => dialog)),
    h("p", null, t("network.handback.lead", { service: t("network.by." + nic.handed) })),
    h("p", { class: "muted small" }, t(nic.handed === "ifupdown" ? "network.handback.howIfupdown" : "network.handback.how", { nic: nic.name })),
    h("p", { class: "banner small" }, t("network.trial.promise", { n: state.network.trial })),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("network.handback.go"), {
        class: "primary",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            const pending = await api("POST", `/api/network/${nic.name}/handback`, {});
            dialog.close();
            trialDialog(pending);
          } catch (err) {
            error.textContent = errorText(err);
            el.disabled = false;
          }
        },
      }),
    ),
  );
}

/** The Wi-Fi networks in reach of an interface: pick one, type its password */
function wifiDialog(nic) {
  const list = h("div", { class: "stack" }, h("p", { class: "muted" }, t("wifi.looking")));
  const error = h("p", { class: "error", role: "alert" });
  const bars = (signal) => h("span", { class: "muted small mono" }, `${signal}%`);
  const join = (net, row) => {
    const password = h("input", { type: "password", autocomplete: "off", minLength: 8, maxLength: 63, required: true, placeholder: t("wifi.password") });
    const needs = net.secure && !net.known;
    const go = button(t("wifi.connect"), { class: "primary small", type: "submit" });
    const form = h(
      "form",
      {
        class: "pair",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          go.disabled = true;
          go.lastChild.textContent = t("wifi.connecting");
          try {
            state.network = await api("POST", `/api/network/${nic.name}/wifi`, { ssid: net.ssid, ...(needs ? { password: password.value } : {}) });
            dialog.close();
            toast(t("wifi.connected", { ssid: net.ssid }));
            renderSettings();
          } catch (err) {
            error.textContent = errorText(err);
            go.disabled = false;
            go.lastChild.textContent = t("wifi.connect");
          }
        },
      },
      needs && password,
      go,
    );
    row.after(form);
    if (needs) password.focus();
  };
  const paint = (networks) => {
    list.replaceChildren(
      ...(networks.length
        ? networks.map((net) => {
            const row = h(
              "button",
              { type: "button", class: "menu-item", disabled: net.active, onclick: () => (list.querySelector("form")?.remove(), join(net, row)) },
              icon(net.secure ? "lock" : "network"),
              h("span", { class: "grow" }, net.ssid, net.active && h("span", { class: "muted small" }, " · " + t("wifi.active")), !net.active && net.known && h("span", { class: "muted small" }, " · " + t("wifi.known"))),
              h("span", { class: "muted small" }, `${net.band} GHz`),
              bars(net.signal),
            );
            return row;
          })
        : [h("p", { class: "muted" }, t("wifi.none"))]),
    );
  };
  const other = () => {
    const name = h("input", { maxLength: 32, required: true, placeholder: t("hotspot.name"), spellcheck: false });
    const password = h("input", { type: "password", autocomplete: "off", minLength: 8, maxLength: 63, placeholder: t("wifi.password") });
    const go = button(t("wifi.connect"), { class: "primary small", type: "submit" });
    list.replaceChildren(
      h(
        "form",
        {
          class: "stack",
          onsubmit: async (e) => {
            e.preventDefault();
            error.textContent = "";
            go.disabled = true;
            go.lastChild.textContent = t("wifi.connecting");
            try {
              state.network = await api("POST", `/api/network/${nic.name}/wifi`, { ssid: name.value, hidden: true, ...(password.value ? { password: password.value } : {}) });
              dialog.close();
              toast(t("wifi.connected", { ssid: name.value }));
              renderSettings();
            } catch (err) {
              error.textContent = errorText(err);
              go.disabled = false;
              go.lastChild.textContent = t("wifi.connect");
            }
          },
        },
        h("p", { class: "muted small" }, t("wifi.otherLead")),
        field(t("hotspot.name"), name),
        field(t("wifi.password"), password, t("wifi.otherPasswordHint")),
        h("div", null, go),
      ),
    );
    name.focus();
  };
  const look = async () => {
    error.textContent = "";
    try {
      paint((await api("GET", `/api/network/${nic.name}/wifi`)).networks);
    } catch (err) {
      list.replaceChildren();
      error.textContent = errorText(err);
    }
  };
  const dialog = openDialog("", h("header", null, h("h2", { class: "grow" }, t("wifi.title", { nic: nic.name })), closeX(() => dialog)), nic.wifi.hotspot && h("p", { class: "banner small" }, t("wifi.endsHotspot", { ssid: nic.wifi.hotspot.ssid })), list, error, h("footer", null, button(t("wifi.again"), { onclick: () => (list.replaceChildren(h("p", { class: "muted" }, t("wifi.looking"))), look()) }, "refresh"), button(t("wifi.other"), { onclick: other }), closeButton(() => dialog)));
  void look();
}

/** The server's own Wi-Fi network: its name and password, or — when it is on — how to join it and who has */
function hotspotDialog(nic, settings = false) {
  const on = nic.wifi.hotspot;
  const spot = settings ? null : on;
  const error = h("p", { class: "error", role: "alert" });
  const done = (data, message) => {
    state.network = data;
    dialog.close();
    toast(message);
    renderSettings();
  };
  let dialog;
  if (spot) {
    const code = h("div", { class: "qr-box" });
    void api("GET", `/api/network/${nic.name}/hotspot`).then((res) => code.replaceChildren(qrSvg(res.qr)), () => {});
    dialog = openDialog(
      "",
      h("header", null, h("h2", { class: "grow" }, t("hotspot.title")), closeX(() => dialog)),
      code,
      h("p", { class: "muted small" }, t("hotspot.scan")),
      h("div", { class: "kv" }, h("span", { class: "muted" }, t("hotspot.name")), h("span", null, spot.ssid)),
      h("div", { class: "kv" }, h("span", { class: "muted" }, t("wifi.password")), h("span", { class: "mono" }, spot.password)),
      h("div", { class: "kv" }, h("span", { class: "muted" }, t("hotspot.address")), h("span", { class: "mono" }, `http://${(nic.addresses[0] ?? "").split("/")[0]}${location.port ? ":" + location.port : ""}`)),
      h("h3", null, t("hotspot.clients", { n: spot.clients.length })),
      spot.clients.length ? spot.clients.map((c) => h("div", { class: "kv" }, h("span", null, c.name || c.mac), h("span", { class: "mono muted small" }, c.ip))) : h("p", { class: "muted small" }, t("hotspot.nobody")),
      error,
      h(
        "footer",
        null,
        button(t("hotspot.settings"), { onclick: () => (dialog.close(), hotspotDialog(nic, true)) }, "sliders"),
        button(t("hotspot.off"), {
          class: "danger",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              done(await api("DELETE", `/api/network/${nic.name}/hotspot`), t("hotspot.stopped"));
            } catch (err) {
              error.textContent = errorText(err);
              e.target.closest("button").disabled = false;
            }
          },
        }),
        closeButton(() => dialog),
      ),
    );
    return;
  }
  const ssid = h("input", { value: on?.ssid ?? "Hata", maxLength: 32, required: true });
  const password = h("input", { class: "mono", value: on?.password ?? "", minLength: 8, maxLength: 63, required: true, autocomplete: "off", spellcheck: false });
  const band = h("select", { onchange: () => channels(0) }, h("option", { value: "2.4" }, t("hotspot.band24")), h("option", { value: "5", selected: on?.band === "5" }, t("hotspot.band5")));
  const channel = h("select");
  const channels = (chosen) => channel.replaceChildren(h("option", { value: "0" }, t("hotspot.channelAuto")), ...state.network.channels[band.value].map((n) => h("option", { value: String(n), selected: n === chosen }, String(n))));
  channels(on?.channel ?? 0);
  const address = h("input", { class: "mono", value: on?.address ?? "", placeholder: "10.42.0.1/24", spellcheck: false });
  const go = h("button", { class: "btn primary" }, t(on ? "network.apply" : "hotspot.on"));
  const needs = h("div");
  dialog = openDialog(
    "",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          needs.replaceChildren();
          go.disabled = true;
          try {
            done(await api("PUT", `/api/network/${nic.name}/hotspot`, { ssid: ssid.value, password: password.value, band: band.value, channel: Number(channel.value), address: address.value }), t("hotspot.started", { ssid: ssid.value.trim() }));
          } catch (err) {
            if (err.code === "network.needsPackage") needs.replaceChildren(hotspotNeeds(err.detail, error));
            else error.textContent = errorText(err);
            go.disabled = false;
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("hotspot.title")), closeX(() => dialog)),
      !on && h("p", { class: "muted small" }, t("hotspot.lead")),
      on && h("p", { class: "banner small" }, t("hotspot.restarts")),
      nic.wifi.ssid && h("p", { class: "banner small" }, t("hotspot.leaves", { ssid: nic.wifi.ssid })),
      field(t("hotspot.name"), ssid),
      field(t("wifi.password"), password, t("hotspot.passwordHint")),
      field(t("hotspot.band"), band, t("hotspot.bandHint")),
      field(t("hotspot.channel"), channel, t("hotspot.channelHint")),
      field(t("hotspot.ownAddress"), address, t("hotspot.ownAddressHint")),
      needs,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
    ),
  );
}

/** What the access point lacks, with the button that installs it */
function hotspotNeeds(detail, error) {
  return h(
    "div",
    { class: "banner stack" },
    h("strong", null, t("hotspot.needs.what")),
    h("p", { class: "muted small" }, t("hotspot.needs.why")),
    detail.install ? h("p", { class: "cmd" }, icon("terminal"), detail.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: detail.package })),
    detail.install &&
      button(t("mounting.needs.install", { package: detail.package }), {
        class: "small",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            state.network = await api("POST", "/api/network/package", { package: detail.package });
            el.closest(".banner").replaceChildren(h("p", null, t("hotspot.needs.done")));
          } catch (err) {
            error.textContent = errorText(err);
            el.disabled = false;
          }
        },
      }),
  );
}

function networkSection() {
  const data = state.network;
  if (!data) return [waitMark()];
  const error = h("p", { class: "error", role: "alert" });
  const row = (label, value, mono = true) => h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("span", { class: mono ? "mono" : "" }, value || "—"));
  const card = (nic) =>
    nic.port
      ? h(
          "section",
          { class: "card pad" },
          h("div", { class: "section-head" }, h("h2", null, h("span", { class: "with-icon" }, icon("network"), nic.name), " ", h("span", { class: "state " + (nic.up ? "running" : "stopped") }, t(nic.up ? "network.up" : "network.down")))),
          h("p", { class: "muted small" }, t("bridge.portOf", { bridge: nic.port })),
          row(t("network.mac"), nic.mac + (nic.speed ? ` · ${nic.speed >= 1000 ? nic.speed / 1000 + " Gbit/s" : nic.speed + " Mbit/s"}` : "")),
        )
      : h(
      "section",
      { class: "card pad", menu: true },
      h(
        "div",
        { class: "section-head" },
        h("h2", null, h("span", { class: "with-icon" }, icon("network"), nic.kind === "modem" ? nic.product || t("network.modem") : nic.name), " ", nic.kind === "modem" && h("span", { class: "muted small mono" }, nic.name + " "), h("span", { class: "state " + (nic.up ? "running" : "stopped") }, t(nic.up ? "network.up" : "network.down")), nic.outside && h("span", { class: "state" }, t("outside.chip")), nic.online === false && h("span", { class: "state restarting" }, t("network.offline")), nic.online === true && h("span", { class: "state running" }, t("network.online"))),
        h(
          "div",
          { class: "actions" }, foldActions([
          nic.wifi?.ready && nic.wifi.ap && button(t(nic.wifi.hotspot ? "hotspot.show" : "hotspot.make"), { class: nic.wifi.hotspot ? "accent" : "", onclick: () => hotspotDialog(nic) }, "share"),
          nic.wifi?.ready && button(t("wifi.networks"), { onclick: () => wifiDialog(nic) }, "search"),
          nic.wifi?.ssid &&
            button(t("wifi.forget"), {
              onclick: () =>
                confirmAction({
                  title: t("wifi.forgetTitle", { ssid: nic.wifi.ssid }),
                  lead: t("wifi.forgetLead"),
                  label: t("wifi.forgetGo"),
                  run: async () => {
                    state.network = await api("DELETE", `/api/network/${nic.name}/wifi`);
                    renderSettings();
                  },
                }),
            }),
          nic.manager === "nm" && !data.pending && (!nic.wifi || nic.wifi.ssid) && !nic.wifi?.hotspot && button(t("network.change"), { onclick: () => nicDialog(nic) }, "sliders"),
          (nic.manager === "networkd" || nic.manager === "ifupdown") && data.tool === "ok" && !data.pending && button(t("network.handover"), { onclick: () => handOverDialog(nic) }),
          nic.handed && !data.pending && button(t("network.handback"), { onclick: () => handBackDialog(nic) }, "undo"),
          !bridgeWhy(nic) && !data.nics.some((n) => n.home) && !data.pending && button(t("bridge.make"), { onclick: () => homeBridgeDialog(nic) }, "box"),
          nic.home && !data.pending && button(t("bridge.apart"), { onclick: () => bridgeApartDialog(nic) }, "undo"),])
        ),
      ),
      nic.home && h("p", { class: "muted small" }, t("bridge.is", { ports: (nic.ports ?? []).filter((p) => data.nics.some((n) => n.name === p)).join(", ") || "—" }), " ", t("bridge.guests", { n: (nic.ports ?? []).filter((p) => !data.nics.some((n) => n.name === p)).length })),
      nic.wifi && row("Wi-Fi", nic.wifi.hotspot ? t("hotspot.state", { ssid: nic.wifi.hotspot.ssid, n: nic.wifi.hotspot.clients.length }) : nic.wifi.ssid ? `${nic.wifi.ssid} · ${nic.wifi.signal}%` : t(nic.wifi.ready ? "wifi.notConnected" : "wifi.notReady"), false),
      nic.wifi?.needs && data.tool === "ok" && needsCard(nic.wifi.needs, "wifi.needs"),
      row(t("network.address"), nic.addresses.join(", ") + (nic.addresses.length ? ` · ${t(nic.dynamic ? "network.byRouter" : "network.fixed")}` : "")),
      !nic.wifi?.hotspot && row(t("network.gateway"), nic.gateway),
      nic.shares && row(t("network.internet"), t("network.sharing", { n: nic.shares.length }), false),
      !nic.shares && !nic.wifi?.hotspot && (nic.internet !== "none" || (several && nic.addresses.length > 0)) && h("div", { class: "kv" }, h("span", { class: "muted" }, t("network.internet")), nic.manager === "nm" && several ? roleSelect(nic) : h("span", null, t("network.role." + (nic.internet === "none" ? "off" : nic.internet)))),
      !nic.wifi?.hotspot && row(t("network.dns"), nic.dns.join(", ")),
      !nic.wifi?.hotspot && (nic.addresses6.length > 0 || nic.v6.method === "off") && row("IPv6", nic.v6.method === "off" ? t("network.v6.off") : nic.addresses6.join(", ") + (nic.v6.method ? ` · ${t(nic.v6.method === "manual" ? "network.fixed" : "network.byRouter")}` : ""), nic.v6.method !== "off"),
      row(t("network.mac"), nic.mac + (nic.speed ? ` · ${nic.speed >= 1000 ? nic.speed / 1000 + " Gbit/s" : nic.speed + " Mbit/s"}` : "")),
      row(t("network.manager"), t("network.by." + (nic.manager || "none")), false),
      h("div", { class: "kv" }, h("span", { class: "muted" }, t("outside.side")), sideSelect(nic)),
      nic.public && !nic.outside && h("p", { class: "banner small" }, t("outside.exposed", { address: nic.public })),
      nic.kind === "modem" && h("p", { class: "muted small" }, t("network.modemHint", { gateway: nic.gateway || "192.168.0.1" })),
      nic.manager !== "nm" && h("p", { class: "muted small" }, t(nic.manager === "networkd" || nic.manager === "ifupdown" ? (data.tool === "ok" ? "network.handoverHint" : "network.needsTool") : "network.readOnly")),
    );
  const several = data.nics.filter((n) => n.internet !== "none").length > 1 || data.nics.some((n) => n.kind === "modem");
  const rank = (nic) => (nic.home ? 0 : nic.port ? 1 : 2);
  const roleSelect = (nic) => {
    const select = h(
      "select",
      {
        "aria-label": t("network.internet"),
        onchange: async () => {
          error.textContent = "";
          if (select.value === "off" && nic.internet === "main") {
            select.value = "main";
            return confirmAction({
              title: t("network.roleOffTitle", { nic: nic.name }),
              lead: t("network.roleOffLead"),
              label: t("network.roleOffGo"),
              iconName: "x",
              run: async () => {
                state.network = await api("PUT", `/api/network/${nic.name}/role`, { role: "off" });
                renderSettings();
              },
            });
          }
          select.disabled = true;
          try {
            state.network = await api("PUT", `/api/network/${nic.name}/role`, { role: select.value });
          } catch (err) {
            error.textContent = errorText(err);
          }
          renderSettings();
        },
      },
      ["main", "backup", "off"].map((role) => h("option", { value: role, selected: (nic.internet === "none" ? "off" : nic.internet) === role }, t("network.role." + role))),
    );
    return select;
  };
  const sideSelect = (nic) => {
    const select = h(
      "select",
      {
        "aria-label": t("outside.side"),
        onchange: async () => {
          error.textContent = "";
          if (select.value === "outside") {
            select.value = "home";
            return outsideDialog(nic);
          }
          // the firewall on this cable goes: pages, shares and Docker's ports answer there from now on
          select.value = "outside";
          confirmAction({
            title: t("outside.homeTitle", { nic: nic.name }),
            lead: t("outside.homeLead"),
            label: t("outside.homeGo"),
            iconName: "x",
            run: async () => {
              state.network = await api("PUT", `/api/network/${nic.name}/side`, { side: "home" });
              renderSettings();
            },
          });
        },
      },
      ["home", "outside"].map((side) => h("option", { value: side, selected: (nic.outside ? "outside" : "home") === side }, t("outside.side." + side))),
    );
    return select;
  };
  const checkBox = h("input", {
    type: "checkbox",
    class: "switch",
    role: "switch",
    "aria-label": t("network.check"),
    checked: data.check.on,
    onchange: async () => {
      error.textContent = "";
      checkBox.disabled = true;
      try {
        state.network = await api("PUT", "/api/network/check", { on: checkBox.checked });
      } catch (err) {
        error.textContent = errorText(err);
      }
      renderSettings();
    },
  });
  const needsCard = (needs, key) =>
    h(
      "div",
      { class: "banner stack" },
      h("strong", null, t(key + ".what")),
      h("p", { class: "muted small" }, t(key + ".why")),
      needs.install ? h("p", { class: "cmd" }, icon("terminal"), needs.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: needs.package })),
      needs.install &&
        button(t("mounting.needs.install", { package: needs.package }), {
          class: "small",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            error.textContent = "";
            try {
              state.network = await api("POST", "/api/network/package", { package: needs.package });
              renderSettings();
            } catch (err) {
              error.textContent = errorText(err);
              e.target.closest("button").disabled = false;
            }
          },
        }),
    );
  const needs = data.needs && needsCard(data.needs, "network.needs");
  return [
    h("section", { class: "card pad stack" }, h("h2", null, t("settings.network")), h("p", { class: "muted small" }, t("network.lead")), data.tool === "stopped" && h("p", { class: "banner small" }, t("network.stopped")), needs, data.tool === "ok" && uiSetting({ name: t("network.check"), explain: t("network.checkHint", { url: data.check.url.replace(/^https?:\/\//, "").replace(/\/.*/, "") }), control: checkBox }), error, data.pending && h("div", { class: "banner" }, t("network.trial.title", { nic: data.pending.nic }), " ", button(t("network.trial.show"), { class: "small", onclick: () => trialDialog(data.pending) }))),
    // the home bridge stands right before the card in it
    ...[...data.nics].sort((a, b) => rank(a) - rank(b) || data.nics.indexOf(a) - data.nics.indexOf(b)).map(card),
    !data.nics.length && h("p", { class: "card pad muted" }, t("network.none")),
  ];
}

/** Takes a system program away: what happens, the command, and for Docker the password */
function toolRemoveDialog(tool) {
  const error = h("p", { class: "error", role: "alert" });
  const password = tool.id === "docker" ? h("input", { type: "password", autocomplete: "current-password", required: true }) : null;
  const go = h("button", { class: "btn danger" }, t("tools.removeGo", { name: tool.name }));
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          go.disabled = true;
          go.textContent = t("tools.removing");
          try {
            state.tools = await api("POST", `/api/tools/${tool.id}/remove`, password ? { password: password.value } : {});
            dialog.close();
            toast(t("tools.removed", { name: tool.name }));
            renderSettings();
          } catch (err) {
            error.textContent = errorText(err);
            go.disabled = false;
            go.textContent = t("tools.removeGo", { name: tool.name });
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, t("tools.removeTitle", { name: tool.name })), closeX(() => dialog)),
      h("p", null, t(tool.id === "incus" ? "tools.removeLeadIncus" : "tools.removeLead")),
      tool.id === "docker" && h("p", { class: "banner" }, t("tools.removeDocker")),
      h("p", { class: "cmd whole" }, icon("terminal"), tool.remove),
      password && field(t("auth.password"), password),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
    ),
  );
}

async function loadRemote() {
  state.remote = await api("GET", "/api/tailscale").catch(() => state.remote);
  if (state.route.view === "settings" && showsSection("remote")) renderSettings();
}

/** Settings → Remote access: Tailscale, then WireGuard in and out */
/* Bluetooth: the devices of this server */

const BT_ICONS = { keyboard: "keyboard", mouse: "mouse", gamepad: "gamepad", remote: "remote", input: "keyboard", speaker: "speaker", headphones: "headphones", phone: "phone", computer: "server", tv: "tv", other: "bluetooth" };
const btUi = { dialog: null, paint: null, busy: "" };
/** How strongly a device is heard, in four steps: the list must not jump with every decibel */
const btBars = (signal) => (signal === null ? 0 : signal >= -60 ? 4 : signal >= -72 ? 3 : signal >= -84 ? 2 : 1);
/** What of the report the page draws: it is redrawn only when this differs */
const btSignature = (r) => JSON.stringify([r.state, r.error, r.hardware, r.hardBlocked, r.adapter, r.devices, (r.found ?? []).map((d) => [d.address, d.name, d.kind, btBars(d.signal)]), btUi.busy]);

async function loadBluetooth() {
  const before = state.bluetooth ? btSignature(state.bluetooth) : "";
  state.bluetooth = await api("GET", "/api/bluetooth").catch((e) => ({ error: errorText(e) }));
  btUi.paint?.();
  if (state.route.view === "settings" && showsSection("bluetooth") && btSignature(state.bluetooth) !== before) renderSettings();
}

function btPairDialog(device) {
  const body = h("div", { class: "stack" });
  const foot = h("footer");
  const dialog = openDialog("confirm bt-pair", h("h2", null, t("bt.pair.title", { name: device.name })), body, foot);
  let timer = null;
  const start = async () => {
    try {
      state.bluetooth = await api("POST", `/api/bluetooth/devices/${device.address}/pair`, {});
    } catch (e) {
      state.bluetooth = { ...state.bluetooth, pairing: { address: device.address, name: device.name, step: "failed", code: "", typed: 0, error: e.code ?? "bluetooth.pair.failed" } };
    }
    paint();
  };
  const code = (p) => h("div", { class: "bt-code", "aria-label": p.code }, [...p.code].map((digit, i) => h("span", { class: i < p.typed ? "typed" : "" }, digit)));
  const paint = () => {
    const p = state.bluetooth?.pairing;
    const mine = p && p.address === device.address ? p : { step: "working", code: "", typed: 0, error: "" };
    const over = mine.step === "done" || mine.step === "failed";
    body.replaceChildren(
      ...[
        mine.step === "working" && h("p", { class: "muted" }, t("bt.pair.working")),
        (mine.step === "passkey" || mine.step === "pin") && h("p", null, t("bt.pair.type", { name: device.name })),
        mine.step === "confirm" && h("p", null, t("bt.pair.compare", { name: device.name })),
        mine.code && !over && code(mine),
        mine.step === "done" && h("p", { class: "bt-done" }, icon("check"), t(mine.error ? "bt.pair.donePaired" : "bt.pair.done", { name: device.name })),
        mine.step === "done" && mine.error && h("p", { class: "muted" }, t("error." + mine.error)),
        mine.step === "failed" && h("p", { class: "error", role: "alert" }, t("error." + mine.error)),
        mine.step === "failed" && h("p", { class: "muted small" }, t("bt.pair.failedHint")),
      ].filter(Boolean),
    );
    foot.replaceChildren(
      ...[
        mine.step === "failed" && button(t("bt.pair.again"), { onclick: start }, "refresh"),
        button(t(over ? (mine.step === "done" ? "bt.pair.ok" : "common.close") : "common.cancel"), { class: mine.step === "done" ? "primary" : "", onclick: () => dialog.close() }),
      ].filter(Boolean),
    );
  };
  btUi.paint = paint;
  // the bus tells of every step; asked as well, in case the stream is down
  timer = setInterval(() => void loadBluetooth(), 2000);
  dialog.addEventListener("close", async () => {
    clearInterval(timer);
    btUi.paint = null;
    await api("DELETE", "/api/bluetooth/pairing").catch(() => {});
    void loadBluetooth();
  });
  paint();
  void start();
}

/** Speakers and headphones need one more program: what it is, why, the command, the button */
function btSoundCard(r, error) {
  if (r.sound === "ready") return uiCard({ title: t("bt.sound.title"), marks: uiState("ok", t("bt.sound.ready")), lead: t("bt.sound.readyLead") });
  const install = async (e) => {
    const el = e.currentTarget;
    el.disabled = true;
    try {
      await api("POST", "/api/tools/bluez-alsa/install", {});
      await loadBluetooth();
      renderSettings();
    } catch (err) {
      error.textContent = errorText(err);
      el.disabled = false;
    }
  };
  return uiCard({ title: t("bt.sound.title"), lead: t("bt.sound.lead") }, uiNeedProgram({ name: "BlueALSA", why: t("bt.sound.what"), command: r.soundInstall || null, run: r.soundInstall ? install : null, why2: r.soundInstall ? null : t("mounting.needs.byHand", { package: "bluez-alsa-utils" }) }));
}

function bluetoothSection() {
  const r = state.bluetooth;
  if (!r) return [uiCard({ flush: true }, uiEmpty({ size: "loading" }))];
  const error = h("p", { class: "error", role: "alert" }, r.error ?? "");
  const send = (method, path, data, mark = "") => async (e) => {
    const el = e?.currentTarget;
    if (el) el.disabled = true;
    btUi.busy = mark;
    error.textContent = "";
    try {
      state.bluetooth = await api(method, path, data);
    } catch (err) {
      toast(errorText(err), "error");
    }
    btUi.busy = "";
    renderSettings();
  };
  const turnOff = () => confirmAction({ title: t("bt.offTitle"), lead: t("bt.offLead"), label: t("bt.turnOff"), iconName: "power", run: () => send("PUT", "/api/bluetooth", { on: false })() });
  const stateOf = r.error ? uiState("bad", t("bt.state.error")) : r.state === "ready" ? uiState("ok", t("bt.stateOn")) : r.state === "off" ? uiState("off", t("bt.stateOff")) : uiState("off", t("bt.state.notReady"));
  // the page's head is Bluetooth's own: its state, its adapter, and turning it off
  queueMicrotask(() =>
    houseHead({
      icon: "bluetooth",
      title: "Bluetooth",
      state: stateOf,
      facts: [r.adapter && t("bt.adapter", { name: r.adapter.name, address: r.adapter.address })].filter(Boolean),
      actions: r.state === "ready" ? [{ label: t("bt.turnOff") + "…", icon: "power", run: turnOff }] : [],
    }),
  );
  if (r.error) return [uiCard({}, uiEmpty({ size: "error", title: r.error, action: button(t("attention.retry"), { onclick: () => void loadBluetooth().then(renderSettings) }, "refresh") }))];
  const noRadio = !r.hardware && uiNotice({ tone: "warn", text: t("bt.noRadio") });

  if (r.state === "missing") {
    const install = async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      try {
        await api("POST", "/api/tools/bluez/install", {});
        await loadBluetooth();
        renderSettings();
      } catch (err) {
        error.textContent = errorText(err);
        el.disabled = false;
      }
    };
    return [uiCard({ lead: t("bt.lead") }, noRadio, uiNeedProgram({ name: "BlueZ", why: t("bt.what"), command: r.install || null, run: r.install ? install : null, why2: r.install ? null : t("mounting.needs.byHand", { package: "bluez" }) }), error)];
  }
  if (r.state === "stopped") return [uiCard({}, uiEmpty({ size: "big", icon: "bluetooth", title: t("bt.stoppedTitle"), text: t("bt.stopped"), action: button(t("bt.start"), { class: "primary", onclick: send("POST", "/api/bluetooth/start", {}) }, "power") }), uiCommand("systemctl enable --now bluetooth"))];
  if (r.state === "noAdapter") return [uiCard({}, uiEmpty({ size: "big", icon: "bluetooth", title: t("bt.noAdapterTitle"), text: t(r.hardware ? "bt.noAdapter" : "bt.noRadio") }))];
  if (r.state === "off") return [uiCard({}, r.hardBlocked && uiNotice({ tone: "warn", text: t("error.bluetooth.hardBlocked") }), uiEmpty({ size: "big", icon: "bluetooth", title: t("bt.offTitleState"), text: t("bt.lead"), action: button(t("bt.turnOn"), { class: "primary", disabled: r.hardBlocked, onclick: send("PUT", "/api/bluetooth", { on: true }) }, "power") }))];

  const kindIcon = (d) => ({ icon: BT_ICONS[d.kind] ?? "bluetooth" });
  const row = (d) => {
    const busy = btUi.busy === d.address;
    const connect = d.connected
      ? button(t("bt.disconnect"), { class: "small", onclick: send("POST", `/api/bluetooth/devices/${d.address}/disconnect`, {}) })
      : button(t(busy ? "bt.connecting" : "bt.connect"), { class: "small", disabled: busy, "aria-busy": busy ? "true" : null, onclick: (e) => ((btUi.busy = d.address), renderSettings(), send("POST", `/api/bluetooth/devices/${d.address}/connect`, {}, d.address)(e)) });
    const forget = { label: t("bt.forget") + "…", icon: "trash", danger: true, run: () => confirmAction({ title: t("bt.forgetTitle", { name: d.name || d.address }), lead: t("bt.forgetLead"), label: t("bt.forget"), run: () => send("DELETE", `/api/bluetooth/devices/${d.address}`)() }) };
    const battery = d.battery === null ? "—" : d.battery <= 20 ? uiState("warn", t("bt.batteryLow", { n: d.battery })) : d.battery + "%";
    return {
      cells: [uiCell({ lead: kindIcon(d), name: d.name || d.address, sub: t("bt.kind." + d.kind) }), uiState(d.connected ? "ok" : "off", t(d.connected ? "bt.connected" : "bt.away")), battery, h("div", { class: "row-actions end" }, connect, uiMore([forget], { size: "s" }))],
      sub: [t("bt.kind." + d.kind), d.battery !== null && d.battery + "%"].filter(Boolean).join(" · "),
    };
  };
  const looking = r.adapter.looking;
  const bars = (d) => h("span", { class: "bt-signal l" + btBars(d.signal), title: d.signal === null ? "" : d.signal + " dBm" }, h("i"), h("i"), h("i"), h("i"));
  const found = [...r.found].sort((a, b) => btBars(b.signal) - btBars(a.signal) || a.name.localeCompare(b.name));
  return [
    uiCard(
      { title: t("bt.devices"), count: r.devices.length || null, lead: t("bt.lead"), flush: true },
      h("div", { class: "ui-inset" }, error),
      r.devices.length ? uiTable([{ label: t("bt.col.device") }, { label: t("bt.col.state") }, { label: t("bt.col.battery"), num: true }, { label: "" }], r.devices.map(row)) : uiEmpty({ text: t("bt.none") }),
    ),
    uiCard(
      { title: t("bt.add"), lead: t("bt.addLead"), flush: true, actions: looking ? button(t("bt.stopLooking"), { class: "small", onclick: send("POST", "/api/bluetooth/look", { on: false }) }, "x") : button(t("bt.look"), { class: "small primary", onclick: send("POST", "/api/bluetooth/look", { on: true }) }, "search") },
      looking && h("div", { class: "ui-empty small" }, h("span", { class: "wait-ring" }), h("span", null, t("bt.looking"))),
      found.map((d) => uiRow({ lead: kindIcon(d), name: d.name || d.address, sub: t("bt.kind." + d.kind), value: bars(d), action: button(t("bt.pair"), { class: "small", onclick: () => btPairDialog(d) }, "plus"), menu: true })),
      !looking && !found.length && uiEmpty({ text: t("bt.lookHint") }),
    ),
    btSoundCard(r, error),
  ];
}

const remoteSection = () => [...tailscaleCards(), ...wireguardCards()];

/** A device that agreed on keys within the last three minutes is connected: WireGuard renews them every two */
const wgConnected = (handshake) => handshake > 0 && Date.now() - handshake < 180_000;

async function wgDeviceDialog(id) {
  let file;
  try {
    file = await api("GET", `/api/wireguard/devices/${id}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const w = state.wireguard;
  const web = `http://${w.server.address}${w.web === 80 ? "" : ":" + w.web}`;
  const dialog = openDialog(
    "wide",
    h("header", null, h("h2", { class: "grow" }, t("wg.deviceTitle", { name: file.name })), closeX(() => dialog)),
    h("p", { class: "muted" }, t("wg.deviceLead")),
    h("div", { class: "qr-box" }, qrSvg(file.qr)),
    h("p", { class: "muted small" }, t("wg.devicePhone")),
    h("pre", { class: "cmd whole wg-conf" }, file.conf),
    h("p", { class: "muted small" }, t("wg.deviceComputer")),
    h("p", { class: "banner" }, t("wg.deviceSecret")),
    h("p", { class: "muted small" }, t("wg.deviceThen", { address: web })),
    h("footer", null, h("a", { class: "btn", href: `/api/wireguard/devices/${id}?download=1`, download: "" }, icon("download"), h("span", null, t("wg.deviceFile"))), closeButton(() => dialog)),
  );
}

function wgAddDialog() {
  const w = state.wireguard;
  const name = h("input", { maxLength: 40, required: true, placeholder: t("wg.namePlaceholder") });
  const lan = h("input", { type: "checkbox", disabled: !w.server.firewall || !w.server.networks.length });
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  dialog = openDialog(
    "",
    h("h2", null, t("wg.add")),
    field(t("wg.name"), name),
    h("label", { class: "check" }, lan, h("span", null, h("strong", null, t("wg.lan")), h("span", { class: "muted small block" }, !w.server.firewall ? t("wg.lanNoFirewall") : w.server.networks.length ? t("wg.lanHint", { networks: w.server.networks.join(", ") }) : t("remote.networksNone")))),
    error,
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("wg.addGo"), {
        class: "primary",
        onclick: async (e) => {
          const el = e.currentTarget;
          el.disabled = true;
          try {
            state.wireguard = await api("POST", "/api/wireguard/devices", { name: name.value, lan: lan.checked });
            dialog.close();
            renderSettings();
            void wgDeviceDialog(state.wireguard.added);
          } catch (err) {
            error.textContent = errorText(err);
            el.disabled = false;
          }
        },
      }),
    ),
  );
  name.focus();
}

function wireguardCards() {
  const w = state.wireguard;
  if (!w) return [];
  const error = h("p", { class: "error", role: "alert" });
  const send = async (method, path, data, el, said = error) => {
    if (el) el.disabled = true;
    said.textContent = "";
    try {
      state.wireguard = await api(method, `/api/wireguard/${path}`, data);
      renderSettings();
      return state.wireguard;
    } catch (err) {
      said.textContent = errorText(err);
      if (el) el.disabled = false;
      return null;
    }
  };

  if (w.tool === "missing")
    return [
      h(
        "section",
        { class: "card pad stack" },
        h("h2", null, "WireGuard"),
        h("p", { class: "muted" }, t("wg.lead")),
        h("p", null, t("wg.what")),
        h("p", { class: "muted small" }, t("wg.why")),
        w.install ? h("p", { class: "cmd" }, icon("terminal"), w.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: w.package })),
        error,
        w.install &&
          h(
            "footer",
            null,
            button(t("mounting.needs.install", { package: "WireGuard" }), {
              class: "primary",
              onclick: async (e) => {
                const el = e.currentTarget;
                el.disabled = true;
                el.lastChild.textContent = t("tools.installing");
                try {
                  await api("POST", "/api/tools/wireguard-tools/install", {});
                  state.wireguard = await api("GET", "/api/wireguard");
                  renderSettings();
                } catch (err) {
                  error.textContent = errorText(err);
                  el.disabled = false;
                }
              },
            }, "download"),
          ),
      ),
    ];

  const s = w.server;
  const endpoint = h("input", { value: s.endpoint || s.suggested, placeholder: "home.example.com", spellcheck: false, autocapitalize: "off", class: "mono", required: true });
  const port = h("input", { type: "number", min: 1, max: 65535, value: s.port, class: "short mono", required: true });
  const typed = () => ({ endpoint: endpoint.value.trim(), port: Number(port.value) });
  const up = s.enabled && s.running;
  const deviceRow = (d) =>
    h(
      "tr",
      null,
      h("td", null, h("div", { class: "strong" }, d.name), h("div", { class: "muted small mono" }, d.address)),
      h("td", null, h("label", { class: "check small" }, h("input", { type: "checkbox", checked: d.lan, disabled: !s.firewall, onchange: (e) => send("PUT", `devices/${d.id}`, { lan: e.target.checked }, e.target) }), h("span", null, t("wg.lanShort")))),
      h("td", null, h("span", { class: "state " + (wgConnected(d.handshake) ? "running" : "stopped") }, wgConnected(d.handshake) ? t("wg.connected") : d.handshake ? t("remote.seen", { when: ago(d.handshake) }) : t("wg.never"))),
      h(
        "td",
        null,
        h(
          "div",
          { class: "row-actions" },
          button(t("wg.show"), { class: "small", onclick: () => wgDeviceDialog(d.id) }),
          h("button", {
            type: "button",
            class: "icon-btn",
            title: t("wg.remove"),
            "aria-label": t("wg.remove"),
            onclick: () => {
              const dialog = openDialog("confirm", h("h2", null, t("wg.removeTitle", { name: d.name })), h("p", { class: "muted" }, t("wg.removeLead")), h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("wg.remove"), { class: "danger", onclick: (e) => (dialog.close(), send("DELETE", `devices/${d.id}`, undefined, e.currentTarget)) })));
            },
          }, icon("trash")),
        ),
      ),
    );
  const inCard = h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("wg.in.title"), h("span", { class: "state " + (up ? "running" : s.enabled ? "partial" : "stopped") }, t(up ? "wg.state.on" : s.enabled ? "remote.state.stopped" : "remote.state.off"))), h("span", { class: "muted small" }, "WireGuard")),
    h("p", { class: "muted" }, t("wg.in.lead")),
    settingRow(t("wg.endpoint"), t("wg.endpointHint"), endpoint),
    settingRow(t("wg.port"), t("wg.portHint", { port: s.port }), port),
    !s.firewall && h("p", { class: "banner" }, t("wg.noFirewall")),
    error,
    h("footer", null, h("div", { class: "row-actions" }, s.enabled && button(t("remote.turnOff"), { onclick: (e) => {
      const el = e.currentTarget;
      confirmAction({ title: t("wg.offTitle"), lead: t("wg.offLead"), label: t("remote.turnOff"), iconName: "x", run: () => send("PUT", "server", { enabled: false }, el) });
    } }), button(t(s.enabled ? "settings.save" : "remote.turnOn"), { class: "primary", onclick: (e) => send("PUT", "server", { ...typed(), enabled: true }, e.currentTarget) }))),
  );
  const devices =
    s.address &&
    h(
      "section",
      { class: "card pad stack" },
      h("div", { class: "section-head" }, h("h2", null, t("wg.devices"), h("span", { class: "muted small" }, s.devices.length)), button(t("wg.add"), { class: "small primary", disabled: !s.endpoint, onclick: wgAddDialog }, "plus")),
      s.devices.length ? h("div", { class: "table-wrap" }, h("table", null, h("tbody", null, s.devices.map(deviceRow)))) : h("p", { class: "muted" }, t("wg.devicesNone")),
      h("p", { class: "muted small" }, t("wg.devicesHint", { address: s.address })),
    );

  const c = w.client;
  const outError = h("p", { class: "error", role: "alert" });
  const conf = h("textarea", { rows: 8, spellcheck: false, class: "mono", placeholder: "[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = …\nAllowedIPs = …" });
  const pick = h("input", { type: "file", accept: ".conf,text/plain", class: "offscreen", onchange: async () => pick.files[0] && (conf.value = await pick.files[0].text()) });
  const join = async (e) => {
    const done = await send("PUT", "client", { conf: conf.value, enabled: true }, e.currentTarget, outError);
    if (done?.dropped?.length) toast(t("wg.out.dropped", { lines: done.dropped.join(", ") }));
  };
  const outUp = c.enabled && c.running;
  const outCard = h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("wg.out.title"), c.set && h("span", { class: "state " + (outUp ? "running" : c.enabled ? "partial" : "stopped") }, t(outUp ? (wgConnected(c.handshake) ? "wg.connected" : "wg.out.waiting") : c.enabled ? "remote.state.stopped" : "remote.state.off"))), h("span", { class: "muted small" }, "WireGuard")),
    h("p", { class: "muted" }, t("wg.out.lead")),
    c.set
      ? [
          settingRow(t("wg.out.server"), c.handshake ? t("wg.out.spoke", { when: ago(c.handshake) }) : "", h("span", { class: "mono" }, c.endpoint)),
          settingRow(t("wg.out.address"), "", h("span", { class: "mono" }, c.address)),
          settingRow(t("wg.out.through"), t(c.everything ? "wg.out.everything" : "wg.out.some"), h("span", { class: "mono" }, c.allowed.join(", "))),
        ]
      : [field(t("wg.out.conf"), conf, t("wg.out.confHint")), pick],
    outError,
    h(
      "footer",
      null,
      h(
        "div",
        { class: "row-actions" },
        c.set
          ? [button(t("wg.out.forget"), {
            class: "quiet",
            onclick: () =>
              confirmAction({
                title: t("wg.out.forgetTitle"),
                lead: t("wg.out.forgetLead"),
                label: t("wg.out.forgetGo"),
                run: async () => {
                  state.wireguard = await api("DELETE", "/api/wireguard/client");
                  renderSettings();
                },
              }),
          }), c.enabled ? button(t("remote.turnOff"), { onclick: (e) => send("PUT", "client", { enabled: false }, e.currentTarget, outError) }) : button(t("remote.turnOn"), { class: "primary", onclick: (e) => send("PUT", "client", { enabled: true }, e.currentTarget, outError) })]
          : [button(t("wg.out.file"), { onclick: () => pick.click() }), button(t("wg.out.join"), { class: "primary", onclick: join })],
      ),
    ),
  );
  return [inCard, devices, outCard].filter(Boolean);
}

function tailscaleCards() {
  const r = state.remote;
  if (!r) return [waitMark()];
  const error = h("p", { class: "error", role: "alert" });
  const act = (what, data = {}, said) => async (e) => {
    const el = e.currentTarget;
    el.disabled = true;
    error.textContent = "";
    try {
      state.remote = await api("POST", `/api/tailscale/${what}`, data);
      if (said) toast(said);
      renderSettings();
    } catch (err) {
      error.textContent = errorText(err);
      el.disabled = false;
    }
  };
  const lead = h("p", { class: "muted" }, t("remote.lead"));
  const title = "Tailscale";

  if (r.state === "missing")
    return [
      h(
        "section",
        { class: "card pad stack" },
        h("h2", null, title),
        lead,
        h("p", null, t("remote.what")),
        h("p", { class: "muted small" }, t("remote.why")),
        h("p", { class: "cmd" }, icon("terminal"), r.install),
        h("p", { class: "muted small" }, t("remote.how")),
        error,
        h(
          "footer",
          null,
          button(t("mounting.needs.install", { package: "Tailscale" }), {
            class: "primary",
            onclick: async (e) => {
              const el = e.currentTarget;
              el.disabled = true;
              try {
                const res = await api("POST", "/api/tailscale/install", {});
                jobDialog(res.job, "tailscale", "", loadRemote);
              } catch (err) {
                error.textContent = errorText(err);
                el.disabled = false;
              }
            },
          }, "download"),
        ),
      ),
    ];

  const head = (chip, cls) => h("div", { class: "section-head" }, h("h2", null, title, h("span", { class: "state " + cls }, chip)), h("span", { class: "muted small mono" }, r.version));
  if (r.state === "stopped") return [h("section", { class: "card pad stack" }, head(t("remote.state.stopped"), "stopped"), h("p", { class: "muted" }, t("remote.stopped")), error, h("footer", null, button(t("remote.start"), { class: "primary", onclick: act("start") }))) ];

  // waiting for the person to let the server in: the page looks again by itself until it is done
  if (r.state === "starting") {
    const timer = setTimeout(loadRemote, 3000);
    cleanups.push(() => clearTimeout(timer));
  }
  const port = r.port === 80 ? "" : ":" + r.port;
  const address = (host) => h("a", { class: "link mono", href: `http://${host}${port}/` }, host + port);

  if (r.state === "needsLogin" || r.state === "starting") {
    const own = h("input", { value: r.server ?? "", placeholder: "https://headscale.example.com", spellcheck: false, autocapitalize: "off", class: "mono" });
    return [
      h(
        "section",
        { class: "card pad stack" },
        head(t(r.authUrl ? "remote.state.waiting" : "remote.state.signedOut"), r.authUrl ? "partial" : "stopped"),
        lead,
        r.authUrl
          ? [h("p", null, t("remote.openLink")), h("p", { class: "cmd" }, h("a", { class: "link grow clip", href: r.authUrl, target: "_blank", rel: "noopener noreferrer" }, r.authUrl), h("button", { type: "button", class: "icon-btn", title: t("twofa.copy"), "aria-label": t("twofa.copy"), onclick: () => copyText(r.authUrl) }, icon("copy"))), h("p", { class: "muted small" }, t("remote.openLinkHint"))]
          : [h("p", { class: "muted small" }, t("remote.signInHint")), h("details", null, h("summary", { class: "muted small" }, t("remote.ownServer")), field(t("remote.ownServerAddress"), own, t("remote.ownServerHint")))],
        error,
        h("footer", null, r.authUrl ? button(t("common.cancel"), { onclick: act("disconnect") }) : button(t("remote.signIn"), { class: "primary", onclick: (e) => act("connect", { server: own.value.trim() })(e) }, "arrow")),
      ),
    ];
  }

  const on = r.state === "running";
  const offered = r.offered.length > 0;
  // a network a router of the private network already carries is reached through it: nothing waits there
  const carried = r.offered.filter((net) => !r.approved.includes(net) && r.carried?.[net]);
  const waiting = r.offered.filter((net) => !r.approved.includes(net) && !r.carried?.[net]);
  const share = h("input", { type: "checkbox", class: "switch", role: "switch", "aria-label": t("remote.networksOn"), checked: offered, disabled: !on || (!offered && !r.networks.length), onchange: (e) => act("networks", { on: e.target.checked })(e) });
  return [
    h(
      "section",
      { class: "card pad stack" },
      head(t(on ? "remote.state.on" : "remote.state.off"), on ? "running" : "stopped"),
      lead,
      settingRow(t("remote.name"), t("remote.nameHint"), h("span", { class: "stack-s end" }, r.name && address(r.name), r.addresses.filter((a) => !a.includes(":")).map(address))),
      settingRow(t("remote.account"), r.server ? t("remote.accountOwn", { server: r.server }) : r.expires ? t("remote.expires", { date: shortDate(r.expires) }) : "", h("span", null, r.tailnet || "—")),
      r.health.length > 0 && h("div", { class: "banner stack" }, r.health.map((line) => h("p", { class: "small" }, line))),
      error,
      h("footer", null, h("div", { class: "row-actions" }, button(t("remote.signOut"), {
        class: "quiet",
        onclick: () =>
          confirmAction({
            title: t("remote.signOutTitle"),
            lead: t("remote.signOutLead"),
            label: t("remote.signOutGo"),
            iconName: "signout",
            run: async () => {
              state.remote = await api("POST", "/api/tailscale/signout", {});
              renderSettings();
            },
          }),
      }), on ? button(t("remote.turnOff"), { onclick: (e) => {
        const el = e.currentTarget;
        confirmAction({ title: t("remote.offTitle"), lead: t("remote.offLead"), label: t("remote.turnOff"), iconName: "x", run: () => act("disconnect")({ currentTarget: el, target: el }) });
      } }) : button(t("remote.turnOn"), { class: "primary", onclick: act("connect") }))),
    ),
    h(
      "section",
      { class: "card pad stack" },
      h("h2", null, t("remote.networks")),
      uiSetting({ name: t("remote.networksOn"), explain: r.networks.length || offered ? t("remote.networksHint", { networks: (offered ? r.offered : r.networks).join(", ") }) : t("remote.networksNone"), control: share }),
      carried.length > 0 && h("p", { class: "muted small" }, carried.map((net) => t("remote.networksCarried", { network: net, device: r.carried[net] })).join(" ")),
      waiting.length > 0 && h("p", { class: "banner" }, t(r.server ? "remote.networksApproveOwn" : "remote.networksApprove", { networks: waiting.join(", ") }), !r.server && [" ", h("a", { class: "link", href: r.admin, target: "_blank", rel: "noopener noreferrer" }, "login.tailscale.com")]),
    ),
    h(
      "section",
      { class: "card pad stack" },
      h("div", { class: "section-head" }, h("h2", null, t("remote.devices"), h("span", { class: "muted small" }, r.devices.length))),
      r.devices.length
        ? h("div", { class: "table-wrap" }, h("table", null, h("tbody", null, r.devices.map((d) => h("tr", null, h("td", null, h("div", { class: "strong" }, d.name), h("div", { class: "muted small" }, d.os)), h("td", { class: "mono small" }, d.addresses.filter((a) => !a.includes(":")).join(", ")), h("td", { class: "num" }, h("span", { class: "state " + (d.online ? "running" : "stopped") }, d.online ? t("remote.online") : d.lastSeen ? t("remote.seen", { when: ago(d.lastSeen) }) : t("remote.offline"))))))))
        : h("p", { class: "muted" }, t("remote.devicesNone")),
      h("p", { class: "muted small" }, t("remote.devicesHint")),
    ),
  ];
}

/** Settings → System programs: everything of the system Hata relies on, installed or not */
function toolsSection() {
  const tools = state.tools;
  if (!tools) return [waitMark()];
  const error = h("p", { class: "error", role: "alert" });
  const again = async () => {
    state.tools = await api("GET", "/api/tools").catch(() => state.tools);
    if (state.route.view === "settings" && showsSection("tools")) renderSettings();
  };
  const install = (tool) =>
    button(t("mounting.needs.install", { package: tool.name }), {
      class: "small primary",
      onclick: async (e) => {
        const el = e.currentTarget;
        el.disabled = true;
        el.lastChild.textContent = t("tools.installing");
        error.textContent = "";
        try {
          const res = await api("POST", `/api/tools/${tool.id}/install`, {});
          if (res.job) return jobDialog(res.job, tool.id === "tailscale" ? "tailscale" : "docker", "", again);
          state.tools = res;
          toast(t("tools.installed", { name: tool.name }));
        } catch (err) {
          error.textContent = errorText(err);
        }
        renderSettings();
      },
    }, "download");
  // how a program comes to be installed: the very command, in a window of its own
  const how = (tool) => {
    let dialog;
    dialog = openDialog("confirm", h("header", null, h("h2", { class: "grow" }, t("tools.howTitle", { name: tool.name })), closeX(() => dialog)), h("p", { class: "muted small" }, t(`tools.${tool.id}.what`)), tool.install ? uiCommand(tool.install, { block: true }) : h("p", null, t("mounting.needs.byHand", { package: tool.package })), h("footer", null, closeButton(() => dialog)));
  };
  const where = (tool) => h("a", { class: "link", href: tool.page, onclick: (e) => e.stopPropagation() }, t(`tools.${tool.id}.where`));
  const absentRow = (tool) =>
    uiRow({
      name: tool.name,
      sub: tool.cannot ? t("tools.cannot." + tool.cannot) : h("span", null, t(`tools.${tool.id}.what`), " · ", where(tool)),
      state: tool.cannot && uiState("off", t("tools.state." + tool.state)),
      action: !tool.cannot && tool.install && install(tool),
      more: !tool.cannot && [{ label: t("tools.how"), icon: "terminal", run: () => how(tool) }],
    });
  const presentRow = (tool) =>
    uiRow({
      name: tool.name,
      sub: h("span", null, tool.version && h("span", { class: "mono" }, tool.version), tool.version && " · ", t(`tools.${tool.id}.what`), " · ", where(tool), tool.builtIn ? " · " + t(`tools.${tool.id}.builtIn`) : "", tool.holds ? " · " + t("tools.holds." + tool.holds) : ""),
      state: tool.newer ? uiState("warn", t("tools.newer", { version: tool.newer })) : tool.used ? uiState("info", t("tools.used")) : null,
      action: tool.upgrade?.length > 0 && button(t("tools.update") + "…", { class: "small", onclick: () => sysUpgradeDialog("", tool.upgrade, tool.name) }, "up"),
      more: tool.remove ? [{ label: t("tools.remove"), icon: "trash", danger: true, off: !!tool.holds, run: () => toolRemoveDialog(tool) }] : null,
    });
  const here = tools.filter((tool) => tool.state === "installed");
  const absent = tools.filter((tool) => tool.state !== "installed");
  return [
    uiCard({}, uiNotice({ tone: "info", text: t("tools.lead") }), error),
    h("div", { id: "sysupdates" }, sysUpdatesCard("")),
    absent.length > 0 && uiCard({ title: t("tools.absent"), count: absent.length, flush: true }, absent.map(absentRow)),
    here.length > 0 && uiCard({ title: t("tools.present"), count: here.length, flush: true }, here.map(presentRow)),
  ];
}

/** Newer versions of the system's packages as last checked: "" — this server, else a machine's id */
const sysUpdates = {};
const sysUpdatesApi = (at) => (at ? `/api/machines/${at}/system/updates` : "/api/system/updates");
/** The packages ticked in the list, per place, and whether the list is open */
const sysChosen = {};
const sysShown = {};

async function loadSysUpdates(at = "") {
  try {
    sysUpdates[at] = await api("GET", sysUpdatesApi(at));
  } catch (e) {
    sysUpdates[at] = { error: errorText(e) };
  }
  paintSysUpdates(at);
  if (state.route.area === "server" || state.route.view === "server") paintServerTabCounts();
}

function paintSysUpdates(at) {
  const box = document.getElementById(at ? "machine-sysupdates" : "sysupdates");
  if (box && (at ? state.route.view === "machine" && state.route.id === at : state.route.view === "settings")) box.replaceChildren(sysUpdatesCard(at));
}

/** A check began or ended somewhere: the page that shows that place looks again */
async function sysUpdatesEvent(at) {
  if (!at && state.route.view === "settings" && showsSection("tools")) {
    // the rows of the programs carry their newer versions too
    state.tools = await api("GET", "/api/tools").catch(() => state.tools);
    sysUpdates[""] = await api("GET", "/api/system/updates").catch(() => sysUpdates[""]);
    renderSettings();
  } else if (at && state.route.view === "machine" && state.route.id === at) void loadSysUpdates(at);
}

/** Newer versions of the system's packages: how many, which, and the buttons that install them */
function sysUpdatesCard(at) {
  const info = sysUpdates[at];
  const list = info?.list ?? [];
  const chosen = (sysChosen[at] ??= new Set());
  for (const name of [...chosen]) if (!list.some((p) => p.name === name)) chosen.delete(name);
  const check = button(info?.checking ? t("sysupdates.checking") : t("sysupdates.check"), {
    class: "small",
    disabled: !!info?.checking,
    onclick: async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      el.lastChild.textContent = t("sysupdates.checking");
      try {
        sysUpdates[at] = await api("POST", `${sysUpdatesApi(at)}/check`, {});
      } catch (err) {
        toast(errorText(err), "error");
      }
      paintSysUpdates(at);
      if (!at) void sysUpdatesEvent("");
    },
  }, "refresh");
  const card = (opts, ...body) => uiCard({ title: t("sysupdates.title"), ...opts }, ...body);
  if (!info) return card({ actions: check, flush: true }, uiEmpty({ size: "loading" }));
  if (info.error && !info.at) return card({ actions: check }, uiNotice({ tone: "bad", text: info.error }));
  if (info.at && !info.manager) return card({}, uiEmpty({ text: t("sysupdates.noManager") }));
  const security = list.filter((p) => p.security).length;
  const when = info.at ? t("sysupdates.checked", { ago: ago(info.at) }) : "";
  const shown = (sysShown[at] ??= chosen.size > 0);
  const bar = h("div", { class: "ui-select-bar", hidden: !chosen.size });
  const paintBar = () => {
    bar.hidden = !chosen.size;
    put(bar, h("span", null, t("ui.chosen", { n: chosen.size })), button(t("sysupdates.updateChosen", { n: chosen.size }), { class: "small primary", onclick: () => sysUpgradeDialog(at, [...chosen]) }, "up"));
  };
  paintBar();
  const row = (p) => {
    const box = h("input", { type: "checkbox", checked: chosen.has(p.name), "aria-label": p.name });
    box.addEventListener("change", () => {
      if (box.checked) chosen.add(p.name);
      else chosen.delete(p.name);
      paintBar();
    });
    return uiRow({ lead: { check: box }, name: h("span", { class: "mono" }, p.name, p.security && " ", p.security && uiTag(t("sysupdates.securityOne"))), value: h("span", { class: "mono" }, p.from ? `${p.from} → ${p.to}` : t("sysupdates.new", { version: p.to })), cls: "sys-package" });
  };
  // security updates first, then by name
  const sorted = [...list].sort((a, b) => Number(b.security) - Number(a.security) || a.name.localeCompare(b.name));
  const packages = h("div", { class: "ui-rows", hidden: !shown }, bar, sorted.map(row));
  const toggle = button(t(shown ? "sysupdates.hide" : "sysupdates.show", { n: list.length }), {
    class: "small quiet",
    onclick: () => {
      sysShown[at] = packages.hidden;
      packages.hidden = !packages.hidden;
      toggle.lastChild.textContent = t(packages.hidden ? "sysupdates.show" : "sysupdates.hide", { n: list.length });
    },
  }, "list");
  return card(
    {
      marks: [list.length > 0 && uiState("warn", t("sysupdates.countShort", { n: list.length })), security > 0 && uiState("bad", t("sysupdates.security", { n: security }))].filter(Boolean),
      lead: info.at ? [t("sysupdates.lead"), when].join(" · ") : t("sysupdates.lead"),
      flush: true,
      actions: [check, list.length > 0 && button(t("sysupdates.updateAll") + "…", { class: "small primary", onclick: () => sysUpgradeDialog(at, []) }, "up")].filter(Boolean),
    },
    info.error && h("div", { class: "ui-inset" }, uiNotice({ tone: "bad", text: t("sysupdates.lastError", { message: info.error }) })),
    info.reboot && h("div", { class: "ui-inset" }, uiNotice({ tone: "warn", text: t(at ? "sysupdates.rebootMachine" : "sysupdates.reboot") })),
    !info.at ? uiEmpty({ text: t("sysupdates.never") }) : !list.length ? uiEmpty({ icon: "check", tone: "ok", text: t("sysupdates.none") + " · " + when }) : null,
    list.length > 0 && h("div", { class: "ui-inset" }, uiCommand(info.command)),
    list.length > 0 && uiEmpty({ text: t("sysupdates.count", { n: list.length }), action: toggle }),
    list.length > 0 && packages,
  );
}

/** Asks before newer versions are installed: of every package (`packages` empty) or the ones named */
function sysUpgradeDialog(at, packages, name = "") {
  const list = sysUpdates[at]?.list ?? [];
  const count = packages.length || list.length;
  const docker = (packages.length ? packages : list.map((p) => p.name)).some((p) => /^(docker|containerd)/.test(p));
  const manager = sysUpdates[at]?.manager;
  const command = packages.length ? (manager === "dnf" ? `dnf upgrade ${packages.join(" ")}` : `apt-get install --only-upgrade ${packages.join(" ")}`) : sysUpdates[at]?.command;
  let dialog;
  dialog = openDialog(
    "confirm",
    h("header", null, h("h2", { class: "grow" }, name ? t("sysupdates.updateTitle", { name }) : t("sysupdates.updateMany", { n: count })), closeX(() => dialog)),
    h("p", null, t(at ? "sysupdates.updateLeadMachine" : "sysupdates.updateLead")),
    docker && h("p", { class: "banner" }, t("sysupdates.docker")),
    command && h("p", { class: "cmd whole" }, icon("terminal"), command),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("sysupdates.go"), {
        class: "primary",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const res = await api("POST", `${sysUpdatesApi(at)}/upgrade`, { packages });
            dialog.close();
            sysChosen[at]?.clear();
            jobDialog(res.job, "sysupdate", "", () => sysUpdatesEvent(at));
          } catch (err) {
            dialog.close();
            toast(errorText(err), "error");
          }
        },
      }, "up"),
    ),
  );
}

/** Images and volumes as last counted: "" — this server, else a machine's id */
const spaces = {};
const spaceApi = (at) => (at ? `/api/machines/${at}/docker` : "/api/docker");

async function loadSpace(at = "") {
  try {
    spaces[at] = await api("GET", `${spaceApi(at)}/space`);
  } catch (e) {
    spaces[at] = { error: errorText(e) };
  }
  paintSpace(at);
}

/** Shows what was counted where it is looked at: Settings → Docker, or the machine's tab */
function paintSpace(at) {
  if (!at && state.route.view === "settings" && showsSection("docker")) renderSettings();
  const box = document.getElementById("machine-docker");
  if (at && box && state.route.view === "machine" && state.route.id === at) box.replaceChildren(...dockerSection(at).filter(Boolean));
}

/** Asks before something of Docker's is taken away; `password` — for what takes data with it in bulk */
function dockerDropDialog({ at, title, lead, warn, command, password: ask, go: label, run }) {
  const error = h("p", { class: "error", role: "alert" });
  const password = ask ? h("input", { type: "password", autocomplete: "current-password", required: true }) : null;
  const go = h("button", { class: "btn danger" }, label);
  const dialog = openDialog(
    "confirm",
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          go.disabled = true;
          try {
            const done = await run(password?.value);
            dialog.close();
            toast(done);
            await loadSpace(at);
          } catch (err) {
            error.textContent = errorText(err);
            go.disabled = false;
          }
        },
      },
      h("header", null, h("h2", { class: "grow" }, title), closeX(() => dialog)),
      h("p", null, lead),
      warn && h("p", { class: "banner danger" }, warn),
      h("p", { class: "cmd whole" }, icon("terminal"), command),
      password && field(t("account.password"), password, t("docker.passwordHint")),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
    ),
  );
}

/**
 * Images and volumes, who uses them, and taking away what nothing uses: of this server (Settings →
 * Docker) or of a machine (`at`, its tab "Docker")
 */
function dockerSection(at = "") {
  const space = spaces[at];
  const base = spaceApi(at);
  if (!space) return [uiCard({ flush: true }, uiEmpty({ size: "loading", text: t("docker.counting") }))];
  if (space.error) return [uiCard({}, uiEmpty({ size: "error", title: space.error, action: button(t("docker.recount"), { onclick: () => (delete spaces[at], paintSpace(at), loadSpace(at)) }, "refresh") }))];
  const sum = (list) => list.reduce((n, one) => n + Math.max(0, one.size), 0);
  // an app of this server opens its page; a machine's apps are on the machine's tab
  const appLink = (name) => (at ? h("a", { class: "link", href: `#/machines/${at}/apps` }, name) : (state.overview?.apps ?? []).some((a) => a.name === name) ? h("a", { class: "link", href: `#/apps/${name}` }, name) : h("span", null, name));
  // who uses it: the app when it is one, else the container
  const users = (one) => (one.used.length ? one.used.map((u) => h("div", { class: "small" }, u.app ? appLink(u.app) : h("span", { class: "mono" }, u.container), !u.running && h("span", { class: "muted" }, " · " + t("docker.stopped")))) : "—");
  const usersWords = (one) => one.used.map((u) => (u.app || u.container) + (u.running ? "" : " · " + t("docker.stopped"))).join(", ");
  const stateOf = (one) => (one.used.length ? uiState("ok", t("docker.inUse")) : one.wanted?.length ? uiState("info", t("docker.neededBy", { apps: one.wanted.join(", ") })) : uiState("off", t("docker.unused")));

  const images = space.images;
  const idle = images.filter((i) => !i.used.length);
  const wanted = idle.filter((i) => i.wanted.length);
  const imageName = (i) => (i.name ? h("div", { class: "strong mono clip" }, i.name) : h("div", null, h("span", { class: "strong" }, t("docker.noName")), h("span", { class: "muted small mono" }, " " + i.id.slice(7, 19))));
  const dropImage = (i) =>
    dockerDropDialog({
      at,
      title: t("docker.image.dropTitle"),
      lead: i.name || i.id.slice(7, 19),
      warn: i.wanted.length ? t("docker.image.wanted", { apps: i.wanted.join(", ") }) : "",
      command: `docker image rm ${i.name || i.id.slice(7, 19)}`,
      go: t("docker.drop"),
      run: async () => (await api("DELETE", `${base}/images/${i.id}`), t("docker.image.dropped")),
    });
  const imageRow = (i) => ({
    menu: (at2) => menuAt(at2, null, [{ label: t("docker.drop") + "…", icon: "trash", danger: true, off: i.used.length > 0, run: () => dropImage(i) }]),
    cells: [
      uiCell({ name: i.name ? h("span", { class: "mono", title: i.name }, i.name) : h("span", null, t("docker.noName"), " ", h("span", { class: "muted mono" }, i.id.slice(7, 19))), sub: i.more.length ? h("span", { class: "mono" }, i.more.join(", ")) : null }),
      bytes(i.size),
      h("span", { class: "muted" }, shortDate(i.created * 1000)),
      h("div", null, users(i)),
      stateOf(i),
      i.used.length ? "" : uiMore([{ label: t("docker.drop") + "…", icon: "trash", danger: true, run: () => dropImage(i) }], { size: "s" }),
    ],
    sub: [bytes(i.size), shortDate(i.created * 1000), usersWords(i)].filter(Boolean).join(" · "),
  });
  const pruneImages = () =>
    dockerDropDialog({
      at,
      title: t("docker.image.pruneTitle"),
      lead: t("docker.image.pruneLead", { n: idle.length, size: bytes(sum(idle)) }),
      warn: wanted.length ? t("docker.image.wanted", { apps: [...new Set(wanted.flatMap((i) => i.wanted))].join(", ") }) : "",
      command: "docker image prune -a",
      go: t("docker.pruneGo"),
      run: async () => t("docker.freed", { size: bytes((await api("POST", `${base}/images/prune`, {})).freed) }),
    });

  const volumes = space.volumes;
  const spare = volumes.filter((v) => !v.used.length);
  const volumeName = (v) => uiCell({ name: h("span", { class: "mono", title: v.name }, v.anonymous ? v.name.slice(0, 12) + "…" : v.name), sub: v.anonymous ? t("docker.volume.anonymous") : v.project ? t("docker.volume.of", { app: v.project }) : t("docker.volume.byHand") });
  const dropVolume = (v) =>
    dockerDropDialog({
      at,
      title: t("docker.volume.dropTitle"),
      lead: v.name,
      warn: t("docker.volume.dataGoes"),
      command: `docker volume rm ${v.name}`,
      go: t("docker.drop"),
      run: async () => (await api("DELETE", `${base}/volumes/${encodeURIComponent(v.name)}`), t("docker.volume.dropped")),
    });
  const volumeRow = (v) => ({
    cells: [volumeName(v), v.size >= 0 ? bytes(v.size) : "—", h("span", { class: "muted" }, v.created ? shortDate(Date.parse(v.created)) : "—"), h("div", null, users(v)), stateOf(v), v.used.length ? "" : uiMore([{ label: t("docker.drop") + "…", icon: "trash", danger: true, run: () => dropVolume(v) }], { size: "s" })],
    sub: [v.size >= 0 ? bytes(v.size) : null, usersWords(v)].filter(Boolean).join(" · "),
  });
  const pruneVolumes = () =>
    dockerDropDialog({
      at,
      title: t("docker.volume.pruneTitle"),
      lead: t("docker.volume.pruneLead", { n: spare.length, size: bytes(sum(spare)), names: spare.map((v) => (v.anonymous ? v.name.slice(0, 12) + "…" : v.name)).join(", ") }),
      warn: t("docker.volume.dataGoesAll"),
      command: "docker volume prune -a",
      password: true,
      go: t("docker.pruneGo"),
      run: async (password) => {
        const done = await api("POST", `${base}/volumes/prune`, { password });
        return t("docker.volume.pruned", { n: done.count, size: bytes(done.freed) });
      },
    });
  const pruneCache = () =>
    dockerDropDialog({
      at,
      title: t("docker.cache.title"),
      lead: t("docker.cache.lead", { size: bytes(space.cache) }),
      command: "docker builder prune -a",
      go: t("docker.pruneGo"),
      run: async () => t("docker.freed", { size: bytes((await api("POST", `${base}/cache/prune`, {})).freed) }),
    });

  const card = (title, list, unused, prune, first, rows, none) =>
    uiCard(
      { title, count: list.length, lead: unused.length ? t("docker.unusedSum", { n: unused.length, size: bytes(sum(unused)) }) : t("docker.allUsed"), flush: true, actions: unused.length > 0 && button(t("docker.pruneShort"), { class: "small danger-text", onclick: prune }, "trash") },
      list.length ? uiTable([{ label: first }, { label: t("docker.size"), num: true }, { label: t("docker.created") }, { label: t("docker.usedBy") }, { label: t("app.col.state") }, { label: "" }], rows, { cls: "docker-table" }) : uiEmpty({ text: none }),
    );
  const recount = button(t("docker.recount"), { class: "small", onclick: () => (delete spaces[at], paintSpace(at), loadSpace(at)) }, "refresh");
  return [
    uiCard({}, uiNotice({ tone: "info", text: [t(at ? "docker.leadMachine" : "docker.lead"), space.cache > 0 ? " " + t("docker.cache.line", { size: bytes(space.cache) }) : ""].join(""), action: recount, second: space.cache > 0 && button(t("docker.cache.clear"), { class: "small", onclick: pruneCache }) })),
    card(t("docker.images"), images, idle, pruneImages, t("docker.image"), images.map(imageRow), t("docker.none")),
    card(t("docker.volumes"), volumes, spare, pruneVolumes, t("docker.volume"), volumes.map(volumeRow), t("docker.noVolumes")),
  ];
}

let imagesTimer;
/** Settings → Apps: newer images in the registries, and the apps updating by themselves */
function imagesCard() {
  const s = state.settings.images;
  const st = state.images;
  if (!st) return null;
  const apps = state.overview?.apps ?? [];
  const check = h("input", { type: "checkbox", checked: s.check });
  const auto = h("input", { type: "checkbox", checked: s.auto, disabled: !s.check });
  const time = h("input", { type: "time", value: s.time, class: "short mono", required: true });
  const included = apps.map((app) => ({ name: app.name, box: h("input", { type: "checkbox", checked: !s.exclude.includes(app.name) }), title: app.title }));
  const whenAuto = h("div", { class: "stack", hidden: !s.auto }, field(`${t("images.time")} · ${state.settings.systemTimezone}`, time), included.length > 0 && h("div", { class: "stack" }, h("strong", null, t("images.apps")), included.map((a) => h("label", { class: "check" }, a.box, h("span", null, a.title)))));
  check.onchange = () => {
    auto.disabled = !check.checked;
    if (!check.checked) auto.checked = false;
    whenAuto.hidden = !auto.checked;
  };
  auto.onchange = () => (whenAuto.hidden = !auto.checked);
  const error = h("p", { class: "error", role: "alert" });
  const again = async (path, method = "GET") => {
    state.images = await api(method, path, method === "GET" ? undefined : {}).catch(() => state.images);
    // the marks on the apps come with the list of apps
    if (!state.images.running) await refresh();
    if (state.route.view === "settings" && showsSection("apps")) renderSettings();
  };
  clearTimeout(imagesTimer);
  if (st.running) imagesTimer = setTimeout(() => state.route.view === "settings" && again("/api/images"), 3000);
  const status = st.running ? t("images.running") : st.at ? t("images.status", { when: ago(st.at), asked: st.asked, newer: st.newer }) : t("images.never");
  return h(
    "form",
    {
      class: "card pad stack",
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = "";
        try {
          state.settings = await api("PUT", "/api/settings", { images: { check: check.checked, auto: auto.checked, time: time.value, exclude: included.filter((a) => !a.box.checked).map((a) => a.name) } });
          toast(t("settings.saved"));
          await refresh();
          renderSettings();
        } catch (err) {
          error.textContent = errorText(err);
        }
      },
    },
    h("div", { class: "section-head" }, h("h2", null, t("images.title")), s.check && h("div", { class: "actions" }, h("span", { class: "ui-row-time" }, status), button(t("images.checkNow"), { class: "small", disabled: st.running, onclick: () => again("/api/images/check", "POST") }, "refresh"))),
    h("label", { class: "check" }, check, h("span", null, h("strong", null, t("images.check")), h("span", { class: "muted small block" }, t("images.checkHint")))),
    s.check && st.failed.length > 0 && !st.running && h("details", null, h("summary", { class: "muted small" }, t("images.failed", { n: st.failed.length })), st.failed.map((f) => h("p", { class: "small" }, h("span", { class: "mono" }, f.image), " — ", h("span", { class: "muted" }, f.message)))),
    h("label", { class: "check" }, auto, h("span", null, h("strong", null, t("images.auto")), h("span", { class: "muted small block" }, t("images.autoHint")))),
    whenAuto,
    error,
    h("footer", null, h("button", { class: "btn primary" }, t("settings.save"))),
  );
}

const HTTPS_MODES = ["off", "proxy", "acme"];
/** Settings → HTTPS and domain: how Hata is reached */
const ACCENTS = ["#f5a524", "#ec6a5e", "#e0559a", "#9b6cf0", "#4f8ff7", "#22b8cf", "#3fbf7f", "#a3b82e"];
const BACKGROUNDS = ["#131110", "#0e1116", "#0f1a17", "#17121c", "#1a1212", "#000000", "#f6f3ef", "#eef2f6"];

function appearanceSection(error) {
  const look = state.settings.appearance;
  /** Shows the change at once and saves it; a refused one is taken back */
  const change = async (patch, redraw = true) => {
    const before = state.settings.appearance;
    state.settings.appearance = state.appearance = { ...before, ...patch };
    applyAppearance(state.appearance);
    if (redraw) renderSettings();
    try {
      state.settings = await api("PUT", "/api/settings", { appearance: patch });
      state.appearance = state.settings.appearance;
    } catch (e) {
      state.settings.appearance = state.appearance = before;
      applyAppearance(before);
      renderSettings();
      toast(errorText(e), "error");
    }
  };
  const colours = (key, presets, fallback) => {
    const current = look[key];
    const custom = h("input", { type: "color", value: current || fallback, title: t("appearance.custom"), "aria-label": t("appearance.custom"), oninput: () => applyAppearance({ ...state.appearance, [key]: custom.value }), onchange: () => change({ [key]: custom.value }) });
    return h(
      "div",
      { class: "swatches" },
      presets.map((colour, i) => {
        // the first one is Hata's own: choosing it means "no colour of mine"
        const on = i === 0 ? !current : current === colour;
        const swatch = h("button", { type: "button", class: "swatch" + (on ? " on" : ""), title: i === 0 ? t("appearance.default") : colour, "aria-label": i === 0 ? t("appearance.default") : colour, "aria-pressed": String(on), onclick: () => change({ [key]: i === 0 ? "" : colour }) });
        swatch.style.background = colour;
        return swatch;
      }),
      custom,
    );
  };
  const wall = (name, label) =>
    h("button", { type: "button", class: "wall" + (look.wallpaper === name ? " on" : ""), "aria-pressed": String(look.wallpaper === name), onclick: () => change({ wallpaper: name }) }, name && h("img", { src: wallpaperUrl(look, name), alt: "", loading: "lazy" }), h("span", null, label));
  const file = h("input", {
    type: "file",
    accept: "image/jpeg,image/png,image/webp,image/avif",
    hidden: true,
    onchange: async () => {
      const picture = file.files[0];
      if (!picture) return;
      error.textContent = "";
      try {
        const res = await fetch("/api/appearance/wallpaper", { method: "PUT", body: picture, headers: { "content-type": "application/octet-stream" } });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "request.failed", data?.error?.detail ?? {});
        state.settings = data;
        applyAppearance((state.appearance = data.appearance));
        renderSettings();
      } catch (e) {
        error.textContent = errorText(e);
      }
    },
  });
  const dim = h("input", { type: "range", min: 0, max: 90, step: 5, value: look.dim, "aria-label": t("appearance.dim"), oninput: () => applyAppearance({ ...state.appearance, dim: Number(dim.value) }), onchange: () => change({ dim: Number(dim.value) }, false) });
  return [
    h("section", { class: "card pad" }, h("h2", null, t("appearance.colours")), settingRow(t("appearance.accent"), t("appearance.accentHint"), colours("accent", ACCENTS, ACCENTS[0])), settingRow(t("appearance.background"), t("appearance.backgroundHint"), colours("background", BACKGROUNDS, BACKGROUNDS[0]))),
    h(
      "section",
      { class: "card pad" },
      h("h2", null, t("appearance.picture")),
      h("div", { class: "walls" }, wall("", t("appearance.none")), state.wallpapers.map((name) => wall(name, t("appearance.wall." + name))), look.custom &&
          h(
            "div",
            { class: "wall-own" },
            wall("custom", t("appearance.yours")),
            h("button", {
              type: "button",
              class: "icon-btn wall-remove",
              title: t("appearance.remove"),
              "aria-label": t("appearance.remove"),
              onclick: async () => {
                try {
                  state.settings = await api("DELETE", "/api/appearance/wallpaper");
                  applyAppearance((state.appearance = state.settings.appearance));
                  renderSettings();
                } catch (e) {
                  toast(errorText(e), "error");
                }
              },
            }, icon("trash")),
          ), h("button", { type: "button", class: "wall add", onclick: () => file.click() }, h("span", null, icon("upload"), " ", t(look.custom ? "appearance.replace" : "appearance.upload"))), file),
      look.wallpaper && settingRow(t("appearance.dim"), t("appearance.dimHint"), dim),
      error,
    ),
  ];
}

/** Settings → HTTPS and domain: the name on the home network, which needs no domain and no setting up */
function localNameCard() {
  const local = state.settings.local;
  const enabled = h("input", { type: "checkbox", checked: local.enabled });
  // the name is the server's own: changed in the one window that renames the server, here it is only shown
  const name = h("div", { class: "row-actions" }, h("code", null, local.name), button(t("rename.open"), { class: "small", onclick: () => renameServerDialog(renderSettings) }, "edit"));
  const error = h("p", { class: "error", role: "alert" });
  const status = h("div", { class: "stack" });
  let alive = true;
  cleanups.push(() => (alive = false));
  const paint = async () => {
    const s = await api("GET", "/api/local").catch(() => null);
    if (!alive || !s) return;
    const port = s.port === 80 ? "" : ":" + s.port;
    const address = (host) => h("a", { class: "link mono", href: `http://${host}${port}/` }, host + port);
    status.replaceChildren(
      ...(!s.enabled
        ? []
        : !s.own
          ? [
              h("p", { class: "muted small" }, t("local.otherLead", { domain: s.domain, address: s.addresses[0] ?? "—" })),
              ...s.checks.map((c) => h("div", { class: "activity-item" }, icon(c.ok ? "check" : "x", c.ok ? "ok" : "danger"), h("div", { class: "grow" }, h("div", null, c.ok ? address(c.host) : h("span", { class: "mono" }, c.host)), h("div", { class: "muted small" }, c.ok ? t("local.leadsHere") : c.found.length ? t("local.leadsElsewhere", { addresses: c.found.join(", ") }) : t("local.unknown"))))),
            ]
          : !s.listening
            ? [h("p", { class: "error" }, t("local.failed", { message: s.error || "…" }))]
            : [
              h("div", { class: "activity-item" }, icon("check", "ok"), h("div", { class: "grow" }, h("div", null, address(s.domain)), h("div", { class: "muted small" }, t("local.answers", { addresses: s.addresses.join(", ") || "—" })))),
                // replaceChildren writes a missing one out as the word "false"
                (state.overview?.apps ?? []).some((a) => a.port) ? h("p", { class: "muted small" }, t("local.apps", { example: `${(state.overview.apps.find((a) => a.port).name).replace(/_/g, "-")}.${s.domain}${port}` })) : "",
              ]),
    );
  };
  void paint();
  return h(
    "form",
    {
      class: "card pad",
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = "";
        try {
          state.settings = await api("PUT", "/api/settings", { local: { enabled: enabled.checked } });
          toast(t("settings.saved"));
          await refresh();
          // the responder takes a moment to start listening
          setTimeout(paint, 600);
        } catch (err) {
          error.textContent = errorText(err);
        }
      },
    },
    h("h2", null, t("local.title")),
    h("p", { class: "muted small" }, t("local.lead")),
    settingRow(t("local.enabled"), t("local.enabledHint"), enabled),
    settingRow(t("local.name"), t("local.nameHint"), name),
    status,
    error,
    h("footer", null, h("button", { class: "btn primary" }, t("settings.save"))),
  );
}

function httpsSection(save, error) {
  const https = state.settings.https;
  const mode = h("select", null, HTTPS_MODES.map((id) => h("option", { value: id, selected: https.mode === id }, t("https.mode." + id))));
  const domain = h("input", { value: https.domain, placeholder: "home.example.com", spellcheck: false, autocapitalize: "none", class: "mono" });
  const email = h("input", { type: "email", value: https.email, placeholder: "you@example.com", spellcheck: false });
  const explain = h("p", { class: "muted small" });
  const emailRow = settingRow(t("https.email"), t("https.emailHint"), email);
  const domainRow = settingRow(t("https.domain"), t("https.domainHint"), domain);
  const results = h("div", { class: "stack" });
  const sync = () => {
    explain.textContent = t("https.explain." + mode.value);
    domainRow.hidden = mode.value === "off";
    emailRow.hidden = mode.value !== "acme";
  };
  mode.addEventListener("change", sync);
  sync();
  const check = button(t("https.check"), {
    onclick: async () => {
      check.disabled = true;
      results.replaceChildren(h("p", { class: "muted small" }, t("https.checking")));
      try {
        const list = await api("POST", "/api/https/check", {});
        results.replaceChildren(...list.map((r) => h("div", { class: "activity-item" }, icon(r.ok ? "check" : "x", r.ok ? "ok" : "danger"), h("div", { class: "grow" }, h("div", { class: "mono" }, r.host), !r.ok && h("div", { class: "muted small" }, r.problem)))));
      } catch (e) {
        results.replaceChildren(h("p", { class: "error" }, errorText(e)));
      }
      check.disabled = false;
    },
  });
  const here = state.overview?.site?.domain;
  // certificates are requested in the background: the card keeps asking until nothing is in progress
  const certs = h("div", { class: "stack" });
  let alive = true;
  cleanups.push(() => (alive = false));
  const paintCerts = async () => {
    const status = await api("GET", "/api/https").catch(() => null);
    if (!alive || !status) return;
    put(certs,
      status.httpPort !== 80 && h("p", { class: "banner" }, t("https.needPort80", { port: status.httpPort })),
      status.error && h("p", { class: "error" }, status.error),
      ...status.certificates.map((c) =>
        h(
          "div",
          { class: "activity-item" },
          icon(c.working ? "refresh" : c.notAfter ? "check" : "x", c.working ? "" : c.notAfter ? "ok" : "danger"),
          h("div", { class: "grow" }, h("div", { class: "mono" }, c.name), h("div", { class: "muted small" }, c.working ? t("https.cert.working") : c.notAfter ? t("https.cert.valid", { date: new Date(c.notAfter).toLocaleDateString(state.lang, { day: "numeric", month: "long", year: "numeric" }), issuer: c.issuer }) : t("https.cert.none")), c.error && h("div", { class: "error small" }, c.error)),
        ),
      ),
    );
    if (status.certificates.some((c) => c.working)) setTimeout(paintCerts, 2000);
  };
  if (https.mode === "acme") void paintCerts();
  const retry = button(t("https.retry"), { onclick: async () => (await api("POST", "/api/https/retry", {}).catch((e) => toast(errorText(e), "error")), setTimeout(paintCerts, 800)) }, "refresh");
  return [
    localNameCard(),
    h(
      "form",
      {
        class: "card pad",
        onsubmit: async (e) => {
          e.preventDefault();
          await save({ https: { mode: mode.value, domain: domain.value.trim(), email: email.value.trim() } });
          await refresh();
          render();
          void loadSettings();
        },
      },
      h("h2", null, t("settings.https")),
      settingRow(t("https.mode"), "", mode),
      explain,
      domainRow,
      emailRow,
      error,
      h("footer", null, h("button", { class: "btn primary" }, t("settings.save"))),
    ),
    hasModule("domains") && namesCard(),
    https.mode === "acme" && https.domain && wildcardCard(paintCerts),
    https.mode === "acme" && h("section", { class: "card pad" }, h("div", { class: "section-head" }, h("h2", null, t("https.certificates")), retry), h("p", { class: "muted small" }, t(https.wildcard && https.wildcard !== "off" ? "wildcard.certificatesLead" : "https.certificatesLead")), certs),
    here && h("section", { class: "card pad" }, h("div", { class: "section-head" }, h("h2", null, t("https.checkTitle")), check), h("p", { class: "muted small" }, t("https.checkLead", { domain: here })), results),
    here && h("section", { class: "card pad" }, h("h2", null, t("https.addresses")), h("p", { class: "muted small" }, t("https.addressesLead")), settingRow("Hata", "", h("a", { class: "link mono", href: `https://${here}/` }, here)), (state.overview?.apps ?? []).filter((a) => a.port).map((a) => settingRow(a.title, a.protected ? t("access.protected") : "", h("a", { class: "link mono", href: `https://${a.name.replace(/_/g, "-")}.${here}/`, target: "_blank", rel: "noopener noreferrer" }, `${a.name.replace(/_/g, "-")}.${here}`)))),
  ];
}

/** One certificate for the domain and every name under it: the way its TXT record gets into the DNS */
function wildcardCard(afterChange) {
  const body = h("div", { class: "stack" }, waitMark());
  const paint = async () => {
    const status = await api("GET", "/api/https").catch(() => null);
    if (!status) return;
    const w = status.wildcard;
    const via = h("select", null, ["off", "api", "delegate", "manual"].map((id) => h("option", { value: id, selected: w.via === id }, t("wildcard.via." + id))));
    const provider = h("select", null, w.providers.map((id) => h("option", { value: id, selected: w.provider === id }, t("wildcard.provider." + id))));
    const token = h("input", { type: "password", class: "mono", autocomplete: "off", placeholder: w.saved ? t("wildcard.keep") : "" });
    const accessKey = h("input", { class: "mono", autocomplete: "off", spellcheck: false, placeholder: w.saved ? t("wildcard.keep") : "" });
    const secret = h("input", { type: "password", class: "mono", autocomplete: "off", placeholder: w.saved ? t("wildcard.keep") : "" });
    const tokenRow = field(t("wildcard.token"), token);
    const hint = h("span");
    const tokenWhy = h("p", { class: "muted small" }, hint);
    const keyRow = field(t("wildcard.accessKey"), accessKey);
    const secretRow = field(t("wildcard.secret"), secret);
    const record = (name, type, value) => h("div", { class: "kv" }, h("span", { class: "mono small" }, `${name} ${type}`), h("span", { class: "mono small" }, value));
    const delegate = h("div", { class: "stack-s" }, h("p", { class: "muted small" }, t("wildcard.delegateLead")), record(w.name, "NS", w.server), record(w.server, "A", t("wildcard.outsideAddress")), h("p", { class: "muted small" }, t("wildcard.delegatePort")), !w.dns && h("p", { class: "banner small" }, h("a", { class: "link", href: "#/settings/dns" }, t("wildcard.dnsNeeded"))));
    const manualHint = h("p", { class: "muted small" }, t("wildcard.manualLead"));
    const shape = () => {
      const api = via.value === "api";
      const r53 = provider.value === "route53";
      provider.closest(".field, label, div").hidden = !api;
      tokenRow.hidden = !api || r53;
      tokenWhy.hidden = !api;
      hint.textContent = api ? t("wildcard.how." + provider.value) : "";
      keyRow.hidden = secretRow.hidden = !api || !r53;
      delegate.hidden = via.value !== "delegate";
      manualHint.hidden = via.value !== "manual";
    };
    via.addEventListener("change", shape);
    provider.addEventListener("change", shape);
    const error = h("p", { class: "error", role: "alert" });
    const save = button(t("settings.save"), {
      class: "primary",
      onclick: async (e) => {
        const el = e.currentTarget;
        el.disabled = true;
        error.textContent = "";
        try {
          await api("PUT", "/api/https/wildcard", { via: via.value, provider: provider.value, token: token.value, accessKey: accessKey.value, secret: secret.value });
          toast(t("wildcard.saved"));
          await paint();
          setTimeout(afterChange, 800);
        } catch (err) {
          error.textContent = errorText(err);
          el.disabled = false;
        }
      },
    });
    put(
      body,
      w.manual &&
        h(
          "div",
          { class: "banner stack-s" },
          h("strong", null, t("wildcard.manualWaits")),
          ...w.manual.values.map((value) => record(w.manual.name, "TXT", value)),
          h("p", { class: "muted small" }, t("wildcard.manualAll")),
          h("div", { class: "actions" }, button(t("wildcard.manualDone"), {
            class: "primary small",
            onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                await api("POST", "/api/https/wildcard/done", {});
                toast(t("wildcard.manualGoing"));
              } catch (err) {
                toast(errorText(err), "error");
              }
              setTimeout(paint, 3000);
            },
          })),
        ),
      field(t("wildcard.way"), via),
      field(t("wildcard.providerLabel"), provider),
      tokenRow,
      keyRow,
      secretRow,
      tokenWhy,
      delegate,
      manualHint,
      error,
      h("div", { class: "actions" }, save),
    );
    shape();
    if (via.value === "manual" && !w.manual) setTimeout(() => void (body.isConnected && paint()), 8000);
  };
  void paint();
  return h("section", { class: "card pad stack" }, h("h2", null, t("wildcard.title")), h("p", { class: "muted small" }, t("wildcard.lead")), body);
}
