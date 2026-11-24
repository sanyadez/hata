// The page a link opens for somebody without an account: a file or a folder to look at and download,
// or a folder to send files into. It knows nothing of the rest of Hata and asks only `/s/<token>/…`.

const token = location.pathname.split("/")[2] ?? "";
const at = `/s/${token}`;
const root = document.getElementById("link");
const lang = /^uk\b/i.test(navigator.language) ? "uk" : "en";
let dict = {};

const t = (key, vars = {}) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : ""));

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
  return el;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];
function bytes(n) {
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  return (i === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)) + " " + UNITS[i];
}

const when = (ts) => new Date(ts).toLocaleString(lang, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

class Failure extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail ?? {};
  }
}

async function ask(method, path, data) {
  const res = await fetch(at + path, { method, headers: data ? { "content-type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined, credentials: "same-origin" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Failure(res.status, body.error?.code ?? "request.failed", body.error?.detail);
  return body;
}

const said = (e) => (e instanceof Failure ? t(`linkpage.error.${e.code}`, e.detail) : t("linkpage.error.network"));
const show = (...children) => root.replaceChildren(...children);

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;
const VIDEO_RE = /\.(mp4|m4v|webm|mov|ogv)$/i;
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i;

const fileUrl = (path, download) => `${at}/raw?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
const zipUrl = (path) => `${at}/zip?path=${encodeURIComponent(path)}`;

/** Who gave it and until when */
function about(info) {
  return h(
    "p",
    { class: "muted small" },
    [info.from && t("linkpage.from", { name: info.from }), info.expires ? t("linkpage.until", { when: when(info.expires) }) : ""].filter(Boolean).join(" · "),
  );
}

function head(info, title) {
  return [h("h1", { class: "wrap" }, title), about(info), info.note ? h("p", { class: "link-note" }, info.note) : null];
}

// --- Locked -----------------------------------------------------------------------------------------

function locked() {
  const input = h("input", { type: "password", required: true, autocomplete: "off", placeholder: t("linkpage.password") });
  const error = h("p", { class: "error", role: "alert" });
  const button = h("button", { class: "btn primary" }, t("linkpage.open"));
  show(
    h(
      "form",
      {
        class: "ui-card ui-pad stack",
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          button.disabled = true;
          try {
            opened(await ask("POST", "/unlock", { password: input.value }));
          } catch (err) {
            error.textContent = said(err);
            button.disabled = false;
            input.select();
          }
        },
      },
      h("h1", null, t("linkpage.lockedTitle")),
      h("p", { class: "muted" }, t("linkpage.lockedLead")),
      input,
      error,
      button,
    ),
  );
  input.focus();
}

// --- A file -----------------------------------------------------------------------------------------

function oneFile(info) {
  const url = fileUrl("", false);
  const preview = IMAGE_RE.test(info.name) ? h("img", { class: "link-preview", src: url, alt: "" }) : VIDEO_RE.test(info.name) ? h("video", { class: "link-preview", src: url, controls: true, preload: "metadata" }) : AUDIO_RE.test(info.name) ? h("audio", { src: url, controls: true, preload: "metadata" }) : null;
  show(h("section", { class: "ui-card ui-pad stack" }, ...head(info, info.name), h("p", { class: "muted" }, bytes(info.size)), preview, h("a", { class: "btn primary", href: fileUrl("", true) }, t("linkpage.download"))));
}

// --- A folder ---------------------------------------------------------------------------------------

let folder = "";

async function oneFolder(info, path = "") {
  folder = path;
  const list = h("div", { class: "link-list" }, h("p", { class: "muted" }, t("linkpage.loading")));
  const crumbs = h("nav", { class: "link-crumbs" });
  const parts = path ? path.split("/") : [];
  crumbs.append(h("button", { type: "button", class: "btn ghost small", onclick: () => oneFolder(info, "") }, info.name));
  parts.forEach((part, i) => crumbs.append(h("span", { class: "muted" }, "/"), h("button", { type: "button", class: "btn ghost small", onclick: () => oneFolder(info, parts.slice(0, i + 1).join("/")) }, part)));
  show(
    h(
      "section",
      { class: "ui-card ui-pad stack" },
      ...head(info, info.name),
      h("div", { class: "link-bar" }, crumbs, h("a", { class: "btn primary small", href: zipUrl(path) }, t("linkpage.downloadAll"))),
      list,
    ),
  );
  try {
    const { entries, truncated } = await ask("GET", `/list?path=${encodeURIComponent(path)}`);
    if (folder !== path) return;
    const at = (name) => (path ? `${path}/${name}` : name);
    list.replaceChildren(
      ...(entries.length ? [] : [h("p", { class: "muted" }, t("linkpage.empty"))]),
      ...entries.map((entry) =>
        entry.type === "dir"
          ? h("button", { type: "button", class: "link-row", onclick: () => oneFolder(info, at(entry.name)) }, h("span", { class: "link-kind dir" }, "▸"), h("span", { class: "link-name" }, entry.name), h("span", { class: "muted small" }, ""))
          : h(
              "div",
              { class: "link-row" },
              h("span", { class: "link-kind" }, "·"),
              IMAGE_RE.test(entry.name) || VIDEO_RE.test(entry.name) || AUDIO_RE.test(entry.name) || /\.pdf$/i.test(entry.name)
                ? h("a", { class: "link-name", href: fileUrl(at(entry.name), false), target: "_blank", rel: "noopener" }, entry.name)
                : h("span", { class: "link-name" }, entry.name),
              h("span", { class: "muted small" }, bytes(entry.size)),
              h("a", { class: "btn ghost small", href: fileUrl(at(entry.name), true), title: t("linkpage.download"), "aria-label": t("linkpage.download") }, "↓"),
            ),
      ),
      ...(truncated ? [h("p", { class: "muted small" }, t("linkpage.truncated"))] : []),
    );
  } catch (e) {
    list.replaceChildren(h("p", { class: "error", role: "alert" }, said(e)));
  }
}

// --- A drop -----------------------------------------------------------------------------------------

const PART = 8 * 1024 * 1024;

function drop(info) {
  const sent = h("div", { class: "link-list" });
  const room = h("p", { class: "muted small" }, info.room !== null ? t("linkpage.room", { size: bytes(info.room) }) : "");
  const picker = h("input", { type: "file", multiple: true, hidden: true, onchange: () => (send([...picker.files]), (picker.value = "")) });
  const zone = h(
    "div",
    {
      class: "link-drop",
      onclick: () => picker.click(),
      ondragover: (e) => (e.preventDefault(), zone.classList.add("over")),
      ondragleave: () => zone.classList.remove("over"),
      ondrop: (e) => (e.preventDefault(), zone.classList.remove("over"), send([...e.dataTransfer.files])),
    },
    h("strong", null, t("linkpage.dropHere")),
    h("span", { class: "muted small" }, t("linkpage.dropOr")),
  );
  show(h("section", { class: "ui-card ui-pad stack" }, ...head(info, t("linkpage.dropTitle", { name: info.name })), zone, picker, room, sent));

  let queue = Promise.resolve();
  const send = (files) => {
    for (const file of files) {
      const bar = h("div", { class: "bar" }, h("i"));
      const line = h("span", { class: "muted small" }, t("linkpage.waiting"));
      sent.prepend(h("div", { class: "link-row sending" }, h("span", { class: "link-name" }, file.name, bar), line));
      queue = queue.then(() => sendOne(file, bar.firstChild, line, room, info));
    }
  };
}

async function sendOne(file, fill, line, room, info) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  let offset = 0;
  try {
    do {
      const piece = file.slice(offset, offset + PART);
      const last = offset + piece.size >= file.size;
      const res = await fetch(`${at}/upload?name=${encodeURIComponent(file.name)}&id=${id}&offset=${offset}&last=${last ? 1 : 0}`, { method: "PUT", body: piece, credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Failure(res.status, body.error?.code ?? "request.failed", body.error?.detail);
      offset += piece.size;
      fill.style.width = `${file.size ? Math.round((offset / file.size) * 100) : 100}%`;
      line.textContent = `${bytes(offset)} / ${bytes(file.size)}`;
      if (last) {
        line.textContent = body.name && body.name !== file.name ? t("linkpage.sentAs", { name: body.name }) : t("linkpage.sent");
        line.className = "ok small";
        if (info.room !== null) {
          info.room = Math.max(0, info.room - file.size);
          room.textContent = t("linkpage.room", { size: bytes(info.room) });
        }
        return;
      }
    } while (true);
  } catch (e) {
    line.textContent = said(e);
    line.className = "error small";
    fetch(`${at}/upload?id=${id}`, { method: "DELETE", credentials: "same-origin" }).catch(() => {});
  }
}

// --- Start ------------------------------------------------------------------------------------------

function opened(info) {
  if (info.locked) return locked();
  document.title = `${info.kind === "drop" ? t("linkpage.dropTitle", { name: info.name }) : info.name} · Hata`;
  if (info.kind === "drop") return drop(info);
  return info.dir ? oneFolder(info) : oneFile(info);
}

async function start() {
  document.documentElement.lang = lang;
  dict = await fetch(`/lang/${lang}.json`).then((r) => r.json()).catch(() => ({}));
  document.getElementById("foot").textContent = t("linkpage.foot");
  try {
    opened(await ask("GET", "/info"));
  } catch (e) {
    show(h("section", { class: "ui-card ui-pad stack" }, h("h1", null, t("linkpage.goneTitle")), h("p", { class: "muted" }, e instanceof Failure && e.status === 404 ? t("linkpage.goneLead") : said(e))));
  }
}

void start();
