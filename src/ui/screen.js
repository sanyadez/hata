// The screen of a virtual machine, shown in a frame by the UI: on a Proxmox server `?pve=<server>&guest=qemu/<id>`,
// on this server `?incus=<name>` (QEMU's own VNC socket). Hata asks for the screen, and the browser speaks VNC to it through Hata's socket. The VNC client
// is noVNC (vendor/, third-party code).
import RFB from "/vendor/novnc.js";

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const lang = params.get("lang") || "en";
const load = (code) => fetch(`/lang/${code}.json`).then((r) => (r.ok ? r.json() : {}), () => ({}));
const [fallback, dict] = await Promise.all([load("en"), lang === "en" ? {} : load(lang)]);
const t = (key, vars = {}) => String(dict[key] ?? fallback[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
document.documentElement.lang = lang;

const status = (text, kind = "") => {
  $("status").textContent = text;
  $("status").className = "term-status " + kind;
};
const note = (text) => {
  $("note").hidden = !text;
  $("note-text").textContent = text || "";
};
$("keys").textContent = "Ctrl+Alt+Del";
$("again").textContent = t("screen.again");
$("on").textContent = t("screen.turnOn");
const incus = params.get("incus");

let rfb = null;

async function connect() {
  rfb?.disconnect();
  rfb = null;
  note("");
  $("on").hidden = true;
  status(t("terminal.state.connecting"));
  let asked;
  try {
    const where = incus !== null ? `/api/containers/${encodeURIComponent(incus)}/screen` : `/api/proxmox/${encodeURIComponent(params.get("pve") ?? "")}/guests/${params.get("guest") ?? ""}/screen`;
    const res = await fetch(where, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    asked = await res.json();
    if (!res.ok) throw Object.assign(new Error(), { code: asked.error?.code, detail: asked.error?.detail });
  } catch (e) {
    status(t("screen.failed"), "bad");
    // a machine made before Hata asked QEMU for a screen gets one by a restart
    $("on").hidden = e.code !== "containers.screenOff";
    return note(e.code ? t("error." + e.code, e.detail ?? {}) : String(e.message || e));
  }
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/ws?screen=${asked.screen}`;
  rfb = new RFB($("box"), url, { credentials: { password: asked.password }, wsProtocols: [] });
  // the machine's own resolution, scaled to the frame: Proxmox's screens do not change size on request
  rfb.scaleViewport = true;
  rfb.resizeSession = false;
  rfb.background = "transparent";
  rfb.addEventListener("connect", () => (status(t("terminal.state.live"), "live"), rfb.focus()));
  rfb.addEventListener("credentialsrequired", () => rfb.sendCredentials({ password: asked.password }));
  rfb.addEventListener("securityfailure", (e) => note(t("screen.refused", { reason: e.detail?.reason ?? "" })));
  rfb.addEventListener("disconnect", (e) => {
    status(t(e.detail?.clean ? "screen.closed" : "screen.lost"), "bad");
    if (!e.detail?.clean) note(t("screen.lostHint"));
  });
}

$("keys").addEventListener("click", () => rfb?.sendCtrlAltDel());
$("again").addEventListener("click", () => void connect());
$("on").addEventListener("click", async () => {
  $("on").disabled = true;
  status(t("screen.restarting"));
  const res = await fetch(`/api/containers/${encodeURIComponent(incus ?? "")}/screen/on`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
  $("on").disabled = false;
  if (!res?.ok) {
    const e = (await res?.json().catch(() => null))?.error;
    status(t("screen.failed"), "bad");
    return note(e?.code ? t("error." + e.code, e.detail ?? {}) : t("screen.lostHint"));
  }
  // the machine starts again: its screen is there once QEMU is up
  setTimeout(() => void connect(), 2000);
});
void connect();
