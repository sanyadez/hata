// The screen of a virtual machine on a Proxmox server, shown in a frame by the UI: `?pve=<server>&guest=qemu/<id>`.
// Hata asks Proxmox for the screen, and the browser speaks VNC to it through Hata's socket. The VNC client
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

let rfb = null;

async function connect() {
  rfb?.disconnect();
  rfb = null;
  note("");
  status(t("terminal.state.connecting"));
  let asked;
  try {
    const res = await fetch(`/api/proxmox/${encodeURIComponent(params.get("pve") ?? "")}/guests/${params.get("guest") ?? ""}/screen`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    asked = await res.json();
    if (!res.ok) throw Object.assign(new Error(), { code: asked.error?.code, detail: asked.error?.detail });
  } catch (e) {
    status(t("screen.failed"), "bad");
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
void connect();
