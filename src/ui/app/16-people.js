// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Folders shared over the network ----------------------------------------------------------------

function setShares(data) {
  state.shares = data;
  if (state.files) state.files.shared = data.shares.map((share) => share.path);
  if (state.route.view === "settings" && showsSection("shares")) renderSettings();
  if (state.route.view === "files") renderFilesBody();
}

/** The two ways a shared folder is written: for Explorer, and for everything else */
const shareAddresses = (host, name = "") => ({ windows: `\\\\${host}${name && "\\" + name}`, url: `smb://${host}${name && "/" + name.replaceAll(" ", "%20")}` });

/** Sharing of one folder: turning it on, how it is shared, turning it off */
async function shareDialog(path) {
  let data;
  try {
    data = state.shares = await api("GET", "/api/shares");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const share = data.shares.find((one) => one.path === path);
  const folder = path.split("/").pop() || "/";
  let dialog;
  if (data.tool === "missing") {
    // what, why, the command and the button right here; once installed, the dialog of the folder itself
    dialog = openDialog(
      "confirm",
      h("h2", null, t("shares.dialog.new", { name: folder })),
      h("p", { class: "muted" }, t("shares.tool.note")),
      sambaCard(
        () => {
          dialog.close();
          void shareDialog(path);
        },
        closeButton(() => dialog, t("common.cancel")),
      ),
    );
    return;
  }
  const name = h("input", { value: share?.name ?? "", placeholder: folder, maxLength: 40, spellcheck: false, autocomplete: "off" });
  const choice = (value) => h("select", null, ["none", "read", "write"].map((access) => h("option", { value: access, selected: access === value }, t("shares.access." + access))));
  // a folder shared for the first time is open to whoever shares it
  const users = data.users.map((user) => {
    const select = choice(share ? (share.users[user.id] ?? "none") : user.id === state.user.id && user.allowed !== false ? "write" : "none");
    // kept out by an administrator: what was chosen stays, and counts again once let back in
    select.disabled = user.allowed === false;
    return { user, select };
  });
  const guest = choice(share?.guest ?? "none");
  // Macs back up here with Time Machine; the limit keeps them from filling the disk
  const tm = h("input", { type: "checkbox", checked: !!share?.timeMachine });
  const limit = h("input", { type: "number", min: 0, step: 1, inputmode: "numeric", value: share?.timeMachine?.limit || "", placeholder: t("shares.tm.noLimit") });
  const limitField = field(t("shares.tm.limit"), limit, t("shares.tm.limitHint"));
  const showLimit = () => (limitField.hidden = !tm.checked);
  tm.addEventListener("change", showLimit);
  showLimit();
  const error = h("p", { class: "error", role: "alert" });
  const send = async (method, url, body, done) => {
    error.textContent = "";
    try {
      setShares(await api(method, url, body));
      dialog.close();
      toast(done);
    } catch (e) {
      error.textContent = errorText(e);
    }
  };
  const settings = () => ({ name: name.value.trim(), guest: guest.value, users: Object.fromEntries(users.map(({ user, select }) => [user.id, select.value])), timeMachine: tm.checked ? { limit: Math.max(0, Math.floor(Number(limit.value) || 0)) } : null });
  const address = share && data.hosts[0] && shareAddresses(data.hosts[0], share.name);
  dialog = openDialog(
    "confirm",
    h(
      "form",
      {
        onsubmit: (e) => {
          e.preventDefault();
          if (share) return send("PUT", `/api/shares/${encodeURIComponent(share.name)}`, settings(), t("shares.saved"));
          return send("POST", "/api/shares", { path, ...settings() }, t("shares.sharedDone", { name: folder }));
        },
      },
      h("header", null, uiLead({ icon: "share" }), h("div", null, h("h2", null, t(share ? "shares.dialog.edit" : "shares.dialog.new", { name: folder })), h("span", { class: "muted small mono clip" }, path))),
      address && h("div", { class: "stack-s" }, uiCommand(address.windows), uiCommand(address.url)),
      field(t("shares.name"), name, t("shares.nameHint")),
      uiField(
        t("shares.who"),
        h(
          "div",
          null,
          users.map(({ user, select }) => uiSetting({ name: user.name, explain: user.allowed === false ? t("shares.deniedHint") : !user.ready ? t("shares.notReadyHint") : null, control: select })),
          uiSetting({ name: t("shares.guest"), explain: t("shares.guestHint"), control: guest }),
        ),
        null,
        { group: true },
      ),
      uiCheck(t("shares.tm.title"), tm, t("shares.tm.hint")),
      limitField,
      error,
      h("footer", null, share ? button(t("shares.stop"), { class: "danger", onclick: () => confirmAction({ title: t("attention.end.share", { name: share.name }), lead: t("attention.end.shareLead", { path: share.path }), label: t("shares.stop"), iconName: "x", run: () => send("DELETE", `/api/shares/${encodeURIComponent(share.name)}`, undefined, t("shares.stoppedDone", { name: share.name })) }) }) : h("span"), closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t(share ? "shares.save" : "shares.share"))),
    ),
  );
}

/** What Samba is, what for, the command and the button that installs it (next to a dialog's "Cancel") */
function sambaCard(done, cancel) {
  const data = state.shares;
  const error = h("p", { class: "error", role: "alert" });
  const install = async (e) => {
    const el = e.currentTarget;
    error.textContent = "";
    el.disabled = true;
    el.lastChild.textContent = t("shares.tool.installing");
    try {
      setShares(await api("POST", "/api/shares/tool", {}));
      toast(t("shares.tool.installed"));
      done?.();
    } catch (err) {
      el.disabled = false;
      el.lastChild.textContent = t("shares.tool.install");
      error.textContent = errorText(err);
    }
  };
  return [
    h("p", { class: "muted" }, t("shares.tool.what")),
    h("p", { class: "muted" }, t("shares.tool.why")),
    data.install ? [h("p", { class: "muted" }, t("shares.tool.how")), uiCommand(data.install, { block: true })] : h("p", { class: "muted" }, t("shares.tool.byHand")),
    error,
    (cancel || data.install) && h("footer", null, cancel, data.install && button(t("shares.tool.install"), { class: "primary", onclick: install }, "download")),
  ];
}

function sharesSection() {
  const data = state.shares;
  if (!data) return [waitMark()];
  const error = h("p", { class: "error", role: "alert" });
  if (data.tool === "missing") return [uiCard({ title: t("shares.tool.missing"), lead: t("shares.lead") }, sambaCard())];
  const host = data.hosts[0] ?? location.hostname;
  const taken = data.shares.map((share) => share.path);
  const add = () => folderPicker({ title: t("shares.addTitle"), start: "", confirmLabel: t("shares.addHere"), allowed: (at) => !taken.includes(at), action: (at) => void setTimeout(() => shareDialog(at)) });
  // who may open a folder: the first one in words, the rest counted
  const whoList = (share) => [...data.users.filter((user) => share.users[user.id]).map((user) => `${user.name} · ${t("shares.access." + share.users[user.id])}`), ...(share.guest !== "none" ? [`${t("shares.guest")} · ${t("shares.access." + share.guest)}`] : [])];
  const who = (share) => {
    const list = whoList(share);
    if (!list.length) return h("span", { class: "muted" }, t("shares.nobody"));
    return h("span", { title: list.join("\n") }, list[0], list.length > 1 && h("span", { class: "muted" }, " " + t("shares.moreWho", { n: list.length - 1 })));
  };
  const row = (share) => {
    const address = shareAddresses(host, share.name);
    return {
      onclick: () => shareDialog(share.path),
      cells: [
        uiCell({ lead: { icon: "share" }, name: h("span", null, share.name, share.timeMachine && " ", share.timeMachine && uiTag(share.timeMachine.limit ? t("shares.tm.tagLimit", { limit: share.timeMachine.limit }) : t("shares.tm.tag"))), sub: share.missing ? null : h("span", { class: "mono" }, share.path) }),
        share.missing ? uiState("bad", t("shares.missing")) : who(share),
        h("div", { onclick: (e) => e.stopPropagation() }, uiCommand(address.url)),
        h("div", { onclick: (e) => e.stopPropagation() }, uiLine([button(t("shares.settings"), { class: "small", onclick: () => shareDialog(share.path) }, "sliders")], { end: true })),
      ],
      sub: share.missing ? t("shares.missing") : whoList(share)[0] ?? t("shares.nobody"),
    };
  };
  const all = shareAddresses(host);
  // where the server shows up by itself, so that no address has to be typed
  const found = data.announced.browse && data.announced.windows ? "both" : data.announced.windows ? "windows" : data.announced.browse ? "browse" : "";
  const userRow = (user) =>
    uiRow({
      lead: { avatar: avatarOf(user, "avatar ui-lead") },
      name: user.name,
      sub: t("shares.users.folders", { n: data.shares.filter((share) => share.users[user.id]).length }),
      state: user.allowed === false ? uiState("off", t("shares.users.denied")) : user.ready ? uiState("ok", t("shares.users.ready")) : uiState("off", t("shares.users.notReady")),
    });
  return [
    uiCard(
      {
        title: t("shares.title"),
        count: data.shares.length || null,
        marks: data.shares.length > 0 && uiState(data.running ? "ok" : "bad", t(data.running ? "shares.running" : "shares.stopped")),
        lead: data.shares.length ? t("shares.lead") : null,
        flush: true,
        actions: button(t("shares.add"), { class: "small primary", onclick: add }, "plus"),
      },
      data.error && h("div", { class: "ui-inset" }, uiNotice({ tone: "bad", text: t("shares.error", { message: data.error }) })),
      data.shares.length > 0
        ? uiTable([{ label: t("shares.col.name") }, { label: t("shares.col.access") }, { label: t("shares.col.address") }, { label: "" }], data.shares.map(row))
        : uiEmpty({ size: "big", icon: "share", title: t("shares.noneTitle"), text: t("shares.none"), action: button(t("shares.add"), { class: "primary", onclick: add }, "plus") }),
    ),
    uiCard(
      { title: t("shares.users.title"), lead: [t("shares.users.lead"), t("shares.users.note")].join(" "), flush: true, actions: h("a", { class: "ui-link", href: "#/settings/users/access" }, t("access.givenShort"), icon("chevron")) },
      data.users.map(userRow),
    ),
    uiCard(
      { title: t("shares.how.title") },
      found && uiNotice({ tone: "ok", text: t("shares.found." + found, { name: data.announced.name }) }),
      data.announced.error && data.shares.length > 0 && uiNotice({ tone: "warn", text: t("shares.found.error", { message: data.announced.error }) }),
      ...uiFacts([
        [t("shares.how.windowsKey"), uiCommand(all.windows)],
        [t("shares.how.macKey"), uiCommand(all.url)],
        [t("shares.how.phoneKey"), h("span", { class: "muted small" }, t("shares.how.phoneValue"))],
      ]),
    ),
  ];
}

// --- Links for somebody without an account ----------------------------------------------------------

const LINK_HOURS = [24, 168, 720, 0];
const LINK_LIMITS = [1, 10, 50, 0].map((gb) => gb * 1024 ** 3);

/** The address of a link: at the HTTPS domain when Hata has one, else at the address of this page */
const linkUrl = (link, base) => `${base ?? location.origin}/s/${link.token}`;

/** What a link is, in a few words: what it does, until when, how often it was used */
function linkWords(link) {
  const until = !link.alive ? t("links.ended") : link.expires ? t("links.until", { when: new Date(link.expires).toLocaleString(state.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }) : t("links.forever");
  const used = link.kind === "drop" ? t("links.received", { n: link.files, size: bytes(link.received) }) : t("links.opened", { n: link.opened });
  return [t(link.kind === "drop" ? "links.kind.drop" : "links.kind.get"), until, link.locked ? t("links.withPassword") : null, used].filter(Boolean).join(" · ");
}

/** Without an HTTPS domain the address works only where this page is opened */
const linkHomeOnly = (base) => !base && uiNotice({ tone: "info", text: t("links.homeOnly"), action: h("a", { class: "btn small", href: "#/network/addresses" }, t("links.homeOnlyHow")) });

/** One link with its address to copy and what may be done with it */
function linkRow(link, base, done) {
  const remove = () => confirmAction({ title: t("links.removeTitle"), lead: t("links.removeLead"), label: t("links.remove"), run: async () => (await api("DELETE", `/api/files/links/${link.id}`), done()) });
  const longer = async () => {
    try {
      await api("PATCH", `/api/files/links/${link.id}`, { hours: 168 });
      done();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  return h(
    "div",
    { class: "stack-s" },
    uiRow({
      lead: { icon: link.dir ? "folder" : "file" },
      name: link.note || t(link.kind === "drop" ? "links.kind.drop" : "links.kind.get"),
      sub: linkWords(link),
      state: uiState(link.alive ? "ok" : "off", t(link.alive ? "links.active" : "links.ended2")),
      action: button(t(link.alive ? "links.week" : "links.again"), { class: "small", onclick: longer }),
      more: [{ label: t("links.remove") + "…", icon: "trash", danger: true, run: remove }],
    }),
    link.alive ? uiCommand(linkUrl(link, base)) : null,
  );
}

/**
 * Making a link for a file or a folder: to look at and download, or (a folder) to send files into.
 * The links already made for it are listed above.
 */
async function shareLinkDialog(path, name, dir, kind = "get") {
  let dialog;
  const made = h("div", { class: "stack-s" });
  const error = h("p", { class: "error", role: "alert" });
  let base = null;
  const load = async () => {
    try {
      const r = await api("GET", `/api/files/links?path=${encodeURIComponent(path)}`);
      base = r.base;
      made.replaceChildren(...(r.links.length ? [h("h3", null, t("links.madeHere")), ...r.links.map((link) => linkRow(link, base, load))] : []));
      homeOnly.replaceChildren(...[linkHomeOnly(base)].filter(Boolean));
    } catch (e) {
      made.replaceChildren(h("p", { class: "error" }, errorText(e)));
    }
  };
  const homeOnly = h("div");
  const hours = h("select", null, LINK_HOURS.map((n) => h("option", { value: n, selected: n === 168 }, t("links.hours." + n))));
  const limit = h("select", null, LINK_LIMITS.map((n) => h("option", { value: n, selected: n === 10 * 1024 ** 3 }, n ? t("links.limitOf", { size: bytes(n) }) : t("links.noLimit"))));
  const password = h("input", { type: "text", autocomplete: "off", spellcheck: false, minLength: 4, maxLength: 200, placeholder: t("links.passwordNone") });
  const note = h("input", { maxLength: 100, placeholder: t("links.notePlaceholder") });
  const limitRow = field(t("links.limit"), limit, t("links.limitHint"));
  const lead = h("p", { class: "muted small" });
  const seg = h("div");
  const shape = () => {
    put(seg, uiSegment(["get", "drop"].map((k) => ({ value: k, label: t("links.kind." + k) })), kind, (k) => ((kind = k), shape()), { wide: true }));
    limitRow.hidden = kind !== "drop";
    lead.textContent = t(kind === "drop" ? "links.dropLead" : dir ? "links.folderLead" : "links.fileLead");
  };
  const make = button(t("links.make"), {
    class: "primary",
    onclick: async () => {
      error.textContent = "";
      make.disabled = true;
      try {
        const r = await api("POST", "/api/files/links", { path, kind, hours: Number(hours.value), password: password.value, note: note.value, limit: Number(limit.value) });
        password.value = "";
        note.value = "";
        await load();
        copyLink(linkUrl(r.link, r.base));
      } catch (e) {
        error.textContent = errorText(e);
      }
      make.disabled = false;
    },
  }, "link");
  dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", { class: "wrap" }, t("links.title", { name })), h("p", { class: "muted small" }, t("links.lead"))), closeX(() => dialog)),
    dir && seg,
    lead,
    field(t("links.time"), hours),
    field(t("links.password"), password, t("links.passwordHint")),
    field(t("links.note"), note, t(kind === "drop" ? "links.noteDropHint" : "links.noteHint")),
    limitRow,
    homeOnly,
    error,
    made,
    h("footer", null, closeButton(() => dialog), make),
  );
  shape();
  await load();
}

/** A new link's address goes to the clipboard at once */
function copyLink(url) {
  try {
    void navigator.clipboard.writeText(url);
    toast(t("links.copied"));
  } catch {
    toast(t("links.madeToast"));
  }
}

/** Every link one may see: the page Links of Files (`#/links`) */
async function loadLinksPage() {
  // the places on the left come with a listing of Files
  if (!state.files && isAdmin()) state.files = await api("GET", "/api/files?path=").catch(() => null);
  if (!isAdmin() && !state.myShares) await loadMine();
  if (state.route.view === "links") renderLinks();
}

function renderLinks() {
  const box = h("div", { id: "links-list" }, uiCard({ title: t("links.side"), lead: t("links.cardLead"), flush: true }, uiEmpty({ size: "loading" })));
  const load = async () => {
    try {
      const { links, base } = await api("GET", "/api/files/links");
      if (state.route.view !== "links") return;
      const folderOf = (link) => (link.dir ? link.path : link.path.slice(0, link.path.lastIndexOf("/")) || "/");
      const row = (link) => {
        const url = linkUrl(link, base);
        const remove = () => confirmAction({ title: t("links.removeTitle"), lead: t("links.removeLead"), label: t("links.remove"), run: async () => (await api("DELETE", `/api/files/links/${link.id}`), load()) });
        const longer = async () => {
          try {
            await api("PATCH", `/api/files/links/${link.id}`, { hours: 168 });
            load();
          } catch (e) {
            toast(errorText(e), "error");
          }
        };
        const more = [
          link.alive && { label: t("links.copy"), icon: "copy", run: () => copyLink(url) },
          { label: t(link.alive ? "links.week" : "links.again"), icon: "clock", run: longer },
          { label: t("links.openFolder"), icon: "folder", href: filesHash(folderOf(link)) },
          { label: t("links.remove") + "…", icon: "trash", danger: true, run: remove },
        ];
        return uiRow({
          lead: { icon: link.dir ? "folder" : "file" },
          name: link.note || link.path.split("/").pop() || "/",
          sub: [link.path, linkWords(link), isAdmin() && link.by.name ? t("links.by", { name: link.by.name }) : null].filter(Boolean).join(" · "),
          state: uiState(link.alive ? "ok" : "off", t(link.alive ? "links.active" : "links.ended2")),
          action: link.alive ? button(t("links.copy"), { class: "small", onclick: () => copyLink(url) }, "copy") : button(t("links.again"), { class: "small", onclick: longer }),
          more: more.filter(Boolean),
          menu: (at) => menuAt(at, null, more.filter(Boolean)),
        });
      };
      put(
        box,
        uiCard(
          { title: t("links.side"), count: links.length || null, lead: t("links.cardLead"), flush: true },
          links.length > 0 && !base && h("div", { class: "ui-inset" }, uiNotice({ tone: "info", text: t("links.homeOnly"), action: h("a", { class: "btn small", href: "#/network/addresses" }, t("links.homeOnlyHow")) })),
          links.length ? links.map(row) : uiEmpty({ size: "big", icon: "link", title: t("links.noneYet"), text: t("links.noneLead") }),
        ),
      );
    } catch (e) {
      put(box, uiCard({ title: t("links.side"), flush: true }, uiEmpty({ size: "error", title: errorText(e), action: button(t("ui.retry"), { onclick: load }) })));
    }
  };
  shell(uiWithSide({ sideId: "files-places", main: [pageHead({ crumbs: [{ label: t("nav.files"), href: "#/files" }, { label: t("links.side") }], title: t("links.cardTitle") }), box] }));
  filesPlaces("#links");
  void load();
}

// --- Access keys of agents (the MCP server) ---------------------------------------------------------

const AGENT_LEVELS = ["read", "operate", "full"];
const mcpAddress = () => `${location.origin}/mcp`;

/** A line of text to take away: shown whole, with a button that copies it */
const copyBox = (text, rows = 1) => uiCommand(text, { block: rows > 1 });

/** The key, shown the only time it can be, with what to paste into the agent */
function agentKeyDialog(made) {
  const url = mcpAddress();
  const command = `claude mcp add --transport http hata ${url} --header "Authorization: Bearer ${made.key}"`;
  const config = JSON.stringify({ mcpServers: { hata: { type: "http", url, headers: { Authorization: `Bearer ${made.key}` } } } }, null, 2);
  // Claude Desktop runs only programs from its file: the bridge mcp-remote speaks HTTP for it. The header
  // comes from a variable, because a space inside an argument is split on Windows
  const bridge = ["-y", "mcp-remote", url, "--header", "Authorization:${HATA_AUTH}", ...(location.protocol === "http:" ? ["--allow-http"] : [])];
  const desktop = JSON.stringify({ mcpServers: { hata: { command: "npx", args: bridge, env: { HATA_AUTH: `Bearer ${made.key}` } } } }, null, 2);
  const dialog = openDialog(
    "wide",
    h("header", null, h("div", { class: "grow" }, h("h2", null, t("agents.made.title", { name: made.info.name })), h("p", { class: "muted small" }, t("agents.made.lead"))), closeX(() => dialog)),
    field(t("agents.made.key"), copyBox(made.key)),
    field(t("agents.made.claude"), copyBox(command, 3), t("agents.made.claudeHint")),
    field(t("agents.made.desktop"), copyBox(desktop, 8), t("agents.made.desktopHint")),
    field(t("agents.made.config"), copyBox(config, 11), t("agents.made.configHint")),
    h("footer", null, button(t("agents.made.done"), { class: "primary", onclick: () => dialog.close() })),
  );
}

// --- The assistant: a chat with a model that works with Hata's tools --------------------------------

const assistantUi = { open: false, panel: null, fab: null, config: null, chats: [], chat: null, timer: 0, waiting: localStorage.getItem("hata.assistant.waiting") ?? "" };
/** Whether the window was open and how big, kept across pages and reloads */
const ASSISTANT_KEY = "hata.assistant";

/** A model's answer as elements: paragraphs, lists, code, bold — built from text, never as markup */
function mdInline(text) {
  const out = [];
  // code, bold, and a link — only to a web address, opened apart
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let at = 0;
  for (let m; (m = pattern.exec(text)); at = pattern.lastIndex) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(m[1] !== undefined ? h("code", null, m[1]) : m[2] !== undefined ? h("strong", null, m[2]) : h("a", { class: "link", href: m[4], target: "_blank", rel: "noopener noreferrer" }, m[3]));
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function md(text) {
  const out = [];
  String(text).split(/```/).forEach((part, i) => {
    // every second part lies between code fences; its first line names the language
    if (i % 2) return out.push(uiCode(part.replace(/^[\w-]*\n/, "").replace(/\n$/, "")));
    let list = null;
    let para = [];
    const flush = () => {
      if (para.length) out.push(h("p", null, para.flatMap((line, n) => (n ? [h("br"), ...mdInline(line)] : mdInline(line)))));
      para = [];
    };
    for (const line of part.split("\n")) {
      const item = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (item) {
        flush();
        const tag = item[1] ? "ol" : "ul";
        if (!list || list.tagName.toLowerCase() !== tag) out.push((list = h(tag)));
        list.append(h("li", null, mdInline(item[2])));
        continue;
      }
      list = null;
      if (heading) {
        flush();
        out.push(h("p", null, h("strong", null, mdInline(heading[1]))));
      } else if (!line.trim()) flush();
      else para.push(line);
    }
    flush();
  });
  return out;
}

/** Questions to begin with: the ones of the page the person is on come first */
function assistantStarts() {
  const v = state.route.view;
  const section = state.route.section;
  const here =
    v === "machines" || v === "machine" || v === "proxmox" ? ["servers.room", "servers.backups", "servers.away"]
    : v === "containers" ? ["containers.use", "containers.backups"]
    : v === "service" ? ["service.state", "service.problem"]
    : v === "ha" || v === "integrations" ? ["ha.batteries", "ha.updates"]
    : v === "app" ? ["app.slow", "app.update"]
    : v === "store" ? ["store.photos", "store.similar"]
    : v === "settings" && STORAGE_SECTIONS.includes(section) ? ["storage.clean", "storage.dying", "storage.protected"]
    : v === "settings" && ["network", "remote", "ports"].includes(section) ? ["network.internet", "network.outside"]
    : v === "settings" && (section === "dns" || section === "adblock") ? ["dns.breaks", "dns.who"]
    : v === "settings" && section === "https" ? ["https.complains"]
    : v === "settings" && section === "backups" ? ["backups.missing", "backups.restore"]
    : ["health", "changed", "backups.missing"];
  return [...here, "health", "updates", "space"].filter((key, i, all) => all.indexOf(key) === i).slice(0, 5).map((key) => "assistant.start." + key);
}

const toolTarget = (target) => String(target?.name ?? target?.app ?? target?.host ?? target?.guest ?? target?.id ?? "");

/** What a call of the assistant does, in the page's words */
function toolWords(call) {
  const key = `assistant.tool.${call.name}${call.name === "app_remove" && call.args.deleteData === true ? ".data" : ""}`;
  const a = call.args ?? {};
  // what a person is asked to allow is worded: `reboot` and `true` are the tool's values, not words
  const said = Object.fromEntries(Object.entries(a).filter(([, value]) => typeof value !== "object").map(([name, value]) => [name, has(`assistant.value.${value}`) ? t(`assistant.value.${value}`) : String(value)]));
  return has(key) ? t(key, { ...said, app: String(a.app ?? a.name ?? ""), query: String(a.query ?? ""), snapshot: String(a.snapshot ?? ""), target: toolTarget(a.target) }) : call.name;
}

async function assistantCall(path, data = {}) {
  try {
    const chat = await api("POST", path, data);
    if (chat?.turns) assistantUi.chat = chat;
  } catch (e) {
    toast(errorText(e), "error");
  }
  paintAssistant();
}

async function sendToAssistant(text, fresh = false) {
  const words = text.trim();
  if (!words) return;
  const chat = fresh ? null : assistantUi.chat;
  await assistantCall(chat ? `/api/assistant/chats/${chat.id}` : "/api/assistant/chats", { text: words });
  void loadAssistant(true);
}

function assistantBody() {
  const chat = assistantUi.chat;
  if (!assistantUi.config) return [waitMark()];
  if (!assistantUi.config.ready) {
    // asked before there is a model: what it would do, how to give it one, and the question kept for then
    return [
      uiProse([
        h("p", null, t("assistant.notSet")),
        h("p", { class: "muted small" }, t("assistant.notSetHint")),
        h("p", { class: "small" }, t("assistant.canDo")),
        h("ul", { class: "small muted" }, ["apps", "machines", "network", "backups", "changes"].map((k) => h("li", null, t("assistant.can." + k)))),
        assistantUi.waiting && uiMessage("user", assistantUi.waiting),
        assistantUi.waiting && h("p", { class: "muted small" }, t("assistant.waitingQuestion")),
        h("a", { class: "btn primary", href: "#/settings/assistant", onclick: () => innerWidth < 900 && closeAssistant() }, t("assistant.setUp")),
      ]),
    ];
  }
  if (!chat) {
    const ask = (key) => button(t(key), { class: "small", onclick: () => sendToAssistant(t(key), true) });
    return [uiProse([h("p", null, t("assistant.hello")), h("p", { class: "muted small" }, t("assistant.helloHint")), uiLine(assistantStarts().map(ask))])];
  }
  const results = new Map(chat.turns.filter((turn) => turn.role === "tool").map((turn) => [turn.id, turn]));
  const callRow = (call) => {
    const result = results.get(call.id);
    if (call.state === "asking") {
      const detail = typeof call.args.compose === "string" ? call.args.compose : Object.keys(call.args).some((k) => !["app", "name", "deleteData", "snapshot"].includes(k)) ? JSON.stringify(call.args, null, 1) : "";
      return uiNotice({
        tone: "info",
        icon: "chat",
        title: t("assistant.wants", { what: toolWords(call) }),
        text: detail && uiCode(detail),
        foot: uiLine([button(t("approvals.decline"), { class: "small", onclick: () => assistantCall(`/api/assistant/chats/${chat.id}/calls/${call.id}`, { run: false }) }), button(t("assistant.run"), { class: "small primary", onclick: () => assistantCall(`/api/assistant/chats/${chat.id}/calls/${call.id}`, { run: true }) }, "play")]),
      });
    }
    const mark = !result ? icon("refresh", "spin") : icon(result.error ? "x" : "check", result.error ? "danger" : "");
    // what the tool answered is there to look at: nothing the assistant saw is hidden from the person
    return uiDetails([mark, h("span", null, result?.declined || call.state === "declined" ? t("assistant.declined", { what: toolWords(call) }) : toolWords(call))], result && !result.declined && uiCode(result.text));
  };
  const rows = chat.turns.flatMap((turn) => {
    if (turn.role === "user") return [uiMessage("user", turn.text)];
    if (turn.role === "assistant") return [turn.text && uiMessage("bot", md(turn.text)), ...turn.calls.map(callRow)];
    return [];
  });
  if (chat.status === "thinking") rows.push(uiLine([icon("refresh", "spin"), h("span", { class: "grow muted" }, t("assistant.thinking")), button(t("assistant.stop"), { class: "small", onclick: () => assistantCall(`/api/assistant/chats/${chat.id}/stop`) })]));
  if (chat.status === "error") {
    const key = "error.assistant." + chat.error?.code;
    rows.push(uiNotice({ tone: "bad", title: has(key) ? t(key) : null, text: chat.error?.message ?? "", action: button(t("assistant.retry"), { class: "small", onclick: () => assistantCall(`/api/assistant/chats/${chat.id}`, { retry: true }) }, "refresh") }));
  }
  return rows;
}

function paintAssistant() {
  const panel = assistantUi.panel;
  if (!panel) return;
  const { chat, chats } = assistantUi;
  const pick = h(
    "select",
    { "aria-label": t("assistant.chats"), onchange: (e) => (e.target.value ? void loadAssistantChat(e.target.value) : ((assistantUi.chat = null), paintAssistant())) },
    h("option", { value: "", selected: !chat }, t("assistant.newChat")),
    chats.map((c) => h("option", { value: c.id, selected: c.id === chat?.id }, c.title)),
  );
  // the chat on the screen comes back after a reload
  if (chat) localStorage.setItem(ASSISTANT_KEY + ".chat", chat.id);
  else localStorage.removeItem(ASSISTANT_KEY + ".chat");
  const wide = panel.classList.contains("wide");
  const tool = (label, name, onclick, cls = "") => h("button", { type: "button", class: "icon-btn " + cls, title: label, "aria-label": label, onclick }, icon(name));
  const parts = assistantUi.parts;
  const fresh = () => ((assistantUi.chat = null), paintAssistant(), panel.querySelector("textarea").focus());
  // wide, the chats are a column on the left; narrow, a list in the head
  const listed = !phone.matches && chats.length > 0;
  panel.classList.toggle("ui-chat-listed", listed);
  put(
    parts.list,
    listed && [
      button(t("assistant.newChat"), { class: "small" + (chat ? "" : " primary"), onclick: fresh }, "plus"),
      uiNavList(chats.map((c) => ({ name: c.title, sub: ago(c.updatedAt), dot: c.status === "asking", current: c.id === chat?.id, onclick: () => void loadAssistantChat(c.id) }))),
    ],
  );
  const title = chats.find((c) => c.id === chat?.id)?.title ?? (chat ? "" : t("assistant.newChat"));
  put(
    parts.head,
    // with chats to choose from the list names the one on the screen; otherwise the window says what it is
    listed ? h("strong", { class: "grow clip" }, title) : chats.length > 0 ? h("span", { class: "grow" }, pick) : h("strong", { class: "grow" }, t("assistant.title")),
    chat && !listed && tool(t("assistant.newChat"), "plus", fresh),
    chat && tool(t("assistant.forget"), "trash", () => confirmAction({ title: t("assistant.forgetTitle"), lead: t("assistant.forgetLead"), label: t("assistant.forget"), run: forgetAssistantChat })),
    tool(t(wide ? "assistant.narrow" : "assistant.wide"), wide ? "shrink" : "expand", () => (panel.classList.toggle("wide"), rememberAssistant(), paintAssistant()), "ui-chat-wide-only"),
    tool(t("assistant.hide"), "down", closeAssistant),
  );
  const body = parts.body;
  // new words are followed down the panel unless the person has scrolled up to read
  const follow = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  put(body, assistantBody());
  if (follow) body.scrollTop = body.scrollHeight;
  const busy = chat?.status === "thinking" || chat?.status === "asking";
  parts.form.hidden = !assistantUi.config?.ready;
  // a question asked before the assistant was set up waits in the field once it is
  if (assistantUi.config?.ready && assistantUi.waiting) {
    const input = panel.querySelector("textarea");
    if (!input.value.trim()) input.value = assistantUi.waiting;
    keepWaiting("");
  }
  parts.form.querySelector("button").disabled = busy;
}

async function loadAssistantChat(id) {
  assistantUi.chat = await api("GET", `/api/assistant/chats/${id}`).catch(() => null);
  // the list keeps up with the chat on the screen, for the dot on the button
  const listed = assistantUi.chats.find((c) => c.id === id);
  if (listed && assistantUi.chat) listed.status = assistantUi.chat.status;
  markAssistantFab();
  paintAssistant();
}

async function loadAssistant(keep = false) {
  if (!hasModule("assistant")) return;
  try {
    const data = await api("GET", "/api/assistant");
    assistantUi.config = data.config;
    assistantUi.chats = data.chats;
    if (state.overview) state.overview.assistant = data.config.ready;
  } catch {}
  markAssistantFab();
  if (!keep && assistantUi.chat) return loadAssistantChat(assistantUi.chat.id);
  paintAssistant();
}

async function forgetAssistantChat() {
  const { chat } = assistantUi;
  if (!chat) return;
  await api("DELETE", `/api/assistant/chats/${chat.id}`).catch((e) => toast(errorText(e), "error"));
  assistantUi.chat = null;
  void loadAssistant();
}

/** The round button in the corner of every page: opens the window, and shows when a change waits for a word */
function assistantFab() {
  // the module is off: the button goes with it
  if (!hasModule("assistant")) {
    if (assistantUi.open) closeAssistant();
    assistantUi.fab?.remove();
    assistantUi.fab = null;
    return;
  }
  if (!isAdmin()) return;
  if (!assistantUi.fab) {
    assistantUi.fab = uiFab({ icon: "chat", label: t("assistant.title"), onclick: () => (assistantUi.open ? closeAssistant() : openAssistant()) });
    document.body.append(assistantUi.fab);
    // a window left open stays open after a reload; otherwise only the list of chats is asked for, for the dot
    if (localStorage.getItem(ASSISTANT_KEY) && state.route.view !== "assistant") {
      const last = localStorage.getItem(ASSISTANT_KEY + ".chat");
      if (last) assistantUi.chat = { id: last };
      openAssistant({ restore: true });
    }
    else void loadAssistant(true);
  }
}

/** The dot on the button: some chat of this person waits for a yes or no */
function markAssistantFab() {
  const dot = assistantUi.fab?.lastChild;
  if (!dot) return;
  dot.hidden = !assistantUi.chats.some((c) => c.status === "asking");
  assistantUi.fab.classList.toggle("ui-fab-open", assistantUi.open);
}

function keepWaiting(text) {
  assistantUi.waiting = text;
  if (text) localStorage.setItem("hata.assistant.waiting", text);
  else localStorage.removeItem("hata.assistant.waiting");
}

const rememberAssistant = () => (assistantUi.open ? localStorage.setItem(ASSISTANT_KEY, assistantUi.panel?.classList.contains("wide") ? "wide" : "open") : localStorage.removeItem(ASSISTANT_KEY));

/** The window of the assistant, made once: floating over the pages, or the whole page #/assistant */
function assistantPanel() {
  if (!assistantUi.panel) {
    const input = h("textarea", { rows: 2, maxLength: 20000, placeholder: t("assistant.placeholder"), "aria-label": t("assistant.placeholder") });
    const submit = () => {
      const text = input.value;
      if (!text.trim() || form.querySelector("button").disabled) return;
      input.value = "";
      void sendToAssistant(text);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    const form = h("form", { onsubmit: (e) => (e.preventDefault(), submit()) }, input, h("button", { class: "btn primary square", "aria-label": t("assistant.send"), title: t("assistant.send") }, icon("arrow")));
    assistantUi.parts = uiChat({ label: t("assistant.title"), wide: localStorage.getItem(ASSISTANT_KEY) === "wide", form });
    assistantUi.parts.list.setAttribute("aria-label", t("assistant.chats"));
    assistantUi.panel = assistantUi.parts.el;
  }
  return assistantUi.panel;
}

/** Opens the window; `ask` is sent as the first words of a new chat, `draft` is put into the field */
function openAssistant({ ask, draft, restore } = {}) {
  const panel = assistantPanel();
  // on its own page the window is the page; elsewhere it floats
  if (state.route.view !== "assistant" && panel.parentElement !== document.body) document.body.append(panel);
  assistantUi.open = true;
  assistantUi.panel.hidden = false;
  rememberAssistant();
  markAssistantFab();
  const input = assistantUi.panel.querySelector("textarea");
  if (ask) assistantUi.chat = null;
  if (draft) input.value = draft;
  paintAssistant();
  void loadAssistant().then(() => {
    if (assistantUi.config?.ready) return ask && sendToAssistant(ask, true);
    if (ask || draft) {
      keepWaiting(ask || draft);
      paintAssistant();
    }
  });
  // a window put back after a reload does not take the keyboard from the page
  if (!restore) input.focus();
}

function closeAssistant() {
  assistantUi.open = false;
  if (assistantUi.panel) assistantUi.panel.hidden = true;
  rememberAssistant();
  markAssistantFab();
}

/** The server says a chat moved on: the one on the screen is read again */
function assistantEvent(event) {
  if (event.owner !== state.user?.id) return;
  // with the window hidden, only the dot on the button follows
  if (!assistantUi.open) {
    clearTimeout(assistantUi.timer);
    assistantUi.timer = setTimeout(() => void loadAssistant(true), 300);
    return;
  }
  clearTimeout(assistantUi.timer);
  assistantUi.timer = setTimeout(() => {
    if (assistantUi.chat?.id === event.chat) void loadAssistantChat(event.chat);
    else if (!assistantUi.chat) void loadAssistant(true);
  }, 120);
}

function assistantSection() {
  const config = state.assistant?.config;
  if (!config) return waitMark();
  const provider = h("select", null, ["anthropic", "openai"].map((id) => h("option", { value: id, selected: id === config.provider }, t("assistant.provider." + id))));
  const url = h("input", { type: "url", class: "mono", value: config.url, spellcheck: false });
  const urlHint = h("span");
  const key = h("input", { type: "password", autocomplete: "off", class: "mono", placeholder: config.saved ? t("assistant.keySaved") : "" });
  const models = h("datalist", { id: "assistant-models" });
  const model = h("input", { class: "mono", value: config.model, spellcheck: false, required: true });
  model.setAttribute("list", "assistant-models");
  const level = h("select", null, AGENT_LEVELS.map((id) => h("option", { value: id, selected: id === config.level }, t("agents.level." + id))));
  const levelHint = h("span");
  const error = h("p", { class: "error", role: "alert" });
  const paint = () => {
    url.placeholder = config.defaults[provider.value];
    urlHint.textContent = t(`assistant.url.${provider.value}`);
    levelHint.textContent = `${t(`agents.level.${level.value}.hint`)} ${t(level.value === "full" ? "assistant.level.full" : "assistant.level.asks")}`;
  };
  provider.addEventListener("change", paint);
  level.addEventListener("change", paint);
  paint();
  const draft = () => ({ provider: provider.value, url: url.value.trim(), key: key.value.trim(), model: model.value.trim(), level: level.value });
  const find = button(t("assistant.findModels"), {
    class: "small",
    onclick: async () => {
      error.textContent = "";
      find.disabled = true;
      try {
        const { models: names } = await api("POST", "/api/assistant/models", draft());
        put(models, names.map((name) => h("option", { value: name })));
        toast(t("assistant.modelsFound", { n: names.length }));
        model.focus();
      } catch (e) {
        error.textContent = [errorText(e), e.detail?.message].filter(Boolean).join(" — ");
      }
      find.disabled = false;
    },
  });
  return [
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            state.assistant = { ...state.assistant, ...(await api("PUT", "/api/assistant/config", draft())) };
            if (state.overview) state.overview.assistant = state.assistant.config.ready;
            assistantUi.config = state.assistant.config;
            toast(t("settings.saved"));
            renderSettings();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      uiCard(
        { title: t("assistant.title"), lead: t("assistant.lead"), actions: config.ready && button(t("assistant.open"), { class: "small", onclick: () => openAssistant() }, "chat") },
        uiField(t("assistant.provider"), provider),
        uiField(t("assistant.url"), url, urlHint),
        uiField(t("assistant.key"), key, t("assistant.keyHint")),
        uiField(t("assistant.model"), [uiAffix(model, find), models], t("assistant.modelHint"), { group: true }),
        uiField(t("agents.new.level"), level, levelHint),
        error,
        h("p", { class: "muted small" }, t("assistant.privacy")),
        uiFoot(h("button", { class: "btn primary" }, t("settings.save"))),
      ),
    ),
  ];
}

// --- A connector that signs in: the administrator's answer ------------------------------------------

/** Where the connector is sent back to, in words a person can judge */
function connectWhere(redirect) {
  try {
    const url = new URL(redirect);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return t("connect.where.local");
    return /^https?:$/.test(url.protocol) ? url.host : t("connect.where.app", { scheme: url.protocol.slice(0, -1) });
  } catch {
    return redirect;
  }
}

function renderConnect() {
  const { id } = state.route;
  const box = uiCard({}, waitMark());
  shell(uiNarrow(box));
  const say = (text) => put(box, h("p", null, text), h("p", null, h("a", { class: "btn", href: "#/settings/agents" }, t("settings.agents"))));
  if (!isAdmin()) return put(box, h("p", null, t("connect.adminOnly")));
  const leave = async (answer, error) => {
    try {
      const { redirect } = await api("POST", `/api/oauth/requests/${id}`, answer);
      say(t(answer.allow ? "connect.done" : "connect.declined"));
      if (redirect) location.href = redirect;
    } catch (e) {
      if (e.code === "oauth.gone") say(t("error.oauth.gone"));
      else error.textContent = errorText(e);
    }
  };
  api("GET", `/api/oauth/requests/${id}`).then(
    (q) => {
      const level = h("select", null, AGENT_LEVELS.map((value) => h("option", { value, selected: value === (q.level || "read") }, t("agents.level." + value))));
      const hint = h("span");
      const confirm = h("input", { type: "checkbox", checked: true });
      const asks = uiCheck(t("agents.confirm"), confirm);
      const paint = () => {
        hint.textContent = t(`agents.level.${level.value}.hint`);
        asks.hidden = level.value !== "full";
      };
      level.addEventListener("change", paint);
      paint();
      const password = h("input", { type: "password", autocomplete: "current-password", required: true });
      const name = h("input", { type: "text", maxlength: 40, value: q.name.slice(0, 40), autocomplete: "off" });
      const error = h("p", { class: "error", role: "alert" });
      put(
        box,
        h(
          "form",
          {
            class: "stack-s",
            onsubmit: (e) => {
              e.preventDefault();
              void leave({ allow: true, name: name.value, level: level.value, confirm: level.value === "full" && confirm.checked, password: password.value }, error);
            },
          },
          h("h2", null, t("connect.asks", { name: q.name })),
          h("p", null, t("connect.lead")),
          uiField(t("connect.where"), h("strong", { class: "mono wrap" }, connectWhere(q.redirect)), t("connect.whereHint"), { group: true }),
          h("p", { class: "muted small" }, t("connect.warn")),
          field(t("connect.name"), name, t("connect.nameHint")),
          uiField(t("agents.new.level"), level, hint),
          asks,
          field(t("connect.password"), password, t("connect.passwordHint")),
          error,
          uiFoot(button(t("approvals.decline"), { onclick: () => leave({ allow: false }, error) }), h("button", { class: "btn primary" }, t("connect.allow"))),
        ),
      );
    },
    (e) => say(e.code === "oauth.gone" ? t("error.oauth.gone") : errorText(e)),
  );
}

// --- Calls of agents that wait for an administrator's word ------------------------------------------

let askDialog = null;
/** Requests already shown in a dialog: one put off with "Later" waits in Settings → Agents */
const asksShown = new Set();

function askedWhat(ask) {
  const key = `approvals.what.${ask.tool}${ask.tool === "app_remove" && ask.args.deleteData === true ? ".data" : ""}`;
  if (has(key)) return t(key, { app: String(ask.args.app ?? ""), snapshot: String(ask.args.snapshot ?? "") });
  return has(`assistant.tool.${ask.tool}`) ? toolWords({ name: ask.tool, args: ask.args }) : ask.title;
}

async function answerAsk(ask, allow) {
  try {
    await api("POST", `/api/approvals/${ask.id}`, { allow });
  } catch (e) {
    toast(errorText(e), "error");
  }
  void loadApprovals();
}

async function loadApprovals() {
  if (!isAdmin() || !hasModule("assistant")) return;
  state.approvals = await api("GET", "/api/approvals").catch(() => state.approvals ?? []);
  // answered on another device, or lapsed
  if (askDialog && !state.approvals.some((ask) => ask.id === askDialog.ask)) askDialog.close();
  const next = state.approvals.find((ask) => !asksShown.has(ask.id));
  if (next && !askDialog) approvalDialog(next);
  if (state.route.view === "settings" && showsSection("agents")) renderSettings();
}

function approvalDialog(ask) {
  asksShown.add(ask.id);
  const answer = (allow) =>
    button(t(allow ? "approvals.allow" : "approvals.decline"), {
      class: allow ? "danger" : "",
      onclick: () => {
        dialog.close();
        void answerAsk(ask, allow);
      },
    });
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("approvals.title", { agent: ask.agent })),
    h("p", null, t("approvals.text", { what: askedWhat(ask) })),
    typeof ask.args.compose === "string" && uiCode(ask.args.compose),
    h("p", { class: "muted small" }, t("approvals.hint")),
    h("footer", null, closeButton(() => dialog, t("approvals.later")), answer(false), answer(true)),
  );
  dialog.ask = ask.id;
  askDialog = dialog;
  dialog.addEventListener("close", () => {
    askDialog = null;
    const next = (state.approvals ?? []).find((other) => !asksShown.has(other.id));
    if (next) approvalDialog(next);
  });
}

function agentDialog() {
  const name = h("input", { maxLength: 40, required: true, placeholder: t("agents.new.namePlaceholder") });
  const level = h("select", null, AGENT_LEVELS.map((id) => h("option", { value: id }, t("agents.level." + id))));
  const hint = h("span", null, t("agents.level.read.hint"));
  const confirm = h("input", { type: "checkbox", checked: true });
  const asks = uiCheck(t("agents.confirm"), confirm);
  asks.hidden = true;
  level.addEventListener("change", () => {
    hint.textContent = t(`agents.level.${level.value}.hint`);
    asks.hidden = level.value !== "full";
  });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const made = await api("POST", "/api/agents", { name: name.value.trim(), level: level.value, confirm: level.value === "full" && confirm.checked });
            dialog.close();
            agentKeyDialog(made);
            void loadSettings();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("agents.new")), h("p", { class: "muted small" }, t("agents.new.lead"))), closeX(() => dialog)),
      field(t("agents.new.name"), name, t("agents.new.nameHint")),
      uiField(t("agents.new.level"), level, hint),
      asks,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("agents.new.create"))),
    ),
  );
  name.focus();
}

function renameAgentKey(key) {
  const input = h("input", { value: key.name, required: true, maxLength: 40, spellcheck: false, autocomplete: "off" });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "confirm",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await api("PATCH", `/api/agents/${key.id}`, { name: input.value.trim() });
            dialog.close();
            void loadSettings();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, t("agents.rename.title", { name: key.name })),
      h("p", { class: "muted" }, t("agents.rename.lead")),
      input,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("agents.rename"))),
    ),
  );
  input.focus();
  input.select();
}

function removeAgentKey(key) {
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("agents.remove.title", { name: key.name })),
    h("p", { class: "muted" }, t("agents.remove.lead")),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("agents.remove"), {
        class: "danger",
        onclick: async () => {
          await api("DELETE", `/api/agents/${key.id}`).catch((e) => toast(errorText(e), "error"));
          dialog.close();
          void loadSettings();
        },
      }),
    ),
  );
}

function agentsSection() {
  const keys = state.agents;
  if (!keys) return waitMark();
  const row = (key) => {
    const confirm =
      key.level === "full" &&
      uiSwitch({
        on: key.confirm,
        label: t("agents.confirm"),
        onchange: async (on) => {
          await api("PATCH", `/api/agents/${key.id}`, { confirm: on }).catch((err) => toast(errorText(err), "error"));
          void loadSettings();
        },
      });
    return uiRow({
      lead: { icon: "key" },
      name: h("span", null, key.name, " ", uiTag(t("agents.level." + key.level))),
      sub: [key.via ? t("agents.via", { client: key.via }) : `hata_…${key.hint}`, t("agents.createdBy", { user: key.createdBy, when: ago(key.createdAt) }), key.lastUsed ? t("agents.lastUsed", { when: ago(key.lastUsed), ip: key.lastIp }) : t("agents.neverUsed")].join(" · "),
      value: confirm && uiLine([h("span", { class: "small muted" }, t("agents.confirm.short")), confirm]),
      more: [{ label: t("agents.rename"), icon: "edit", run: () => renameAgentKey(key) }, { label: t("agents.remove") + "…", icon: "trash", danger: true, run: () => removeAgentKey(key) }],
    });
  };
  const waiting = state.approvals ?? [];
  return [
    waiting.length > 0 &&
      uiCard(
        { title: t("approvals.waiting"), count: waiting.length, lead: t("approvals.hint"), flush: true },
        waiting.map((ask) =>
          uiRow({
            lead: { icon: "alert", tone: "warn" },
            name: ask.agent,
            sub: [t("approvals.text", { what: askedWhat(ask) }), ago(ask.at)].join(" · "),
            action: uiLine([typeof ask.args.compose === "string" && button(t("approvals.look"), { class: "small", onclick: () => approvalDialog(ask) }, "eye"), button(t("approvals.decline"), { class: "small", onclick: () => answerAsk(ask, false) }), button(t("approvals.allow"), { class: "small danger", onclick: () => answerAsk(ask, true) })]),
          }),
        ),
      ),
    uiCard({ title: t("agents.title"), count: keys.length || null, lead: t("agents.lead"), flush: true, actions: button(t("agents.new"), { class: "small primary", onclick: agentDialog }, "plus") }, keys.length ? keys.map(row) : uiEmpty({ text: t("agents.none") })),
    uiCard(
      { title: t("agents.how.title"), lead: t("agents.how.address") },
      uiCommand(mcpAddress()),
      location.protocol === "http:" && uiNotice({ tone: "info", text: t("agents.how.plain") }),
      h("p", { class: "muted small" }, t("agents.how.signin")),
    ),
    uiCard({ title: t("agents.levels.title") }, ...AGENT_LEVELS.map((id) => uiSetting({ name: t("agents.level." + id), explain: t(`agents.level.${id}.hint`), control: null })), uiNotice({ tone: "warn", text: t("agents.never") })),
  ];
}

function renderSettings() {
  const ready = state.account && (state.settings || !isAdmin());
  // a tab may hold two sections; the second of a module that is off is simply not there
  const body = ready ? state.route.sections.flatMap((id, i) => (i && SECTION_MODULE[id] && !hasModule(SECTION_MODULE[id]) ? [] : settingsSection(id))) : waitMark();
  shell(...settingsFrame(state.route.section, body));
}

/**
 * The head of a section of the page: a card with its name, a line about it, what can be done there, and its tabs.
 * `metaId` / `actionsId` name the line and the buttons for a page that fills them later.
 */
/** The way to the store from the head of a section: the same button wherever it stands; `category` opens one of its parts */
function storeButton(category = "") {
  return h("a", { class: "btn primary", href: "#/store", onclick: () => (state.storeFilter.category = category) }, icon("store"), h("span", null, t("area.apps.store")));
}

/** The name of a page of Integrations: its tab's, or a connected service's kind */
const houseLabel = (tabs, at) => tabs.find((tab) => tab.id === at)?.label ?? (at.startsWith("x-") ? (svcConnections().find((c) => c.kind === at.slice(2))?.title ?? at.slice(2)) : t(`area.house.${at}`));
function areaHead(area, at, { meta = null, metaId = null, actions = null, actionsId = null, search = null, more = null } = {}) {
  const tabs = areaTabs(area);
  const headTab = tabs.find((tab) => tab.head);
  const shown = tabs.filter((tab) => !tab.head);
  const tabsNav = tabs.length > 1 && area !== "house" && uiTabs(shown.map((tab) => ({ label: tab.label ?? t(`area.${area}.${tab.id}`), href: tabHash(area, tab), active: tab.id === at, count: area === "server" ? serverTabNumber(tab.id) || null : null })));
  // this server's numbers may come after the head was drawn: its tabs are kept to be counted again
  if (area === "server" && tabsNav) serverTabs = new Map(shown.map((tab, i) => [tab.id, tabsNav.children[i]]));
  if (area === "server")
    return pageHead({
      cls: "ui-area-head",
      crumbs: [{ label: t("nav.machines"), href: "#/machines" }, { label: t("tree.thisServer") }],
      icon: "server",
      title: state.overview?.system?.hostname ?? t("tree.thisServer"),
      state: uiState("ok", t("status.running")),
      facts: [h("span", { id: "server-meta" }, serverMeta())],
      actions: [{ label: t("terminal.title"), icon: "terminal", href: "#/terminal" }, { label: t("power.restart") + "…", icon: "refresh", run: () => serverPowerDialog("reboot") }],
      more: serverMenuEntries,
      menu: serverMenu,
      tabs: tabsNav,
    });
  // Integrations has no tabs: its overview lists everything, a page of one leads back to it
  if (area === "house" && at !== "overview") return pageHead({ cls: "ui-area-head", crumbs: [{ label: t("area.house"), href: "#/house" }, { label: houseLabel(tabs, at) }] });
  const own = [].concat(actions ?? []).filter(Boolean);
  return pageHead({
    cls: "ui-area-head",
    title: t("area." + area),
    facts: [meta ?? t(`area.${area}.lead`)],
    factsId: metaId,
    actions: [...own, headTab && at !== headTab.id && storeButton()],
    actionsId,
    search,
    more: more || null,
    tabs: tabsNav,
  });
}

/** What stands under this server's name: the system, the address, how long it has been up */
function serverMeta() {
  const here = treeUi.data?.groups.find((g) => g.kind === "here");
  const up = state.overview?.system?.uptime;
  const line = [t("tree.thisServer"), here?.os, here?.address || location.hostname, up ? t("sys.uptime", { time: duration(up) }) : null].filter(Boolean).join(" · ");
  const made = hardwareWords(here?.hardware);
  return made ? h("span", { class: "stack-s" }, h("span", null, line), h("span", null, made)) : line;
}

/** What a computer is made of, in one line: the processor, cores and threads, the memory and its modules */
function hardwareWords(hw) {
  if (!hw) return "";
  // modules come in whole gigabytes: "8 GB", not "8.0 GB"
  const round = (n) => bytes(n).replace(/\.0(?= )/, "");
  const cores = hw.threads ? t(hw.cores === hw.threads ? "hw.cores" : "hw.coresThreads", { cores: hw.cores, threads: hw.threads }) : "";
  // equal modules are said once: "2 × 8 GB DDR3 1600 MHz"
  const kinds = new Map();
  for (const m of hw.modules ?? []) {
    const words = [round(m.size), m.type, m.speed ? t("hw.mhz", { n: m.speed }) : ""].filter(Boolean).join(" ");
    kinds.set(words, (kinds.get(words) ?? 0) + 1);
  }
  const modules = [...kinds].map(([words, n]) => `${n} × ${words}`).join(", ");
  const total = (hw.modules ?? []).reduce((sum, m) => sum + m.size, 0) || hw.memory;
  const memory = total ? t("hw.memory", { size: round(total) }) + (modules ? ` (${modules}${hw.slots > hw.modules.length ? ", " + t("hw.slots", { n: hw.modules.length, all: hw.slots }) : ""})` : "") : "";
  return [hw.cpu, cores, memory].filter(Boolean).join(" · ");
}
const paintServerMeta = () => document.getElementById("server-meta")?.replaceChildren(serverMeta());
/** The numbers by the tabs of this server: apps, containers, packages that wait */
/** The numbers by this server's tabs again: what they count may come after the head was drawn */
let serverTabs = new Map();
function paintServerTabCounts() {
  for (const [id, a] of serverTabs) {
    if (!a.isConnected) continue;
    a.querySelector(".ui-tab-count")?.remove();
    const n = serverTabNumber(id);
    if (n) a.append(h("span", { class: "ui-tab-count" }, String(n)));
  }
}
const serverTabNumber = (id) => (id === "apps" ? (state.overview?.apps?.length ?? 0) : id === "containers" ? (incusUi.data?.containers?.length ?? 0) : id === "system" ? (sysUpdates[""]?.list?.length ?? 0) : 0);
/**
 * The server renamed: one name for the computer itself and for the home network. Opened from the
 * server's menu and from the card of the name on the home network — one window for both.
 */
function renameServerDialog(done) {
  let dialog;
  const local = state.settings?.local?.name ?? "";
  const ending = local.includes(".") ? local.slice(local.indexOf(".")) : ".local";
  const host = state.overview?.system?.hostname?.split(".")[0] ?? local.split(".")[0] ?? "";
  const name = h("input", { value: host, maxLength: 253, spellcheck: false, autocapitalize: "none", class: "mono", required: true, "aria-label": t("rename.name") });
  const will = h("p", { class: "muted small" });
  const error = h("p", { class: "error", role: "alert" });
  const typed = () => name.value.trim().toLowerCase();
  const address = () => (typed().includes(".") ? typed() : typed() + ending);
  const say = () => (will.textContent = typed() ? t("rename.will", { address: address() }) : "");
  name.oninput = say;
  say();
  // a copy to a network folder is going on: said once, and the next press renames all the same
  let anyway = false;
  const save = async (e) => {
    e.preventDefault();
    error.textContent = "";
    const go = e.submitter;
    if (go) go.disabled = true;
    try {
      const said = await api("PUT", "/api/system/name", { name: typed(), anyway });
      state.settings = said.settings;
      if (state.overview?.system) state.overview.system.hostname = said.host;
      dialog.close();
      toast(t("rename.done", { name: said.host }));
      // the page was opened by the old name: that address answers no longer
      if (local && (location.hostname === local || location.hostname.endsWith("." + local)) && said.local !== local) return void setTimeout(() => (location.href = location.href.replace(local, said.local)), 1500);
      await refresh();
      done?.();
    } catch (err) {
      error.textContent = errorText(err);
      if (go) go.disabled = false;
      if (err instanceof ApiError && err.code === "system.renameCopying") {
        anyway = true;
        if (go) go.querySelector("span").textContent = t("rename.anyway");
      }
    }
  };
  dialog = openDialog(
    "confirm",
    h("form", { class: "stack", onsubmit: save }, h("h2", null, t("rename.title")), h("p", { class: "muted" }, t("rename.lead")), name, will, local && h("p", { class: "muted small" }, t("rename.old", { address: local })), error, h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, h("span", null, t("rename.save"))))),
  );
  name.focus();
  name.select();
}

const serverMenuEntries = () => [
  { label: t("rename.open"), icon: "edit", run: () => renameServerDialog() },
  { label: t("terminal.title"), icon: "terminal", href: "#/terminal" },
  { label: t("area.network"), icon: "network", href: "#/network" },
  { label: t("power.reboot"), icon: "refresh", run: () => serverPowerDialog("reboot") },
  { label: t("power.poweroff"), icon: "stop", danger: true, run: () => serverPowerDialog("poweroff") },
];
function serverMenu(at) {
  menuAt(at, menuHeader(state.overview?.system?.hostname ?? t("tree.thisServer"), t("tree.thisServer"), "server"), serverMenuEntries());
}

// --- This server: a computer like the others, with a page of its own ---------------------------------

function renderServer() {
  const apps = state.route.tab === "apps";
  shell(areaHead("server", state.route.tab), h("div", { class: "stack", id: apps ? "apps-body" : "server-body" }));
  if (apps) return renderAppsBody();
  renderServerBody();
  if (!sysUpdates[""]) void loadSysUpdates("").then(() => state.route.view === "server" && renderServerBody());
  if (!state.backups) void api("GET", `/api/backups?lang=${state.lang}`).then((b) => ((state.backups = b), state.route.view === "server" && renderServerBody())).catch(() => {});
}

function renderServerBody() {
  const box = document.getElementById("server-body");
  if (!box) return;
  if (!box.childElementCount) {
    put(
      box,
      uiCard({ flush: true }, h("div", { class: "ui-stats" }, ownKpis("stat")), h("div", { class: "ui-trend", id: "own-trend" })),
      uiColumns(h("div", { class: "stack", id: "server-main" }), h("div", { class: "stack", id: "server-side" })),
    );
  }
  renderSystem();
  const o = state.overview;
  const more = (hash, label) => h("a", { class: "ui-link", href: hash }, label, icon("chevron"));
  const d = hasModule("containers") ? incusUi.data : null;
  const apps = o?.apps ?? [];
  const row = (c) =>
    uiRow({
      name: c.name,
      sub: [t("tree.kind." + c.kind), c.os, c.address].filter(Boolean).join(" · "),
      state: uiState(c.status === "running" ? "ok" : c.status === "error" ? "bad" : "off", t("incus.status." + c.status)),
      action: c.status !== "running" && button(t("incus.start"), { class: "small", onclick: (e) => containerAct(c, "start", e.currentTarget) }, "play"),
      href: `#/containers/i/${c.name}`,
      menu: (at) => containerMenu(c, at),
    });
  put(
    document.getElementById("server-main"),
    d?.state === "ready" &&
      uiCard(
        { title: t("area.server.containers"), count: d.containers.length, actions: [button(t("server.new"), { class: "small", onclick: () => newContainerDialog() }, "plus"), more("#/machines/this/containers", t("server.allContainers"))], flush: true },
        d.containers.length ? d.containers.map(row) : uiEmpty({ text: t("server.containersNone") }),
      ),
    uiCard(
      { title: t("area.server.apps"), count: apps.length, actions: more("#/machines/this/apps", t("server.all")) },
      apps.length ? uiFacts([[t("server.appsRunning"), t("server.appsOf", { running: apps.filter(isUp).length, all: apps.length })]]) : uiEmpty({ text: t("apps.noneLead") }),
    ),
  );
  const updates = sysUpdates[""];
  const b = state.backups;
  put(
    document.getElementById("server-side"),
    uiCard(
      { title: t("area.server.system"), actions: more("#/machines/this/system", t("common.open")) },
      updates?.reboot && uiNotice({ tone: "warn", text: t("sysupdates.reboot"), action: button(t("power.reboot") + "…", { class: "small", onclick: () => serverPowerDialog("reboot") }, "refresh") }),
      ...uiFacts([[t("server.updates"), serverUpdatesValue(updates)], ["Docker", o?.docker?.available ? h("span", { class: "mono" }, o.docker.version ?? "—") : t("server.dockerNo")], ["Hata", h("span", { class: "mono" }, state.version)]]),
    ),
    uiCard(
      { title: t("server.backup"), actions: more("#/backups", t("server.toBackups")) },
      ...uiFacts([[t("server.backupLast"), !b ? "…" : b.lastRun ? ago(b.lastRun.at) : t("server.backupNever")], [t("server.backupWhere"), h("span", { class: "mono" }, b?.dir ?? "…")]]),
    ),
  );
}

/** How many updates this server has: marks for all of them and for the security ones */
function serverUpdatesValue(updates) {
  const list = updates?.list ?? [];
  const security = list.filter((p) => p.security).length;
  if (!updates) return "…";
  if (updates.error && !updates.at) return "—";
  if (!updates.at) return h("span", { class: "muted" }, t("sysupdates.never"));
  if (!list.length) return h("span", { class: "with-icon" }, icon("check"), t("server.updatesNone"));
  return uiLine([uiState("warn", t("server.updatesN", { n: list.length })), security > 0 && uiState("bad", t("sysupdates.security", { n: security }))], { end: true });
}

/** "Find a setting" in the head of Settings: sections and cards by the words typed, wherever they live now */
function settingsFind() {
  const results = uiFindResults();
  const input = h("input", { type: "search", placeholder: t("settings.find"), "aria-label": t("settings.find"), autocomplete: "off", spellcheck: false });
  const open = (action) => (e) => {
    e.preventDefault();
    input.value = "";
    results.hidden = true;
    action();
  };
  const paint = () => {
    const typed = input.value;
    if (!typed.trim()) return void (results.hidden = true);
    const found = findSettings(typed);
    put(
      results,
      !found.length && h("p", { class: "muted small" }, t("settings.findNone", { text: typed.trim() })),
      found.flatMap(({ item, cards, off }) => [
        uiFindHit({ icon: item.icon, name: markFound(sectionTitle(item), typed), note: off ? t("modules.turnOn") : t("area." + sectionArea(item.id)), onpick: open(() => (off ? turnModuleOn(off, sectionHash(item.id)) : openSettingsCard(item))) }),
        ...cards.map((card) => uiFindHit({ name: markFound(card, typed), under: true, onpick: open(() => openSettingsCard(item, card)) })),
      ]),
    );
    results.hidden = false;
  };
  input.addEventListener("input", paint);
  input.addEventListener("focus", paint);
  input.addEventListener("blur", () => (results.hidden = true));
  input.addEventListener("keydown", (e) => e.key === "Escape" && input.blur());
  return uiFind(input, results);
}

/** The head of the section a part of the settings lives in, with its tabs, around what that part shows */
function settingsFrame(section, ...content) {
  const r = state.route;
  const [area, at] = r.view === "settings" ? [r.area, r.at] : section === "users" ? ["settings", "users"] : ["backups", r.tab ?? "overview"];
  const opts = area === "settings" ? { meta: `${t("area.settings.lead")} · ${state.version}`, actions: settingsFind() } : area === "backups" ? { metaId: "backup-meta", actionsId: "backup-actions" } : {};
  return [h("div", { class: "ui-settings-frame" }, areaHead(area, at, opts), content)];
}
/** The long sections are cut into tabs: the address says which */
const STORAGE_TABS = { storage: ["disks", "fs", "fills"] };
const settingsUi = { find: "" };
const settingsTab = (section) => (STORAGE_TABS[section].includes(state.route.tab) ? state.route.tab : STORAGE_TABS[section][0]);

// --- Account and users --------------------------------------------------------------------------

/** The QR code of a matrix sent by the server as rows of "0" and "1" */
function qrSvg(rows) {
  const quiet = 4;
  const size = rows.length + quiet * 2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("shape-rendering", "crispEdges");
  const back = document.createElementNS(SVG_NS, "rect");
  back.setAttribute("width", size);
  back.setAttribute("height", size);
  back.setAttribute("fill", "#fff");
  const path = document.createElementNS(SVG_NS, "path");
  let d = "";
  rows.forEach((row, r) => [...row].forEach((cell, c) => (d += cell === "1" ? `M${c + quiet},${r + quiet}h1v1h-1z` : "")));
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.append(back, path);
  return svg;
}

/** A browser and system out of a User-Agent line — enough to tell one's own devices apart */
function deviceName(userAgent) {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : /curl\//.test(userAgent) ? "curl" : "";
  const system = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return [browser, system].filter(Boolean).join(" · ") || userAgent.slice(0, 40) || "—";
}

function passwordInput(autocomplete) {
  return h("input", { type: "password", autocomplete, required: true, minLength: autocomplete === "new-password" ? 8 : 1 });
}

async function twoFactorSetup() {
  let setup;
  try {
    setup = await api("POST", "/api/account/totp/begin", {});
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const code = h("input", { inputMode: "numeric", autocomplete: "one-time-code", required: true, class: "mono", placeholder: "000000" });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            const res = await api("POST", "/api/account/totp/enable", { code: code.value.trim() });
            dialog.close();
            state.user.twoFactor = true;
            // what the administrator could not do until now opens once the codes are put away
            if (state.user.mustTwoFactor) return recoveryDialog(res.recovery, () => location.reload());
            recoveryDialog(res.recovery);
            void loadSettings();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("twofa.setupTitle")), h("p", { class: "muted small" }, t("twofa.setupLead"))), closeX(() => dialog)),
      uiQr(qrSvg(setup.qr)),
      field(t("twofa.secret"), h("input", { readOnly: true, value: setup.secret.replace(/(.{4})/g, "$1 ").trim(), class: "mono", onfocus: (e) => e.target.select() }), t("twofa.secretHint")),
      field(t("twofa.code"), code),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("twofa.turnOn"))),
    ),
  );
  code.focus();
}

function recoveryDialog(codes, done = () => {}) {
  const dialog = openDialog(
    "",
    h("h2", null, t("twofa.recoveryTitle")),
    h("p", { class: "muted" }, t("twofa.recoveryLead")),
    uiCommand(codes.join("\n"), { block: true }),
    h("footer", null, button(t("twofa.copy"), { onclick: () => navigator.clipboard?.writeText(codes.join("\n")).then(() => toast(t("twofa.copied"))) }), button(t("twofa.saved"), { class: "primary", onclick: () => (dialog.close(), done()) })),
  );
}

function passwordPrompt(title, lead, confirmLabel, action, extra = null, kind = "danger") {
  const password = passwordInput("current-password");
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "confirm",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await action(password.value);
            dialog.close();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, title),
      h("p", { class: "muted" }, lead),
      field(t("auth.password"), password),
      extra,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn " + kind }, confirmLabel)),
    ),
  );
  password.focus();
}

const AVATAR_SIDE = 256;

/** A picture the person chose, made into a small square: the middle of it, scaled down in the browser itself */
async function avatarSquare(file) {
  const picture = await createImageBitmap(file);
  const side = Math.min(picture.width, picture.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(AVATAR_SIDE, side);
  canvas.getContext("2d").drawImage(picture, (picture.width - side) / 2, (picture.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  picture.close();
  const as = (type) => new Promise((done) => canvas.toBlob(done, type, 0.9));
  // a browser that cannot write WebP gives PNG back for it
  return (await as("image/webp")) ?? (await as("image/jpeg"));
}

/** The person's picture in their account: chosen from the device, taken away */
function avatarCard() {
  const error = h("p", { class: "error", role: "alert" });
  const picker = h("input", { type: "file", accept: "image/*", hidden: true });
  const keep = (user) => {
    state.user = { ...state.user, ...user };
    if (state.account) state.account.user = { ...state.account.user, ...user };
    render();
  };
  picker.onchange = async () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (!file) return;
    error.textContent = "";
    try {
      const square = await avatarSquare(file).catch(() => null);
      if (!square) throw new Error(t("account.avatarUnreadable"));
      const res = await fetch("/api/account/avatar", { method: "PUT", headers: { "content-type": square.type }, body: square }).catch(() => {
        throw new ApiError(0, "network");
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data.error?.code ?? "request.failed", data.error?.detail);
      keep(data.user);
      toast(t("account.avatarSaved"));
    } catch (err) {
      error.textContent = err instanceof ApiError ? errorText(err) : err.message;
    }
  };
  const has = !!state.user.avatar;
  return uiCard(
    { title: t("account.avatar"), lead: t("account.avatarHint") },
    uiLine([
      avatarOf(state.user, "avatar big"),
      picker,
      button(t(has ? "account.avatarChange" : "account.avatarUpload"), { class: "small", onclick: () => picker.click() }, "upload"),
      has &&
        button(t("account.avatarRemove"), {
          class: "small",
          onclick: async () => {
            try {
              keep((await api("DELETE", "/api/account/avatar")).user);
            } catch (err) {
              error.textContent = errorText(err);
            }
          },
        }, "trash"),
    ]),
    error,
  );
}

const SESSIONS_SHOWN = 8;
const accountUi = { allSessions: false };
function accountSection() {
  const account = state.account;
  const signOut = async (session) => {
    await api("DELETE", `/api/account/sessions/${session.id}`).catch((e) => toast(errorText(e), "error"));
    void loadSettings();
  };
  const sessionRow = (session) =>
    uiRow({
      lead: { icon: "screen" },
      name: h("span", null, deviceName(session.userAgent), session.current && " ", session.current && uiTag(t("account.thisDevice"))),
      sub: [session.ip, t("account.lastSeen", { time: ago(session.lastSeen) })].filter(Boolean).join(" · "),
      action: !session.current && state.user.role !== "guest" && button(t("account.signOutDevice"), { class: "small", onclick: () => signOut(session) }),
    });
  // the device in hand first, then the latest; a long list is cut and "More" shows the rest
  const sessions = [...account.sessions].sort((a, b) => Number(!!b.current) - Number(!!a.current) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const sessionsCard = uiCard(
    { title: t("account.sessions"), count: sessions.length, flush: true, actions: account.sessions.length > 1 && state.user.role !== "guest" && button(t("account.signOutOthers"), { class: "small", onclick: async () => (await api("DELETE", "/api/account/sessions/others").catch((e) => toast(errorText(e), "error")), loadSettings()) }, "signout") },
    sessions.slice(0, accountUi.allSessions ? undefined : SESSIONS_SHOWN).map(sessionRow),
    !accountUi.allSessions && sessions.length > SESSIONS_SHOWN && uiEmpty({ text: t("load.more", { n: sessions.length - SESSIONS_SHOWN }), action: button(t("ui.showMore"), { class: "small quiet", onclick: () => ((accountUi.allSessions = true), void loadSettings()) }, "down") }),
  );
  // a guest account is shared: the people using it do not manage it
  if (state.user.role === "guest") return [uiCard({ title: state.user.name, lead: t("account.guest") }), sessionsCard];
  const current = passwordInput("current-password");
  const next = passwordInput("new-password");
  const error = h("p", { class: "error", role: "alert" });
  const twoFactor = account.user.twoFactor;
  return [
    avatarCard(),
    uiCard(
      { title: t("account.password") },
      h(
        "form",
        {
          class: "stack",
          onsubmit: async (e) => {
            e.preventDefault();
            error.textContent = "";
            try {
              await api("POST", "/api/account/password", { current: current.value, password: next.value });
              current.value = next.value = "";
              toast(t("account.passwordChanged"));
              void loadSettings();
            } catch (err) {
              error.textContent = errorText(err);
            }
          },
        },
        uiSetting({ name: t("account.current"), control: current }),
        uiSetting({ name: t("account.new"), explain: t("account.newHint"), control: next }),
        error,
        uiFoot(h("button", { class: "btn primary" }, t("account.change"))),
      ),
    ),
    uiCard({
      title: t("twofa.title"),
      marks: uiState(twoFactor ? "ok" : "off", twoFactor ? t("twofa.on") : t("twofa.off")),
      lead: twoFactor ? t("twofa.onHint", { n: account.recoveryCodes }) : t("twofa.offHint"),
      actions: twoFactor
        ? button(t("twofa.turnOff") + "…", {
            class: "small",
            onclick: () =>
              passwordPrompt(t("twofa.turnOffTitle"), t("twofa.turnOffLead"), t("twofa.turnOff"), async (password) => {
                await api("POST", "/api/account/totp/disable", { password });
                state.user.twoFactor = false;
                toast(t("settings.saved"));
                void loadSettings();
              }),
          })
        : button(t("twofa.setUp"), { class: "small primary", onclick: twoFactorSetup }, "lock"),
    }),
    passkeysCard(account),
    sessionsCard,
  ];
}

function passkeysCard(account) {
  const here = account.passkeysHere && !!window.PublicKeyCredential;
  if (!here && !account.passkeys.length) return uiCard({ title: t("passkey.title") }, uiNotice({ tone: "info", text: t("passkey.needDomain") }));
  const add = () => {
    const name = h("input", { maxLength: 40, placeholder: deviceName(navigator.userAgent) });
    passwordPrompt(t("passkey.addTitle"), t("passkey.addLead"), t("passkey.add"), async (password) => {
      try {
        await passkeyCreate(password, name.value.trim() || deviceName(navigator.userAgent));
      } catch (e) {
        if (passkeyCancelled(e)) return;
        throw e;
      }
      toast(t("passkey.added"));
      void loadSettings();
    }, field(t("passkey.name"), name, t("passkey.nameHint")), "primary");
  };
  const remove = (key) => confirmAction({ title: t("passkey.removeTitle", { name: key.name || t("passkey.unnamed") }), lead: t("passkey.removeLead"), label: t("passkey.removeGo"), run: async () => (await api("DELETE", `/api/account/passkeys/${key.id}`), void loadSettings()) });
  return uiCard(
    { title: t("passkey.title"), count: account.passkeys.length || null, lead: t(here ? "passkey.lead" : "passkey.needDomain"), flush: true, actions: here && button(t("passkey.add"), { class: "small primary", onclick: add }, "plus") },
    account.passkeys.length
      ? account.passkeys.map((key) =>
          uiRow({
            lead: { icon: "key" },
            name: key.name || t("passkey.unnamed"),
            sub: [t("passkey.created", { date: new Date(key.createdAt).toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" }) }), key.lastUsed && t("passkey.used", { time: ago(key.lastUsed) })].filter(Boolean).join(" · "),
            more: [{ label: t("passkey.remove") + "…", icon: "trash", danger: true, run: () => remove(key) }],
          }),
        )
      : uiEmpty({ text: t("passkey.none") }),
  );
}

async function loadUsers() {
  try {
    const [users, invites, access, signIns] = await Promise.all([api("GET", "/api/users"), api("GET", "/api/invites"), api("GET", `/api/access?lang=${state.lang}`), api("GET", "/api/signins")]);
    Object.assign(state, { users, invites, access, signIns });
    // the one table of access also holds the folders — this server's and the computers' — and Home Assistant
    if (state.route.part === "access") {
      const [shares, machines, ha] = await Promise.all([
        hasModule("shares") ? api("GET", "/api/shares").catch(() => null) : null,
        hasModule("machines") ? api("GET", "/api/machines").catch(() => null) : null,
        hasModule("integrations") ? api("GET", "/api/ha").catch(() => null) : null,
      ]);
      const let_ = (machines?.machines ?? []).filter((m) => m.people);
      const folders = await Promise.all(let_.map((m) => api("GET", `/api/machines/${m.id}/shares`).then((r) => ({ machine: m, shares: r.shares }), () => ({ machine: m, shares: [] }))));
      state.accessMore = { shares: shares?.shares ?? [], kept: new Set((shares?.users ?? []).filter((u) => !u.allowed).map((u) => u.id)), folders, ha: ha?.servers ?? [] };
    }
    if (!state.settings) state.settings = await api("GET", "/api/settings");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "users") renderUsers();
}

function userDialog() {
  const name = h("input", { required: true, autocapitalize: "none", spellcheck: false, autocomplete: "off" });
  const password = passwordInput("new-password");
  const role = h("select", null, h("option", { value: "member" }, t("user.role.member")), h("option", { value: "guest" }, t("user.role.guest")), h("option", { value: "admin" }, t("user.role.admin")));
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await api("POST", "/api/users", { name: name.value.trim(), password: password.value, role: role.value });
            dialog.close();
            void loadUsers();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("users.add"))), closeX(() => dialog)),
      field(t("auth.name"), name),
      field(t("auth.password"), password, t("users.passwordHint")),
      field(t("users.role"), role, t("users.roleHint")),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("users.add"))),
    ),
  );
  name.focus();
}

function userMenuFor(user, at) {
  return menuAt(at, menuHeader(user.name, t("user.role." + user.role), avatarOf(user)), userEntries(user));
}

/** What may be done with a user: their role, the network folders, the password, the second factor, removal */
function userEntries(user) {
  const self = user.id === state.user.id;
  const change = async (patch, done) => {
    try {
      await api("PUT", `/api/users/${user.id}`, patch);
      toast(done ?? t("settings.saved"));
      void loadUsers();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  /** What a person may do on this server changes most to or from administrator: it is asked first */
  const askRole = (role, label) =>
    confirmAction({
      title: t(role === "admin" ? "users.makeAdminTitle" : "users.dropAdminTitle", { name: user.name }),
      lead: t(role === "admin" ? "users.makeAdminLead" : "users.dropAdminLead", { name: user.name }),
      label,
      iconName: "user",
      run: async () => {
        await api("PUT", `/api/users/${user.id}`, { role });
        toast(t("settings.saved"));
        void loadUsers();
      },
    });
  const item = (label, iconName, run, cls = "") => ({ label, icon: iconName, run, danger: cls === "danger" });
  return [
    user.role !== "member" && item(t("users.makeMember"), "user", () => (user.role === "admin" ? askRole("member", t("users.makeMember")) : change({ role: "member" }))),
    user.role !== "guest" && item(t("users.makeGuest"), "user", () => (user.role === "admin" ? askRole("guest", t("users.makeGuest")) : change({ role: "guest" }))),
    user.role !== "admin" && item(t("users.makeAdmin"), "sliders", () => askRole("admin", t("users.makeAdmin"))),
    item(t(user.shares === false ? "users.sharesAllow" : "users.sharesDeny"), "share", () => change({ shares: user.shares === false }, t(user.shares === false ? "users.sharesAllowed" : "users.sharesDenied"))),
    item(t("users.setPassword"), "refresh", () => {
      const password = passwordInput("new-password");
      const error = h("p", { class: "error", role: "alert" });
      const prompt = openDialog(
        "confirm",
        h(
          "form",
          {
            onsubmit: async (e) => {
              e.preventDefault();
              try {
                await api("PUT", `/api/users/${user.id}`, { password: password.value });
                prompt.close();
                toast(t("account.passwordChanged"));
                void loadUsers();
              } catch (err) {
                error.textContent = errorText(err);
              }
            },
          },
          h("h2", null, t("users.setPasswordTitle", { name: user.name })),
          h("p", { class: "muted" }, t("users.setPasswordLead")),
          field(t("account.new"), password, t("account.newHint")),
          error,
          h("footer", null, closeButton(() => prompt, t("common.cancel")), h("button", { class: "btn primary" }, t("settings.save"))),
        ),
      );
      password.focus();
    }),
    user.twoFactor && item(t("users.resetTwoFactor"), "x", () =>
      confirmAction({
        title: t("users.resetTwoFactorTitle", { name: user.name }),
        lead: t("users.resetTwoFactorLead", { name: user.name }),
        label: t("users.resetTwoFactorGo"),
        iconName: "x",
        run: async () => {
          await api("PUT", `/api/users/${user.id}`, { twoFactor: false });
          toast(t("settings.saved"));
          void loadUsers();
        },
      }),
    ),
    !self &&
      item(t("users.remove"), "trash", () =>
        confirmAction({
          title: t("users.removeTitle", { name: user.name }),
          lead: t("users.removeLead", { name: user.name }),
          label: t("users.remove"),
          run: async () => {
            await api("DELETE", `/api/users/${user.id}`);
            void loadUsers();
          },
        }), "danger"),
  ];
}

const USER_PARTS = ["people", "access", "invites", "signins"];

function renderUsers() {
  const users = state.users ?? [];
  const part = state.route.part ?? "people";
  const admins = users.filter((u) => u.role === "admin").length;
  const without = users.filter((u) => !u.twoFactor).length;
  const invites = state.invites?.length ?? 0;
  const people = () => [
    uiCard(
      { title: t("users.part.people"), count: users.length, lead: [t("users.meta", { users: users.length, admins }), without > 0 && t("users.without2fa", { n: without })].filter(Boolean).join(" · "), flush: true },
      uiTable(
        [{ label: t("users.col.user") }, { label: t("users.role") }, { label: t("twofa.short") }, { label: t("users.col.lastSignIn") }, { label: t("account.sessions"), num: true }, { label: "" }],
        users.map((u) => ({
          menu: (at) => userMenuFor(u, at),
          cells: [
            uiCell({ lead: { avatar: avatarOf(u, "avatar ui-lead") }, name: [u.name, u.id === state.user.id && h("span", { class: "muted small" }, " ", t("users.you"))], sub: userShares(u) }),
            u.role === "admin" ? uiState("info", t("user.role." + u.role)) : uiTag(t("user.role." + u.role)),
            u.twoFactor ? uiState("ok", t("twofa.onShort")) : h("span", { class: "muted" }, t("twofa.offShort")),
            u.lastSignIn ? ago(u.lastSignIn) : h("span", { class: "muted" }, t("users.never")),
            u.sessions || "—",
            uiMore(() => userEntries(u), { size: "s", header: () => menuHeader(u.name, t("user.role." + u.role), avatarOf(u)), label: t("users.actions", { name: u.name }) }),
          ],
          sub: [t("user.role." + u.role), u.lastSignIn ? ago(u.lastSignIn) : t("users.never")].join(" · "),
        })),
      ),
      h("div", { class: "ui-inset" }, h("p", { class: "muted small" }, t("users.rolesHint"))),
    ),
    requireTwoFactorRow(),
  ];
  const body = part === "access" ? accessTable() : part === "invites" ? invitesCard() : part === "signins" ? signInLog() : people();
  shell(
    ...settingsFrame(
      "users",
      uiCard(
        { flush: true, cls: "ui-filters" },
        uiSegment(USER_PARTS.map((id) => ({ value: id, label: t("users.part." + id), href: `#/settings/users${id === "people" ? "" : "/" + id}`, count: id === "invites" && invites > 0 ? invites : null })), part, null, { label: t("area.settings.users") }),
        uiLine([button(t("invite.new"), { onclick: inviteDialog }, "link"), button(t("users.add"), { class: "primary", onclick: userDialog }, "plus")], { end: true }),
      ),
      body,
    ),
  );
}


/** The network folders a user may open, and how — under the name in the list of users */
function userShares(user) {
  if (user.shares === false) return h("div", { class: "muted small" }, t("users.sharesDenied"));
  const shares = (state.settings?.shares ?? []).filter((share) => share.users?.[user.id]);
  if (!shares.length) return null;
  return h("div", { class: "muted small" }, t("users.shares"), " ", shares.map((share, i) => [i > 0 && ", ", h("a", { class: "link", href: "#/settings/shares" }, share.name), ` (${t("shares.access." + share.users[user.id])})`]));
}

/** The rule that every administrator signs in with a second factor */
function requireTwoFactorRow() {
  const on = !!state.settings?.security?.adminTwoFactor;
  const box = uiSwitch({
    on,
    label: t("users.require2fa"),
    onchange: async (next) => {
      state.settings = await api("PUT", "/api/settings", { security: { adminTwoFactor: next } });
    },
  });
  return uiCard({}, uiSetting({ name: t("users.require2fa"), explain: t("users.require2faHint"), control: box }));
}

function inviteDialog() {
  const role = h("select", null, h("option", { value: "member" }, t("user.role.member")), h("option", { value: "guest" }, t("user.role.guest")));
  const note = h("input", { maxLength: 80, placeholder: t("invite.notePlaceholder") });
  const error = h("p", { class: "error", role: "alert" });
  const dialog = openDialog(
    "",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const res = await api("POST", "/api/invites", { role: role.value, note: note.value.trim() });
            dialog.close();
            const link = `${location.origin}/#invite=${res.token}`;
            const box = h("input", { readOnly: true, value: link, class: "mono", onfocus: (ev) => ev.target.select() });
            const shown = openDialog("", h("h2", null, t("invite.linkTitle")), h("p", { class: "muted" }, t("invite.linkLead")), box, h("footer", null, button(t("twofa.copy"), { onclick: () => navigator.clipboard?.writeText(link).then(() => toast(t("twofa.copied"))) }, "link"), button(t("common.close"), { class: "primary", onclick: () => shown.close() })));
            box.focus();
            void loadUsers();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("header", null, h("div", { class: "grow" }, h("h2", null, t("invite.new")), h("p", { class: "muted small" }, t("invite.newLead"))), closeX(() => dialog)),
      field(t("users.role"), role, t("users.roleHint")),
      field(t("invite.note"), note),
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, t("invite.create"))),
    ),
  );
}

function invitesCard() {
  const invites = state.invites ?? [];
  const revoke = async (invite) => (await api("DELETE", `/api/invites/${invite.id}`).catch((e) => toast(errorText(e), "error")), loadUsers());
  return uiCard(
    { title: t("invite.title2"), count: invites.length || null, flush: true },
    invites.length
      ? invites.map((invite) =>
          uiRow({
            lead: { icon: "link" },
            name: invite.note || t("user.role." + invite.role),
            sub: `${t("user.role." + invite.role)} · ${t("invite.expires", { time: new Date(invite.exp).toLocaleDateString(state.lang, { day: "numeric", month: "short" }) })}`,
            more: [{ label: t("invite.revoke"), icon: "trash", danger: true, run: () => revoke(invite) }],
          }),
        )
      : uiEmpty({ text: t("invite.none") }),
  );
}

function signInLog() {
  const list = (state.signIns ?? []).slice(0, 60);
  return uiCard(
    { title: t("signins.title"), flush: true },
    list.length
      ? list.map((entry) =>
          uiRow({
            mode: "event",
            lead: { icon: entry.outcome === "ok" ? "signin" : "x", tone: entry.outcome === "ok" ? null : "bad" },
            name: t("signins." + entry.outcome, { name: entry.name || "?" }),
            sub: entry.ip,
            time: ago(entry.ts),
          }),
        )
      : uiEmpty({ text: t("activity.none") }),
  );
}

/**
 * The one table of access: a row per thing — apps, network folders, the folders of the computers let to people, Home
 * Assistant — and a column per person. A tick opens, "reads" is a folder without writing; an administrator opens all but
 * the network folders, where everybody is named.
 */
function accessTable() {
  const access = state.access;
  const more = state.accessMore;
  if (!access || !more) return waitMark();
  const users = access.users;
  const again = () => void loadUsers();
  const fail = (e) => (toast(errorText(e), "error"), again());
  const members = users.filter((u) => u.role === "member").map((u) => u.id);
  const dash = () => h("span", { class: "muted" }, "—");
  const fixed = (title) => uiGrant({ state: "fixed", label: title });
  const tick = (on, label, set) => uiGrant({ state: on ? "on" : "off", label, onclick: () => set(!on) });
  // a folder: none → reads → reads and writes → none
  const level = (now, label, set) => {
    const next = now === "read" ? "write" : now === "write" ? "none" : "read";
    const words = `${label}: ${t("shares.access." + (now ?? "none"))}`;
    return uiGrant({ state: now === "write" ? "on" : now === "read" ? "reads" : "off", label: words, text: now === "read" ? t("access.reads") : null, onclick: () => set(next) });
  };
  const group = (title, lead) => ({ group: title, lead });
  const withLevel = (map, id, to) => Object.fromEntries(Object.entries({ ...map, [id]: to }).filter(([, v]) => v !== "none"));

  const setApp = async (app, patch) => {
    try {
      const res = await api("PUT", app.machine ? `/api/machines/${app.machine.id}/apps/${app.app}/access` : `/api/apps/${app.name}/access`, { protect: app.protect, allowed: app.allowed, ...patch });
      if (res.job) jobDialog(res.job, "apply", app.title, again);
      else again();
    } catch (e) {
      fail(e);
    }
  };
  const appRow = (app) => {
    const everyone = app.allowed === "all";
    const list = everyone ? members : app.allowed;
    const signIn = uiCheck(t("access.signIn"), h("input", { type: "checkbox", checked: app.protect, disabled: !!app.cannotProtect, title: app.cannotProtect ? t("access.cannot." + app.cannotProtect) : "", onchange: (e) => setApp(app, { protect: e.target.checked }) }));
    return {
      thing: uiCell({
        lead: appIcon(app, "row"),
        name: h("a", { href: app.machine ? `#/machines/${app.machine.id}/apps` : `#/apps/${app.name}` }, app.title),
        sub: [app.machine && h("span", { class: "with-icon" }, icon("server"), app.machine.name, app.protect && app.listen ? ` · ${t("access.through", { port: app.listen })}` : ""), signIn, app.cannotProtect === "hostNetwork" && h("span", null, t("access.hostOpen")), !everyone && !app.protect && h("span", null, t("access.onlyHidden"))],
      }),
      cells: users.map((u) => (u.role === "admin" ? fixed(t("access.adminAll")) : tick(everyone ? u.role === "member" : list.includes(u.id), `${u.name}: ${app.title}`, (on) => setApp(app, { allowed: on ? [...new Set([...list, u.id])] : list.filter((id) => id !== u.id) })))),
    };
  };
  const shareRow = (share) => ({
    thing: uiCell({ lead: { icon: "folder" }, name: h("a", { href: "#/storage/shares" }, share.name), sub: [h("span", { class: "mono clip" }, share.path), share.guest !== "none" && h("span", null, t("access.guest", { level: t("shares.access." + share.guest).toLowerCase() }))] }),
    cells: users.map((u) => (more.kept.has(u.id) ? h("span", { class: "muted", title: t("access.keptOut") }, "—") : level(share.users[u.id], `${u.name}: ${share.name}`, (to) => api("PUT", `/api/shares/${encodeURIComponent(share.name)}`, { users: withLevel(share.users, u.id, to) }).then(again, fail)))),
  });
  const folderRow = (m, share) => ({
    thing: uiCell({ lead: { icon: "folder" }, name: h("a", { href: machineBase(m) }, share.name), sub: h("span", { class: "mono" }, share.path) }),
    cells: users.map((u) => (u.role === "admin" ? fixed(t("access.adminAll")) : level(share.users[u.id], `${u.name}: ${share.name}`, (to) => api("PUT", `/api/machines/${m.id}/shares`, { path: share.path, name: share.name, users: withLevel(share.users, u.id, to) }).then(again, fail)))),
  });
  const haRow = (x) => {
    const all = x.people === "all";
    const list = all ? users.filter((u) => u.role !== "admin").map((u) => u.id) : (x.people ?? []);
    return {
      thing: uiCell({ lead: { icon: "bulb" }, name: h("a", { href: `#/house/ha/${x.id}` }, x.name), sub: t("access.haWhat") }),
      cells: users.map((u) => (u.role === "admin" ? fixed(t("access.adminAll")) : tick(list.includes(u.id), `${u.name}: ${x.name}`, (on) => api("PATCH", `/api/ha/${x.id}`, { people: on ? [...new Set([...list, u.id])] : list.filter((id) => id !== u.id) }).then(again, fail)))),
    };
  };
  const rows = [
    access.apps.length > 0 && [group(t("nav.apps"), t("access.appsLead")), access.apps.map(appRow)],
    more.shares.length > 0 && [group(t("area.storage.shares"), t("access.sharesLead")), more.shares.map(shareRow)],
    more.folders.filter((f) => f.shares.length > 0).map((f) => [group(t("access.foldersOf", { name: f.machine.name })), f.shares.map((share) => folderRow(f.machine, share))]),
    more.ha.length > 0 && [group("Home Assistant", t("access.haLead")), more.ha.map(haRow)],
  ].filter(Boolean);
  return [
    uiCard(
      { title: t("users.part.access"), count: t("access.people", { n: users.length }), flush: true },
      rows.flat(3).length ? uiMatrix(users.map((u) => ({ name: u.name, sub: t("user.role." + u.role) })), rows.flat(3)) : uiEmpty({ text: t("access.nothing") }),
      h("div", { class: "ui-inset" }, h("p", { class: "muted small" }, t("access.one"), " ", t("access.how"))),
    ),
  ];
}
