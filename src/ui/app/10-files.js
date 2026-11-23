// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Files --------------------------------------------------------------------------------------
// The server's files. Paths are the real ones; the page opens in the data root.

const filesUi = {
  mode: localStorage.getItem("hata.files.mode") === "grid" ? "grid" : "list",
  sort: ["name", "modified", "size"].find((key) => key === localStorage.getItem("hata.files.sort")) ?? "name",
  /** Names selected in the folder on screen */
  selected: new Set(),
  /** A search under the folder on screen: what was asked, and what was found — null while it runs */
  find: null,
  /** A name to choose once the folder is listed */
  pick: null,
  /** The entry the keys act on: a name in the folder on screen */
  cursor: null,
  /** The name the cursor goes to once the folder is listed (the folder one came up from) */
  cursorNext: null,
  /** The address being typed: `{ value, caret, select }`, null while the crumbs are shown */
  edit: null,
  /** Where back and forward lead: the browser's own entries, numbered as Files opens them (`filesStep`) */
  trail: null,
};

/** The address of a folder; `machine` — of another machine, by default the one on screen */
const filesHash = (path, machine = filesMachine()) => "#/files" + (machine ? "/@" + machine : "") + (path.split("/").filter(Boolean).map((part) => "/" + encodeURIComponent(part)).join("") || "/");
/** The machine whose files are on screen; "" — this server */
const filesMachine = () => (state.route.view === "files" ? state.route.machine || "" : "");
/** Where the file manager's calls go: this server's files or a machine's */
const filesApi = (sub = "", machine = filesMachine()) => (machine ? `/api/machines/${machine}/files` : "/api/files") + sub;
const within = (path, dir) => path === dir || path.startsWith(dir === "/" ? "/" : dir + "/");

/** Puts text on the clipboard; on plain HTTP browsers offer no clipboard API, so the old way steps in */
function copyText(text) {
  try {
    void navigator.clipboard.writeText(text);
  } catch {
    const area = h("textarea", { class: "offscreen", value: text, readOnly: true });
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(t("files.pathCopied", { path: text }));
}
/** The same for what should not stand on the screen in a message: a password */
function copyQuietly(text) {
  try {
    void navigator.clipboard.writeText(text);
  } catch {
    const area = h("textarea", { class: "offscreen", value: text, readOnly: true });
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(t("twofa.copied"));
}
const joinPath = (dir, name) => (dir === "/" ? "" : dir) + "/" + name;
const rawUrl = (path, download = false) => `${filesApi("/raw")}?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

// What the browser can show itself; the rest is downloaded.
const FILE_KINDS = {
  image: "jpg jpeg png gif webp avif bmp svg ico",
  video: "mp4 m4v webm mov mkv ogv",
  audio: "mp3 m4a aac ogg oga opus wav flac",
  pdf: "pdf",
  text: "txt md log csv json yml yaml toml ini conf cfg env xml html css js ts sh py service properties list sql",
};
const KIND_BY_EXT = Object.fromEntries(Object.entries(FILE_KINDS).flatMap(([kind, list]) => list.split(" ").map((ext) => [ext, kind])));
const KIND_ICONS = { dir: "folder", image: "image", video: "film", audio: "music" };
/** The colour of a tile with no picture, by what the file is */
const TINT_BY_EXT = Object.fromEntries(
  Object.entries({
    archive: "zip tar gz tgz xz bz2 zst 7z rar iso deb rpm",
    doc: "pdf doc docx odt rtf xls xlsx ods csv ppt pptx odp epub",
    video: FILE_KINDS.video + " avi wmv flv ts",
    audio: FILE_KINDS.audio + " wma",
    image: FILE_KINDS.image + " heic tif tiff raw cr2 nef psd",
    text: FILE_KINDS.text,
  }).flatMap(([tint, list]) => list.split(" ").map((ext) => [ext, tint])),
);
/** Images up to this size are shown as their own thumbnails: there is no smaller copy of them */
const THUMB_MAX = 6 * 1024 * 1024;
const TEXT_MAX = 1024 * 1024;

function fileKind(entry) {
  if (entry.type !== "file") return entry.type;
  const dot = entry.name.lastIndexOf(".");
  return KIND_BY_EXT[dot >= 0 ? entry.name.slice(dot + 1).toLowerCase() : ""] ?? "file";
}

const fileIcon = (entry) => icon(KIND_ICONS[fileKind(entry)] ?? "file", entry.type === "dir" ? "folder-ico" : "");
const fileTime = (ts) => (new Date(ts).getFullYear() === new Date().getFullYear() ? dateTime(ts) : new Date(ts).toLocaleDateString(state.lang, { day: "numeric", month: "short", year: "numeric" }));

function sortedEntries(entries) {
  const collator = new Intl.Collator(state.lang, { numeric: true, sensitivity: "base" });
  const by = { name: () => 0, modified: (a, b) => b.modified - a.modified, size: (a, b) => b.size - a.size }[filesUi.sort];
  return [...entries].sort((a, b) => ((a.type === "dir") === (b.type === "dir") ? by(a, b) || collator.compare(a.name, b.name) : a.type === "dir" ? -1 : 1));
}

const isFavorite = (path) => (state.favorites ?? []).some((one) => one.path === path);

/** Marks a folder or a file as a favourite of the person, or takes the mark off */
async function favorite(path, on, name = path.split("/").pop() || "/") {
  try {
    state.favorites = (await api("POST", "/api/files/favorite", { path, on })).favorites;
    toast(t(on ? "files.favoriteDone" : "files.unfavoriteDone", { name }));
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "files") renderFilesBody();
  else if (state.route.view === "trash") filesPlaces(null);
  else if (state.route.view === "myhata") renderMyHata();
}

/** Puts a folder on the dashboard or takes it off */
async function pinFolder(path, pinned, quiet = true, name = path.split("/").pop() || "/") {
  try {
    const res = await api("POST", "/api/files/pin", { path, pinned });
    if (state.files) state.files.pinned = res.pinned;
    toast(t(pinned ? "files.pinnedDone" : "files.unpinnedDone", { name }));
  } catch (e) {
    // a dialog shows the reason itself
    if (!quiet) throw e;
    return toast(errorText(e), "error");
  }
  await refresh();
  if (state.route.view === "files") renderFilesBody();
}

const onFiles = (path) => state.route.view === "files" && state.route.path === path;
/** The listing on screen, when it is of the folder and machine the address names */
const filesListing = () => (state.files?.path === state.route.path && (state.files.machine ?? "") === filesMachine() ? state.files : null);

async function loadFiles() {
  const path = state.route.path;
  const machine = filesMachine();
  // theirs with whom folders are shared start from those folders
  if (!isAdmin() && !path) return go("#/hata");
  if (!isAdmin() && !state.myMachines) await loadMine();
  // the other machines are places of the sidebar
  if (!machinesUi.list && isAdmin() && hasModule("machines")) machinesUi.list = await api("GET", "/api/machines").catch(() => null);
  let listing;
  try {
    listing = await api("GET", `${filesApi()}?path=${encodeURIComponent(path)}`);
  } catch (e) {
    listing = { path, home: machine ? "/" : (state.files?.home ?? ""), entries: [], places: machine ? [] : (state.files?.places ?? []), pinned: [], shared: [], disk: machine ? null : (state.files?.disk ?? null), error: errorText(e) };
  }
  listing.machine = machine;
  if (!onFiles(path) || filesMachine() !== machine) return;
  if (path !== listing.path) {
    // the page was opened without a folder: the address becomes the data root's
    state.route.path = listing.path;
    history.replaceState(history.state, "", filesHash(listing.path));
  }
  if (state.files?.path !== listing.path || (state.files?.machine ?? "") !== machine) {
    filesUi.cursor = filesUi.cursorNext;
    filesUi.cursorNext = null;
  }
  const names = new Set(listing.entries.map((entry) => entry.name));
  filesUi.selected = new Set(state.files?.path === listing.path ? [...filesUi.selected].filter((name) => names.has(name)) : []);
  if (filesUi.find && filesUi.find.under !== listing.path) filesUi.find = null;
  // a file found by a search is shown chosen in its folder
  if (filesUi.pick && names.has(filesUi.pick)) filesUi.selected = new Set([filesUi.pick]);
  filesUi.pick = null;
  state.files = listing;
  if (listing.favorites) state.favorites = listing.favorites;
  renderFilesBody();
}

function renderFiles() {
  // whether a Proxmox server is there to send a disc to, from a file's menu
  if (isAdmin() && hasModule("proxmox") && !pveUi.list) void api("GET", "/api/proxmox").then((list) => (pveUi.list ??= list), () => {});
  const box = h("div", { class: "files" }, h("aside", { class: "files-side fold", id: "files-places" }), h("section", { class: "stack", id: "files-main" }));
  box.addEventListener("contextmenu", filesContext);
  // files and folders dropped anywhere on the page go into the folder on screen
  let depth = 0;
  const dragging = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  box.addEventListener("dragenter", (e) => dragging(e) && (e.preventDefault(), depth++, box.classList.add("dropping")));
  box.addEventListener("dragover", (e) => dragging(e) && e.preventDefault());
  box.addEventListener("dragleave", (e) => dragging(e) && --depth <= 0 && ((depth = 0), box.classList.remove("dropping")));
  box.addEventListener("drop", async (e) => {
    if (!dragging(e)) return;
    e.preventDefault();
    depth = 0;
    box.classList.remove("dropping");
    const dir = state.route.path;
    queueUpload(dir, await droppedFiles(e.dataTransfer));
  });
  shell(box);
  renderFilesBody();
}

/** The places on the left of Files and of the trash; `path` — the folder on screen, null in the trash */
function filesPlaces(path) {
  const places = document.getElementById("files-places");
  if (!places) return;
  const trash = path === null;
  const machine = trash ? "" : filesMachine();
  const listing = trash ? null : state.files;
  const home = machine ? "" : (state.files?.home ?? "");
  const inHome = !trash && path !== "#hata" && home !== "" && within(path, home);
  const inside = (folder) => !trash && path !== "#hata" && within(path, folder);
  const place = (label, to, iconName, active, on = machine) =>
    h(
      "a",
      { class: "cat" + (active ? " active" : ""), href: filesHash(to, on), menu: (at) => sidebarMenu(at, { label, path: to, machine: on, iconName }) },
      h("span", { class: "with-icon" }, icon(iconName), h("span", { class: "clip" }, label)),
    );
  // a favourite file opens its folder with the file chosen
  const favorites = state.favorites ?? [];
  const favoriteRow = (one) => {
    const name = one.path.split("/").pop() || "/";
    if (one.dir) return place(name, one.path, "star", !trash && path === one.path, "");
    const parent = one.path.slice(0, one.path.lastIndexOf("/")) || "/";
    const show = (e) => {
      e.preventDefault();
      filesUi.pick = name;
      if (path === parent && !filesMachine()) loadFiles();
      else go(filesHash(parent));
    };
    return h(
      "a",
      { class: "cat", href: filesHash(parent), title: one.path, onclick: show, menu: (at) => menuAt(at, menuHeader(name, one.path, "file"), [{ label: t("common.open"), icon: "folder", run: () => show(new Event("click")) }, { label: t("files.copyPath"), icon: "copy", run: () => copyText(one.path) }, { label: t("files.unfavorite"), icon: "star", run: () => favorite(one.path, false, name) }]) },
      h("span", { class: "with-icon" }, icon("star"), h("span", { class: "clip" }, name)),
    );
  };
  const others = machinesUi.list?.machines ?? [];
  const machinesList = others.length > 0 && [h("div", { class: "cat-title" }, t("nav.machines")), others.map((m) => h("a", { class: "cat" + (machine === m.id ? " active" : "") + (m.online ? "" : " muted"), href: filesHash("/", m.id), title: m.online ? "" : t("machines.offline"), menu: (at) => menuAt(at, menuHeader(m.name, machineOs(m), "server"), [{ label: t("machines.files"), icon: "folder", href: filesHash("/", m.id) }, { label: t("menu.machinePage"), icon: "server", href: `#/machines/${m.id}` }, isAdmin() && { label: t("app.more"), icon: "more", run: () => machineMenu(m, at) }]) }, h("span", { class: "with-icon" }, icon("server"), h("span", { class: "clip" }, m.name))))];
  const shares = myShares();
  if (shares) {
    return put(
      places,
      h(
        "nav",
        { class: "cats" },
        h("div", { class: "cat-title" }, t("files.places")),
        h("a", { class: "cat" + (path === "#hata" ? " active" : ""), href: "#/hata" }, h("span", { class: "with-icon" }, icon("home"), h("span", { class: "clip" }, t("myhata.title")))),
        h("a", { class: "cat" + (trash ? " active" : ""), href: "#/trash" }, h("span", { class: "with-icon" }, icon("trash"), h("span", { class: "clip" }, t("trash.title")))),
        h("a", { class: "cat" + (path === "#links" ? " active" : ""), href: "#/links" }, h("span", { class: "with-icon" }, icon("link"), h("span", { class: "clip" }, t("links.side")))),
        (state.myShares ?? []).length > 0 && [h("div", { class: "cat-title" }, t("myhata.shared")), state.myShares.map((share) => place(share.name, share.path, "share", !machine && inside(share.path), ""))],
        (state.myMachines ?? []).map((m) => [h("div", { class: "cat-title" }, m.name), m.shares.map((share) => place(share.name, share.path, "share", machine === m.id && inside(share.path), m.id))]),
        favorites.length > 0 && [h("div", { class: "cat-title" }, t("files.favorites")), favorites.map(favoriteRow)],
      ),
    );
  }
  if (machine) {
    const m = others.find((x) => x.id === machine);
    const volumes = listing?.disks ?? [];
    return put(
      places,
      h(
        "nav",
        { class: "cats" },
        h("div", { class: "cat-title" }, t("files.places")),
        h("a", { class: "cat", href: "#/hata" }, h("span", { class: "with-icon" }, icon("home"), h("span", { class: "clip" }, t("myhata.title")))),
        h("a", { class: "cat", href: "#/files" }, h("span", { class: "with-icon" }, icon("folder"), h("span", { class: "clip" }, t("files.home")))),
        machinesList,
        volumes.length > 0 && h("div", { class: "cat-title" }, m?.name ?? t("files.disks")),
        volumes.length > 0 && place(t("files.root"), "/", "disk", !volumes.some((d) => within(path, d.path))),
        volumes.map((d) => place(volumeName(d), d.path, d.network ? "globe" : "disk", inside(d.path), machine)),
      ),
    );
  }
  // the connected disks and network drives are places of their own: a disk just connected is found here at once.
  // The trash and My Hata have no listing of their own, so the last one known is kept
  if (state.files?.disks && !filesMachine()) filesUi.volumes = state.files.disks;
  const volumes = filesUi.volumes ?? [];
  const onVolume = volumes.some((d) => inside(d.path));
  put(
    places,
    h(
      "nav",
      { class: "cats" },
      h("div", { class: "cat-title" }, t("files.places")),
      h("a", { class: "cat" + (path === "#hata" ? " active" : ""), href: "#/hata" }, h("span", { class: "with-icon" }, icon("home"), h("span", { class: "clip" }, t("myhata.title")))),
      home && place(t("files.home"), home, "folder", inHome),
      place(t("files.root"), "/", "disk", !trash && path !== "#hata" && path !== "#links" && path !== "" && !inHome && !onVolume),
      h("a", { class: "cat" + (trash ? " active" : ""), href: "#/trash" }, h("span", { class: "with-icon" }, icon("trash"), h("span", { class: "clip" }, t("trash.title")))),
      h("a", { class: "cat" + (path === "#links" ? " active" : ""), href: "#/links" }, h("span", { class: "with-icon" }, icon("link"), h("span", { class: "clip" }, t("links.side")))),
      volumes.length > 0 && [h("div", { class: "cat-title" }, t("files.disks")), volumes.map((d) => h("a", { class: "cat" + (inside(d.path) ? " active" : ""), href: filesHash(d.path, ""), title: d.path, menu: (at) => sidebarMenu(at, { label: volumeName(d), path: d.path, volume: d, iconName: d.network ? "globe" : "disk" }) }, h("span", { class: "with-icon" }, icon(d.network ? "globe" : "disk"), h("span", { class: "clip" }, volumeName(d), volumeFolder(d) && h("span", { class: "muted" }, " · " + volumeFolder(d))))))],
      favorites.length > 0 && [h("div", { class: "cat-title" }, t("files.favorites")), favorites.map(favoriteRow)],
      machinesList,
    ),
  );
}

function renderFilesBody() {
  const main = document.getElementById("files-main");
  if (!main) return;
  const path = state.route.path;
  const listing = filesListing();
  const parts = path.split("/").filter(Boolean);
  const machine = filesMachine();
  const machineName = machine && (machinesUi.list?.machines.find((m) => m.id === machine)?.name ?? machine);

  filesPlaces(path);
  const entries = listing ? sortedEntries(listing.entries) : [];
  const dirs = entries.filter((entry) => entry.type === "dir");
  const rest = entries.filter((entry) => entry.type !== "dir");
  const picker = h("input", { type: "file", multiple: true, hidden: true, onchange: () => (queueUpload(path, [...picker.files].map((file) => ({ file, sub: "" }))), (picker.value = "")) });
  const setMode = (mode) => {
    filesUi.mode = mode;
    localStorage.setItem("hata.files.mode", mode);
    renderFilesBody();
  };
  const sort = h(
    "select",
    { class: "sort", "aria-label": t("files.sort"), onchange: () => ((filesUi.sort = sort.value), localStorage.setItem("hata.files.sort", sort.value), renderFilesBody()) },
    ["name", "modified", "size"].map((key) => h("option", { value: key, selected: filesUi.sort === key }, t("files.sort." + key))),
  );

  const isPinned = (listing?.pinned ?? []).includes(path);
  const isShared = (listing?.shared ?? []).includes(listing?.path);
  const trail = filesUi.trail;
  const here = listing && !listing.error && !machine;
  // what the folder holds may have changed from elsewhere: over the network, by an app, in a terminal
  const folderMore = () => [
    { label: t("files.reload"), icon: "refresh", run: () => loadFiles() },
    phone.matches && !(!listing || listing.error || listing.readOnly) && { label: t("files.new"), icon: "plus", run: () => newMenu(path, document.querySelector(".files-tools .ui-more")) },
    here && { label: t(isFavorite(path) ? "files.unfavorite" : "files.favorite"), icon: "star", on: isFavorite(path), run: () => favorite(path, !isFavorite(path)) },
    here && isAdmin() && { label: t(isPinned ? "files.unpin" : "files.pin"), icon: "home", on: isPinned, run: () => pinFolder(path, !isPinned) },
    here && isAdmin() && { label: t(isShared ? "files.shareSettings" : "files.share") + "…", icon: "share", run: () => shareDialog(path) },
  ].filter(Boolean);
  const navButton = (label, iconName, off, run, cls = "") => h("button", { type: "button", class: "btn square", title: label, "aria-label": label, disabled: off, onclick: run }, icon(iconName, cls));
  const head = h(
    "div",
    { class: "page-head files-head" },
    h(
      "div",
      { class: "files-bar" },
      h(
        "div",
        { class: "files-nav" },
        navButton(t("files.back"), "arrow", !(trail && trail.at > trail.first), () => history.back(), "flip"),
        navButton(t("files.forward"), "arrow", !(trail && trail.at < trail.last), () => history.forward()),
        navButton(t("files.up"), "up", !!filesMachine() && path === "/", goUp),
      ),
      filesUi.edit ? addressEditor() : filesAddress(path),
    ),
    h(
      "div",
      { class: "files-tools" },
      listing && !listing.error && !machine && findBox(path),
      h("span", { class: "grow" }),
      sort,
      uiSegment([{ value: "list", icon: "list", label: h("span", { class: "sr-only" }, t("files.view.list")) }, { value: "grid", icon: "grid", label: h("span", { class: "sr-only" }, t("files.view.grid")) }], filesUi.mode, setMode, { label: t("files.view") }),
      button(t("files.new"), { class: "files-new", disabled: !listing || !!listing.error || listing.readOnly, onclick: (e) => newMenu(path, e.currentTarget) }, "plus"),
      button(t("files.upload"), { class: "primary", disabled: !listing || !!listing.error || listing.readOnly, onclick: () => picker.click() }, "upload"),
      uiMore(folderMore),
      picker,
    ),
  );
  // what the folder holds, and the room of its disk: under the list, where the files end
  const status =
    listing &&
    !listing.error &&
    h(
      "div",
      { class: "files-status" },
      h("span", null, listing.readOnly && uiState("warn", t("files.readOnly")), t("files.count", { dirs: dirs.length, files: rest.length }), rest.length > 0 && h("span", { class: "dot-sep" }, "·"), rest.length > 0 && bytes(rest.reduce((n, entry) => n + entry.size, 0))),
      listing.disk && h("span", null, t("files.free", { free: bytes(listing.disk.free), total: bytes(listing.disk.total) })),
    );

  const selection = h("div", { class: "card selection", id: "files-selection", hidden: true });
  let body;
  if (!listing) body = h("p", { class: "muted" }, " ");
  else if (listing.error) body = uiCard({}, uiEmpty({ size: "error", title: t("files.cannotRead"), text: listing.error, action: button(t("ui.retry"), { onclick: () => loadFiles() }) }));
  else if (!entries.length)
    body = h(
      "div",
      { class: "card empty-folder" + (listing.readOnly ? " read-only" : "") },
      uiEmpty({ size: "big", icon: "folder", title: t("files.empty"), text: listing.readOnly ? null : t("files.dropHint"), action: !listing.readOnly && button(t("files.uploadFiles"), { class: "primary", onclick: () => picker.click() }, "upload") }),
    );
  else body = filesUi.mode === "grid" ? filesGrid(dirs, rest) : filesTable(entries);
  const finding = filesUi.find && filesUi.find.under === path;
  if (finding) body = foundList(filesUi.find);
  // in a list the line closes its card; under tiles or an empty folder it is a card of its own
  const inCard = !finding && status && body.classList.contains("table-wrap");
  if (inCard) body.append(status);

  put(main, head, selection, body, listing?.truncated && uiCard({}, uiEmpty({ text: t("files.truncated") })), !finding && !inCard && status && h("div", { class: "card" }, status), uploadBox);
  renderSelection();
  if (filesUi.edit) {
    const input = main.querySelector(".address-input");
    input.focus();
    if (filesUi.edit.select) input.select();
    else input.setSelectionRange(filesUi.edit.caret ?? input.value.length, filesUi.edit.caret ?? input.value.length);
    filesUi.edit.select = false;
  } else fitCrumbs();
}

// --- The address: back, forward, up, the path as crumbs, or typed ------------------------------------

/** Numbers the browser's entry Files is on, so that back and forward know whether there is somewhere to go */
function stepTrail() {
  const step = history.state?.filesStep;
  const trail = filesUi.trail;
  if (typeof step !== "number") {
    // a folder opened anew: what lay ahead of the current one is gone, as in the browser
    const next = trail ? trail.at + 1 : 1;
    history.replaceState({ ...(history.state ?? {}), filesStep: next }, "");
    filesUi.trail = { first: trail?.first ?? next, at: next, last: next };
  } else if (!trail) filesUi.trail = { first: step, at: step, last: step };
  else Object.assign(trail, { at: step, first: Math.min(trail.first, step), last: Math.max(trail.last, step) });
}

/** One level up; the folder left is the one the keys stand on there */
function goUp() {
  const path = state.route.path;
  // above the data folder and the whole server is My Hata, where every place is
  if ((!filesMachine() && (!path || path === "/" || path === state.files?.home)) || myShares()?.some((share) => share.path === path)) return go("#/hata");
  if (!path || path === "/") return;
  filesUi.cursorNext = path.split("/").pop();
  go(filesHash(path.slice(0, path.lastIndexOf("/")) || "/"));
}

/** Where a path lies, for its first crumb: the data folder, a disk or a network place by name, else the root */
function pathAnchor(path) {
  const machine = filesMachine();
  const files = state.files;
  const named = [
    ...(myShares() ?? []).map((share) => ({ path: share.path, label: share.name, icon: "share" })),
    !machine && files?.home && { path: files.home, label: t("files.home"), icon: "folder" },
    ...((files?.machine ?? "") === machine ? (files?.disks ?? []) : []).map((d) => ({ path: d.path, label: volumeName(d), icon: d.network ? "globe" : "disk" })),
  ].filter((place) => place && within(path, place.path));
  const root = machine ? { path: "/", label: machinesUi.list?.machines.find((m) => m.id === machine)?.name ?? machine, icon: "server" } : { path: "/", label: t("files.root"), icon: "disk" };
  return named.sort((a, b) => b.path.length - a.path.length)[0] ?? root;
}

/** The path as crumbs: each opens its folder, the arrow after it the folders inside; a click beside them types a path */
function filesAddress(path) {
  const anchor = pathAnchor(path);
  const parts = path.slice(anchor.path === "/" ? 1 : anchor.path.length + 1).split("/").filter(Boolean);
  const steps = [anchor, ...parts.map((name, i) => ({ label: name, path: (anchor.path === "/" ? "" : anchor.path) + "/" + parts.slice(0, i + 1).join("/") }))];
  const crumbs = h(
    "h1",
    { class: "crumbs" },
    steps.map((step, i) => [
      h("a", { class: "crumb" + (i === steps.length - 1 ? " here" : ""), href: filesHash(step.path), "data-step": String(i) }, step.icon && icon(step.icon), h("span", { class: "clip" }, step.label)),
      h("button", { type: "button", class: "sep", "data-step": String(i), title: t("files.inside", { name: step.label }), "aria-label": t("files.inside", { name: step.label }), onclick: (e) => folderList(e.currentTarget, step.path, steps[i + 1]?.label) }, icon("chevron")),
    ]),
  );
  crumbs.steps = steps;
  const address = h(
    "div",
    { class: "address", onclick: (e) => (e.target === address || e.target === crumbs) && editAddress() },
    crumbs,
    h(
      "span",
      { class: "address-tail" },
      h("button", { type: "button", class: "icon-btn", title: t("files.copyPath"), "aria-label": t("files.copyPath"), onclick: () => copyText(path) }, icon("copy")),
      h("button", { type: "button", class: "icon-btn", title: t("files.typePath"), "aria-label": t("files.typePath"), onclick: () => editAddress() }, icon("edit")),
    ),
  );
  return address;
}

/** A long path keeps its last crumbs; the ones before fold into "…", which lists them */
function fitCrumbs() {
  const crumbs = document.querySelector("#files-main .crumbs");
  if (!crumbs?.steps) return;
  const steps = crumbs.steps;
  const hidden = [];
  for (let i = 0; i < steps.length - 1 && crumbs.scrollWidth > crumbs.clientWidth; i++) {
    for (const el of crumbs.querySelectorAll(`[data-step="${i}"]`)) el.hidden = true;
    hidden.push(steps[i]);
  }
  if (!hidden.length) return;
  const more = h("button", { type: "button", class: "crumb", title: t("files.earlier"), "aria-label": t("files.earlier"), onclick: (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    menuAt({ x: box.left, y: box.bottom + 6 }, null, hidden.map((step) => ({ label: step.label, icon: step.icon ?? "folder", href: filesHash(step.path) })));
  } }, "…");
  crumbs.prepend(more, h("span", { class: "sep still" }, icon("chevron")));
}

/** The folders inside one of the path: the arrow after a crumb */
async function folderList(anchor, path, here) {
  const box = anchor.getBoundingClientRect();
  let listing = state.files?.path === path && (state.files.machine ?? "") === filesMachine() ? state.files : null;
  try {
    listing ??= await api("GET", `${filesApi()}?path=${encodeURIComponent(path)}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const collator = new Intl.Collator(state.lang, { numeric: true, sensitivity: "base" });
  const dirs = listing.entries.filter((entry) => entry.type === "dir").map((entry) => entry.name).sort(collator.compare);
  menuAt(
    { x: box.left - 8, y: box.bottom + 6 },
    null,
    dirs.length ? dirs.map((name) => ({ label: name, icon: "folder", href: filesHash(joinPath(path, name)), on: name === here })) : [{ label: t("files.noFolders"), icon: "folder", off: true, run: () => {} }],
  );
}

/** Turns the crumbs into a field with the path; `text` — what to start with instead of the folder's path */
function editAddress(text) {
  filesUi.edit = text === undefined ? { value: state.route.path, select: true } : { value: text, caret: text.length };
  renderFilesBody();
}

/** "a/../b/./c" as the folder it means; relative to the folder on screen, "~" — the data folder */
function resolvePath(raw) {
  let text = raw.trim();
  if (text === "~" || text.startsWith("~/")) text = (filesMachine() ? "/" : state.files?.home || "/") + text.slice(1);
  if (!text.startsWith("/")) text = joinPath(state.route.path || "/", text);
  const out = [];
  for (const part of text.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

/** The path typed: folders offered as in a terminal, Enter goes there, Esc leaves it */
function addressEditor() {
  const edit = filesUi.edit;
  const input = h("input", { class: "address-input mono", value: edit.value, spellcheck: false, autocomplete: "off", autocapitalize: "off", "aria-label": t("files.typePath") });
  const pop = h("div", { class: "address-pop", hidden: true });
  const listings = new Map();
  const listOf = (dir) => {
    if (!listings.has(dir)) listings.set(dir, api("GET", `${filesApi()}?path=${encodeURIComponent(dir)}`).catch((e) => ({ error: errorText(e), entries: [] })));
    return listings.get(dir);
  };
  const collator = new Intl.Collator(state.lang, { numeric: true, sensitivity: "base" });
  const kbd = (key, what) => [h("kbd", null, key), " ", what];
  let hits = [];
  let at = -1;
  let asked = 0;
  let leaving = false;
  const paint = (message = "") => {
    put(
      pop,
      message && h("p", { class: "address-error" }, message),
      hits.map((path, i) => h("button", { type: "button", class: "address-hit" + (i === at ? " on" : ""), onpointerdown: (e) => e.preventDefault(), onclick: () => travel(path) }, icon("folder"), h("span", { class: "clip" }, path))),
      h("p", { class: "address-keys" }, kbd("↑↓", t("files.keys.choose")), " · ", kbd("Tab", t("files.keys.complete")), " · ", kbd("Enter", t("files.keys.go")), " · ", kbd("Esc", t("files.keys.cancel"))),
    );
    pop.hidden = false;
  };
  const suggest = async () => {
    edit.value = input.value;
    edit.caret = input.selectionStart;
    const cut = input.value.lastIndexOf("/");
    if (cut < 0) return void ((hits = []), (at = -1), paint());
    const dir = resolvePath(input.value.slice(0, cut + 1) || "/");
    const typed = input.value.slice(cut + 1).toLowerCase();
    const mine = ++asked;
    const listing = await listOf(dir);
    if (mine !== asked) return;
    const names = listing.entries.filter((entry) => entry.type === "dir").map((entry) => entry.name).sort(collator.compare);
    const starting = names.filter((name) => name.toLowerCase().startsWith(typed));
    hits = [...starting, ...names.filter((name) => !starting.includes(name) && name.toLowerCase().includes(typed))].slice(0, 12).map((name) => joinPath(dir, name));
    at = typed && hits.length ? 0 : -1;
    paint(listing.error);
  };
  const close = () => {
    filesUi.edit = null;
    renderFilesBody();
  };
  const travel = async (raw) => {
    const path = resolvePath(raw);
    leaving = true;
    try {
      await api("GET", `${filesApi()}?path=${encodeURIComponent(path)}`);
      filesUi.edit = null;
      return go(filesHash(path));
    } catch (e) {
      // a file: its folder opens with it chosen
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      const name = path.split("/").pop();
      const there = await listOf(parent);
      if (!there.error && there.entries.some((entry) => entry.name === name && entry.type !== "dir")) {
        filesUi.edit = null;
        filesUi.pick = name;
        filesUi.cursorNext = name;
        return go(filesHash(parent));
      }
      leaving = false;
      hits = [];
      at = -1;
      paint(e instanceof ApiError && e.code === "files.notFound" ? t("files.noSuchFolder", { path }) : errorText(e));
      input.focus();
    }
  };
  input.addEventListener("input", () => void suggest());
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      at = (at + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      return paint();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (!hits.length) return;
      input.value = hits[Math.max(at, 0)] + "/";
      return void suggest();
    }
    // the field's keys are its own: the list under it must not hear them too
    if (e.key === "Enter") return (e.preventDefault(), e.stopPropagation(), void travel(at >= 0 ? hits[at] : input.value));
    if (e.key === "Escape") return (e.preventDefault(), e.stopPropagation(), close());
  });
  // a click elsewhere puts the crumbs back
  input.addEventListener("blur", () => setTimeout(() => !leaving && filesUi.edit === edit && document.activeElement !== input && close(), 0));
  input.addEventListener("focus", () => pop.hidden && paint());
  return h("div", { class: "address editing" }, input, pop);
}

/** The keys of Files: the cursor moves with the arrows, Enter opens, Space chooses; the path by Ctrl+L or "/" */
const typedName = { text: "", at: 0 };
function filesKeys(e) {
  if (state.route.view !== "files" || document.querySelector("dialog[open]")) return;
  const active = document.activeElement;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName ?? "") || active?.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && e.key.toLowerCase() === "l") return (e.preventDefault(), editAddress());
  if (typing) return;
  if (e.key === "/" && !mod && !e.altKey) return (e.preventDefault(), editAddress("/"));
  if ((e.altKey && e.key === "ArrowUp") || (e.key === "Backspace" && !mod && !e.altKey)) return (e.preventDefault(), goUp());
  if (e.altKey || filesUi.find || !filesListing() || filesListing().error) return;
  const els = [...document.querySelectorAll("#files-main [data-name]")];
  const entryOf = (name) => state.files.entries.find((entry) => entry.name === name);
  const current = els.findIndex((el) => el.dataset.name === filesUi.cursor);
  const cursorEntry = current >= 0 ? entryOf(filesUi.cursor) : null;
  if (mod && e.key.toLowerCase() === "a") {
    e.preventDefault();
    filesUi.selected = new Set(state.files.entries.map((entry) => entry.name));
    return renderFilesBody();
  }
  if (mod) return;
  const moves = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
  if (e.key in moves && els.length) {
    e.preventDefault();
    let next;
    if (current < 0) next = e.key === "End" ? els.length - 1 : 0;
    else if (e.key === "Home" || e.key === "End") next = e.key === "Home" ? 0 : els.length - 1;
    else if (filesUi.mode === "grid" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      // in tiles up and down go to the nearest tile of the row above or below
      const from = els[current].getBoundingClientRect();
      const down = e.key === "ArrowDown";
      const rows = els.map((el, i) => ({ i, box: el.getBoundingClientRect() })).filter(({ box }) => (down ? box.top > from.top + 4 : box.top < from.top - 4));
      if (!rows.length) return;
      const rowTop = down ? Math.min(...rows.map(({ box }) => box.top)) : Math.max(...rows.map(({ box }) => box.top));
      next = rows.filter(({ box }) => Math.abs(box.top - rowTop) < 4).sort((a, b) => Math.abs(a.box.left - from.left) - Math.abs(b.box.left - from.left))[0].i;
    } else if (filesUi.mode !== "grid" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
    else next = Math.min(els.length - 1, Math.max(0, current + moves[e.key]));
    return setCursor(els[next].dataset.name);
  }
  if (e.key === "Enter" && cursorEntry) {
    e.preventDefault();
    return cursorEntry.type === "dir" ? go(filesHash(joinPath(state.files.path, cursorEntry.name))) : openEntry(cursorEntry);
  }
  if (e.key === " " && cursorEntry) return (e.preventDefault(), toggleSelected(cursorEntry, !filesUi.selected.has(cursorEntry.name)));
  if (e.key === "Delete") {
    const chosen = selectedEntries();
    if (chosen.length || cursorEntry) (e.preventDefault(), deleteDialog(chosen.length ? chosen : [cursorEntry]));
    return;
  }
  if (e.key === "F2" && cursorEntry) return (e.preventDefault(), renameDialog(cursorEntry));
  if (e.key === "Escape") {
    filesUi.selected = new Set();
    filesUi.cursor = null;
    return renderFilesBody();
  }
  // letters typed one after another find the name that starts with them
  if (e.key.length === 1 && e.key !== " ") {
    const now = Date.now();
    typedName.text = (now - typedName.at < 900 ? typedName.text : "") + e.key.toLowerCase();
    typedName.at = now;
    const found = els.find((el) => el.dataset.name.toLowerCase().startsWith(typedName.text));
    if (found) setCursor(found.dataset.name);
  }
}
document.addEventListener("keydown", filesKeys);

function setCursor(name) {
  filesUi.cursor = name;
  for (const el of document.querySelectorAll("#files-main [data-name]")) {
    const on = el.dataset.name === name;
    el.classList.toggle("cursor", on);
    if (on) el.scrollIntoView({ block: "nearest" });
  }
}

/** How full a disk is: a thin bar and "free X of Y" — on a narrow tile only "X free", the rest on hover */
function diskRoom(volume, short = false) {
  const used = Math.round(((volume.total - volume.free) / volume.total) * 100);
  const fill = h("i", { class: level(used) });
  fill.style.width = used + "%";
  const whole = t("files.free", { free: bytes(volume.free), total: bytes(volume.total) });
  return h("span", { class: "tile-room", title: short ? whole : "" }, h("span", { class: "bar" }, fill), h("span", { class: "muted small clip" }, short ? t("home.diskFree", { free: bytes(volume.free) }) : whole));
}

/** What a disk is called: its label, or the folder it is mounted at */
const volumeName = (volume) => volume.label || volume.path.split("/").pop() || volume.path;
/** The folder a volume is connected at, when its own label says something else: "Data" alone would not tell which disk */
const volumeFolder = (volume) => ((folder) => (volume.label && folder && folder !== volume.label ? folder : ""))(volume.path.split("/").pop() ?? "");
/** The disks that are not inside the data folder already, where people look for them */
const outerVolumes = (listing) => (listing?.disks ?? []).filter((d) => !(d.path + "/").startsWith((listing.home || "\0") + "/"));

/**
 * My Hata: everything Files can open, in one page — this server's places, its disks, the network
 * places, the favourites and the machines — like "This PC" of a desktop
 */
async function loadMyHata() {
  if (!isAdmin()) {
    await loadMine();
    if (state.route.view === "myhata") renderMyHata();
    return;
  }
  const [data, root] = await Promise.all([api("GET", "/api/files?path=").catch(() => null), api("GET", "/api/files?path=" + encodeURIComponent("/")).catch(() => null)]);
  if (data) {
    state.files = data;
    if (data.favorites) state.favorites = data.favorites;
  }
  myHataUi.root = root?.disk ?? null;
  if (!machinesUi.list) await loadMachines().catch(() => {});
  if (state.route.view === "myhata") renderMyHata();
}

const myHataUi = { root: null };

/** A tile of My Hata: what it is, where, and how full when it is a file system */
function hataTile({ href, onclick, iconName, title, sub, room, menu, cls = "", words = false }) {
  let foot = null;
  if (room?.total) {
    const used = Math.round(((room.total - room.free) / room.total) * 100);
    foot = [uiMeter(used), h("span", { class: "ui-tile-free" }, t("files.free", { free: bytes(room.free), total: bytes(room.total) }))];
  }
  return uiTile({
    href: href ?? (onclick ? null : "#"),
    onclick: onclick ? (e) => (e.preventDefault?.(), onclick(e)) : null,
    icon: iconName,
    name: title,
    sub: sub && (words || !String(sub).startsWith("/") ? sub : h("span", { class: "mono" }, sub)),
    foot,
    menu,
    kind: [cls === "add" ? "adds" : "", cls === "away" ? "away" : ""].filter(Boolean).join(" "),
  });
}

function renderMyHata() {
  if (!isAdmin()) return renderMySharedFolders();
  const listing = state.files;
  const home = listing?.home ?? "";
  const disks = listing?.disks ?? [];
  const volumeTile = (volume) => hataTile({ href: filesHash(volume.path, ""), iconName: volume.network ? "globe" : "disk", title: volumeName(volume), sub: volume.path, room: volume, menu: (at) => sidebarMenu(at, { label: volumeName(volume), path: volume.path, volume, iconName: volume.network ? "globe" : "disk" }) });
  const favoriteTile = (one) => {
    const name = one.path.split("/").pop() || "/";
    const parent = one.path.slice(0, one.path.lastIndexOf("/")) || "/";
    return hataTile({ href: filesHash(one.dir ? one.path : parent, ""), onclick: one.dir ? null : () => (filesUi.pick = name), iconName: one.dir ? "folder" : "file", title: name, sub: one.path, menu: (at) => menuAt(at, menuHeader(name, one.path, one.dir ? "folder" : "file"), [{ label: t("files.copyPath"), icon: "copy", run: () => copyText(one.path) }, { label: t("files.unfavorite"), icon: "star", run: () => favorite(one.path, false, name) }]) });
  };
  const machineTile = (m) => hataTile({ href: m.online ? filesHash("/", m.id) : `#/machines/${m.id}`, iconName: "server", title: m.name, sub: m.online ? machineOs(m) : t("machines.offline"), cls: m.online ? "" : "away" });
  const section = (title, tiles, extra) => uiCard({ title, actions: extra, cls: "my-hata" }, h("div", { class: "ui-tiles" }, tiles));
  const local = disks.filter((d) => !d.network);
  const network = disks.filter((d) => d.network);
  const machines = machinesUi.list?.machines ?? [];
  const favorites = state.favorites ?? [];
  shell(
    h(
      "div",
      { class: "files" },
      h("aside", { class: "files-side fold", id: "files-places" }),
      h(
        "section",
        { class: "stack", id: "files-main" },
        pageHead({ title: t("myhata.title"), facts: [t("myhata.lead")] }),
        !listing
          ? uiCard({}, uiEmpty({ size: "loading" }))
          : [
              section(t("myhata.server"), [
                home && hataTile({ href: filesHash(home, ""), iconName: "folder", title: t("files.home"), sub: home, room: listing.disk }),
                hataTile({ href: filesHash("/", ""), iconName: "disk", title: t("files.root"), sub: "/", room: myHataUi.root }),
                hataTile({ href: "#/trash", iconName: "trash", title: t("trash.title"), sub: t("myhata.trash") }),
              ]),
              section(t("files.disks"), local.length ? local.map(volumeTile) : uiEmpty({ text: t("myhata.noDisks") }), h("a", { class: "ui-link", href: "#/storage/disks" }, t("myhata.storage"), icon("chevron"))),
              section(t("myhata.network"), [
                ...network.map(volumeTile),
                hataTile({ onclick: (e) => (e.preventDefault(), findPlacesDialog()), iconName: "search", title: t("myhata.browse"), sub: t("myhata.browseLead"), cls: "add" }),
                hataTile({ onclick: addPlaceHere, iconName: "plus", title: t("netplace.sidebar"), sub: t("myhata.addPlace"), cls: "add" }),
              ]),
              favorites.length > 0 && section(t("files.favorites"), favorites.map(favoriteTile)),
              section(t("nav.machines"), machines.length ? machines.map(machineTile) : hataTile({ href: "#/machines", iconName: "plus", title: t("myhata.addMachine"), sub: t("myhata.addMachineLead"), cls: "add" }), machines.length > 0 && h("a", { class: "ui-link", href: "#/machines" }, t("myhata.allMachines"), icon("chevron"))),
            ],
      ),
    ),
  );
  filesPlaces("#hata");
}

/** My Hata of one who is not an administrator: the folders shared with them, and their favourites */
function renderMySharedFolders() {
  const shares = state.myShares;
  const favorites = state.favorites ?? [];
  const section = (title, tiles) => uiCard({ title, cls: "my-hata" }, h("div", { class: "ui-tiles" }, tiles));
  // a machine that is away keeps its tiles, greyed: its folders open once it is back
  const shareTile = (share, m) => hataTile({ href: filesHash(share.path, m ? m.id : ""), iconName: "share", title: share.name, sub: m && !m.online ? t("machines.offline") : t(share.access === "write" ? "myhata.mayWrite" : "myhata.mayRead"), words: true, cls: m && !m.online ? "away" : "", menu: (at) => sidebarMenu(at, { label: share.name, path: share.path, machine: m ? m.id : "", iconName: "share" }) });
  const favoriteTile = (one) => {
    const name = one.path.split("/").pop() || "/";
    const parent = one.path.slice(0, one.path.lastIndexOf("/")) || "/";
    return hataTile({ href: filesHash(one.dir ? one.path : parent, ""), onclick: one.dir ? null : () => (filesUi.pick = name), iconName: one.dir ? "folder" : "file", title: name, sub: one.path, menu: (at) => menuAt(at, menuHeader(name, one.path, one.dir ? "folder" : "file"), [{ label: t("files.unfavorite"), icon: "star", run: () => favorite(one.path, false, name) }]) });
  };
  shell(
    h(
      "div",
      { class: "files" },
      h("aside", { class: "files-side fold", id: "files-places" }),
      h(
        "section",
        { class: "stack", id: "files-main" },
        pageHead({ title: t("myhata.title"), facts: [t("myhata.sharedLead")] }),
        !shares
          ? uiCard({}, uiEmpty({ size: "loading" }))
          : [
              (shares.length > 0 || !(state.myMachines ?? []).length) && section(t("myhata.shared"), shares.length ? shares.map((share) => shareTile(share, "")) : uiEmpty({ text: t("myhata.nothingShared") })),
              (state.myMachines ?? []).map((m) => section(t("myhata.onMachine", { name: m.name }), m.shares.map((share) => shareTile(share, m)))),
              favorites.length > 0 && section(t("files.favorites"), favorites.map(favoriteTile)),
            ],
      ),
    ),
  );
  filesPlaces("#hata");
}

const selectedEntries = () => (state.files?.entries ?? []).filter((entry) => filesUi.selected.has(entry.name));

function toggleSelected(entry, on) {
  if (on) filesUi.selected.add(entry.name);
  else filesUi.selected.delete(entry.name);
  for (const el of document.querySelectorAll("#files-main [data-name]")) {
    if (el.dataset.name !== entry.name) continue;
    el.classList.toggle("selected", on);
    el.querySelector("input[type=checkbox]").checked = on;
  }
  renderSelection();
}

function renderSelection() {
  const box = document.getElementById("files-selection");
  if (!box) return;
  const chosen = selectedEntries();
  box.hidden = !chosen.length;
  const all = document.getElementById("files-all");
  if (all) {
    all.checked = chosen.length > 0 && chosen.length === state.files.entries.length;
    all.indeterminate = chosen.length > 0 && !all.checked;
  }
  if (!chosen.length) return;
  put(box,
    h("strong", { class: "grow" }, t("files.selected", { n: chosen.length }), h("span", { class: "muted small" }, " · " + bytes(chosen.reduce((n, entry) => n + entry.size, 0)))),
    button(t("files.download"), { class: "small", onclick: () => downloadEntries(chosen) }, "download"),
    !state.files.readOnly && button(t("files.move"), { class: "small", onclick: () => transferDialog(chosen, false) }, "arrow"),
    button(t("files.copy"), { class: "small", onclick: () => transferDialog(chosen, true) }, "copy"),
    !state.files.readOnly && button(t("files.delete"), { class: "small", onclick: () => deleteDialog(chosen) }, "trash"),
    h("button", { type: "button", class: "icon-btn", "aria-label": t("files.clearSelection"), title: t("files.clearSelection"), onclick: () => ((filesUi.selected = new Set()), renderFilesBody()) }, icon("x")),
  );
}

const entryCheckbox = (entry) => h("input", { type: "checkbox", checked: filesUi.selected.has(entry.name), "aria-label": entry.name, onclick: (e) => e.stopPropagation(), onchange: (e) => toggleSelected(entry, e.target.checked) });
const entryMore = (entry) => h("button", { type: "button", class: "icon-btn", "aria-label": `${t("files.actions")}: ${entry.name}`, title: t("files.actions"), onclick: (e) => (e.preventDefault(), e.stopPropagation(), entryMenu(entry)) }, icon("more"));
/** A folder is a link (so it opens in a new tab too); a file opens in place */
const entryOpener = (entry, className, ...content) =>
  entry.type === "dir"
    ? h("a", { class: className, href: filesHash(joinPath(state.files.path, entry.name)) }, content)
    : h("button", { type: "button", class: className, onclick: () => openEntry(entry) }, content);

/** Small signs after a name: a favourite, a folder on the dashboard, a folder shared over the network */
const entryMarks = (entry) => {
  const path = joinPath(state.files.path, entry.name);
  const mark = (iconName, title) => h("span", { class: "shared-mark", title }, icon(iconName));
  const here = !filesMachine();
  return [
    here && entry.type !== "other" && isFavorite(path) && mark("star", t("files.favoriteMark")),
    here && entry.type === "dir" && (state.files.pinned ?? []).includes(path) && mark("home", t("files.pinnedMark")),
    entry.type === "dir" && (state.files.shared ?? []).includes(path) && mark("share", t("files.sharedMark")),
  ];
};

function filesTable(entries) {
  const all = h("input", {
    type: "checkbox",
    id: "files-all",
    "aria-label": t("files.selectAll"),
    onchange: () => ((filesUi.selected = new Set(all.checked ? entries.map((entry) => entry.name) : [])), renderFilesBody()),
  });
  const row = (entry) =>
    h(
      "tr",
      { class: (filesUi.selected.has(entry.name) ? "selected" : "") + (filesUi.cursor === entry.name ? " cursor" : ""), "data-name": entry.name },
      h("td", { class: "tick" }, entryCheckbox(entry)),
      h("td", { class: "name" }, entryOpener(entry, "file-name", fileIcon(entry), h("span", { class: "clip" }, entry.name), entry.link && icon("link", "faint"), entryMarks(entry))),
      h("td", { class: "num muted" }, entry.type === "file" ? bytes(entry.size) : "—"),
      h("td", { class: "muted when" }, fileTime(entry.modified)),
      h("td", { class: "tick" }, entryMore(entry)),
    );
  return h("div", { class: "card table-wrap" }, h("table", { class: "file-table" }, h("thead", null, h("tr", null, h("th", { class: "tick" }, all), h("th", null, t("files.col.name")), h("th", { class: "num" }, t("files.col.size")), h("th", { class: "when" }, t("files.col.modified")), h("th"))), h("tbody", null, entries.map(row))));
}

/** A file without a picture: its extension and what it is, on the colour of its kind */
function extBadge(entry) {
  const dot = entry.name.lastIndexOf(".");
  const ext = dot > 0 ? entry.name.slice(dot + 1) : "";
  const tint = TINT_BY_EXT[ext.toLowerCase()] ?? "other";
  return h("span", { class: "ext tint-" + tint }, ext && ext.length <= 5 ? h("b", null, ext.toUpperCase()) : fileIcon(entry), h("small", null, t("files.kind." + tint)));
}

/** The first lines of text files, by path and time, so a new drawing of the folder does not ask again */
const peeks = new Map();
const PEEK_BYTES = 2048;

/** The thumbnail of a text file: its first lines, read when the tile comes into view */
function textPeek(entry, path, badge) {
  const key = `${filesMachine()}:${path}:${entry.modified}`;
  const box = h("span", { class: "thumb" }, peeks.get(key) ?? badge);
  if (peeks.has(key)) return box;
  const seen = new IntersectionObserver(async ([view]) => {
    if (!view.isIntersecting) return;
    seen.disconnect();
    try {
      const res = await fetch(rawUrl(path), { headers: { range: `bytes=0-${PEEK_BYTES - 1}` } });
      if (!res.ok) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      // a NUL means it is not text after all
      if (bytes.includes(0)) return;
      const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
      if (bytes.length >= PEEK_BYTES) lines.pop();
      const text = lines.slice(0, 16).join("\n");
      if (!text.trim()) return;
      if (peeks.size > 300) peeks.delete(peeks.keys().next().value);
      peeks.set(key, h("pre", { class: "peek" }, text));
      box.replaceChildren(peeks.get(key));
    } catch {}
  });
  seen.observe(box);
  return box;
}

function filesGrid(dirs, rest) {
  const tile = (entry) => {
    const path = joinPath(state.files.path, entry.name);
    const kind = fileKind(entry);
    let thumb = null;
    if (entry.type !== "dir") {
      const badge = extBadge(entry);
      if (kind === "image" && entry.size <= THUMB_MAX) thumb = h("span", { class: "thumb" }, h("img", { src: rawUrl(path), alt: "", loading: "lazy", decoding: "async", onerror: (e) => e.currentTarget.replaceWith(badge) }));
      else if (kind === "text" && entry.size > 0 && entry.size <= TEXT_MAX) thumb = textPeek(entry, path, badge);
      else thumb = h("span", { class: "thumb" }, badge);
    }
    return h(
      "div",
      { class: "file-tile" + (entry.type === "dir" ? " dir" : "") + (filesUi.selected.has(entry.name) ? " selected" : "") + (filesUi.cursor === entry.name ? " cursor" : ""), "data-name": entry.name },
      entryOpener(entry, "file-open", thumb, entry.type === "dir" && fileIcon(entry), h("span", { class: "file-text" }, h("span", { class: "clip strong" }, entry.name, entryMarks(entry)), h("span", { class: "muted small clip" }, entry.type === "file" ? `${bytes(entry.size)} · ${fileTime(entry.modified)}` : fileTime(entry.modified)))),
      h("span", { class: "file-tick" }, entryCheckbox(entry)),
      h("span", { class: "file-more" }, entryMore(entry)),
    );
  };
  // the boxes to tick show on the tile under the pointer, and on all of them once something is chosen
  return h(
    "div",
    { class: "stack files-tiles" + (filesUi.selected.size ? " choosing" : "") },
    dirs.length > 0 && h("div", { class: "file-grid dirs" }, dirs.map(tile)),
    rest.length > 0 && h("div", { class: "file-grid" }, rest.map(tile)),
  );
}

function openEntry(entry) {
  const kind = fileKind(entry);
  const path = joinPath(state.files.path, entry.name);
  if (kind === "image" || kind === "video" || kind === "audio") return mediaDialog(entry);
  if (kind === "pdf") return void window.open(rawUrl(path), "_blank", "noopener");
  if (kind === "text" && entry.size <= TEXT_MAX) return void textDialog(path);
  entryMenu(entry);
}

/** One or several files and folders: a single file as it is, anything else as a ZIP archive */
async function downloadEntries(entries) {
  const dir = state.files.path;
  const save = (href) => h("a", { href, download: "" }).click();
  if (entries.length === 1 && entries[0].type === "file") return save(rawUrl(joinPath(dir, entries[0].name), true));
  try {
    // the archive is streamed, so its limits are checked before it starts
    const sum = await api("POST", filesApi("/summary"), { paths: entries.map((entry) => joinPath(dir, entry.name)) });
    if (sum.truncated || sum.size > 3.8 * 1024 ** 3 || sum.files + sum.dirs > 60000) return toast(t("error.files.archiveTooLarge"), "error");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  save(filesApi("/zip") + "?" + entries.map((entry) => "path=" + encodeURIComponent(joinPath(dir, entry.name))).join("&"));
}

/** Puts a menu where the pointer is, inside the window; a right click beside it moves it there */
function placeAt(dialog, at) {
  const page = document.documentElement;
  dialog.style.right = "auto";
  dialog.style.left = Math.max(8, Math.min(at.x, page.clientWidth - dialog.offsetWidth - 8)) + "px";
  dialog.style.top = Math.max(8, Math.min(at.y, page.clientHeight - dialog.offsetHeight - 8)) + "px";
  dialog.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (e.target !== dialog) return;
    dialog.close();
    document.elementFromPoint(e.clientX, e.clientY)?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
  });
}

/**
 * A menu at the pointer. Entries are `{ label, icon, run }` or `{ label, icon, href, newTab }`, with
 * `danger` and `off`; false ones are skipped. `header` is what the menu is about.
 */
function menuAt(at, header, entries) {
  let dialog;
  const one = (e) =>
    e.href
      ? h("a", { class: "menu-item", href: e.href, ...(e.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {}), onclick: () => dialog.close() }, e.iconEl ?? icon(e.icon), e.label)
      : h("button", { type: "button", class: "menu-item" + (e.danger ? " danger" : ""), disabled: !!e.off, onclick: () => (dialog.close(), e.run()) }, e.iconEl ?? icon(e.icon), e.label);
  const marked = (e, el) => (e.on && el.append(icon("check", "on-mark")), el);
  dialog = openDialog("menu dropdown", header, entries.filter(Boolean).map((e) => marked(e, one(e))));
  placeAt(dialog, at);
  // opened by the pointer: the first entry is not chosen by itself (the dialog takes the focus instead)
  dialog.tabIndex = -1;
  dialog.focus();
  return dialog;
}

const menuHeader = (title, sub, iconName) => h("header", null, iconName && h("span", { class: "badge-icon plain" }, icon(iconName)), h("div", null, h("h2", { class: "clip" }, title), sub && h("span", { class: "muted small clip" }, sub)));

/** A card of the store: install it, or go to it once it is installed */
const storeCardMenu = (a, isIn, at) =>
  menuAt(at, menuHeader(a.title ?? a.name, a.category ?? ""), [
    isIn ? { label: t("common.open"), icon: "grid", href: `#/apps/${a.name}` } : { label: t("store.install") + "…", icon: "download", run: () => storeDialog(a) },
    isIn && { label: t("menu.newTab"), icon: "external", href: location.pathname + `#/apps/${a.name}`, newTab: true },
  ]);

/** Whether the element or one around it has a menu of its own */
const hasOwnMenu = (el) => {
  for (; el && el !== document.body; el = el.parentElement) if (el.hataMenu) return true;
  return false;
};

/** The rows a right click finds the actions of by themselves: what their buttons and their link do */
const MENU_ROWS = "tr, .snapshot, .machine-card, .attention-item, .tool";

/** The menu of a row made of its own buttons — the same actions, where the pointer is; false — it has none */
function rowMenu(row, at) {
  const shown = (el) => el.getClientRects().length > 0 && !el.closest("dialog:not([open])");
  const buttons = [...row.querySelectorAll("button, a.btn")].filter((b) => shown(b) && !b.closest(".menu-item") && !b.classList.contains("select-btn") && b.type !== "submit");
  // the name, without the chips that sit inside it ("test" of "test · Everything")
  const named = row.querySelector("h2 .with-icon") ?? row.querySelector("strong, h2, h3, .strong, .name");
  const title = (named && ([...named.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim() || named.textContent.trim())) || "";
  // "Back up now: Adminer" says the name for a screen reader; under a header with that name it is said once
  const labelOf = (b) => {
    const text = (b.textContent.trim() || b.getAttribute("aria-label") || b.title || "").replace(/\s+/g, " ");
    return title && text.endsWith(": " + title) ? text.slice(0, -title.length - 2) : text;
  };
  const actions = buttons.filter((b) => labelOf(b));
  // the row's own link, not one in the words under it (`.link`)
  const link = [...row.querySelectorAll("a[href]:not(.btn):not(.link)")].find((a) => shown(a) && a.getAttribute("href") !== "#");
  if (!actions.length && !link) return false;
  // a row with a "⋯" button: that menu is the row's (only that one is clicked for the person — never a delete)
  const more = actions.find((b) => b.querySelector("path")?.getAttribute("d") === ICONS.more);
  if (more) {
    more.click();
    return true;
  }
  const svgOf = (b) => b.querySelector("svg")?.cloneNode(true) ?? icon("chevron");
  // the same thing twice (a copy button by each of two lines) is said once
  const seen = new Set();
  const once = actions.filter((b) => !seen.has(labelOf(b)) && seen.add(labelOf(b)));
  menuAt(at, title && menuHeader(title), [
    link && { label: t("common.open"), icon: "folder", href: link.getAttribute("href"), ...(link.target === "_blank" ? { newTab: true } : {}) },
    link && link.target !== "_blank" && { label: t("menu.newTab"), icon: "external", href: link.href, newTab: true },
    ...once.map((b) => ({ label: labelOf(b), iconEl: svgOf(b), off: b.disabled, danger: b.classList.contains("danger"), run: () => b.click() })),
  ]);
  return true;
}

/**
 * The right click, everywhere: the menu of the thing under the pointer — one given to it (`menu` in h()),
 * or one made of a row's buttons. Text being selected, fields, frames and Shift keep the browser's own.
 */
function contextMenus() {
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented || e.shiftKey || !(e.target instanceof Element)) return;
    if (e.target.closest("input, textarea, select, .select-btn, [contenteditable], iframe, dialog.menu")) return;
    const picked = getSelection();
    if (picked && !picked.isCollapsed && picked.containsNode(e.target, true)) return;
    const at = { x: e.clientX, y: e.clientY };
    for (let el = e.target; el && el !== document.body; el = el.parentElement) {
      // `menu: true` — the element's own buttons are its menu, as in a row
      if (el.hataMenu === true && rowMenu(el, at)) return void e.preventDefault();
      if (typeof el.hataMenu === "function") {
        e.preventDefault();
        return void el.hataMenu(at);
      }
      if (el.matches(MENU_ROWS) && !el.closest("thead") && rowMenu(el, at)) return void e.preventDefault();
    }
    // nothing of its own under the pointer: the page's menu — but a link, a picture or a dialog keep the browser's
    if (e.target.closest("a[href], img, video, audio, canvas, dialog")) return;
    e.preventDefault();
    pageMenu(at);
  });
}

/** The menu of the page itself: Hata's own places, and what the page on screen can add */
function pageMenu(at) {
  const admin = isAdmin();
  menuAt(at, menuHeader("Hata", state.version, "home"), [
    mayArrange() && { label: t("grid.edit"), icon: "grid", run: gridEdit },
    admin && state.route.view === "home" && state.overview && { label: t("menu.addHere"), icon: "plus", run: () => addDialog() },
    admin && state.route.view === "home" && state.overview && { label: t("menu.dashboardConfig"), icon: "code", run: layoutTextDialog },
    admin && { label: t("menu.appearance"), icon: "image", href: "#/settings/appearance" },
    { label: t("nav.settings"), icon: "sliders", href: "#/settings" },
    { label: t("menu.about"), icon: "info", href: "#/settings/about" },
  ]);
}

/** The right click in Files: the menu of the file, of everything selected, or of the folder on screen */
function filesContext(e) {
  // Shift leaves the browser's own menu, and so does a field with text in it
  if (e.shiftKey || e.target.closest?.("input, textarea, select") || !e.target.closest?.("#files-main") || hasOwnMenu(e.target)) return;
  const listing = filesListing();
  if (!listing || listing.error) return;
  e.preventDefault();
  const at = { x: e.clientX, y: e.clientY };
  const name = e.target.closest("[data-name]")?.dataset.name;
  const entry = name !== undefined && listing.entries.find((one) => one.name === name);
  if (!entry) return folderMenu(at);
  const chosen = selectedEntries();
  if (chosen.length > 1 && chosen.includes(entry)) return selectionMenu(chosen, at);
  entryMenu(entry, at);
}

function selectionMenu(chosen, at) {
  let dialog;
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    "menu dropdown",
    h("header", null, h("div", null, h("h2", null, t("files.selected", { n: chosen.length })), h("span", { class: "muted small" }, bytes(chosen.reduce((n, entry) => n + entry.size, 0))))),
    item(t("files.downloadZip"), "download", () => downloadEntries(chosen)),
    !state.files.readOnly && item(t("files.move"), "arrow", () => transferDialog(chosen, false)),
    item(t("files.copy"), "copy", () => transferDialog(chosen, true)),
    item(t("files.clearSelection"), "x", () => ((filesUi.selected = new Set()), renderFilesBody())),
    !state.files.readOnly && item(t("files.delete"), "trash", () => deleteDialog(chosen), "danger"),
  );
  placeAt(dialog, at);
}

function folderMenu(at) {
  let dialog;
  const listing = state.files;
  const path = listing.path;
  const item = (label, iconName, action, off) => h("button", { type: "button", class: "menu-item", disabled: !!off, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    "menu dropdown",
    h("header", null, h("span", { class: "badge-icon plain" }, icon("folder")), h("div", null, h("h2", { class: "clip" }, path.split("/").pop() || "/"))),
    item(t("files.newFolder"), "folder", () => newFolderDialog(path, loadFiles), listing.readOnly),
    item(t("files.newFile"), "file", () => newFileDialog(path), listing.readOnly),
    item(t("files.upload"), "upload", () => document.querySelector("#files-main .page-head input[type=file]")?.click(), listing.readOnly),
    listing.entries.length > 0 && item(t("files.selectAll"), "check", () => ((filesUi.selected = new Set(listing.entries.map((entry) => entry.name))), renderFilesBody())),
    listing.entries.length > 0 && item(t("files.downloadZip"), "download", () => downloadEntries(listing.entries.filter((entry) => entry.type !== "other"))),
    item(t("files.size"), "disk", () => sizeDialog(path, path.split("/").pop() || "/")),
    item(t("files.copyPath"), "link", () => copyText(path)),
    !listing.machine && item(t(isFavorite(path) ? "files.unfavorite" : "files.favorite"), "star", () => favorite(path, !isFavorite(path))),
    !listing.machine && isAdmin() && item(t(listing.pinned.includes(path) ? "files.unpin" : "files.pin"), "home", () => pinFolder(path, !listing.pinned.includes(path))),
    !listing.machine && isAdmin() && item(t(listing.shared.includes(path) ? "files.shareSettings" : "files.share"), "share", () => shareDialog(path)),
    !listing.machine && mayLink() && path !== "/" && item(t("links.menu"), "link", () => shareLinkDialog(path, path.split("/").pop() || "/", true)),
    !listing.machine && mayLink() && path !== "/" && !listing.readOnly && item(t("links.menuDrop"), "upload", () => shareLinkDialog(path, path.split("/").pop() || "/", true, "drop")),
    machineLet(listing.machine) && path !== "/" && item(t("machines.people.shareHere"), "share", () => machineShareDialog(machineLet(listing.machine), path)),
  );
  placeAt(dialog, at);
}

function entryMenu(entry, at) {
  let dialog;
  const kind = fileKind(entry);
  const path = joinPath(state.files.path, entry.name);
  const item = (label, iconName, action, cls = "") => h("button", { type: "button", class: "menu-item " + cls, onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog(
    at ? "menu dropdown" : "menu",
    h("header", null, h("span", { class: "badge-icon plain" }, fileIcon(entry)), h("div", null, h("h2", { class: "clip" }, entry.name), h("span", { class: "muted small" }, entry.type === "file" ? `${bytes(entry.size)} · ${fileTime(entry.modified)}` : fileTime(entry.modified)))),
    entry.type === "dir" && item(t("common.open"), "folder", () => go(filesHash(path))),
    entry.type === "dir" && at && item(t("files.openTab"), "external", () => window.open(filesHash(path), "_blank", "noopener")),
    ["image", "video", "audio", "pdf"].includes(kind) && item(t("common.open"), "external", () => openEntry(entry)),
    entry.type === "file" && entry.size <= TEXT_MAX && !["image", "video", "audio", "pdf"].includes(kind) && item(t("files.edit"), "edit", () => textDialog(path)),
    entry.type !== "other" && item(t(entry.type === "dir" ? "files.downloadZip" : "files.download"), "download", () => downloadEntries([entry])),
    entry.type === "file" && ARCHIVE_RE.test(entry.name) && !state.files.readOnly && !filesMachine() && isAdmin() && item(t("files.extract"), "archive", () => extractArchive(path)),
    entry.type === "file" && TV_PLAYS_RE.test(entry.name) && !filesMachine() && isAdmin() && hasModule("tv") && item(t("tv.play"), "tv", () => playOnTv(path, entry.name)),
    (entry.type === "dir" || (entry.type === "file" && MUSIC_PLAYS_RE.test(entry.name))) && !filesMachine() && isAdmin() && hasModule("music") && item(t("music.play"), "speaker", () => playMusic({ path }, entry.name)),
    (entry.type === "dir" || (entry.type === "file" && MUSIC_PLAYS_RE.test(entry.name))) && !filesMachine() && isAdmin() && hasModule("music") && item(t("music.queue"), "list", () => playMusic({ path, add: true }, entry.name)),
    entry.type === "file" && PVE_SEND_RE.test(entry.name) && !filesMachine() && isAdmin() && pveUi.list?.hosts?.length !== 0 && item(t("pve.send.menu"), "upload", () => pveSendDialog({ path })),
    entry.type === "file" && /\.iso$/i.test(entry.name) && !filesMachine() && isAdmin() && item(t("incus.disc.menu"), "disk", () => discAddDialog({ how: "path", path })),
    item(t("files.copyPath"), "link", () => copyText(path)),
    entry.type !== "other" && !filesMachine() && item(t(isFavorite(path) ? "files.unfavorite" : "files.favorite"), "star", () => favorite(path, !isFavorite(path), entry.name)),
    entry.type === "dir" && !filesMachine() && isAdmin() && (state.files.pinned.includes(path) ? item(t("files.unpin"), "home", () => pinFolder(path, false)) : item(t("files.pin"), "home", () => pinFolder(path, true))),
    entry.type === "dir" && !filesMachine() && isAdmin() && item(t(state.files.shared.includes(path) ? "files.shareSettings" : "files.share"), "share", () => shareDialog(path)),
    entry.type === "dir" && machineLet(filesMachine()) && item(t("machines.people.shareHere"), "share", () => machineShareDialog(machineLet(filesMachine()), path)),
    entry.type !== "other" && !filesMachine() && mayLink() && item(t("links.menu"), "link", () => shareLinkDialog(path, entry.name, entry.type === "dir")),
    entry.type === "dir" && item(t("files.size"), "disk", () => sizeDialog(path, entry.name)),
    !state.files.readOnly && item(t("files.rename"), "edit", () => renameDialog(entry)),
    !state.files.readOnly && item(t("files.move"), "arrow", () => transferDialog([entry], false)),
    item(t("files.copy"), "copy", () => transferDialog([entry], true)),
    !state.files.readOnly && item(t("files.delete"), "trash", () => deleteDialog([entry]), "danger"),
  );
  if (at) placeAt(dialog, at);
}

/** How much room a folder takes: counted when asked for, since a large one takes a while */
function sizeDialog(path, name) {
  const body = h("div", { class: "stack" }, h("p", { class: "muted" }, t("files.sizeCounting")), waitMark());
  let dialog;
  dialog = openDialog("confirm", h("h2", { class: "wrap" }, name), body, h("footer", null, closeButton(() => dialog)));
  // a machine's client counts file by file and stops at its limit
  const asked = filesMachine() ? api("POST", filesApi("/summary"), { paths: [path] }) : api("POST", "/api/files/size", { path });
  asked.then(
    (r) => put(body, h("p", null, t(r.truncated ? "files.sizeOver" : "files.sizeIs", { size: bytes(r.size) })), h("p", { class: "muted small mono wrap" }, path)),
    (e) => put(body, h("p", { class: "error", role: "alert" }, errorText(e))),
  );
}

/** Asks for one name: a new folder, a new name */
function nameDialog(title, value, confirmLabel, action) {
  const input = h("input", { value, required: true, maxLength: 255, spellcheck: false, autocomplete: "off" });
  const error = h("p", { class: "error", role: "alert" });
  let dialog;
  dialog = openDialog(
    "confirm",
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          error.textContent = "";
          try {
            await action(input.value.trim());
            dialog.close();
          } catch (err) {
            error.textContent = errorText(err);
          }
        },
      },
      h("h2", null, title),
      input,
      error,
      h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { class: "btn primary" }, confirmLabel)),
    ),
  );
  input.focus();
  // the name without its extension is what gets retyped
  const dot = value.lastIndexOf(".");
  input.setSelectionRange(0, dot > 0 ? dot : value.length);
}

/** The names Hata unpacks: ZIP, and tar with or without compression — as `archiveKind` in files.ts */
const ARCHIVE_RE = /\.(zip|tar|tar\.(gz|bz2|xz|zst)|tgz|tbz2?|txz)$/i;

/** Unpacked into a new folder next to the archive, as a job */
async function extractArchive(path) {
  try {
    const res = await api("POST", "/api/files/extract", { path });
    jobDialog(res.job, "extract", path.split("/").pop(), () => void loadFiles());
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/** What can be made in a folder */
function newMenu(path, anchor) {
  let dialog;
  const item = (label, iconName, action) => h("button", { type: "button", class: "menu-item", onclick: () => (dialog.close(), action()) }, icon(iconName), label);
  dialog = openDialog("menu dropdown", item(t("files.newFolder"), "folder", () => newFolderDialog(path, loadFiles)), item(t("files.newFile"), "file", () => newFileDialog(path)));
  const box = anchor.getBoundingClientRect();
  placeAt(dialog, { x: box.right - dialog.offsetWidth, y: box.bottom + 4 });
}

/** A new empty text file, opened in the editor at once */
const newFileDialog = (dir) =>
  nameDialog(t("files.newFile"), "", t("files.create"), async (name) => {
    const res = await api("POST", filesApi("/file"), { path: dir, name });
    await loadFiles();
    void textDialog(res.path);
  });

/** The search field of the folder on screen: names under it, found by the server */
function findBox(path) {
  const input = h("input", { type: "search", class: "find", placeholder: t("files.find"), "aria-label": t("files.find"), value: filesUi.find?.under === path ? filesUi.find.query : "", spellcheck: false });
  let timer;
  const run = async () => {
    const query = input.value.trim();
    if (query.length < 2) {
      if (filesUi.find) (filesUi.find = null), renderFilesBody(), document.querySelector("#files-main input.find")?.focus();
      return;
    }
    filesUi.find = { under: path, query, found: null, more: false };
    try {
      const res = await api("GET", `/api/files/find?path=${encodeURIComponent(path)}&q=${encodeURIComponent(query)}`);
      // another search, or another folder, may have started meanwhile
      if (filesUi.find?.query !== query || filesUi.find.under !== path) return;
      Object.assign(filesUi.find, res);
    } catch (e) {
      if (filesUi.find?.query === query) filesUi.find.error = errorText(e);
    }
    const caret = input.selectionStart;
    renderFilesBody();
    const again = document.querySelector("#files-main input.find");
    if (again) (again.focus(), again.setSelectionRange(caret, caret));
  };
  input.addEventListener("input", () => (clearTimeout(timer), (timer = setTimeout(run, 400))));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (clearTimeout(timer), void run());
    if (e.key === "Escape") ((input.value = ""), clearTimeout(timer), void run());
  });
  // it searches by itself as one types; the button is for whoever does not know that
  return h("div", { class: "find-box" }, input, h("button", { type: "button", class: "find-go", title: t("files.findGo"), "aria-label": t("files.findGo"), onclick: () => (clearTimeout(timer), void run(), input.focus()) }, icon("search")));
}

/** What a search found: each with the folder it lies in; a folder opens, a file opens its folder with it chosen */
function foundList(find) {
  if (find.error) return h("p", { class: "card pad error" }, find.error);
  if (!find.found) return h("p", { class: "muted" }, t("files.finding"));
  if (!find.found.length) return h("div", { class: "card empty" }, icon("search"), h("p", null, t("files.nothingFound", { query: find.query })));
  const show = (item) => {
    const parent = item.path.slice(0, item.path.lastIndexOf("/")) || "/";
    if (item.type === "dir") return go(filesHash(item.path));
    filesUi.find = null;
    filesUi.pick = item.path.split("/").pop();
    go(filesHash(parent));
  };
  const row = (item) => {
    const name = item.path.split("/").pop();
    const parent = item.path.slice(0, item.path.lastIndexOf("/")) || "/";
    return h(
      "tr",
      null,
      h("td", { class: "name" }, h("button", { type: "button", class: "file-name", onclick: () => show(item) }, fileIcon({ name, type: item.type }), h("span", { class: "clip" }, name)), h("div", { class: "muted small clip mono" }, parent)),
      h("td", { class: "num muted" }, item.type === "file" ? bytes(item.size) : "—"),
      h("td", { class: "muted when" }, item.modified ? fileTime(item.modified) : ""),
    );
  };
  return h(
    "div",
    { class: "stack" },
    h("p", { class: "muted small" }, t(find.more ? "files.foundMore" : "files.found", { n: find.found.length, query: find.query })),
    h("div", { class: "card table-wrap" }, h("table", { class: "file-table" }, h("thead", null, h("tr", null, h("th", null, t("files.col.name")), h("th", { class: "num" }, t("files.col.size")), h("th", { class: "when" }, t("files.col.modified")))), h("tbody", null, find.found.map(row)))),
  );
}

const newFolderDialog = (dir, done, machine = filesMachine()) =>
  nameDialog(t("files.newFolder"), "", t("files.create"), async (name) => {
    await api("POST", filesApi("/folder", machine), { path: dir, name });
    await done();
  });

const renameDialog = (entry) =>
  nameDialog(t("files.renameTitle", { name: entry.name }), entry.name, t("files.rename"), async (name) => {
    await api("POST", filesApi("/rename"), { path: joinPath(state.files.path, entry.name), name });
    await loadFiles();
  });

async function deleteDialog(entries) {
  const dir = state.files.path;
  const paths = entries.map((entry) => joinPath(dir, entry.name));
  // a machine keeps no trash: what is deleted there is gone
  const machine = filesMachine();
  let sum;
  try {
    sum = await api("POST", filesApi("/summary"), { paths });
  } catch (e) {
    return toast(errorText(e), "error");
  }
  const note = h("p", { class: "muted" }, t(machine ? "files.machineDeleteLead" : "files.deleteLead", { files: sum.truncated ? sum.files + "+" : sum.files, dirs: sum.dirs, size: bytes(sum.size) }));
  const run = async (e, forever) => {
    const pressed = e.currentTarget;
    pressed.disabled = true;
    try {
      await api("POST", filesApi("/delete"), { paths, forever });
      toast(t(forever ? "files.deletedForever" : "files.trashed", { n: paths.length }));
    } catch (err) {
      // a disk that keeps no trash: what is left is to delete for good, and the dialog says so
      if (err.code === "files.noTrash" && !forever) {
        pressed.hidden = true;
        note.className = "banner small";
        note.textContent = errorText(err);
        return void loadFiles();
      }
      toast(errorText(err), "error");
    }
    dialog.close();
    await loadFiles();
  };
  const dialog = openDialog(
    "confirm",
    h("h2", { class: "wrap" }, entries.length === 1 ? t("files.deleteTitle", { name: entries[0].name }) : t("files.deleteMany", { n: entries.length })),
    note,
    !machine && within(dir, joinPath(state.files.home, "AppData")) ? h("p", { class: "banner small" }, t("files.deleteAppData")) : null,
    machine && h("p", { class: "banner small" }, t("files.machineNoTrash")),
    machine
      ? h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("files.deleteForever"), { class: "danger", onclick: (e) => run(e, true) }, "trash"))
      : h("footer", null, button(t("files.deleteForever"), { class: "ghost danger-text small", onclick: (e) => run(e, true) }), closeButton(() => dialog, t("common.cancel")), button(t("files.toTrash"), { class: "primary", autofocus: true, onclick: (e) => run(e, false) }, "trash")),
  );
}

// --- The trash: what was deleted in Files, to be put back or removed for good ---

async function loadTrash() {
  try {
    state.trash = await api("GET", "/api/files/trash");
  } catch (e) {
    return toast(errorText(e), "error");
  }
  // opened straight from a link: the places on the left come with a listing of Files
  if (!state.files && isAdmin()) state.files = await api("GET", "/api/files?path=").catch(() => null);
  if (!isAdmin() && !state.myShares) await loadMine();
  if (state.files?.favorites) state.favorites = state.files.favorites;
  if (state.route.view === "trash") renderTrash();
}

/** The entries of the trash chosen with their boxes, by id; what is no longer there drops out on every drawing */
const trashChosen = new Set();
const TRASH_DAYS = [1, 3, 7, 14, 30, 60, 90, 180, 365];
const trashDaysText = (n) => (n === 1 ? t("trash.day") : t("trash.days", { n }));

/** A shorter time for the trash: what has lain there longer goes at once, so that is asked first */
function trashDaysChange(days, select) {
  const items = state.trash?.items ?? [];
  const going = items.filter((item) => Date.now() - item.at > days * 86_400_000);
  const save = async () => {
    try {
      const answer = await api("PUT", "/api/files/trash/days", { days });
      if (answer.removed) toast(t("trash.daysRemoved", { n: answer.removed }));
    } catch (e) {
      toast(errorText(e), "error");
    }
    await loadTrash();
  };
  if (!going.length) return void save();
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("trash.daysTitle", { days: trashDaysText(days) })),
    h("p", { class: "muted" }, t("trash.daysLead", { n: going.length, size: bytes(going.reduce((sum, item) => sum + item.size, 0)) })),
    h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("files.deleteForever"), { class: "danger", onclick: () => (dialog.close(), save()) }, "trash")),
  );
  // cancelled: the list shows the time that is still kept
  dialog.addEventListener("close", () => (select.value = String(state.trash.keepDays)));
}

function renderTrash() {
  const data = state.trash;
  const items = data?.items ?? [];
  for (const id of [...trashChosen]) if (!items.some((item) => item.id === id)) trashChosen.delete(id);
  const chosen = items.filter((item) => trashChosen.has(item.id));
  const act = async (el, work) => {
    el.disabled = true;
    try {
      await work();
    } catch (e) {
      toast(errorText(e), "error");
    }
    await loadTrash();
  };
  const back = (list) => (e) =>
    act(e.currentTarget, async () => {
      const { restored } = await api("POST", "/api/files/trash/restore", { ids: list.map((item) => item.id) });
      list.forEach((item) => trashChosen.delete(item.id));
      toast(restored.length === 1 ? t("trash.restored", { path: restored[0].path }) : t("trash.restoredMany", { n: restored.length }));
    });
  const forever = (ids, title, lead) => {
    const dialog = openDialog(
      "confirm",
      h("h2", { class: "wrap" }, title),
      h("p", { class: "muted" }, lead),
      h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("files.deleteForever"), { class: "danger", onclick: (e) => act(e.currentTarget, () => api("POST", "/api/files/trash/delete", ids ? { ids } : {})).then(() => dialog.close()) }, "trash")),
    );
  };
  const folderOf = (path) => path.slice(0, path.lastIndexOf("/")) || "/";
  const tick = (item) =>
    h("input", {
      type: "checkbox",
      checked: trashChosen.has(item.id),
      "aria-label": item.name,
      onchange: (e) => (e.target.checked ? trashChosen.add(item.id) : trashChosen.delete(item.id), renderTrash()),
    });
  const all = h("input", {
    type: "checkbox",
    checked: items.length > 0 && chosen.length === items.length,
    "aria-label": t("trash.chooseAll"),
    onchange: (e) => (items.forEach((item) => (e.target.checked ? trashChosen.add(item.id) : trashChosen.delete(item.id))), renderTrash()),
  });
  all.indeterminate = chosen.length > 0 && chosen.length < items.length;
  const remove = (item) => forever([item.id], t("trash.deleteTitle", { name: item.name }), t("trash.deleteLead"));
  const row = (item) => ({
    cells: [
      uiCell({ tick: tick(item), lead: { icon: item.type === "dir" ? "folder" : "file" }, name: item.name, sub: item.type === "dir" ? t("trash.files", { n: item.files }) : null }),
      h("a", { class: "mono small", href: filesHash(folderOf(item.from)), title: folderOf(item.from) }, folderOf(item.from)),
      uiCell({ name: h("span", { class: "plain" }, ago(item.at)), sub: item.by }),
      bytes(item.size),
      h("div", { class: "row-actions" }, button(t("trash.restore"), { class: "small", onclick: back([item]) }, "undo"), isAdmin() && uiMore([{ label: t("files.deleteForever") + "…", icon: "trash", danger: true, run: () => remove(item) }], { size: "s" })),
    ],
    sub: [folderOf(item.from), ago(item.at), bytes(item.size)].join(" · "),
    menu: (at) => menuAt(at, null, [{ label: t("trash.restore"), icon: "undo", run: () => back([item])({ currentTarget: {} }) }, isAdmin() && { label: t("files.deleteForever") + "…", icon: "trash", danger: true, run: () => remove(item) }].filter(Boolean)),
  });
  const keep = data?.keepDays ?? 30;
  const days = h(
    "select",
    { class: "short", "aria-label": t("trash.keep"), onchange: (e) => trashDaysChange(Number(e.target.value), e.target) },
    [...new Set([...TRASH_DAYS, keep])].sort((a, b) => a - b).map((n) => h("option", { value: String(n), selected: n === keep }, trashDaysText(n))),
  );
  const chosenSize = chosen.reduce((sum, item) => sum + item.size, 0);
  const emptyAll = () => forever(null, t("trash.emptyTitle"), t("trash.emptyLead", { n: items.length, size: bytes(data.size) }));
  shell(h("div", { class: "files" }, h("aside", { class: "files-side fold", id: "files-places" }), h("section", { class: "stack" },
    pageHead({
      crumbs: [{ label: t("nav.files"), href: "#/files" }, { label: t("trash.title") }],
      title: t("trash.title"),
      facts: data ? [t("trash.meta", { n: items.length, size: bytes(data.size ?? 0) })] : null,
      actions: [items.length > 0 && isAdmin() && { label: t("trash.empty") + "…", icon: "trash", danger: true, run: emptyAll }],
    }),
    uiCard(
      { flush: true },
      data && isAdmin() && uiSetting({ name: t("trash.keep"), explain: t("trash.lead", { days: trashDaysText(keep) }), control: days }),
      chosen.length > 0 &&
        h(
          "div",
          { class: "ui-select-bar" },
          h("span", null, t("files.selected", { n: chosen.length })),
          button(t("trash.restore"), { class: "small", onclick: back(chosen) }, "undo"),
          isAdmin() && button(t("files.deleteForever") + "…", { class: "small danger-text", onclick: () => forever(chosen.map((item) => item.id), t("trash.deleteChosenTitle", { n: chosen.length }), t("trash.emptyLead", { n: chosen.length, size: bytes(chosenSize) })) }, "trash"),
        ),
      !data
        ? uiEmpty({ size: "loading" })
        : items.length === 0
          ? uiEmpty({ size: "big", icon: "trash", title: t("trash.nothing") })
          : uiTable([{ label: h("span", { class: "ui-cell" }, all, t("files.col.name")) }, { label: t("trash.col.from") }, { label: t("trash.col.deleted") }, { label: t("files.col.size"), num: true }, { label: "" }], items.map(row)),
    ),
  )));
  filesPlaces(null);
}

/** Picks the folder to move or copy into */
/**
 * Walks the folders of the server to choose one: `allowed(at, machine)` says whether the current one
 * will do. With `machines` the other machines are a press away too, and `action` gets the machine
 * ("" — this server) after the folder.
 */
function folderPicker({ title, start, confirmLabel, action, allowed = () => true, shown = () => true, machine = "", machines = false }) {
  let at = start;
  let on = machine;
  let home = "";
  let dialog;
  const crumbs = h("div", { class: "crumbs wrap" });
  const quick = h("div", { class: "picker-quick" });
  const folders = h("div", { class: "picker" });
  const error = h("p", { class: "error", role: "alert" });
  const confirm = button(confirmLabel, {
    class: "primary",
    onclick: async () => {
      confirm.disabled = true;
      error.textContent = "";
      try {
        await action(at, on);
        dialog.close();
      } catch (e) {
        error.textContent = errorText(e);
        confirm.disabled = false;
      }
    },
  });
  const show = async (path, where = on) => {
    let listing;
    try {
      listing = await api("GET", `${filesApi("", where)}?path=${encodeURIComponent(path)}`);
    } catch (e) {
      // a starting folder that is not there yet opens at the nearest one that is
      if (path === start && where === machine && path.lastIndexOf("/") > 0) return show((start = path.slice(0, path.lastIndexOf("/"))), where);
      return void (error.textContent = errorText(e));
    }
    on = where;
    if (!on) home = listing.home;
    // opened on a machine: this server's data folder is a press away as well
    else if (machines && !home) home = (await api("GET", "/api/files?path=").catch(() => null))?.home ?? "";
    at = listing.path;
    error.textContent = "";
    // one who is not an administrator walks the folders shared with them, from the folder down
    const mine = isAdmin() ? null : (listing.shares ?? []);
    const share = mine?.filter((one) => within(at, one.path)).sort((a, b) => b.path.length - a.path.length)[0];
    const base = share ? share.path : "/";
    const parts = at.slice(base.length).split("/").filter(Boolean);
    const crumb = (label, to) => h("button", { type: "button", class: "crumb", onclick: () => show(to) }, label);
    const other = on && machinesUi.list?.machines.find((m) => m.id === on);
    put(crumbs, other && h("span", { class: "with-icon strong" }, icon("server"), other.name), crumb(share ? share.name : "/", base), parts.map((part, i) => [(i > 0 || share) && icon("chevron"), crumb(part, (base === "/" ? "" : base) + "/" + parts.slice(0, i + 1).join("/"))]));
    // the data folder and the disks, one press away wherever the picker is; with `machines` the other machines too
    const jump = (label, to, iconName, target = on) => h("button", { type: "button", class: "chip-btn" + (target === on && (at === to || at.startsWith(to + "/")) ? " active" : ""), onclick: () => show(to, target) }, icon(iconName), h("span", { class: "clip" }, label));
    const volumes = on ? [] : outerVolumes(listing);
    const others = machines ? (machinesUi.list?.machines ?? []).filter((m) => m.online) : [];
    if (mine) put(quick, mine.map((one) => jump(one.name, one.path, "share")));
    else put(quick, (on ? home : listing.home) && jump(t("files.home"), on ? home : listing.home, "home", ""), volumes.map((d) => jump(volumeName(d), d.path, d.network ? "globe" : "disk")), others.map((m) => h("button", { type: "button", class: "chip-btn" + (on === m.id ? " active" : ""), onclick: () => show("/", m.id) }, icon("server"), h("span", { class: "clip" }, m.name))));
    quick.hidden = mine ? mine.length < 2 : !volumes.length && !others.length && !on;
    const inner = sortedEntries(listing.entries).filter((entry) => entry.type === "dir" && shown(joinPath(at, entry.name), on));
    put(folders, inner.length ? inner.map((entry) => h("button", { type: "button", class: "menu-item", onclick: () => show(joinPath(at, entry.name)) }, icon("folder", "folder-ico"), h("span", { class: "clip grow" }, entry.name), icon("chevron", "faint"))) : h("p", { class: "muted small pad" }, t("files.noFolders")));
    confirm.disabled = !allowed(at, on) || (!!mine && listing.readOnly);
    newFolder.disabled = !!mine && listing.readOnly;
  };
  const newFolder = button(t("files.newFolder"), { onclick: () => newFolderDialog(at, () => show(at), on) }, "folder");
  dialog = openDialog("wide", h("h2", { class: "wrap" }, title), quick, crumbs, folders, error, h("footer", null, newFolder, closeButton(() => dialog, t("common.cancel")), confirm));
  void show(at);
}

function transferDialog(entries, copy) {
  const from = state.files.path;
  const source = filesMachine();
  const paths = entries.map((entry) => joinPath(from, entry.name));
  const what = entries.length === 1 ? entries[0].name : t("files.items", { n: entries.length });
  folderPicker({
    title: t(copy ? "files.copyTitle" : "files.moveTitle", { what }),
    start: from,
    machine: source,
    machines: true,
    confirmLabel: t(copy ? "files.copyHere" : "files.moveHere"),
    allowed: (at, on) => copy || on !== source || at !== from,
    // a folder cannot go into itself
    shown: (path, on) => copy || on !== source || !paths.includes(path),
    action: async (to, on) => {
      if (on !== source) {
        // to another machine: a job that sends the files over
        const res = await api("POST", "/api/files/transfer", { from: { machine: source, paths }, to: { machine: on, dir: to }, copy });
        return jobDialog(res.job, "transfer", what, () => void loadFiles());
      }
      const res = await api("POST", filesApi(copy ? "/copy" : "/move", source), { paths, to });
      // large or to another disk: it goes on in the background, the card in the corner says how far it is
      if (res?.job) return jobInBackground(res.job, copy ? "filecopy" : "filemove", what, () => void loadFiles());
      toast(t(copy ? "files.copied" : "files.moved", { n: entries.length, to: to === "/" ? "/" : to.split("/").pop() }));
      await loadFiles();
    },
  });
}

/** A picture, a video or a sound, with the pictures of the folder one keypress apart */
function mediaDialog(entry) {
  const list = sortedEntries(state.files.entries).filter((item) => ["image", "video", "audio"].includes(fileKind(item)));
  const dir = state.files.path;
  let current = entry;
  let dialog;
  const stage = h("div", { class: "stage" });
  const title = h("h2", { class: "clip" });
  const sub = h("p", { class: "muted small" });
  const step = (by) => {
    const next = list[list.findIndex((item) => item.name === current.name) + by];
    if (next) show(next);
  };
  const prev = h("button", { type: "button", class: "icon-btn", "aria-label": t("files.previous"), title: t("files.previous"), onclick: () => step(-1) }, icon("chevron", "flip"));
  const next = h("button", { type: "button", class: "icon-btn", "aria-label": t("files.next"), title: t("files.next"), onclick: () => step(1) }, icon("chevron"));
  // a video is played by Hata's own player where ffmpeg is: sound tracks, subtitles, formats a browser alone cannot
  let player = null;
  const needs = h("p", { class: "muted small viewer-note", hidden: true });
  const toTv = h("button", { type: "button", class: "icon-btn", onclick: () => void moveToTv(joinPath(dir, current.name), current.name, player ?? stage.querySelector("video, audio"), () => dialog.close()) }, icon("tv"));
  const show = (item) => {
    current = item;
    const src = rawUrl(joinPath(dir, item.name));
    const kind = fileKind(item);
    player?.stop();
    player = kind === "video" && tvStreams() && !filesMachine() ? streamPlayer(joinPath(dir, item.name)) : null;
    put(stage, player ? player.el : kind === "image" ? h("img", { src, alt: item.name }) : kind === "video" ? h("video", { src, controls: true, autoplay: true, playsInline: true }) : h("audio", { src, controls: true, autoplay: true }));
    title.textContent = item.name;
    sub.textContent = `${bytes(item.size)} · ${fileTime(item.modified)}`;
    toTv.hidden = !!filesMachine() || !tvReady() || !TV_PLAYS_RE.test(item.name);
    // without ffmpeg the browser plays a video as it can: said where one would miss the sound or the subtitles
    put(needs, kind === "video" && !player && isAdmin() && !filesMachine() && [t("media.needs"), " ", h("a", { class: "link", href: "#/settings/tools", onclick: () => dialog.close() }, t("media.needsWhere"))]);
    needs.hidden = !needs.firstChild;
    const label = t(kind === "image" ? "tv.play" : "tv.toTv");
    toTv.title = label;
    toTv.setAttribute("aria-label", label);
    const index = list.findIndex((other) => other.name === item.name);
    prev.disabled = index <= 0;
    next.disabled = index >= list.length - 1;
  };
  dialog = openDialog(
    "xwide viewer",
    h("header", null, h("div", { class: "grow" }, title, sub), list.length > 1 && prev, list.length > 1 && next, toTv, h("button", { type: "button", class: "icon-btn", "aria-label": t("files.download"), title: t("files.download"), onclick: () => downloadEntries([current]) }, icon("download")), closeX(() => dialog)),
    stage,
    needs,
  );
  // the keys work wherever the focus is while the viewer is open
  const keys = (e) => {
    if (e.target instanceof HTMLMediaElement || e.target.closest?.(".sp")) return;
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  };
  document.addEventListener("keydown", keys);
  // a video must not keep playing behind a closed dialog
  dialog.addEventListener("close", () => (document.removeEventListener("keydown", keys), player?.stop(), put(stage)));
  show(entry);
}

async function textDialog(path) {
  const machine = filesMachine();
  let file;
  try {
    file = await api("GET", `${filesApi("/text", machine)}?path=${encodeURIComponent(path)}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  let dialog;
  const area = h("textarea", { class: "code", spellcheck: false, value: file.content, wrap: "off", "aria-label": path });
  const error = h("p", { class: "error", role: "alert" });
  const save = button(t("settings.save"), {
    class: "primary",
    disabled: true,
    onclick: async () => {
      error.textContent = "";
      try {
        file = await api("PUT", filesApi("/text", machine), { path, content: area.value, modified: file.modified });
        save.disabled = true;
        toast(t("settings.saved"));
        if (onFiles(state.files?.path)) void loadFiles();
      } catch (e) {
        error.textContent = errorText(e);
      }
    },
  });
  area.addEventListener("input", () => (save.disabled = area.value === file.content));
  dialog = openDialog("xwide", h("header", null, h("div", { class: "grow" }, h("h2", { class: "clip" }, path.split("/").pop()), h("p", { class: "muted small mono clip" }, path)), closeX(() => dialog)), area, error, h("footer", null, closeButton(() => dialog), save));
  // unsaved text is not lost to a stray click outside, the close button or Escape
  const keep = () => !save.disabled && !confirm(t("files.discard"));
  const close = dialog.close.bind(dialog);
  dialog.close = () => void (keep() || close());
  dialog.addEventListener("cancel", (e) => keep() && e.preventDefault());
}

// --- Files: upload ------------------------------------------------------------------------------
// Files go one after another, each in parts: a part is small enough for any proxy in front of Hata,
// and what has arrived is not lost when one part fails.

const UPLOAD_PART = 8 * 1024 * 1024;
const uploadBox = h("div", { class: "card upload", hidden: true });
const uploads = { queue: [], running: false, xhr: null, cancelled: false, count: 0, done: 0, bytes: 0, sent: 0, started: 0, failed: [], conflicts: [] };

/** Everything in a drop: files, and folders with what is in them */
async function droppedFiles(transfer) {
  const out = [];
  // entries must be taken before the first await: the drop's data is gone after it
  const entries = [...transfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...transfer.files].map((file) => ({ file, sub: "" }));
  const walk = async (entry, sub) => {
    if (entry.isFile) out.push({ file: await new Promise((ok, no) => entry.file(ok, no)), sub });
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        // a folder is read in batches; an empty batch ends it
        const batch = await new Promise((ok, no) => reader.readEntries(ok, no));
        if (!batch.length) break;
        for (const child of batch) await walk(child, sub ? `${sub}/${entry.name}` : entry.name);
      }
    }
  };
  for (const entry of entries) await walk(entry, "").catch(() => {});
  return out;
}

function sendPart(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    uploads.xhr = xhr;
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onerror = xhr.onabort = () => reject(new ApiError(0, "network"));
    xhr.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new ApiError(xhr.status, payload.error?.code ?? "request.failed", payload.error?.detail));
    };
    xhr.send(blob);
  });
}

/** Waits between the tries of a part cut off on the way: the network may be back in a few seconds */
const UPLOAD_RETRIES = [1000, 3000, 8000, 15000, 30000];

/**
 * One part, tried again when the connection broke. The server keeps nothing of a part it did not get
 * whole; when the answer was what got lost, its "not in order" says how much it has — a part that
 * arrived counts as sent, and a last part whose file is already in place means the file is done.
 */
async function sendPartAgain(url, blob, offset, last, onProgress) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendPart(url, blob, onProgress);
    } catch (e) {
      const cut = e instanceof ApiError && e.status === 0;
      if (attempt > 0 && e instanceof ApiError && e.code === "files.uploadOrder" && e.detail?.have === offset + blob.size) return {};
      if (attempt > 0 && last && e instanceof ApiError && (e.code === "files.exists" || (e.code === "files.uploadOrder" && e.detail?.have === -1))) return {};
      if (!cut || uploads.cancelled || attempt >= UPLOAD_RETRIES.length) throw e;
      uploads.retrying = true;
      paintUpload();
      // a press of "Cancel" during the wait is heard at once
      for (let waited = 0; waited < UPLOAD_RETRIES[attempt] && !uploads.cancelled; waited += 250) await new Promise((ok) => setTimeout(ok, 250));
      uploads.retrying = false;
      if (uploads.cancelled) throw e;
    }
  }
}

async function uploadOne({ dir, file, sub, overwrite, machine }) {
  const id = crypto.getRandomValues(new Uint32Array(3)).reduce((text, n) => text + n.toString(36), "").padEnd(8, "0").slice(0, 24);
  const base = uploads.sent;
  let offset = 0;
  do {
    const blob = file.slice(offset, offset + UPLOAD_PART);
    const last = offset + blob.size >= file.size;
    const query = new URLSearchParams({ dir, name: file.name, sub, id, offset, last: last ? "1" : "0", overwrite: overwrite ? "1" : "0" });
    try {
      await sendPartAgain(filesApi("/upload", machine) + "?" + query, blob, offset, last, (loaded) => ((uploads.sent = base + offset + loaded), paintUpload()));
    } catch (e) {
      if (offset > 0 || uploads.cancelled) void fetch(`${filesApi("/upload", machine)}?${new URLSearchParams({ dir, sub, id })}`, { method: "DELETE" }).catch(() => {});
      uploads.sent = base + file.size;
      throw e;
    }
    offset += blob.size;
  } while (offset < file.size);
  uploads.sent = base + file.size;
}

function paintUpload() {
  const { count, done, bytes: total, sent, started } = uploads;
  const percent = total ? Math.min(100, Math.round((sent / total) * 100)) : 100;
  const seconds = (Date.now() - started) / 1000;
  const speed = seconds > 1 ? sent / seconds : 0;
  const fill = h("i");
  fill.style.width = percent + "%";
  put(uploadBox,
    icon("upload"),
    h("div", { class: "grow stack-s" }, h("div", { class: "upload-line" }, h("strong", { class: "grow clip" }, t("files.uploading", { done: Math.min(done + 1, count), n: count })), h("span", { class: "muted small mono" }, uploads.retrying ? t("files.uploadRetrying") : [percent + "%", speed && `${bytes(speed)}/s`, speed && sent < total && duration(Math.max(60, (total - sent) / speed))].filter(Boolean).join(" · "))), h("div", { class: "bar" }, fill)),
    h("button", { type: "button", class: "icon-btn", "aria-label": t("common.cancel"), title: t("common.cancel"), onclick: () => ((uploads.cancelled = true), (uploads.queue = []), uploads.xhr?.abort()) }, icon("x")),
  );
}

const queueUpload = (dir, items, overwrite = false) => queueUploadOn(filesMachine(), dir, items, overwrite);

function queueUploadOn(machine, dir, items, overwrite = false) {
  if (!items.length) return;
  if (!uploads.running) Object.assign(uploads, { count: 0, done: 0, bytes: 0, sent: 0, started: Date.now(), failed: [], conflicts: [], cancelled: false });
  for (const item of items) {
    uploads.queue.push({ dir, overwrite, machine, ...item });
    uploads.count++;
    uploads.bytes += item.file.size;
  }
  if (!uploads.running) void runUploads();
}

async function runUploads() {
  uploads.running = true;
  uploadBox.hidden = false;
  // leaving the page would cut the upload short
  const warn = (e) => e.preventDefault();
  window.addEventListener("beforeunload", warn);
  const touched = new Set();
  let item;
  while ((item = uploads.queue.shift())) {
    paintUpload();
    try {
      // a name that is plainly taken is not sent just to be refused
      if (!item.overwrite && !item.sub && state.files?.path === item.dir && (state.files.machine ?? "") === item.machine && state.files.entries.some((entry) => entry.name === item.file.name)) {
        uploads.sent += item.file.size;
        throw new ApiError(409, "files.exists");
      }
      await uploadOne(item);
      touched.add(item.dir);
    } catch (e) {
      if (uploads.cancelled) break;
      if (e.code === "files.exists" && !item.overwrite) uploads.conflicts.push(item);
      else uploads.failed.push({ item, error: errorText(e) });
    }
    uploads.done++;
  }
  window.removeEventListener("beforeunload", warn);
  uploads.running = false;
  uploadBox.hidden = true;
  const { failed, conflicts, cancelled } = uploads;
  const ok = uploads.done - failed.length - conflicts.length;
  if (cancelled) toast(t("files.uploadCancelled"));
  else if (failed.length) toast(t("files.uploadFailed", { name: failed[0].item.file.name, n: failed.length, error: failed[0].error }), "error");
  else if (ok > 0) toast(t("files.uploaded", { n: ok }));
  if (state.route.view === "files") void loadFiles();
  if (conflicts.length && !cancelled) replaceDialog(conflicts);
}

/** Files that are already there are never replaced without a question */
function replaceDialog(conflicts) {
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("files.replaceTitle", { n: conflicts.length })),
    h("ul", { class: "paths small" }, conflicts.slice(0, 8).map((item) => h("li", null, item.sub ? `${item.sub}/${item.file.name}` : item.file.name)), conflicts.length > 8 && h("li", null, "…")),
    h("footer", null, closeButton(() => dialog, t("files.skip")), button(t("files.replace"), { class: "danger", onclick: () => (dialog.close(), queueUploadOn(conflicts[0].machine, conflicts[0].dir, conflicts.map(({ file, sub }) => ({ file, sub })), true)) })),
  );
}

// --- Store --------------------------------------------------------------------------------------

async function loadStore() {
  try {
    state.store = await api("GET", `/api/store?lang=${state.lang}`);
  } catch (e) {
    return toast(errorText(e), "error");
  }
  if (state.route.view === "store") renderStoreList();
}

/** A store added by its address: the repository is read first, and one with no app Hata can read is refused */
function addStoreForm() {
  const input = h("input", { type: "url", class: "mono grow", placeholder: "https://github.com/…", "aria-label": t("store.address"), spellcheck: false, required: true });
  const error = h("p", { class: "error", role: "alert" });
  const go = h("button", { class: "btn" }, icon("plus"), h("span", null, t("store.add")));
  return h(
    "form",
    {
      class: "stack-s add-store",
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = "";
        go.disabled = true;
        go.lastChild.textContent = t("store.adding");
        try {
          const res = await api("POST", "/api/stores", { url: input.value });
          toast(t("store.added", { apps: res.apps }));
          await loadStore();
          renderSettings();
        } catch (err) {
          error.textContent = errorText(err);
          go.disabled = false;
          go.lastChild.textContent = t("store.add");
        }
      },
    },
    h("span", { class: "form-label" }, t("store.address")),
    h("div", { class: "row-actions" }, input, go),
    h("span", { class: "muted small" }, t("store.addHint")),
    error,
  );
}

function removeStoreDialog(store) {
  const dialog = openDialog(
    "confirm",
    h("h2", null, t("store.removeTitle", { id: store.id })),
    h("p", { class: "muted" }, t("store.removeText")),
    h(
      "footer",
      null,
      closeButton(() => dialog, t("common.cancel")),
      button(t("store.remove"), {
        class: "danger",
        onclick: async () => {
          dialog.close();
          await api("DELETE", `/api/stores/${store.id}`).catch((e) => toast(errorText(e), "error"));
          await loadStore();
          renderSettings();
        },
      }),
    ),
  );
}

async function syncStores() {
  toast(t("store.syncing"));
  for (const store of state.store?.stores ?? state.settings?.stores ?? []) {
    try {
      const res = await api("POST", `/api/store/${store.id}/sync`, {});
      toast(res.ok ? t("store.synced", { apps: res.apps }) : res.error, res.ok ? "info" : "error");
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
  await loadStore();
  if (state.route.view === "settings") renderSettings();
}
