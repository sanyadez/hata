// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- TV: the media player on the server's own screen ---------------------------------------------

/** What the player plays, by the file's name: the same list the server goes by */
const TV_PLAYS_RE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|mpg|mpeg|wmv|flv|ogv|3gp|iso|mp3|flac|m4a|ogg|opus|wav|aac|wma|jpe?g|png|gif|webp|bmp|heic)$/i;
const tvUi = { timer: 0, busy: false, tick: 0, tab: "", sheet: null, editMarks: false, control: false };

/** What plays on the server's screen, in the head of every page: pause from anywhere, a click leads to the remote */
function paintTvNow() {
  const box = document.getElementById("tv-now");
  if (!box) return;
  const tv = isAdmin() && hasModule("tv") ? state.tvNow : null;
  // the chip is the one way to the TV: there while the module is on, also with the player off or not installed yet
  const there = isAdmin() && hasModule("tv");
  box.hidden = !there;
  box.className = "tv-now" + ((tv?.playing && !tv.playing.paused) || tv?.page ? " playing" : "") + (document.querySelector("dialog.tv-drop[open]") ? " open" : "");
  if (!there) return box.replaceChildren();
  const now = tv?.playing;
  const label = tv?.page ? t("tv.page.showing", { name: tv.page.title || tv.page.url }) : now ? t("tv.playing", { name: now.title }) : t(tv?.on ? "tv.remote" : "tv.title");
  // no words here: grey while nothing plays, the accent colour while something does — the name is in the remote.
  // one button, as the music's next to it: pause is in the remote it opens
  const halves = [h("button", { type: "button", class: "tv-now-half tv-now-open", title: label, "aria-label": label, "aria-haspopup": "dialog", onclick: () => tvDropdown(box) }, icon("tv"))];
  box.replaceChildren(...halves.filter(Boolean));
  paintTvMini(now);
}

/** Where what plays has got to by now: the page counts the seconds on from what the server last said */
const tvTimeNow = (now) => Math.min(now.total || Infinity, now.time + (now.paused ? 0 : (Date.now() - now.at) / 1000));

/**
 * On a phone what plays is a strip over the bottom bar: pause sits under the thumb, a touch anywhere
 * else on it brings the remote up. It is there only while something plays or is paused.
 */
function paintTvMini(now) {
  let mini = document.getElementById("tv-mini");
  clearInterval(tvUi.tick);
  if (!now) {
    mini?.remove();
    return document.body.classList.remove("tv-mini-on");
  }
  if (!mini) document.body.append((mini = h("aside", { id: "tv-mini" })));
  document.body.classList.add("tv-mini-on");
  const bar = h("i");
  const times = h("span", { class: "tv-mini-time muted" });
  const tick = () => {
    const at = tvTimeNow(now);
    times.textContent = `${tvClock(at)} / ${tvClock(now.total)}`;
    bar.style.width = now.total > 0 ? `${(at / now.total) * 100}%` : "0";
  };
  const press = (action) => (e) => (e.stopPropagation(), api("POST", "/api/tv/do", { action }).catch((err) => toast(errorText(err), "error")));
  mini.replaceChildren(
    h("div", { class: "tv-mini-bar" }, bar),
    h("button", { type: "button", class: "tv-mini-open", "aria-label": t("tv.remote"), "aria-haspopup": "dialog", onclick: () => tvDropdown(mini) }, icon("tv"), h("span", { class: "grow" }, h("strong", { class: "clip" }, now.title), times)),
    h("button", { type: "button", class: "tvr-round skip", title: t("tv.key.forward"), "aria-label": t("tv.key.forward"), onclick: press("forward") }, icon("fwd30"), h("span", null, "30")),
    h("button", { type: "button", class: "tvr-main", title: t("tv.key.playpause"), "aria-label": t("tv.key.playpause"), onclick: press("playpause") }, icon(now.paused ? "play" : "pause")),
  );
  tick();
  tvUi.tick = setInterval(tick, 1000);
}

/** The player runs and a screen is plugged in: something can be sent there */
const tvReady = () => isAdmin() && hasModule("tv") && !!state.tvNow?.on && !!state.tvNow.screen;

/** What plays in this browser goes on on the TV from the same place; here it stops */
async function moveToTv(path, name, media, done, subtitle = "") {
  // Hata's own player counts from where its stream began; a plain <video> from the file's start
  const at = media?.position ? media.position() : media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
  media?.pause();
  try {
    await api("POST", "/api/tv/play", { path, at, ...(subtitle ? { subtitle } : {}) });
  } catch (e) {
    return toast(errorText(e), "error");
  }
  toast(t("tv.playing", { name }));
  done();
}

/**
 * What plays on the TV goes on in this browser from the same place. The TV only pauses until the
 * browser really plays — a browser knows fewer formats than Kodi — and stops then; a file the browser
 * cannot play stays on the TV and plays on.
 */
function moveToBrowser(now) {
  document.querySelector("dialog.tv-drop")?.close();
  const link = isLink(now.file);
  const name = link ? "" : now.file.split("/").pop();
  const tell = (action) => api("POST", "/api/tv/do", { action }).catch(() => {});
  const wasPlaying = !now.paused;
  if (wasPlaying) void tell("playpause");
  let dialog;
  let taken = false;
  const played = () => {
    if (!taken) void tell("stop");
    taken = true;
  };
  const failed = () => {
    if (taken) return;
    dialog.close();
    toast(t("tv.browserCannot"), "error");
  };
  const sound = TV_SOUND_RE.test(name);
  // with ffmpeg here the same sound track and subtitles go on; without it the browser plays the file as it can
  const player = !sound && tvStreams() ? streamPlayer(now.file, { at: Math.max(0, now.time - 2), audio: link ? 0 : Math.max(0, now.audioNow ?? 0), sub: link ? (now.outside && now.subNow >= 0 ? OUTSIDE_SUB : -1) : (now.subNow ?? -1), outside: now.outside ?? "", played, failed }) : null;
  const media = player ?? h(sound ? "audio" : "video", { src: `${filesApi("/raw", "")}?path=${encodeURIComponent(now.file)}`, controls: true, autoplay: true, playsInline: true });
  if (!player) {
    media.addEventListener("loadedmetadata", () => (media.currentTime = Math.max(0, now.time - 2)), { once: true });
    media.addEventListener("playing", played);
    media.addEventListener("error", failed);
  }
  const back = button(t("tv.toTv"), { class: "small", onclick: () => void moveToTv(now.file, now.title, media, () => ((taken = true), dialog.close()), now.outside ?? "") }, "tv");
  dialog = openDialog("xwide viewer", h("header", null, h("div", { class: "grow" }, h("h2", { class: "clip" }, now.title), h("p", { class: "muted small" }, t(player ? "tv.browserFrom" : "tv.browserHint"))), back, closeX(() => dialog)), h("div", { class: "stage" }, player ? player.el : media));
  dialog.addEventListener("close", () => {
    if (player) player.stop();
    else (media.pause(), media.removeAttribute("src"));
    // closed before the browser played anything: the TV goes on as it was
    if (!taken && wasPlaying) void tell("playpause");
  });
}

/** ffmpeg is here: videos are played by Hata's own player */
const tvStreams = () => isAdmin() && !!state.overview?.media;

const languageNames = {};
/** "ukr" as a person says it in the page's language; what is not a language's code stays as written */
function languageName(code) {
  if (!code || code === "und") return "";
  try {
    languageNames[state.lang] ??= new Intl.DisplayNames([state.lang], { type: "language" });
    const name = languageNames[state.lang].of(code);
    return name && name !== code ? name[0].toUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** A sound track or a subtitle in a list: its language, what the file calls it, else how it is coded */
const trackLabel = (track) => [!track.name?.toLowerCase().startsWith(languageName(track.language).toLowerCase() || "\n") && languageName(track.language), track.name || [track.codec?.toUpperCase(), track.channels > 2 ? `${track.channels - 1}.1` : track.channels === 2 ? "2.0" : ""].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || `#${track.index + 1}`;

/**
 * Hata's own player for a video of this server: the picture as it is, the chosen sound made into what
 * a browser plays, subtitles of the file. The stream has no length and cannot be sought in, so the
 * bar is ours: a jump asks for a new stream from that moment, and the clock counts from where it began.
 */
function streamPlayer(path, { at = 0, audio = 0, sub = -1, outside = "", played, failed } = {}) {
  const p = { start: 0, startText: "0", audio, sub, info: null, tries: 0, dragging: false, gone: false, reported: false };
  const video = h("video", { playsInline: true, autoplay: true });
  const where = `path=${encodeURIComponent(path)}${outside ? `&subs=${encodeURIComponent(outside)}` : ""}`;
  const from = (kind, n) => `/api/media/${kind}?${where}&start=${p.startText}&n=${n}`;
  const position = () => p.start + (video.currentTime || 0);
  const note = h("p", { class: "sp-note", hidden: true });
  const clock = h("span", { class: "sp-clock" }, "0:00");
  const bar = h("input", { type: "range", class: "tvr-slider", min: 0, max: 0, step: 1, value: 0, "aria-label": t("tv.position") });
  const play = h("button", { type: "button", class: "icon-btn", "aria-label": t("tv.key.playpause"), title: t("tv.key.playpause"), onclick: () => (video.paused ? void video.play().catch(() => {}) : video.pause()) }, icon("pause"));
  const mute = h("button", { type: "button", class: "icon-btn", "aria-label": t("tv.mute"), title: t("tv.mute"), onclick: () => ((video.muted = !video.muted), mute.replaceChildren(icon(video.muted ? "volumeOff" : "volume"))) }, icon("volume"));
  const sounds = h("select", { "aria-label": t("tv.track.audio"), title: t("tv.track.audio"), hidden: true, onchange: () => ((p.audio = Number(sounds.value)), void load(position())) });
  const subs = h("select", { "aria-label": t("tv.track.subs"), title: t("tv.track.subs"), hidden: true, onchange: () => ((p.sub = Number(subs.value)), void words()) });
  const spoken = h("div", { class: "sp-words", "aria-live": "off" });
  const el = h("div", { class: "sp" }, h("div", { class: "sp-view" }, video, spoken), note, h("div", { class: "sp-bar" }, play, clock, bar, sounds, subs, mute, h("button", { type: "button", class: "icon-btn", "aria-label": t("tv.fullScreen"), title: t("tv.fullScreen"), onclick: () => (document.fullscreenElement ? void document.exitFullscreen() : void el.requestFullscreen?.().catch(() => {})) }, icon("expand"))));
  const shown = () => {
    const total = p.info?.duration ?? 0;
    const now = p.dragging ? Number(bar.value) : position();
    clock.textContent = total ? `${tvClock(now)} / ${tvClock(total)}` : tvClock(now);
    if (!p.dragging) bar.value = String(now);
  };
  const say = (text) => ((note.textContent = text), (note.hidden = !text));
  /**
   * The chosen subtitle. Its lines come with the file's own times and are kept here, on the stream's
   * clock; `paint` shows the ones of this very moment in a layer of ours over the picture. The
   * browser's own subtitle tracks were tried first: a line of before a jump stayed drawn over the
   * new ones. Every choice and every jump starts a list of its own, so nothing of the old one is left.
   */
  // The words of a subtitle line. Marks are taken out until none is left (one cut can leave another: "<<i>b>"), and "&amp;" is
  // read last, so "&amp;lt;" stays the text "&lt;". The words are put on the page as text, never as markup.
  const cueWords = (raw) => {
    let text = raw;
    for (let before = ""; before !== text; ) {
      before = text;
      text = text.replace(/<[^>]*>/g, "");
    }
    return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
  };
  const words = async () => {
    p.reading?.abort();
    const lines = (p.lines = []);
    paint();
    if (p.sub < 0) return;
    const stop = (p.reading = new AbortController());
    const zero = p.start;
    const moment = (text) => text.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
    const place = (block) => {
      const rows = block.split("\n");
      const at = rows.findIndex((row) => row.includes("-->"));
      const times = at < 0 ? null : /^\s*([\d:.]+)\s+-->\s+([\d:.]+)/.exec(rows[at]);
      // the marks of the format (<i>, <c.yellow>, <00:01.000>) are left out: the words alone are shown
      const text = cueWords(rows.slice(at + 1).join("\n"));
      if (!times || !text) return;
      const [from, to] = [moment(times[1]) - zero, moment(times[2]) - zero];
      if (to > 0 && to > from) lines.push({ from, to, text });
    };
    try {
      const res = await fetch(from("subs", p.sub), { signal: stop.signal });
      if (!res.ok) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        rest += decoder.decode(value ?? new Uint8Array(), { stream: !done }).replace(/\r/g, "");
        const blocks = rest.split("\n\n");
        rest = done ? "" : blocks.pop();
        if (stop.signal.aborted) return;
        blocks.forEach(place);
        if (done) return;
      }
    } catch {
      // stopped for another subtitle or another moment, or the server ended it: what came stays
    }
  };
  /** The lines of this moment, redrawn only when they are other ones */
  const paint = () => {
    const now = video.currentTime || 0;
    const said = (p.lines ?? []).filter((line) => line.from <= now && now < line.to).map((line) => line.text);
    const key = said.join("\n\n");
    if (key === p.said) return;
    p.said = key;
    put(spoken, said.map((text) => h("p", null, text)));
  };
  const follow = () => {
    if (p.gone) return;
    paint();
    requestAnimationFrame(follow);
  };
  const load = async (moment) => {
    say("");
    let info;
    try {
      info = await api("GET", `/api/media?${where}&at=${Math.max(0, moment).toFixed(3)}`);
    } catch (e) {
      say(errorText(e));
      return failed?.();
    }
    if (p.gone) return;
    if (!p.info) {
      if (!info.audio.some((one) => one.index === p.audio)) p.audio = 0;
      if (!info.subs.some((one) => one.index === p.sub && one.text)) p.sub = -1;
      put(sounds, info.audio.map((one) => h("option", { value: String(one.index), selected: one.index === p.audio }, trackLabel(one))));
      sounds.hidden = info.audio.length < 2;
      const readable = info.subs.filter((one) => one.text);
      put(subs, h("option", { value: "-1", selected: p.sub < 0 }, t("tv.track.noSubs")), readable.map((one) => h("option", { value: String(one.index), selected: one.index === p.sub }, one.index === OUTSIDE_SUB ? t("tv.link.ownSubs") : trackLabel(one))));
      subs.hidden = readable.length === 0;
      // the picture's shape is known from the file: the box keeps it while a new stream is asked for after a jump,
      // or the window would fold to an empty player's size and spring back
      if (info.video?.width > 0 && info.video.height > 0) video.style.aspectRatio = `${info.video.width} / ${info.video.height}`;
      bar.max = String(Math.floor(info.duration));
      bar.hidden = !info.duration;
    }
    p.info = info;
    p.startText = info.start;
    p.start = info.zero;
    video.src = from("stream", p.audio);
    void words();
    void video.play().catch(() => {});
  };
  video.addEventListener("timeupdate", shown);
  video.addEventListener("click", () => play.click());
  video.addEventListener("play", () => play.replaceChildren(icon("pause")));
  video.addEventListener("pause", () => play.replaceChildren(icon("play")));
  video.addEventListener("playing", () => {
    p.tries = 0;
    if (!p.reported) played?.();
    p.reported = true;
  });
  // a stream left paused for long is cut by the way it came: asked for again from where it stopped
  video.addEventListener("error", () => {
    if (p.gone || !video.getAttribute("src")) return;
    if (p.reported && p.tries++ < 2) return void load(position());
    say(t("tv.browserCannot"));
    failed?.();
  });
  bar.addEventListener("input", () => ((p.dragging = true), shown()));
  bar.addEventListener("change", () => ((p.dragging = false), void load(Number(bar.value))));
  el.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === " ") (e.preventDefault(), play.click());
    if (e.key === "ArrowRight") void load(position() + 30);
    if (e.key === "ArrowLeft") void load(position() - 30);
  });
  // on the whole screen the bar lies over the picture and goes away after a few quiet seconds of playing;
  // a move of the pointer, a touch or a key brings it back, and it stays while paused or while a list is open
  const panel = el.querySelector(".sp-bar");
  const wake = () => {
    el.classList.remove("idle");
    clearTimeout(p.quiet);
    p.quiet = setTimeout(() => {
      if (p.gone) return;
      if (video.paused || panel.matches(":hover") || document.querySelector("dialog.select-list[open]")) return wake();
      el.classList.add("idle");
    }, 3000);
  };
  for (const name of ["pointermove", "pointerdown", "keydown", "touchstart"]) el.addEventListener(name, wake, { passive: true });
  video.addEventListener("pause", wake);
  video.addEventListener("play", wake);
  document.addEventListener("fullscreenchange", wake);
  void load(at);
  requestAnimationFrame(follow);
  return {
    el,
    position,
    pause: () => video.pause(),
    stop: () => {
      p.gone = true;
      clearTimeout(p.quiet);
      document.removeEventListener("fullscreenchange", wake);
      p.reading?.abort();
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
  };
}

/** Sound alone among what the player plays: the browser needs no picture for it */
const TV_SOUND_RE = /\.(mp3|flac|m4a|ogg|opus|wav|aac|wma)$/i;
/** What a browser has a chance to play itself */
const TV_BROWSER_RE = /\.(mp4|m4v|webm|mov|mkv|ogv|mp3|flac|m4a|ogg|opus|wav|aac)$/i;

/** An address on the network instead of a file of this server */
const isLink = (path) => /^https?:\/\//i.test(path);
/** The number subtitles given by an address of their own go by in the player */
const OUTSIDE_SUB = 1000;
/** Where an address leads, as a title: without what follows the "?" */
const linkTitle = (link) => {
  try {
    const url = new URL(link);
    return url.host + (url.pathname === "/" ? "" : decodeURIComponent(url.pathname));
  } catch {
    return link;
  }
};

/** An address played in this browser by Hata's own player; from there it can go on on the TV */
function playLinkHere(link, subtitle, at = 0) {
  let dialog;
  const title = linkTitle(link);
  const player = streamPlayer(link, { at, sub: subtitle ? OUTSIDE_SUB : -1, outside: subtitle });
  const toTv = tvReady() && button(t("tv.toTv"), { class: "small", onclick: () => void moveToTv(link, title, player, () => dialog.close(), subtitle) }, "tv");
  dialog = openDialog("xwide viewer", h("header", null, h("div", { class: "grow" }, h("h2", { class: "clip" }, title)), toTv, closeX(() => dialog)), h("div", { class: "stage" }, player.el));
  dialog.addEventListener("close", () => player.stop());
}

/** "Play a link": the address of a video or a broadcast, played on the TV or in this browser */
function playLinkDialog() {
  let dialog;
  const address = h("input", { type: "url", inputMode: "url", autocomplete: "off", spellcheck: false, maxLength: 2000, placeholder: "https://", required: true });
  const subtitle = h("input", { type: "url", inputMode: "url", autocomplete: "off", spellcheck: false, maxLength: 2000, placeholder: "https://" });
  const error = h("p", { class: "error", role: "alert" });
  const read = () => {
    error.textContent = "";
    const [link, subs] = [address.value.trim(), subtitle.value.trim()];
    if (!isLink(link) || (subs && !isLink(subs))) return void (error.textContent = t("error.tv.badLink"));
    return { link, subs };
  };
  const onTv = async (e) => {
    const said = read();
    if (!said) return;
    e.currentTarget.disabled = true;
    try {
      await api("POST", "/api/tv/play", { path: said.link, ...(said.subs ? { subtitle: said.subs } : {}) });
    } catch (err) {
      e.target.closest("button").disabled = false;
      return void (error.textContent = errorText(err));
    }
    toast(t("tv.playing", { name: linkTitle(said.link) }));
    dialog.close();
    setTimeout(loadTv, 500);
  };
  const here = () => {
    const said = read();
    if (!said) return;
    dialog.close();
    playLinkHere(said.link, said.subs);
  };
  const tv = tvReady();
  const browser = tvStreams();
  dialog = openDialog(
    "",
    h("h2", null, t("tv.link.title")),
    h("p", { class: "muted" }, t("tv.link.lead")),
    field(t("tv.link.address"), address),
    field(t("tv.link.subs"), subtitle, t("tv.link.subsHint")),
    !tv && h("p", { class: "muted small" }, t("tv.link.noTv")),
    !browser && h("p", { class: "muted small" }, t("tv.link.noBrowser")),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), browser && button(t("tv.link.here"), { class: tv ? "" : "primary", onclick: here }, "external"), tv && button(t("tv.link.onTv"), { class: "primary", onclick: (e) => void onTv(e) }, "tv")),
  );
  address.focus();
}

async function playOnTv(path, name) {
  try {
    await api("POST", "/api/tv/play", { path });
    toast(t("tv.playing", { name }));
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/* Music: the second player, on the server's own speakers */

const MUSIC_PLAYS_RE = /\.(mp3|flac|m4a|m4b|ogg|oga|opus|wav|aac|wma|ape|wv|aiff?|mka|m3u8?|pls)$/i;
const musicUi = { timer: null, busy: false };

async function playMusic(what, name) {
  try {
    state.music = await api("POST", "/api/music/play", what);
    toast(t(what.add ? "music.queued" : "music.playing", { name }));
    if (state.route.view === "music") paintMusic();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

async function loadMusic() {
  clearTimeout(musicUi.timer);
  if (state.route.view !== "music" || !hasModule("music")) return;
  try {
    state.music = await api("GET", "/api/music");
  } catch (e) {
    if (!state.music) put(document.getElementById("music-body"), h("section", { class: "card pad" }, h("p", { class: "error" }, errorText(e))));
  }
  // a slider under the finger or an open list is not redrawn under the person
  if (state.music && !musicUi.busy && !document.querySelector("dialog[open]") && !document.querySelector("#music-body input[type=range]:active")) paintMusic();
  musicUi.timer = setTimeout(loadMusic, state.music?.now ? 2000 : 8000);
}

/** What the second player plays, in the head of every page next to the TV's: one button, the player under it */
function paintMusicNow() {
  const box = document.getElementById("music-now");
  if (!box) return;
  const there = isAdmin() && hasModule("music");
  const now = there ? state.musicNow : null;
  box.hidden = !there;
  box.className = "tv-now" + (now && !now.paused ? " playing" : "") + (document.querySelector("dialog.music-drop[open]") ? " open" : "");
  if (!there) return box.replaceChildren();
  const label = now ? t("music.playing", { name: now.title }) : t("music.title");
  const halves = [h("button", { type: "button", class: "tv-now-half tv-now-open", title: label, "aria-label": label, "aria-haspopup": "dialog", onclick: () => musicDropdown(box) }, icon("music"))];
  box.replaceChildren(...halves.filter(Boolean));
}

function musicDropdown(at) {
  let dialog;
  let timer = 0;
  let busy = false;
  const body = h("div", { class: "stack" }, waitMark());
  const paint = () => {
    const m = state.music;
    if (!m || busy || body.querySelector("input[type=range]:active") || document.querySelector("dialog.select-list[open]") || dialog.classList.contains("pulled")) return;
    put(body, m.state === "missing" ? h("p", { class: "muted pad" }, t("error.music.missing")) : musicPlayerCard(m, act));
  };
  const act = async (method, path, data) => {
    busy = true;
    try {
      state.music = await api(method, path, data);
    } catch (e) {
      toast(errorText(e), "error");
    }
    busy = false;
    paint();
  };
  const load = async () => {
    clearTimeout(timer);
    if (!dialog.isConnected) return;
    try {
      state.music = await api("GET", "/api/music");
      paint();
    } catch (e) {
      put(body, h("p", { class: "error pad" }, errorText(e)));
    }
    timer = setTimeout(load, 2000);
  };
  dialog = openDialog("dropdown music-drop", h("div", { class: "tvr-head" }, h("span", { class: "with-icon muted" }, icon("music"), t("music.title")), h("a", { class: "link small with-icon", href: "#/house/music", onclick: () => dialog.close() }, t("music.open"), icon("chevron"))), body);
  dialog.addEventListener("close", () => {
    clearTimeout(timer);
    paintMusicNow();
  });
  pullToClose(dialog);
  at.classList.add("open");
  const r = at.getBoundingClientRect();
  placeAt(dialog, { x: r.right - dialog.offsetWidth, y: r.bottom + 6 });
  void load().then(() => placeAt(dialog, { x: r.right - dialog.offsetWidth, y: r.bottom + 6 }));
}

function musicLinkDialog() {
  let dialog;
  const address = h("input", { type: "url", inputMode: "url", autocomplete: "off", spellcheck: false, maxLength: 2000, placeholder: "https://", required: true });
  const error = h("p", { class: "error", role: "alert" });
  const play = async (e) => {
    e.preventDefault();
    const url = address.value.trim();
    if (!isLink(url)) return void (error.textContent = t("error.music.badLink"));
    try {
      state.music = await api("POST", "/api/music/play", { url });
    } catch (err) {
      return void (error.textContent = errorText(err));
    }
    dialog.close();
    paintMusic();
  };
  dialog = openDialog("confirm", h("form", { class: "stack", onsubmit: play }, h("h2", null, t("music.link")), h("p", { class: "muted" }, t("music.linkLead")), address, error, h("footer", null, closeButton(() => dialog, t("common.cancel")), h("button", { type: "submit", class: "btn primary" }, icon("play"), h("span", null, t("music.playNow"))))));
  address.focus();
}

const musicFolder = () => folderPicker({ title: t("music.folder"), start: state.settings?.dataRoot ?? "/", confirmLabel: t("music.playNow"), action: (path) => playMusic({ path }, path.split("/").pop() || path) });

function renderMusic() {
  shell(areaHead("house", "music", { actions: h("div", { class: "row-actions" }, button(t("music.link"), { onclick: musicLinkDialog }, "link"), button(t("music.folder"), { class: "primary", onclick: musicFolder }, "folder")) }), h("div", { id: "music-body", class: "stack" }, waitMark()));
  cleanups.push(() => clearTimeout(musicUi.timer));
  if (state.music) paintMusic();
}

/** The same speakers as a player of Music Assistant: Squeezelite, by its own button */
function musicSpeakerCard(m, act) {
  const s = m.speaker;
  const error = h("p", { class: "error", role: "alert" });
  if (s.state === "missing") {
    const install = async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      el.lastChild.textContent = t("tools.installing");
      try {
        await api("POST", "/api/tools/squeezelite/install", {});
        void loadMusic();
      } catch (err) {
        error.textContent = errorText(err);
        el.disabled = false;
      }
    };
    return h("section", { class: "card pad stack" }, h("h2", null, t("music.speaker.title")), h("p", { class: "muted" }, t("music.speaker.lead")), h("p", null, t("music.speaker.what")), s.install ? h("p", { class: "cmd" }, icon("terminal"), s.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: "squeezelite" })), error, s.install && h("footer", null, button(t("mounting.needs.install", { package: "Squeezelite" }), { onclick: install }, "download")));
  }
  const on = s.state === "on";
  const name = h("input", { value: s.name, maxLength: 40, required: true, "aria-label": t("music.speaker.name") });
  const server = h("input", { value: s.server, maxLength: 260, placeholder: t("music.speaker.serverAuto"), spellcheck: false, autocapitalize: "off", class: "mono", "aria-label": t("music.speaker.server") });
  const typed = () => ({ name: name.value.trim(), server: server.value.trim() });
  return h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("music.speaker.title"), h("span", { class: "state " + (on ? (s.running ? "running" : "partial") : "stopped") }, t(on ? (s.running ? "bt.state.on" : "music.speaker.starting") : "bt.state.off")))),
    h("p", { class: "muted" }, t("music.speaker.lead")),
    settingRow(t("music.speaker.name"), t("music.speaker.nameHint"), name),
    settingRow(t("music.speaker.server"), t("music.speaker.serverHint"), server),
    on && h("p", { class: "muted small" }, t("music.speaker.how")),
    h("footer", null, h("div", { class: "row-actions" }, on && button(t("bt.turnOff"), { onclick: () => act("PUT", "/api/music", { speaker: { on: false } }) }), button(t(on ? "settings.save" : "music.speaker.turnOn"), { class: "primary", onclick: () => act("PUT", "/api/music", { speaker: { ...typed(), on: true } }) }))),
  );
}

/** The player itself — what plays, the keys, the volume, where the sound goes: on the Music tab and under the chip in the head */
function musicPlayerCard(m, act, error = null) {
  const press = (action, value) => act("POST", "/api/music/do", { action, value });
  const now = m.now;
  const round = (action, iconName, cls = "") => h("button", { type: "button", class: "tvr-round " + cls, title: t("music.key." + action), "aria-label": t("music.key." + action), disabled: !now, onclick: () => press(action) }, icon(iconName));
  const seek = now?.duration ? h("input", { type: "range", class: "tvr-slider", min: 0, max: Math.floor(now.duration), value: Math.floor(now.position), "aria-label": t("music.position"), onchange: (e) => press("seek", Number(e.target.value)) }) : null;
  const volume = h("input", { type: "range", class: "tvr-slider" + (m.muted ? " muted" : ""), min: 0, max: 100, value: m.volume, "aria-label": t("music.volume"), onchange: (e) => press("volume", Number(e.target.value)) });
  const kind = (o) => t("music.out." + o.kind);
  const output = m.outputs.length
    ? h("select", { "aria-label": t("music.output"), onchange: (e) => act("PUT", "/api/music", { output: e.target.value }) }, m.outputs.map((o) => h("option", { value: o.id, selected: o.id === m.output }, `${o.name} — ${kind(o)}`)))
    : h("span", { class: "muted" }, t("music.noOutput"));
  const player = h(
    "section",
    { class: "card pad stack music-player" },
    now
      ? h("div", { class: "music-now" }, h("span", { class: "badge-icon plain" }, icon(now.link ? "globe" : "music")), h("div", { class: "grow" }, h("strong", { class: "wrap" }, now.title), now.by && h("div", { class: "muted small wrap" }, now.by)), now.paused && h("span", { class: "state busy" }, t("tv.paused")))
      : h("div", { class: "music-now" }, h("span", { class: "badge-icon plain" }, icon("music")), h("div", { class: "grow" }, h("strong", null, t("music.idle")), h("div", { class: "muted small" }, t("music.idleLead")))),
    seek && h("div", { class: "music-seek" }, h("span", { class: "muted small mono" }, tvClock(now.position)), seek, h("span", { class: "muted small mono" }, tvClock(now.duration))),
    h("div", { class: "music-keys" }, round("previous", "previous"), h("button", { type: "button", class: "tvr-main", title: t("music.key.playpause"), "aria-label": t("music.key.playpause"), disabled: !now, onclick: () => press("playpause") }, icon(now && !now.paused ? "pause" : "play")), round("next", "next"), round("stop", "stop")),
    h("div", { class: "tvr-volume" }, h("button", { type: "button", class: "icon-btn", title: t("music.key.mute"), "aria-label": t("music.key.mute"), disabled: !m.running, onclick: () => press("mute", !m.muted) }, icon(m.muted ? "volumeOff" : "volume")), volume, h("span", { class: "muted small mono" }, m.volume)),
    m.volumeOf === "speaker" && h("p", { class: "muted small" }, t("music.volumeSpeaker")),
    settingRow(t("music.output"), t("music.outputHint"), output),
    error,
  );
  return player;
}

function paintMusic() {
  const box = document.getElementById("music-body");
  const m = state.music;
  if (!box || !m) return;
  const error = h("p", { class: "error", role: "alert" });
  if (m.state === "missing") {
    const install = async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      el.lastChild.textContent = t("tools.installing");
      try {
        await api("POST", "/api/tools/mpv/install", {});
        void loadMusic();
      } catch (err) {
        error.textContent = errorText(err);
        el.disabled = false;
      }
    };
    return put(box, h("section", { class: "card pad stack" }, h("h2", null, t("music.title")), h("p", { class: "muted" }, t("music.lead")), h("p", null, t("music.what")), m.install ? h("p", { class: "cmd" }, icon("terminal"), m.install) : h("p", { class: "muted small" }, t("mounting.needs.byHand", { package: "mpv" })), error, m.install && h("footer", null, button(t("mounting.needs.install", { package: "mpv" }), { class: "primary", onclick: install }, "download"))));
  }
  const act = async (method, path, data) => {
    error.textContent = "";
    musicUi.busy = true;
    try {
      state.music = await api(method, path, data);
    } catch (e) {
      musicUi.busy = false;
      // the choice shown goes back to what is true
      void loadMusic();
      return toast(errorText(e), "error");
    }
    musicUi.busy = false;
    paintMusic();
  };
  const press = (action, value) => act("POST", "/api/music/do", { action, value });
  const player = musicPlayerCard(m, act, error);
  const queue = h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("music.queueTitle"), h("span", { class: "muted small" }, m.queue.length || "")), m.queue.length > 1 && h("div", { class: "row-actions" }, button(t("music.key.shuffle"), { class: "small", onclick: () => press("shuffle") }, "shuffle"), button(t("music.key.clear"), { class: "small", onclick: () => press("clear") }, "x"))),
    m.queue.length
      ? h(
          "div",
          { class: "music-queue" },
          m.queue.slice(0, 300).map((q, i) =>
            h(
              "div",
              { class: "music-row" + (q.current ? " current" : ""), menu: true },
              h("button", { type: "button", class: "music-pick", title: t("music.key.jump"), onclick: () => press("jump", i) }, icon(q.current ? "play" : q.link ? "globe" : "music"), h("span", { class: "grow" }, h("span", { class: "clip" }, q.title), q.where && h("span", { class: "muted small clip" }, q.where))),
              h("button", { type: "button", class: "icon-btn", title: t("music.key.remove"), "aria-label": t("music.key.remove"), onclick: () => press("remove", i) }, icon("x")),
            ),
          ),
          m.queue.length > 300 && h("p", { class: "muted small" }, t("music.more", { n: m.queue.length - 300 })),
        )
      : h("p", { class: "muted" }, t("music.queueEmpty")),
  );
  put(box, h("div", { class: "music-page" }, h("div", { class: "stack" }, player, musicSpeakerCard(m, act)), queue));
}

async function loadTv() {
  clearTimeout(tvUi.timer);
  if (state.route.view !== "tv" || !hasModule("tv")) return;
  try {
    state.tv = await api("GET", "/api/tv");
  } catch (e) {
    if (!state.tv) put(document.getElementById("tv-body"), h("section", { class: "card pad" }, h("p", { class: "error" }, errorText(e))));
  }
  // a slider under the finger or a list that is open is not redrawn under the person
  // nor the picture of the screen while it has this device's whole screen: taken out of the page for a moment, it would fall back
  // nor a field somebody is typing an address into
  if (state.tv && !tvUi.busy && !document.fullscreenElement && !document.activeElement?.closest?.("#tv-body .tv-address") && !document.querySelector("dialog[open]:not(.tv-drop)") && !document.querySelector("#tv-body input[type=range]:active")) paintTv();
  // while the player runs the page keeps up with what plays
  tvUi.timer = setTimeout(loadTv, state.tv?.running || state.tv?.browser?.running ? 2000 : 8000);
}

function renderTv() {
  shell(areaHead("house", "tv"), h("div", { id: "tv-body", class: "stack" }, waitMark()));
  cleanups.push(() => clearTimeout(tvUi.timer));
  if (state.tv) paintTv();
}

const tvClock = (s) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * The remote itself, the same on the TV page and under the chip in the head: what plays, the transport
 * with pause as the one loud button, the volume, a round pad with OK in the middle, four keys below.
 */
function tvRemoteParts(tv, press, turnOn) {
  const note = (iconName, title, text, action) => h("div", { class: "tvr-note" }, h("strong", { class: "with-icon" }, icon(iconName), title), h("p", { class: "muted small" }, text), action);
  // a web page has the screen: its own few buttons instead of the player's
  if (tv.screen === "browser") return tvPageParts(tv);
  if (!tv.installed) return [note("tv", t("tv.needsTitle"), t("tv.needsShort"), h("a", { class: "btn primary wide", href: "#/tv", onclick: (e) => e.currentTarget.closest("dialog")?.close() }, h("span", null, t("tv.openPage"))))];
  if (!tv.running) return [note("power", t(tv.screen === "dark" ? "tv.darkTitle" : "tv.offTitle"), t(tv.screen === "dark" ? "tv.darkLead" : "tv.offLead"), turnOn && button(t("tv.turnOn"), { class: "primary wide", onclick: (e) => ((e.currentTarget.disabled = true), turnOn()) }, "power"))];
  const idle = !tv.answers;
  const now = tv.playing;
  const round = (action, iconName, label, cls = "", off = false) => h("button", { type: "button", class: "tvr-round " + cls, title: label, "aria-label": label, disabled: idle || off, onclick: () => press(action) }, icon(iconName));
  const position = now && now.total > 0 && h("input", { type: "range", class: "tvr-slider", min: 0, max: 100, step: 0.1, value: (now.time / now.total) * 100, "aria-label": t("tv.position"), onchange: (e) => press("seek", Number(e.target.value)) });
  const file = now && !isLink(now.file) ? now.file.split("/").pop() : "";
  const volume = h("input", { type: "range", class: "tvr-slider" + (tv.muted ? " muted" : ""), min: 0, max: 100, step: 1, value: tv.volume, disabled: idle, "aria-label": t("tv.volume"), onchange: (e) => press("volume", Number(e.target.value)) });
  const skip = (action, iconName, label) => h("button", { type: "button", class: "tvr-round skip", title: label, "aria-label": label, disabled: idle || !now, onclick: () => press(action) }, icon(iconName), h("span", null, "30"));
  const arrow = (action, cls, label) => h("button", { type: "button", class: "tvr-arrow " + cls, title: label, "aria-label": label, disabled: idle, onclick: () => press(action) }, icon("chevron"));
  const keyed = (action, iconName, label) => h("div", { class: "tvr-key" }, round(action, iconName, label), h("span", { class: "muted" }, label));
  // the sound and the subtitles of what plays, chosen here instead of in the player's menu on the screen
  const tracks = now && (now.audio?.length > 1 || now.subs?.length > 0) && h(
    "div",
    { class: "tvr-tracks" },
    now.audio.length > 1 && h("label", null, h("span", { class: "muted" }, t("tv.track.audio")), h("select", { onchange: (e) => press("audio", Number(e.target.value)) }, now.audio.map((one) => h("option", { value: String(one.index), selected: one.index === now.audioNow }, trackLabel(one))))),
    now.subs.length > 0 && h("label", null, h("span", { class: "muted" }, t("tv.track.subs")), h("select", { onchange: (e) => press("subtitle", e.target.value === "off" ? "off" : Number(e.target.value)) }, h("option", { value: "off", selected: now.subNow < 0 }, t("tv.track.noSubs")), now.subs.map((one) => h("option", { value: String(one.index), selected: one.index === now.subNow }, trackLabel(one))))),
  );
  const typed = h("div", { class: "tvr-key" }, h("button", { type: "button", class: "tvr-round", title: t("tv.key.textHint"), "aria-label": t("tv.key.text"), disabled: idle, onclick: () => tvTextDialog(press) }, icon("keys")), h("span", { class: "muted" }, t("tv.key.text")));
  return [
    idle
      ? note("refresh", t("tv.starting"), t("tv.startingLead"))
      : now
        ? h("div", { class: "tvr-now" }, h("div", { class: "tvr-title" }, h("div", { class: "grow" }, h("strong", { class: "wrap" }, now.title), now.paused && h("span", { class: "state busy" }, t("tv.paused"))), round("stop", "stop", t("tv.key.stop"))), file && file !== now.title && h("p", { class: "tvr-file muted" }, file), position, h("div", { class: "tvr-times muted" }, h("span", null, tvClock(now.time)), h("span", null, tvClock(now.total))), tracks, (isLink(now.file) ? tvStreams() : now.file.startsWith("/") && (tvStreams() ? TV_PLAYS_RE.test(now.file) && fileKind({ type: "file", name: now.file }) !== "image" : TV_BROWSER_RE.test(now.file))) && h("div", { class: "row-actions" }, button(t("tv.toBrowser"), { class: "small", onclick: () => moveToBrowser(now) }, "external")))
        : note("tv", t("tv.nothingTitle"), t("tv.nothing")),
    h("div", { class: "tvr-transport" }, skip("rewind", "back30", t("tv.key.rewind")), h("button", { type: "button", class: "tvr-main", title: t("tv.key.playpause"), "aria-label": t("tv.key.playpause"), disabled: idle || !now, onclick: () => press("playpause") }, icon(now && !now.paused ? "pause" : "play")), skip("forward", "fwd30", t("tv.key.forward"))),
    h("div", { class: "tvr-volume" }, round("mute", tv.muted ? "volumeOff" : "volume", t(tv.muted ? "tv.unmute" : "tv.mute"), tv.muted ? "on" : ""), volume, h("span", { class: "tvr-value" + (tv.muted ? " muted" : "") }, tv.muted ? t("tv.muted") : `${tv.volume}%`)),
    tv.audio && tv.audio.options.length > 1 && h("div", { class: "tvr-tracks" }, h("label", null, h("span", { class: "muted" }, t("tv.out")), h("select", { "aria-label": t("tv.audio"), onchange: (e) => api("PUT", "/api/tv", { audio: e.target.value }).then((said) => ((state.tv = said), state.route.view === "tv" && paintTv()), (err) => toast(errorText(err), "error")) }, tv.audio.options.map((o) => h("option", { value: o.value, selected: o.value === tv.audio.value }, o.label))))),
    h("hr", { class: "tvr-rule" }),
    h("div", { class: "tvr-pad" }, arrow("up", "up", t("tv.key.up")), arrow("left", "left", t("tv.key.left")), h("button", { type: "button", class: "tvr-ok", disabled: idle, onclick: () => press("select") }, "OK"), arrow("right", "right", t("tv.key.right")), arrow("down", "down", t("tv.key.down"))),
    h("div", { class: "tvr-keys" }, keyed("back", "undo", t("tv.key.back")), keyed("home", "home", t("tv.key.home")), keyed("menu", "lines", t("tv.key.menu")), keyed("info", "info", t("tv.key.info")), typed),
  ];
}

/** The word and the colour of the chip that says what the screen does now: `[state class, word]` */
function tvChip(tv) {
  if (tv.screen === "browser") {
    const m = tv.browser.media;
    return m ? [m.paused ? "busy" : "running", `${t("tv.chip.video")} · ${t(m.paused ? "tv.paused" : "tv.chip.plays")}`] : ["stopped", t("tv.chip.page")];
  }
  if (tv.screen === "kodi") {
    if (!tv.answers) return ["busy", t("tv.chip.starting")];
    return tv.playing ? [tv.playing.paused ? "busy" : "running", t(tv.playing.paused ? "tv.paused" : "tv.chip.plays")] : ["stopped", t("tv.chip.menu")];
  }
  return ["stopped", t(tv.screen === "dark" ? "tv.chip.off" : "tv.chip.console")];
}

/**
 * What plays on the screen as one thing, whether it is a video of a web page or the player's film:
 * where it is, and what its buttons do. null — nothing that could be paused.
 */
function tvMediaOf(tv, again) {
  const failed = (e) => toast(errorText(e), "error");
  if (tv.screen === "browser") {
    const m = tv.browser.media;
    if (!m) return null;
    const act = (action, value) => api("POST", "/api/tv/browser", { action, value }).then(() => setTimeout(again, 400), failed);
    return { paused: m.paused, time: m.time, total: m.total, muted: m.muted, volume: m.volume, play: () => act("play"), skip: (s) => act("skip", s), seek: (v) => act("seek", v), mute: () => act("mute"), loud: (v) => act("volume", v), fourth: { icon: "expand", label: t(m.full ? "tv.page.fullOff" : "tv.page.full"), on: m.full, run: () => act("full") } };
  }
  const now = tv.screen === "kodi" && tv.answers ? tv.playing : null;
  if (!now) return null;
  const press = (action, value) => api("POST", "/api/tv/do", { action, value }).then(() => setTimeout(again, 250), failed);
  return { paused: now.paused, time: now.time, total: now.total, muted: tv.muted, volume: tv.volume, play: () => press("playpause"), skip: (s) => press(s < 0 ? "rewind" : "forward"), seek: (v) => press("seek", v), mute: () => press("mute"), loud: (v) => press("volume", v), fourth: { icon: "stop", label: t("tv.key.stop"), on: false, run: () => press("stop") } };
}

/** The buttons of what plays: 30 seconds back, pause as the one loud button, 30 on, and a fourth (stop, or the whole screen) */
function tvTransport(m) {
  const round = (iconName, label, run, cls = "") => h("button", { type: "button", class: "tvr-round " + cls, title: label, "aria-label": label, onclick: run }, icon(iconName), cls === "skip" && h("span", null, "30"));
  return [
    round("back30", t("tv.key.rewind"), () => m.skip(-30), "skip"),
    h("button", { type: "button", class: "tvr-main", title: t("tv.key.playpause"), "aria-label": t("tv.key.playpause"), onclick: m.play }, icon(m.paused ? "play" : "pause")),
    round("fwd30", t("tv.key.forward"), () => m.skip(30), "skip"),
    round(m.fourth.icon, m.fourth.label, m.fourth.run, "tv-fourth" + (m.fourth.on ? " on" : "")),
  ];
}

/**
 * The stage: a dark rectangle of the screen's shape that is there in every mode and says what the
 * screen shows — a site's name (the screen itself, live, only when asked for), what the player plays,
 * or, while nothing of Hata's is on the screen, what to put there by one press.
 */
function tvStage(tv, { card = false, go, show, hide, media = null }) {
  const b = tv.browser;
  const badge = (iconName, cls = "kodi") => h("span", { class: "tv-mark-icon " + cls, "aria-hidden": "true" }, icon(iconName));
  const words = (mark, title, sub, ...more) => h("div", { class: "tv-stage-words" }, mark, h("strong", { class: "tv-stage-title" }, title), sub && h("span", { class: "tv-stage-sub clip" }, sub), more);
  // where what plays is, along the stage's lower edge; with `media` it is also pulled to another place
  const bar = (time, total) => {
    if (!(total > 0)) return null;
    const at = Math.min(100, (time / total) * 100);
    const fill = h("b");
    fill.style.width = `${at}%`;
    if (!media) return h("i", { class: "tv-stage-bar" }, fill);
    const pull = h("input", { type: "range", min: 0, max: 100, step: 0.1, value: at, "aria-label": t("tv.position"), onchange: (e) => media.seek(Number(e.target.value)) });
    pull.addEventListener("input", () => (fill.style.width = `${pull.value}%`));
    return h("span", { class: "tv-stage-bar seek" }, fill, pull);
  };
  const stage = (cls, ...kids) => h("div", { class: "tv-stage" + (cls ? " " + cls : "") }, kids);
  if (tv.screen === "browser") {
    if (!card && tvUi.control) return stage("live", tvPreview(), h("button", { type: "button", class: "tv-stage-chip", onclick: hide }, icon("eyeOff"), t("tv.page.controlOff")));
    const m = b.media;
    return stage("", words(b.url ? tvMarkIcon({ name: b.title || tvHost(b.url), url: b.url }) : badge("home"), b.title || t(b.url ? "tv.page.blank" : "tv.page.home"), b.url ? tvHost(b.url) : "", !card && h("button", { type: "button", class: "tv-stage-btn", title: t("tv.page.controlHint"), onclick: show }, icon("eye"), t("tv.stage.show"))), m && bar(m.time, m.total));
  }
  if (tv.screen === "kodi") {
    if (!tv.answers) return stage("", words(h("span", { class: "wait-ring" }), t("tv.starting"), t("tv.startingLead")));
    const now = tv.playing;
    if (!now) return stage("", words(badge("film"), t("tv.stage.menu"), t("tv.stage.menuHint")));
    const file = isLink(now.file) ? tvHost(now.file) : now.file.split("/").pop();
    return stage("", now.total > 0 && h("span", { class: "tv-stage-chip" }, `${tvClock(now.time)} / ${tvClock(now.total)}`), words(badge("film"), now.title, file !== now.title ? file : ""), bar(now.time, now.total));
  }
  // nothing of Hata's on the screen: what can be put there, the player first
  const tile = (cls, mark, title, sub, run) => h("button", { type: "button", class: "tv-pick" + (cls ? " " + cls : ""), onclick: (e) => (e.currentTarget.classList.add("going"), run()) }, mark, h("span", { class: "tv-mark-words" }, h("strong", { class: "clip" }, title), h("span", { class: "tv-pick-sub clip" }, sub)));
  const tiles = [
    tv.installed && tile("main", badge("film"), t("tv.turnOnKodi"), t("tv.pick.kodi"), () => go("kodi")),
    b.installed && tile("", badge("globe", "plain"), t("tv.openBrowser"), t("tv.pick.browser"), () => go("browser")),
    ...(b.installed ? (b.bookmarks ?? []).slice(0, 4) : []).map((one) => tile("", tvMarkIcon(one), one.name || tvHost(one.url), tvHost(one.url), () => go("url", one.url))),
  ].filter(Boolean);
  if (!tiles.length) return stage("", words(badge("film"), t("tv.needsTitle"), t("tv.stage.needs")));
  return stage("pick", h("div", { class: "tv-stage-pick" }, h("p", { class: "with-icon" }, icon(tv.screen === "dark" ? "power" : "terminal"), t(tv.screen === "dark" ? "tv.pick.dark" : "tv.pick.console")), h("div", { class: "tv-picks" }, tiles)));
}

/**
 * The TV as a card of Home: the same stage as on the TV page and the same buttons of what plays under
 * it (beside it in a wide low card). It asks the server by itself every few seconds while it is on the page.
 */
function tvBlock(el) {
  if (el.dataset.on) return;
  el.dataset.on = "1";
  const chip = h("span", { class: "state" });
  const body = h("div", { class: "tv-card" });
  let busy = false;
  let timer = 0;
  let last = null;
  const go = async (what, url) => {
    busy = true;
    tvWorking(t("tv.switching." + (what === "url" ? "page" : what === "back" ? "kodi" : what)), el);
    try {
      await (what === "url" ? api("POST", "/api/tv/open", { url }) : what === "back" ? api("POST", "/api/tv/back", {}) : api("PUT", "/api/tv", { screen: what }));
    } catch (e) {
      toast(errorText(e), "error");
    }
    busy = false;
    void load();
  };
  // everything else one reaches for, without going to the TV's page: who has the screen, a site, a link, a file
  const menu = (at) => {
    const tv = last;
    if (!tv) return;
    const b = tv.browser;
    const mode = (id, iconName, label, can = true) => ({ label, icon: iconName, on: tv.screen === id, off: !can, run: () => (tv.screen === id ? null : void go(id)) });
    const r = at.getBoundingClientRect();
    menuAt({ x: r.right - 250, y: r.bottom + 4 }, menuHeader(t("tv.onScreen"), tvChip(tv)[1]), [
      mode("kodi", "film", "Kodi", tv.installed),
      mode("browser", "globe", t("tv.page.browser"), b.installed),
      mode("off", "terminal", t("tv.onScreen.none")),
      mode("dark", "power", t("tv.onScreen.sleep")),
      tv.screen === "browser" && b.back && { label: t("tv.page.toPlayer"), icon: "undo", run: () => void go("back") },
      ...(b.installed ? (b.bookmarks ?? []).slice(0, 6) : []).map((one) => ({ label: one.name || tvHost(one.url), iconEl: tvMarkIcon(one), on: tv.screen === "browser" && b.url === one.url, run: () => void go("url", one.url) })),
      b.installed && { label: t("tv.card.site"), icon: "link", run: () => tvSiteDialog((url) => void go("url", url)) },
      { label: t("tv.link") + "…", icon: "play", run: playLinkDialog },
      { label: t("tv.card.file"), icon: "folder", href: filesHash(tv.folders?.[0] ?? state.settings?.dataRoot ?? "/") },
      { label: t("tv.openPage"), icon: "arrow", href: "#/house/tv" },
    ]);
  };
  put(el, h("div", { class: "section-head" }, h("h2", null, h("a", { class: "with-icon", href: "#/house/tv" }, icon("tv"), t("tv.title"))), h("span", { class: "row-actions" }, chip, h("button", { type: "button", class: "icon-btn tv-card-more", title: t("tv.more"), "aria-label": t("tv.more"), onclick: (e) => menu(e.currentTarget) }, icon("more")))), body);
  const load = async () => {
    clearTimeout(timer);
    if (!el.isConnected) return void delete el.dataset.on;
    let tv = null;
    if (!document.hidden && !busy) {
      try {
        tv = state.tv = await api("GET", "/api/tv");
      } catch {}
      if (!el.isConnected) return void delete el.dataset.on;
      if (tv) last = tv;
      // not redrawn under a slider that is being pulled
      if (tv && !busy && !document.querySelector("dialog[open]") && !document.fullscreenElement && !body.querySelector("input[type=range]:active")) paint(tv);
    }
    clearTimeout(timer);
    timer = setTimeout(load, tv && (tv.running || tv.browser.running) ? 3000 : 8000);
  };
  const paint = (tv) => {
    el.classList.remove("tv-switching");
    const [cls, word] = tvChip(tv);
    chip.className = "state " + cls;
    chip.textContent = word;
    const b = tv.browser;
    const toPage = () => ((tvUi.control = true), (location.hash = "#/house/tv"));
    const m = tvMediaOf(tv, load);
    const now = tv.screen === "kodi" && tv.answers ? tv.playing : null;
    const title = tv.screen === "browser" ? b.title || t(b.url ? "tv.page.blank" : "tv.page.home") : tv.screen === "kodi" ? (now ? now.title : t(tv.answers ? "tv.nothingTitle" : "tv.starting")) : t(tv.screen === "dark" ? "tv.darkTitle" : "tv.consoleHead");
    const sub = tv.screen === "browser" ? tvHost(b.url) : now && !isLink(now.file) ? now.file.split("/").pop() : "";
    const line = (text, action) => h("div", { class: "tv-card-foot" }, h("span", { class: "tv-card-quiet clip" }, text), action);
    const foot = m
      ? h("div", { class: "tv-card-foot" }, tvTransport(m), h("button", { type: "button", class: "tvr-round to-right" + (m.muted ? " on" : ""), title: t(m.muted ? "tv.unmute" : "tv.mute"), "aria-label": t(m.muted ? "tv.unmute" : "tv.mute"), onclick: m.mute }, icon(m.muted ? "volumeOff" : "volume")), h("input", { type: "range", class: "tvr-slider tv-vol" + (m.muted ? " muted" : ""), min: 0, max: 100, step: 1, value: m.volume, title: `${t("tv.volume")}: ${Math.round(m.volume)}%`, "aria-label": t("tv.volume"), onchange: (e) => m.loud(Number(e.target.value)) }))
      : tv.screen === "browser"
        ? line(t("tv.noVideoShort"), button(t("tv.stage.show"), { class: "small", onclick: toPage }, "eye"))
        : tv.screen === "kodi" && tv.answers
          ? h("div", { class: "tv-card-foot keys" }, [["back", "undo", t("tv.key.back"), ""], ["left", "chevron", t("tv.key.left"), "turn-left"], ["up", "chevron", t("tv.key.up"), "turn-up"], ["select", "", "OK", "ok"], ["down", "chevron", t("tv.key.down"), "turn-down"], ["right", "chevron", t("tv.key.right"), ""]].map(([action, iconName, label, cls]) => h("button", { type: "button", class: "tvr-round " + cls, title: label, "aria-label": label, onclick: () => api("POST", "/api/tv/do", { action }).catch((e) => toast(errorText(e), "error")) }, iconName ? icon(iconName) : "OK")))
          : null;
    put(body, tvStage(tv, { card: true, go, media: m }), h("div", { class: "tv-card-side" }, h("strong", { class: "tv-card-title" }, title), sub && h("span", { class: "tv-card-sub muted mono clip" }, sub), foot));
  };
  void load();
}

/** An address typed for the screen, from the card of Home: a bare name gets https:// in front */
function tvSiteDialog(show) {
  let dialog;
  const field = h("input", { type: "url", inputMode: "url", autocomplete: "off", spellcheck: false, maxLength: 2000, placeholder: t("tv.show.placeholder"), "aria-label": t("tv.page.address") });
  const send = () => {
    const typed = field.value.trim();
    if (!typed) return field.focus();
    dialog.close();
    show(/^https?:\/\//i.test(typed) ? typed : "https://" + typed);
  };
  field.addEventListener("keydown", (e) => e.key === "Enter" && send());
  dialog = openDialog("confirm", h("h2", null, t("tv.card.siteTitle")), field, h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("tv.page.show"), { class: "primary", onclick: send }, "tv")));
  field.focus();
}

/** Says, where the stage is, that the screen is changing hands: it takes some seconds, and the person is at the page, not at the screen */
function tvWorking(text, root = document.getElementById("tv-body")) {
  if (!root) return;
  root.classList.add("tv-switching");
  for (const stage of root.querySelectorAll(".tv-stage")) {
    stage.className = "tv-stage switching";
    stage.replaceChildren(h("div", { class: "tv-stage-words", role: "status" }, h("span", { class: "wait-ring" }), h("strong", { class: "tv-stage-title" }, text), h("span", { class: "tv-stage-sub" }, t("tv.stage.black"))));
  }
  for (const el of root.querySelectorAll(".tv-main button, .tv-show button, .tv-card-foot button")) el.disabled = true;
}

/**
 * The screen as a picture in Hata's page, while a web page has it: asked again every second (sooner
 * right after a press), the next one put in the place of the last only once it has loaded, so nothing
 * blinks. A click on it is a click there, the wheel scrolls there.
 */
function tvPreview() {
  const box = tvUi.preview ?? (tvUi.preview = h("div", { class: "tv-preview", role: "img", "aria-label": t("tv.page.previewHint") }));
  if (box.dataset.on) return box;
  box.dataset.on = "1";
  let quick = 0;
  let n = 0;
  const act = (action, value) => api("POST", "/api/tv/browser", { action, value }).then(() => ((quick = 6), next(150)), (e) => toast(errorText(e), "error"));
  const at = (e) => {
    // the picture itself: on the whole screen of this device it may stand inside bars
    const img = box.querySelector("img");
    const r = (img ?? box).getBoundingClientRect();
    // on a screen of another shape the picture keeps its own and stands between bars: the place is counted on the picture, not on its frame
    const [nw, nh] = [img?.naturalWidth, img?.naturalHeight];
    const shape = nw ? nw / nh : r.width / r.height;
    const w = Math.min(r.width, r.height * shape);
    const hgt = w / shape;
    const [left, top] = [r.left + (r.width - w) / 2, r.top + (r.height - hgt) / 2];
    return { x: Math.min(1, Math.max(0, (e.clientX - left) / w)), y: Math.min(1, Math.max(0, (e.clientY - top) / hgt)) };
  };
  const grow = h("button", { type: "button", class: "tv-preview-grow", title: t("tv.page.previewFull"), "aria-label": t("tv.page.previewFull"), onclick: (e) => (e.stopPropagation(), document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen?.()) }, icon("expand"));
  box.addEventListener("click", (e) => void act("click", at(e)));
  box.addEventListener("fullscreenchange", () => next(0));
  // the keyboard of whoever looks at the picture is the screen's while the picture has the focus: letters go as text
  // (gathered for a moment, so a word is one request), the keys that move about or mend go as keys, all in their order
  box.tabIndex = 0;
  box.addEventListener("click", () => box.focus());
  let typed = "";
  let sending = Promise.resolve();
  let pause = 0;
  const send = (action, value) => (sending = sending.then(() => api("POST", "/api/tv/browser", { action, value })).then(() => ((quick = 6), next(150)), () => {}));
  const flush = () => {
    clearTimeout(pause);
    if (typed) send("text", typed);
    typed = "";
  };
  const KEYS = ["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
  box.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // on this device's whole screen Escape is the way out of it
    if (e.key === "Escape" && document.fullscreenElement) return;
    if (e.key.length === 1) {
      typed += e.key;
      clearTimeout(pause);
      pause = setTimeout(flush, 180);
    } else if (KEYS.includes(e.key)) {
      flush();
      send("key", e.key);
    } else return;
    e.preventDefault();
  });
  box.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!text) return;
    e.preventDefault();
    flush();
    send("text", text.slice(0, 2000));
  });
  let turned = 0;
  box.addEventListener("wheel", (e) => {
    e.preventDefault();
    // one call for a run of the wheel: every notch on its own would queue up behind the screen
    turned += e.deltaY;
    clearTimeout(box.wheel);
    box.wheel = setTimeout(() => (void act("wheel", { ...at(e), dy: Math.max(-5000, Math.min(5000, turned)) }), (turned = 0)), 120);
  }, { passive: false });
  let timer = 0;
  const next = (ms) => (clearTimeout(timer), (timer = setTimeout(load, ms)));
  // the stream of pictures: one <img> the browser keeps renewing by itself
  let stream = null;
  let streamAfter = 0;
  let streamAt = 0;
  let renewing = false;
  const load = () => {
    // off the page, or the tab not looked at: nothing is asked of the screen
    if (!box.isConnected) return void delete box.dataset.on;
    const whole = document.fullscreenElement === box;
    if (!whole && Date.now() >= streamAfter) {
      // a stream ends without a word when the server restarts or the network blinks: a new one is asked for now and then,
      // and takes the old one's place only once its first picture is there
      if (!stream || !stream.isConnected || (Date.now() - streamAt > 20_000 && !renewing)) {
        const img = h("img", { alt: "", draggable: false });
        const first = !stream || !stream.isConnected;
        renewing = !first;
        img.onerror = () => ((renewing = false), stream === img || first ? ((stream = null), (streamAfter = Date.now() + 30_000), next(0)) : null);
        img.onload = () => {
          renewing = false;
          streamAt = Date.now();
          if (stream && stream !== img) stream.src = "";
          stream = img;
          if (box.isConnected && document.fullscreenElement !== box) box.replaceChildren(img, grow);
        };
        img.src = `/api/tv/stream?n=${++n}`;
        if (first) ((stream = img), (streamAt = Date.now()), box.replaceChildren(img, grow));
      }
      return next(2000);
    }
    // on this device's whole screen the pictures are asked one by one, at the screen's own size
    if (stream) ((stream.src = ""), (stream = null));
    if (document.hidden) return next(2000);
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.onload = () => (box.replaceChildren(img, grow), next(whole || quick-- > 0 ? 300 : 1000));
    img.onerror = () => next(3000);
    img.src = `/api/tv/shot?n=${++n}${whole ? "&big=1" : ""}`;
  };
  next(0);
  return box;
}

/** Shows a web page on the server's screen, from any page of Hata's; what the server answers becomes the page's state */
async function showOnTv(url, seconds = 0) {
  tvWorking(t("tv.switching.page"));
  tvUi.busy = true;
  try {
    await api("POST", "/api/tv/open", { url, ...(seconds ? { for: seconds } : {}) });
    state.tv = await api("GET", "/api/tv");
    tvUi.busy = false;
    if (state.route.view === "tv") paintTv();
    return true;
  } catch (e) {
    tvUi.busy = false;
    if (state.route.view === "tv" && state.tv) paintTv();
    toast(errorText(e), "error");
    return false;
  }
}

/** The address field of the browser on the screen: a bare name gets https:// in front */
function tvAddressRow(start, label, key = "", placeholder = "https://") {
  // the field lives on between the page's redraws: what is typed or pasted stays until a page is really shown,
  // and the address in it follows the screen only when the page there changes
  const kept = key && (tvUi.fields ??= {})[key];
  if (kept) {
    if (start !== kept.last) {
      if (document.activeElement !== kept.field) kept.field.value = start ?? "";
      kept.last = start;
    }
    return kept.row;
  }
  const field = h("input", { type: "url", inputMode: "url", autocomplete: "off", spellcheck: false, maxLength: 2000, placeholder, value: start ?? "", "aria-label": t("tv.page.address") });
  const go = button(label, { class: "primary", onclick: () => void send() }, "tv");
  const send = async () => {
    const typed = field.value.trim();
    if (!typed) return field.focus();
    go.disabled = true;
    field.blur();
    await showOnTv(/^https?:\/\//i.test(typed) ? typed : "https://" + typed);
    go.disabled = false;
  };
  field.addEventListener("keydown", (e) => e.key === "Enter" && void send());
  const row = h("div", { class: "tv-address" }, field, go);
  if (key) tvUi.fields[key] = { field, row, last: start };
  return row;
}

/** A bookmark put on Home as a tile that shows it on the screen by one press */
async function tvMarkToHome(mark) {
  if (state.overview?.dashboard?.cards?.some((card) => card.type === "link" && card.screen && card.url === mark.url)) return toast(t("tv.marks.onHome", { name: mark.name }));
  try {
    await changeLayout((layout) => void addCard(layout, { type: "link", id: newId(), title: mark.name, url: mark.url, icon: "", screen: true }));
    toast(t("tv.marks.homeDone", { name: mark.name }));
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/** A bookmark of the screen made or changed: a name and an address, whatever is on the screen now */
function tvMarkDialog(marks, at, start, keep) {
  let dialog;
  const name = h("input", { type: "text", autocomplete: "off", maxLength: 60, value: start.name ?? "" });
  const url = h("input", { type: "url", inputMode: "url", autocomplete: "off", spellcheck: false, maxLength: 2000, placeholder: "https://", value: start.url ?? "" });
  const error = h("p", { class: "error", role: "alert" });
  const save = () => {
    const typed = url.value.trim();
    const address = typed && !/^https?:\/\//i.test(typed) ? "https://" + typed : typed;
    let whole = "";
    try {
      whole = new URL(address).href;
    } catch {}
    if (!whole) return void ((error.textContent = t("error.tv.badLink")), url.focus());
    if (marks.some((one, i) => i !== at && one.url === whole)) return void (error.textContent = t("tv.marks.twice"));
    const one = { name: name.value.trim(), url: whole };
    keep(at < 0 ? [...marks, one] : marks.map((was, i) => (i === at ? one : was)));
    dialog.close();
  };
  for (const el of [name, url]) el.addEventListener("keydown", (e) => e.key === "Enter" && save());
  dialog = openDialog("confirm", h("h2", null, t(at < 0 ? "tv.marks.new" : "tv.marks.edit")), field(t("tv.marks.name"), name, t("tv.marks.nameHint")), field(t("tv.page.address"), url), error, h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("settings.save"), { class: "primary", onclick: save }, "check")));
  (start.url ? name : url).focus();
}

/** What stands in the remote's place while a web page has the screen */
function tvPageParts(tv, address = true) {
  const b = tv.browser;
  const again = () => setTimeout(() => (document.querySelector("dialog.tv-drop[open]") ? null : void loadTv()), 400);
  const act = (action, value) => api("POST", "/api/tv/browser", { action, value }).then(again, (e) => toast(errorText(e), "error"));
  const keyed = (action, iconName, label, cls = "") => h("div", { class: "tvr-key" }, h("button", { type: "button", class: "tvr-round " + cls, title: label, "aria-label": label, onclick: () => (action === "text" ? tvTextDialog(act, true) : act(action)) }, icon(iconName)), h("span", { class: "muted" }, label));
  const leave = button(t(b.back ? "tv.page.toPlayer" : "tv.page.close"), { class: "wide tv-leave", onclick: () => ((leave.disabled = true), tvWorking(t(b.back ? "tv.switching.kodi" : "tv.switching.off")), api("POST", "/api/tv/back", {}).then(async () => ((state.tv = await api("GET", "/api/tv")), state.route.view === "tv" && paintTv()), (e) => toast(errorText(e), "error"))) }, b.back ? "play" : "x");
  // the video the page plays, driven as a player: found in the page and its frames, whatever the site's own buttons are
  const m = b.media;
  const round = (action, iconName, label, cls = "", value) => h("button", { type: "button", class: "tvr-round " + cls, title: label, "aria-label": label, onclick: () => act(action, value) }, icon(iconName));
  const skip = (seconds, iconName, label) => h("button", { type: "button", class: "tvr-round skip", title: label, "aria-label": label, onclick: () => act("skip", seconds) }, icon(iconName), h("span", null, "30"));
  const player = m && [
    m.total > 0 && h("input", { type: "range", class: "tvr-slider", min: 0, max: 100, step: 0.1, value: (m.time / m.total) * 100, "aria-label": t("tv.position"), onchange: (e) => act("seek", Number(e.target.value)) }),
    h("div", { class: "tvr-times muted" }, h("span", null, tvClock(m.time)), m.paused && h("span", { class: "state busy" }, t("tv.paused")), h("span", null, m.total > 0 ? tvClock(m.total) : "")),
    h("div", { class: "tvr-transport" }, skip(-30, "back30", t("tv.key.rewind")), h("button", { type: "button", class: "tvr-main", title: t("tv.key.playpause"), "aria-label": t("tv.key.playpause"), onclick: () => act("play") }, icon(m.paused ? "play" : "pause")), skip(30, "fwd30", t("tv.key.forward"))),
    h("div", { class: "tvr-volume" }, round("mute", m.muted ? "volumeOff" : "volume", t(m.muted ? "tv.unmute" : "tv.mute"), m.muted ? "on" : ""), h("input", { type: "range", class: "tvr-slider" + (m.muted ? " muted" : ""), min: 0, max: 100, step: 1, value: m.volume, "aria-label": t("tv.volume"), onchange: (e) => act("volume", Number(e.target.value)) }), round("full", "expand", t(m.full ? "tv.page.fullOff" : "tv.page.full"), m.full ? "on" : "")),
    h("hr", { class: "tvr-rule" }),
  ];
  return [
    h("div", { class: "tvr-now" }, h("div", { class: "tvr-title" }, h("div", { class: "grow" }, h("strong", { class: "wrap" }, b.title || t(b.url ? "tv.page.blank" : "tv.page.home")), b.left > 0 && h("span", { class: "state busy" }, t("tv.page.left", { time: tvClock(b.left) })))), b.url && h("p", { class: "tvr-file muted wrap" }, b.url)),
    player,
    address && tvAddressRow("", t("tv.page.show"), "drop"),
    address && h("hr", { class: "tvr-rule" }),
    h("div", { class: "tvr-keys" }, keyed("back", "undo", t("tv.key.back")), keyed("start", "home", t("tv.page.start")), keyed("reload", "refresh", t("tv.page.reload")), keyed("up", "chevron", t("tv.page.up"), "turn-up"), keyed("down", "chevron", t("tv.page.down"), "turn-down"), keyed("text", "keys", t("tv.key.text"))),
    h("p", { class: "muted small" }, t("tv.page.hint")),
    leave,
  ];
}

/** Text typed here goes into the field the player has open on the screen: a search, a name, a password */
function tvTextDialog(press, page = false) {
  let dialog;
  const field = h("input", { type: "text", autocomplete: "off", maxLength: 500, "aria-label": t("tv.key.text") });
  const send = async () => {
    if (!field.value) return;
    await press("text", field.value);
    dialog.close();
  };
  field.addEventListener("keydown", (e) => e.key === "Enter" && void send());
  dialog = openDialog("confirm", h("h2", null, t("tv.textTitle")), h("p", { class: "muted" }, t(page ? "tv.textLead.page" : "tv.textLead")), field, h("footer", null, closeButton(() => dialog, t("common.cancel")), button(t("tv.textSend"), { class: "primary", onclick: () => void send() }, "check")));
  field.focus();
}

/** The remote under the chip in the head: the screen is driven from any page, without leaving it */
function tvDropdown(at) {
  let dialog;
  let timer = 0;
  const body = h("div", { class: "tvr" }, waitMark());
  const press = (action, value) => api("POST", "/api/tv/do", { action, value }).then(() => setTimeout(load, 250), (e) => toast(errorText(e), "error"));
  const turnOn = () => api("PUT", "/api/tv", { on: true }).then(load, (e) => toast(errorText(e), "error"));
  const load = async () => {
    clearTimeout(timer);
    if (!dialog.isConnected) return;
    try {
      const tv = (state.tv = await api("GET", "/api/tv"));
      // a slider under the finger is not redrawn under it, nor the window while it is pulled down
      if (!body.querySelector("input[type=range]:active") && !document.activeElement?.closest?.(".tv-drop .tv-address") && !document.querySelector("dialog.select-list[open]") && !dialog.classList.contains("pulled")) put(body, tvRemoteParts(tv, press, turnOn));
    } catch (e) {
      put(body, h("p", { class: "error" }, errorText(e)));
    }
    timer = setTimeout(load, 2000);
  };
  dialog = openDialog("dropdown tv-drop", h("div", { class: "tvr-head" }, h("span", { class: "with-icon muted" }, icon("tv"), t("tv.title")), h("a", { class: "link small with-icon", href: "#/tv", onclick: () => dialog.close() }, t("tv.openPage"), icon("arrow"))), body);
  dialog.addEventListener("close", () => {
    clearTimeout(timer);
    paintTvNow();
  });
  pullToClose(dialog);
  at.classList.add("open");
  const r = at.getBoundingClientRect();
  placeAt(dialog, { x: r.right - dialog.offsetWidth, y: r.bottom + 6 });
  // it grows once the player has answered: never past the window's lower edge, it scrolls inside instead
  if (window.innerWidth > 760) dialog.style.maxHeight = `${Math.max(240, window.innerHeight - dialog.getBoundingClientRect().top - 8)}px`;
  void load();
}

/** A site's tile has the first letter of its name on one of a few colours, the same every time for the same site */
const TV_MARK_TINTS = ["#3b74c9", "#c9463b", "#2f9a67", "#b88a14", "#7a5bc0", "#c0672b"];
function tvMarkIcon(mark) {
  let sum = 0;
  for (const ch of mark.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) sum += ch.charCodeAt(0);
  const el = h("span", { class: "tv-mark-icon", "aria-hidden": "true" }, (mark.name.trim()[0] ?? "?").toUpperCase());
  el.style.background = TV_MARK_TINTS[sum % TV_MARK_TINTS.length];
  return el;
}
const tvHost = (url) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").split("/")[0];

/** The screen's own page (the time, the day, the bookmarks as large tiles): shown from any mode */
async function tvStartPage(tv) {
  tvWorking(t(tv.screen === "browser" ? "tv.switching.page" : "tv.switching.browser"));
  tvUi.busy = true;
  try {
    if (tv.screen === "browser") await api("POST", "/api/tv/browser", { action: "start" });
    else await api("PUT", "/api/tv", { screen: "browser" });
    state.tv = await api("GET", "/api/tv");
  } catch (e) {
    toast(errorText(e), "error");
  }
  tvUi.busy = false;
  if (state.route.view === "tv" && state.tv) paintTv();
}

/**
 * "What to show": an address for the screen and the bookmarks as tiles, in every mode — a press shows
 * the site on the TV (the screen goes to the browser), the rest is under "⋯"; "Change" turns the tiles
 * into ones that are moved and removed. `missing` stands in the address's place while the browser is not installed.
 */
function tvShowCard(tv, keep, missing) {
  const b = tv.browser;
  const marks = b.bookmarks ?? [];
  const editing = !!tvUi.editMarks && marks.length > 0;
  const add = () => tvMarkDialog(marks, -1, b.url && !marks.some((one) => one.url === b.url) ? { name: b.title || "", url: b.url } : {}, keep);
  const menu = (one, i, at) =>
    menuAt(at, menuHeader(one.name, tvHost(one.url)), [
      { label: t("home.linkOnTv"), icon: "tv", run: () => void showOnTv(one.url) },
      { label: t("home.linkNewTab"), icon: "external", href: one.url, newTab: true },
      { label: t("tv.marks.toHome"), icon: "home", run: () => void tvMarkToHome(one) },
      { label: t("tv.marks.edit"), icon: "edit", run: () => tvMarkDialog(marks, i, one, keep) },
      { label: t("tv.marks.copy"), icon: "copy", run: () => copyQuietly(one.url) },
      { label: t("tv.folderRemove"), icon: "trash", danger: true, run: () => keep(marks.filter((x) => x.url !== one.url)) },
    ]);
  const moved = (i, by) => {
    const list = [...marks];
    const [one] = list.splice(i, 1);
    list.splice(i + by, 0, one);
    keep(list);
  };
  const tile = (one, i) => {
    const on = tv.screen === "browser" && b.url === one.url;
    const words = h("span", { class: "tv-mark-words" }, h("strong", { class: "clip" }, one.name), h("span", { class: "muted mono clip" }, tvHost(one.url)));
    if (editing)
      return h(
        "div",
        { class: "tv-mark-tile editing" },
        tvMarkIcon(one),
        words,
        h("span", { class: "tv-mark-tools" }, h("button", { type: "button", class: "icon-btn", title: t("tv.marks.earlier"), "aria-label": `${t("tv.marks.earlier")}: ${one.name}`, disabled: i === 0, onclick: () => moved(i, -1) }, icon("previous")), h("button", { type: "button", class: "icon-btn", title: t("tv.marks.later"), "aria-label": `${t("tv.marks.later")}: ${one.name}`, disabled: i === marks.length - 1, onclick: () => moved(i, 1) }, icon("next")), h("button", { type: "button", class: "icon-btn danger-text", title: t("tv.folderRemove"), "aria-label": `${t("tv.folderRemove")}: ${one.name}`, onclick: () => keep(marks.filter((x) => x.url !== one.url)) }, icon("x"))),
      );
    return h(
      "div",
      { class: "tv-mark-tile" + (on ? " on" : ""), menu: (at) => menu(one, i, at) },
      h("button", { type: "button", class: "tv-mark-main", title: one.url, onclick: () => void showOnTv(one.url) }, tvMarkIcon(one), words),
      h("button", { type: "button", class: "icon-btn tv-mark-more", title: t("home.tileActions"), "aria-label": `${t("home.tileActions")}: ${one.name}`, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(one, i, { x: r.left, y: r.bottom + 4 }); } }, icon("more")),
    );
  };
  if (!b.installed) return uiCard({ title: t("tv.show.title"), lead: t("tv.page.needs"), cls: "tv-show" }, missing);
  return uiCard(
    {
      title: t("tv.show.title"),
      lead: t(tv.screen === "browser" ? "tv.show.lead" : "tv.marks.switches"),
      cls: "tv-show",
      actions: marks.length > 0 && button(t(editing ? "tv.marks.done" : "tv.marks.change"), { class: "small" + (editing ? " primary" : ""), onclick: () => ((tvUi.editMarks = !editing), paintTv()) }, editing ? "check" : "edit"),
    },
    tvAddressRow("", t("tv.page.show"), "show", t("tv.show.placeholder")),
    h("div", { class: "tv-marks" }, !editing && h("div", { class: "tv-mark-tile" + (tv.screen === "browser" && !b.url ? " on" : "") }, h("button", { type: "button", class: "tv-mark-main", onclick: () => void tvStartPage(tv) }, h("span", { class: "tv-mark-icon kodi", "aria-hidden": "true" }, icon("home")), h("span", { class: "tv-mark-words" }, h("strong", { class: "clip" }, t("tv.marks.start")), h("span", { class: "muted clip" }, t("tv.marks.startHint"))))), marks.map(tile), !editing && h("button", { type: "button", class: "tv-mark-tile add", onclick: add }, icon("plus"), h("span", null, t("tv.marks.new")))),
  );
}

function paintTv() {
  const box = document.getElementById("tv-body");
  const tv = state.tv;
  if (!box || !tv) return;
  box.classList.remove("tv-switching");
  const error = h("p", { class: "error", role: "alert" });
  const change = async (data) => {
    error.textContent = "";
    if (data.screen) tvWorking(t("tv.switching." + data.screen));
    tvUi.busy = true;
    try {
      state.tv = await api("PUT", "/api/tv", data);
    } catch (e) {
      tvUi.busy = false;
      if (tvUi.sheet?.dialog.isConnected) toast(errorText(e), "error");
      return void (error.textContent = errorText(e));
    }
    tvUi.busy = false;
    paintTv();
    if (state.tv.asking) tvKeepDialog();
  };
  const press = (action, value) => api("POST", "/api/tv/do", { action, value }).then(() => setTimeout(loadTv, 250), (e) => toast(errorText(e), "error"));

  const screens = tv.displays.filter((d) => d.connected);
  const parts = {};
  const screenFacts = [
    screens.length
      ? screens.map((d) => h("div", { class: "kv" }, h("span", { class: "with-icon" }, icon("tv"), [d.monitor, d.name].filter(Boolean).join(" · ")), h("span", { class: "muted" }, [d.mode.replace("x", "×"), t(d.audio ? "tv.screenSound" : "tv.screenSilent")].filter(Boolean).join(" · "))))
      : h("div", { class: "tvr-note warn" }, h("strong", { class: "with-icon" }, icon("tv"), t("tv.noScreenTitle")), h("p", { class: "muted small" }, t(tv.displays.length ? "tv.noScreen" : "tv.noOutput")), tv.displays.length > 0 && h("div", { class: "row-actions" }, button(t("tv.lookAgain"), { class: "small", onclick: () => void loadTv() }, "refresh"))),
  ];

  // a web page on the screen: the browser's own packages by their button, then an address and "Show"
  const b = tv.browser;
  const bringBrowser = button(t("mounting.needs.install", { package: t("tv.page.browser") }), {
    class: "small",
    disabled: !!tv.cannot && !b.installed,
    onclick: async () => {
      bringBrowser.disabled = true;
      try {
        const res = await api("POST", "/api/tv/browser/install", {});
        jobDialog(res.job, "tv", t("tv.page.browser"), loadTv);
      } catch (e) {
        error.textContent = errorText(e);
        bringBrowser.disabled = false;
      }
    },
  }, "download");
  const keep = (list) => void change({ bookmarks: list });
  // other programs show things on the screen with an access key: what to send, ready to paste
  const origin = location.origin;
  const yaml = `rest_command:\n  hata_tv_open:\n    url: "${origin}/api/tv/open"\n    method: post\n    headers:\n      authorization: "Bearer ${t("tv.api.keyHere")}"\n    content_type: "application/json"\n    payload: '{"url": "{{ url }}", "for": {{ seconds | default(0) }}}'\n  hata_tv_back:\n    url: "${origin}/api/tv/back"\n    method: post\n    headers:\n      authorization: "Bearer ${t("tv.api.keyHere")}"`;
  const apiBody = h(
    "div",
    { class: "stack" },
    h("p", { class: "muted small" }, t("tv.api.lead")),
    hasModule("assistant") && h("div", { class: "row-actions" }, h("a", { class: "btn small", href: "#/settings/agents" }, h("span", null, t("tv.api.keys")))),
    !hasModule("assistant") && h("p", { class: "muted small" }, t("tv.api.needsKeys")),
    h("div", { class: "kv-line" }, h("span", { class: "muted" }, "Home Assistant"), h("button", { type: "button", class: "icon-btn", title: t("twofa.copy"), "aria-label": t("twofa.copy"), onclick: () => copyQuietly(yaml) }, icon("copy"))),
    h("pre", { class: "code wrap small" }, yaml),
    h("p", { class: "muted small" }, t("tv.api.more", { now: `${origin}/api/tv/now`, play: `${origin}/api/tv/play`, remote: `${origin}/api/tv/do` })),
  );
  const inner = (card) => (card ? [...card.children].filter((node) => !node.classList.contains("section-head")) : null);

  let installPart = null;
  if (!tv.installed) {
    const install = button(t("mounting.needs.install", { package: "Kodi" }), {
      class: "primary",
      disabled: !!tv.cannot,
      onclick: async () => {
        install.disabled = true;
        try {
          const res = await api("POST", "/api/tv/install", {});
          jobDialog(res.job, "tv", "Kodi", loadTv);
        } catch (e) {
          error.textContent = errorText(e);
          install.disabled = false;
        }
      },
    }, "download");
    installPart = h("div", { class: "tv-off" }, h("strong", null, t("tv.needsTitle")), h("p", { class: "muted small" }, t("tv.needsLead")), tv.cannot ? h("p", { class: "muted small" }, t("tv.cannot." + tv.cannot)) : h("p", { class: "cmd" }, icon("terminal"), tv.install), h("div", { class: "row-actions" }, install));
  }

  const addFolder = () => folderPicker({ title: t("tv.folderPick"), start: state.settings?.dataRoot ?? "/", confirmLabel: t("tv.folderAdd"), action: async (path) => void (await change({ folders: [...tv.folders, path] })) });
  const foldersCard = h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("tv.folders")), h("div", { class: "row-actions" }, button(t("tv.folderAdd"), { class: "small", onclick: addFolder }, "plus"))),
    h("p", { class: "muted small" }, t("tv.foldersLead")),
    tv.folders.length
      ? tv.folders.map((path) => h("div", { class: "kv" }, h("a", { class: "link with-icon wrap", href: filesHash(path) }, icon("folder"), path), button(t("tv.folderRemove"), { class: "small ghost", onclick: () => void change({ folders: tv.folders.filter((x) => x !== path) }) })))
      : h("p", { class: "muted" }, t("tv.noFolders")),
    tv.suggested.map((path) => h("div", { class: "kv" }, h("span", { class: "muted with-icon wrap" }, icon("folder"), path), button(t("tv.folderUse"), { class: "small", onclick: () => void change({ folders: [...tv.folders, path] }) }))),
  );

  // one of Kodi's own settings as a row: a list of Kodi's values or of ours, or a switch
  const pref = (id) => tv.prefs?.[id];
  const set = (setting, value) => void change({ setting, value });
  const listed = (id, title, hint, options) => pref(id) && settingRow(title, hint, h("select", { onchange: (e) => set(id, typeof pref(id).value === "number" ? Number(e.target.value) : e.target.value) }, (options ?? pref(id).options ?? []).map((o) => h("option", { value: String(o.value), selected: o.value === pref(id).value }, o.label))));
  const flag = (id, title, hint) => {
    if (!pref(id)) return null;
    const el = h("button", { type: "button", role: "switch", class: "ha-switch", "aria-checked": String(pref(id).value === true), "aria-label": title, onclick: () => ((el.disabled = true), set(id, pref(id).value !== true)) }, h("i"));
    return settingRow(title, hint, el);
  };
  const haLine = (label, value) => h("div", { class: "kv-line" }, h("span", { class: "muted" }, label), h("code", { class: "wrap" }, value), h("button", { type: "button", class: "icon-btn", title: t("twofa.copy"), "aria-label": `${t("twofa.copy")}: ${label}`, onclick: () => copyQuietly(String(value)) }, icon("copy")));
  const haCard = tv.ha && h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, "Home Assistant", h("span", { class: "state " + (tv.ha.on ? "running" : "stopped") }, t(tv.ha.on ? "bt.state.on" : "bt.state.off"))), button(t(tv.ha.on ? "bt.turnOff" : "music.speaker.turnOn"), { class: "small" + (tv.ha.on ? "" : " primary"), onclick: () => void change({ ha: !tv.ha.on }) })),
    h("p", { class: "muted" }, t("tv.ha.lead")),
    tv.ha.on && h("div", { class: "stack" }, haLine(t("tv.ha.host"), tv.ha.address || location.hostname), haLine(t("tv.ha.port"), tv.ha.port), haLine(t("tv.ha.user"), tv.ha.user), haLine(t("tv.ha.password"), tv.ha.password)),
    tv.ha.on && h("p", { class: "muted small" }, t("tv.ha.how")),
  );
  const audioCard = tv.audio && tv.audio.options.length > 0 && h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("tv.sound"))),
    settingRow(t("tv.audio"), t("tv.audioHint"), h("select", { onchange: (e) => void change({ audio: e.target.value }) }, tv.audio.options.map((o) => h("option", { value: o.value, selected: o.value === tv.audio.value }, o.label)))),
    settingRow(t("tv.offset"), t("tv.offsetHint"), h("div", { class: "row-actions" }, button("", { class: "small", title: t("tv.offsetEarlier"), "aria-label": t("tv.offsetEarlier"), disabled: tv.audio.offset <= -2000, onclick: () => void change({ offset: tv.audio.offset - 25 }) }, "previous"), h("span", { class: "mono tv-offset" }, t(tv.audio.offset < 0 ? "tv.offsetBefore" : tv.audio.offset > 0 ? "tv.offsetAfter" : "tv.offsetNone", { ms: Math.abs(tv.audio.offset) })), button("", { class: "small", title: t("tv.offsetLater"), "aria-label": t("tv.offsetLater"), disabled: tv.audio.offset >= 2000, onclick: () => void change({ offset: tv.audio.offset + 25 }) }, "next"))),
    listed("audiooutput.channels", t("tv.channels"), t("tv.channelsHint")),
    flag("audiooutput.passthrough", t("tv.passthrough"), t("tv.passthroughHint")),
    flag("audiooutput.guisoundmode", t("tv.menuSounds"), null),
  );
  const speaks = tv.language;
  const languageCard = tv.answers && speaks && h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("tv.language"))),
    settingRow(
      t("tv.languageOwn"),
      speaks.busy ? t("tv.languageBusy") : speaks.failed ? t("tv.languageFailed") : t("tv.languageHint"),
      h("select", { disabled: speaks.busy, onchange: (e) => void change({ language: e.target.value }) }, !speaks.value && h("option", { value: "", selected: true }, t("tv.languageOther")), state.languages.filter((code) => ["en", "uk"].includes(code)).map((code) => h("option", { value: code, selected: code === speaks.value }, LANGUAGE_NAMES[code] ?? code))),
    ),
    listed("locale.audiolanguage", t("tv.audioLanguage"), t("tv.audioLanguageHint")),
    listed("locale.subtitlelanguage", t("tv.subsLanguage"), null),
  );
  const saver = pref("screensaver.mode") && [
    listed("screensaver.mode", t("tv.saver"), t("tv.saverHint"), [{ value: "", label: t("tv.saver.off") }, { value: "screensaver.xbmc.builtin.dim", label: t("tv.saver.dim") }, { value: "screensaver.xbmc.builtin.black", label: t("tv.saver.black") }, ...(["", "screensaver.xbmc.builtin.dim", "screensaver.xbmc.builtin.black"].includes(pref("screensaver.mode").value) ? [] : [{ value: pref("screensaver.mode").value, label: pref("screensaver.mode").value }])]),
    pref("screensaver.mode").value !== "" && listed("screensaver.time", t("tv.saverAfter"), null, [...new Set([1, 2, 3, 5, 10, 15, 30, 60, pref("screensaver.time")?.value])].filter(Number.isFinite).sort((a, b) => a - b).map((n) => ({ value: n, label: t("time.minutes", { n }) }))),
    pref("powermanagement.displaysoff") && listed("powermanagement.displaysoff", t("tv.sleep"), t("tv.sleepHint"), [...new Set([0, 5, 10, 15, 30, 60, 120, pref("powermanagement.displaysoff").value])].filter(Number.isFinite).sort((a, b) => a - b).map((n) => ({ value: n, label: n ? t("time.minutes", { n }) : t("tv.sleep.never") }))),
  ];
  // the browser's own player stands on ffmpeg: said with what it gives, the command and the button
  const bring = button(t("mounting.needs.install", { package: "FFmpeg" }), {
    class: "small",
    onclick: async () => {
      bring.disabled = true;
      try {
        await api("POST", "/api/tools/ffmpeg/install", {});
        await refresh();
        void loadTv();
      } catch (e) {
        error.textContent = errorText(e);
        bring.disabled = false;
      }
    },
  }, "download");
  const browserCard = h("section", { class: "card pad stack" }, h("div", { class: "section-head" }, h("h2", null, t("tv.inBrowser")), tv.streams && h("span", { class: "state running" }, t("tv.inBrowserOn"))), h("p", { class: "muted small" }, t(tv.streams ? "tv.inBrowserLead" : "tv.inBrowserNeeds")), !tv.streams && [h("p", { class: "cmd" }, icon("terminal"), tv.streamsInstall), bring]);

  const picture = tv.picture;
  const follow = picture && h("button", { type: "button", role: "switch", class: "ha-switch", "aria-checked": String(picture.match), "aria-label": t("tv.match"), onclick: () => ((follow.disabled = true), void change({ match: !picture.match })) }, h("i"));
  const pictureCard = picture && h(
    "section",
    { class: "card pad stack" },
    h("div", { class: "section-head" }, h("h2", null, t("tv.picture"))),
    settingRow(t("tv.resolution"), t("tv.resolutionHint", { n: TV_KEEP_SECONDS }), h("select", { onchange: (e) => void change({ resolution: Number(e.target.value) }) }, picture.resolution.options.map((o) => h("option", { value: String(o.value), selected: o.value === picture.resolution.value }, o.label)))),
    picture.rate.options.length > 1 && settingRow(t("tv.rate"), null, h("select", { onchange: (e) => void change({ rate: e.target.value }) }, picture.rate.options.map((o) => h("option", { value: o.value, selected: o.value === picture.rate.value }, t("tv.hz", { n: o.label }))))),
    settingRow(t("tv.match"), t("tv.matchHint"), follow),
    saver,
  );

  // --- the main card: who has the screen, the stage, and beside it the same zones in every mode ---
  const pill = (id, iconName, label, off = false) => h("button", { type: "button", class: "seg-pill" + (tv.screen === id ? " active" : ""), "aria-pressed": String(tv.screen === id), disabled: off, onclick: (e) => (tv.screen === id ? null : ((e.currentTarget.classList.add("going")), void change({ screen: id }))) }, icon(iconName), label);
  const now = tv.screen === "kodi" && tv.answers ? tv.playing : null;
  const m = tvMediaOf(tv, loadTv);
  const [chipClass, chipWord] = tvChip(tv);
  const actPage = (action, value) => api("POST", "/api/tv/browser", { action, value }).then(() => setTimeout(loadTv, 400), (e) => toast(errorText(e), "error"));
  const leave = () => (tvWorking(t(b.back ? "tv.switching.kodi" : "tv.switching.off")), api("POST", "/api/tv/back", {}).then(async () => ((state.tv = await api("GET", "/api/tv")), state.route.view === "tv" && paintTv()), (e) => (toast(errorText(e), "error"), void loadTv())));
  const mayMove = now && (isLink(now.file) ? tvStreams() : now.file.startsWith("/") && (tvStreams() ? TV_PLAYS_RE.test(now.file) && fileKind({ type: "file", name: now.file }) !== "image" : TV_BROWSER_RE.test(now.file)));
  const more = (at) =>
    menuAt(at, menuHeader(t("tv.onScreen"), chipWord), [
      tv.screen === "browser" && { label: t(b.back ? "tv.page.toPlayer" : "tv.page.close"), icon: b.back ? "film" : "x", run: leave },
      tv.screen === "browser" && b.url && { label: t("home.linkNewTab"), icon: "external", href: b.url, newTab: true },
      tv.screen === "browser" && b.url && { label: t("tv.marks.copy"), icon: "copy", run: () => copyQuietly(b.url) },
      tv.screen === "browser" && b.url && !(b.bookmarks ?? []).some((one) => one.url === b.url) && { label: t("tv.marks.new"), icon: "star", run: () => tvMarkDialog(b.bookmarks ?? [], -1, { name: b.title || "", url: b.url }, keep) },
      mayMove && { label: t("tv.toBrowser"), icon: "external", run: () => moveToBrowser(now) },
      tv.screen === "kodi" && parts.sound && { label: t("tv.out") + "…", icon: "volume", run: () => openSet("sound") },
      { label: t("tv.link"), icon: "link", run: playLinkDialog },
    ].filter(Boolean));
  const head = h(
    "div",
    { class: "tv-main-head" },
    h("span", { class: "tv-head-icon", "aria-hidden": "true" }, icon("tv")),
    h("div", { class: "tv-head-words" }, h("h2", null, t("tv.onScreen")), h("p", { class: "muted small" }, t("tv.mode." + (tv.screen === "browser" || tv.screen === "kodi" || tv.screen === "dark" ? tv.screen : "off")))),
    h("div", { class: "seg-pills" }, pill("kodi", "film", "Kodi", !tv.installed), pill("browser", "globe", t("tv.page.browser"), !b.installed), pill("off", "terminal", t("tv.onScreen.none")), pill("dark", "power", t("tv.onScreen.sleep"))),
    h("button", { type: "button", class: "icon-btn tv-head-more", title: t("tv.more"), "aria-label": t("tv.more"), onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); more({ x: r.right - 220, y: r.bottom + 4 }); } }, icon("more")),
  );
  const stage = tvStage(tv, { media: m, go: (what, url) => (what === "url" ? void showOnTv(url) : void change({ screen: what })), show: () => ((tvUi.control = true), paintTv()), hide: () => ((tvUi.control = false), paintTv()) });

  const source =
    tv.screen === "browser" ? ["globe", [t("tv.page.browser"), b.url && tvHost(b.url)]]
    : tv.screen === "kodi" ? ["film", ["Kodi", now ? t(isLink(now.file) ? "tv.src.link" : "tv.src.file") : tv.answers ? t("tv.src.menu") : ""]]
    : tv.screen === "dark" ? ["power", [t("tv.darkTitle")]]
    : ["terminal", [t("tv.onScreen.none")]];
  const title = tv.screen === "browser" ? b.title || t(b.url ? "tv.page.blank" : "tv.page.home") : tv.screen === "kodi" ? (now ? now.title : t(tv.answers ? "tv.nothingTitle" : "tv.starting")) : t(tv.screen === "dark" ? "tv.darkHead" : "tv.consoleHead");
  const fileName = now && !isLink(now.file) ? now.file.split("/").pop() : "";
  const under = tv.screen === "browser" ? b.url : tv.screen === "kodi" ? (now ? (fileName !== now.title ? fileName : "") : t(tv.answers ? "tv.stage.menuHint" : "tv.startingLead")) : "";
  const mediaZone = m
    ? [
        m.total > 0 && h("div", { class: "tv-pos" }, h("input", { type: "range", class: "tvr-slider", min: 0, max: 100, step: 0.1, value: (m.time / m.total) * 100, "aria-label": t("tv.position"), onchange: (e) => m.seek(Number(e.target.value)) }), h("div", { class: "tvr-times muted" }, h("span", null, tvClock(m.time)), h("span", null, tvClock(m.total)))),
        h(
          "div",
          { class: "tv-transport" },
          tvTransport(m),
          h("span", { class: "grow" }),
          h("button", { type: "button", class: "tvr-round" + (m.muted ? " on" : ""), title: t(m.muted ? "tv.unmute" : "tv.mute"), "aria-label": t(m.muted ? "tv.unmute" : "tv.mute"), onclick: m.mute }, icon(m.muted ? "volumeOff" : "volume")),
          h("input", { type: "range", class: "tvr-slider tv-vol" + (m.muted ? " muted" : ""), min: 0, max: 100, step: 1, value: m.volume, "aria-label": t("tv.volume"), onchange: (e) => m.loud(Number(e.target.value)) }),
          h("span", { class: "tvr-value" + (m.muted ? " muted" : "") }, m.muted ? t("tv.muted") : `${Math.round(m.volume)}%`),
        ),
      ]
    : tv.screen === "browser"
      ? h("p", { class: "tv-quiet with-icon" }, icon("film"), t("tv.noVideo"))
      : null;
  const tracks = now && (now.audio?.length > 1 || now.subs?.length > 0) && h(
    "div",
    { class: "tv-tracks" },
    now.audio.length > 1 && h("label", null, h("span", null, t("tv.track.audio")), h("select", { onchange: (e) => press("audio", Number(e.target.value)) }, now.audio.map((one) => h("option", { value: String(one.index), selected: one.index === now.audioNow }, trackLabel(one))))),
    now.subs.length > 0 && h("label", null, h("span", null, t("tv.track.subs")), h("select", { onchange: (e) => press("subtitle", e.target.value === "off" ? "off" : Number(e.target.value)) }, h("option", { value: "off", selected: now.subNow < 0 }, t("tv.track.noSubs")), now.subs.map((one) => h("option", { value: String(one.index), selected: one.index === now.subNow }, trackLabel(one))))),
  );
  const key = (iconName, label, run, hint = label) => h("div", { class: "tv-key" }, h("button", { type: "button", class: "tv-key-btn", title: hint, "aria-label": label, onclick: run }, icon(iconName)), h("span", null, label));
  const arrow = (action, cls, label) => h("button", { type: "button", class: "tvr-arrow " + cls, title: label, "aria-label": label, onclick: () => press(action) }, icon("chevron"));
  const controls =
    tv.screen === "browser"
      ? h("div", { class: "tv-ctrl" }, h("div", { class: "tv-keys" }, key("undo", t("tv.key.back"), () => actPage("back")), key("home", t("tv.page.start"), () => actPage("start")), key("refresh", t("tv.page.reload"), () => actPage("reload")), key("up", t("tv.page.up"), () => actPage("up")), key("down", t("tv.page.down"), () => actPage("down")), key("keys", t("tv.key.text"), () => tvTextDialog(actPage, true), t("tv.key.textHint"))))
      : tv.screen === "kodi" && tv.answers
        ? h(
            "div",
            { class: "tv-ctrl kodi" },
            h("div", { class: "tvr-pad" }, arrow("up", "up", t("tv.key.up")), arrow("left", "left", t("tv.key.left")), h("button", { type: "button", class: "tvr-ok", onclick: () => press("select") }, "OK"), arrow("right", "right", t("tv.key.right")), arrow("down", "down", t("tv.key.down"))),
            h("div", { class: "tv-keys" }, key("undo", t("tv.key.back"), () => press("back")), key("home", t("tv.key.home"), () => press("home")), key("lines", t("tv.key.menu"), () => press("menu")), key("info", t("tv.key.info"), () => press("info")), key("keys", t("tv.key.text"), () => tvTextDialog(press), t("tv.key.textHint"))),
          )
        : null;
  // nothing of Hata's on the screen: what it means and the one other thing to do; the choice itself is on the stage
  const idle = (tv.screen === "off" || tv.screen === "dark") && h(
    "div",
    { class: "tv-off" },
    h("p", { class: "muted" }, t(tv.screen === "dark" ? "tv.onScreen.dark" : "tv.consoleLead")),
    tv.screen === "dark" ? button(t("tv.showConsole"), { class: "small", onclick: () => void change({ screen: "off" }) }, "terminal") : button(t("tv.screenOff"), { class: "small", onclick: () => void change({ screen: "dark" }) }, "power"),
  );
  const zones = h(
    "div",
    { class: "tv-zones" },
    h("div", { class: "tv-src" }, h("span", { class: "with-icon muted" }, icon(source[0]), source[1].filter(Boolean).join(" · ")), h("span", { class: "row-actions" }, b.left > 0 && tv.screen === "browser" && h("span", { class: "state busy" }, t("tv.page.left", { time: tvClock(b.left) })), h("span", { class: "state " + chipClass }, chipWord))),
    h("div", { class: "tv-name" }, h("h3", null, title), under && h("p", { class: "muted", title: under }, under)),
    mediaZone,
    tracks,
    idle,
    installPart,
    tv.screen === "kodi" && !tv.decodes && h("p", { class: "muted small" }, t("tv.noDecode")),
    error,
    controls,
  );

  // --- "Settings": what is set once, as rows that open a window each; the tabs say whose settings ---
  const tabs = [tv.installed && ["kodi", "Kodi"], ["screen", t("tv.screen")], b.installed && ["api", t("tv.api.title")]].filter(Boolean);
  const tab = tabs.some(([id]) => id === tvUi.tab) ? tvUi.tab : tv.screen === "kodi" && tv.installed ? "kodi" : "screen";
  const row = (id, iconName, name, summary, body) => {
    const kids = (Array.isArray(body) ? body : [body]).flat().filter(Boolean);
    if (!kids.length) return null;
    parts[id] = { title: name, body: kids };
    return h("button", { type: "button", class: "tv-set", onclick: () => openSet(id) }, icon(iconName), h("span", { class: "tv-set-words" }, h("strong", { class: "clip" }, name), h("span", { class: "muted small clip" }, summary)), icon("chevron"));
  };
  const openSet = (id) => {
    if (!parts[id]) return;
    let dialog;
    const body = h("div", { class: "stack tv-set-body" }, parts[id].body);
    dialog = openDialog("", h("h2", null, parts[id].title), body, h("footer", null, closeButton(() => dialog)));
    tvUi.sheet = { id, body, dialog };
  };
  const kodiRows = [
    row("folders", "folder", t("tv.folders"), tv.folders.length ? `${tv.folders.length} · ${tv.folders.join(", ")}` : t("tv.noFolders"), inner(foldersCard)),
    row("language", "globe", t("tv.language"), speaks ? (LANGUAGE_NAMES[speaks.value] ?? t("tv.languageOther")) : "", inner(languageCard)),
    row("sound", "volume", t("tv.sound"), tv.audio ? (tv.audio.options.find((o) => o.value === tv.audio.value)?.label ?? "") : "", inner(audioCard)),
    row("picture", "screen", t("tv.picture"), picture ? [picture.resolution.options.find((o) => o.value === picture.resolution.value)?.label, picture.match && t("tv.match")].filter(Boolean).join(" · ") : "", inner(pictureCard)),
    row("ha", "home", "Home Assistant", tv.ha ? t(tv.ha.on ? "bt.state.on" : "bt.state.off") : "", inner(haCard)),
    row("streams", "play", t("tv.inBrowser"), t(tv.streams ? "tv.inBrowserOn" : "tv.inBrowserOff"), inner(browserCard)),
  ];
  const screenRows = [
    row("display", "screen", screens.length ? screens.map((d) => [d.monitor, d.name].filter(Boolean).join(" · ")).join(", ") : t("tv.noScreenTitle"), screens.length ? [screens[0].mode.replace("x", "×"), t(screens[0].audio ? "tv.screenSound" : "tv.screenSilent")].filter(Boolean).join(" · ") : t(tv.displays.length ? "tv.noScreen" : "tv.noOutput"), screenFacts),
    row("remotes", "remote", t("tv.remotes"), tv.remotes.length ? tv.remotes.join(", ") : t("tv.set.noRemotes"), tv.remotes.length ? tv.remotes.map((name) => h("div", { class: "kv" }, h("span", { class: "with-icon" }, icon("remote"), name))) : h("p", { class: "muted" }, t("tv.set.noRemotes"))),
    row("how", "info", t("tv.set.how"), t("tv.set.howShort"), [h("p", { class: "muted" }, t("tv.remotesHint")), h("p", { class: "muted" }, t("tv.remotesHint.browser"))]),
  ];
  const apiRows = [row("api", "code", "Home Assistant", t("tv.api.short"), apiBody)];
  const setCard = uiCard(
    { title: t("tv.settings"), cls: "tv-settings", actions: tabs.length > 1 && h("div", { class: "seg-pills" }, tabs.map(([id, label]) => h("button", { type: "button", class: "seg-pill" + (id === tab ? " active" : ""), "aria-pressed": String(id === tab), onclick: () => ((tvUi.tab = id), paintTv()) }, label))) },
    h("div", { class: "tv-sets" }, tab === "kodi" ? kodiRows : tab === "api" ? apiRows : screenRows),
  );

  put(box, h("div", { class: "tvx" }, h("section", { class: "card pad tv-main" }, head, h("div", { class: "tv-main-body" }, stage, zones)), tvShowCard(tv, keep, [h("p", { class: "cmd" }, icon("terminal"), b.install), h("div", { class: "row-actions" }, bringBrowser)]), setCard));
  // a window of settings that is open shows what the server says now
  if (tvUi.sheet?.dialog.isConnected && parts[tvUi.sheet.id]) put(tvUi.sheet.body, parts[tvUi.sheet.id].body);
  if (tv.asking) tvKeepDialog();
}

/** How long Kodi keeps a new screen mode on trial, seconds */
const TV_KEEP_SECONDS = 15;

/**
 * A new screen mode is on trial: Kodi asks on the screen whether to keep it and puts the old one back
 * by itself. The same question here, for whoever holds no remote: the answer presses Kodi's button.
 */
function tvKeepDialog() {
  if (document.querySelector("dialog.tv-keep")) return;
  let left = state.tv?.asking ?? 0;
  if (!left) return;
  let dialog;
  let answered = false;
  const error = h("p", { class: "error", role: "alert" });
  const count = h("p", { class: "muted" }, t("tv.keepLead", { n: left }));
  const answer = async (keep) => {
    answered = true;
    clearInterval(timer);
    for (const el of dialog.querySelectorAll("button")) el.disabled = true;
    try {
      state.tv = await api("POST", "/api/tv/keep", { keep });
    } catch (e) {
      // said too late, or Kodi's window cannot be reached from here: what the screen shows now is what stays
      error.textContent = errorText(e);
      setTimeout(() => (dialog.close(), void loadTv()), 4000);
      return;
    }
    dialog.close();
    paintTv();
  };
  const timer = setInterval(() => {
    if (--left > 0) return void (count.textContent = t("tv.keepLead", { n: left }));
    answered = true;
    clearInterval(timer);
    dialog.close();
    toast(t("tv.keepGone"));
    setTimeout(loadTv, 1500);
  }, 1000);
  dialog = openDialog("confirm tv-keep", h("h2", null, t("tv.keepTitle")), count, error, h("footer", null, button(t("tv.keepNo"), { onclick: () => void answer(false) }), button(t("tv.keepYes"), { class: "primary", onclick: () => void answer(true) }, "check")));
  // closed without a word: the old mode comes back now, not when the time is out
  dialog.addEventListener("close", () => {
    clearInterval(timer);
    if (!answered) void api("POST", "/api/tv/keep", { keep: false }).then(loadTv, loadTv);
  });
}

// --- Modules: the parts of Hata a person turns on -------------------------------------------------

const MODULE_ICONS = { music: "music", bluetooth: "bluetooth", tv: "tv", raid: "shield", netplaces: "network", shares: "share", offsite: "archive", remote: "globe", dns: "signpost", adblock: "ban", domains: "plug", machines: "server", proxmox: "server", containers: "box", integrations: "link", assistant: "chat" };
const MODULE_GROUPS = ["storage", "network", "servers", "more"];
/** Where a module's own things are once it is on */
const MODULE_HOME = { music: "#/house/music", bluetooth: "#/house/bluetooth", tv: "#/house/tv", raid: "#/storage/raid", netplaces: "#/settings/places", shares: "#/settings/shares", offsite: "#/settings/backups", remote: "#/settings/remote", dns: "#/settings/dns", adblock: "#/settings/adblock", domains: "#/settings/ports", machines: "#/machines", proxmox: "#/machines", containers: "#/containers", integrations: "#/settings/integrations", assistant: "#/settings/assistant" };
/** Where the thing that holds a module on is taken away */
const MODULE_USE_AT = { speaker: "#/house/music", bluetooth: "#/house/bluetooth", tv: "#/tv", array: "#/storage/raid", merged: "#/settings/storage", pools: "#/storage/raid", places: "#/settings/places", shares: "#/settings/shares", offsite: "#/settings/backups", wireguard: "#/settings/remote", tailscale: "#/settings/remote", dnsOn: "#/settings/dns", blocking: "#/settings/adblock", names: "#/settings/https", ports: "#/settings/ports", machines: "#/machines", proxmox: "#/machines", containers: "#/containers", homeAssistant: "#/settings/integrations", services: "#/house", keys: "#/settings/agents" };
const moduleName = (id) => t(`modules.${id}.name`);

/** Which modules are on, asked again: after a change made here or on another page */
async function loadModules() {
  const now = await api("GET", "/api/state").catch(() => null);
  if (now?.modules) state.modules = now.modules;
}

function modulesChanged(list) {
  state.modulesList = list;
  state.modules = Object.fromEntries(list.map((m) => [m.id, m.on]));
  render();
  void refresh();
}

/** Turns a module on; what it stands on is asked about first and goes on with it */
async function turnModuleOn(id, then = "") {
  const before = state.modules ?? {};
  const done = (res) => {
    // what went on just now, the asked one first: "Undo" turns those off again
    const turned = res.modules.filter((m) => m.on && !before[m.id]).map((m) => m.id).sort((a, b) => (a === id ? -1 : b === id ? 1 : 0));
    modulesChanged(res.modules);
    const note = h("div", { class: "toast" }, h("span", null, t("modules.nowOn", { name: moduleName(id) })), h("button", { type: "button", class: "toast-action", onclick: async () => {
      note.remove();
      for (const one of turned) {
        try {
          modulesChanged((await api("PUT", `/api/modules/${one}`, { on: false })).modules);
        } catch (e) {
          return toast(errorText(e), "error");
        }
      }
    } }, t("modules.undo")));
    $toasts.append(note);
    setTimeout(() => note.remove(), 8000);
    if (then) go(then);
  };
  try {
    done(await api("PUT", `/api/modules/${id}`, { on: true }));
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== "modules.needs") return toast(errorText(e));
    const needs = String(e.detail.needs).split(",");
    let dialog;
    const error = h("p", { class: "error", role: "alert" });
    const one = (m) => h("div", { class: "module-held" }, icon(MODULE_ICONS[m]), h("span", { class: "grow" }, h("strong", null, moduleName(m)), h("span", { class: "muted small block" }, t(`modules.${m}.adds`))));
    const both = button(t(needs.length > 1 ? "modules.turnOnAll" : "modules.turnOnBoth"), {
      class: "primary",
      onclick: async () => {
        both.disabled = true;
        try {
          const res = await api("PUT", `/api/modules/${id}`, { on: true, withNeeds: true });
          dialog.close();
          done(res);
        } catch (err) {
          error.textContent = errorText(err);
          both.disabled = false;
        }
      },
    }, "check");
    dialog = openDialog("confirm", h("h2", { class: "wrap" }, t("modules.needsTitle", { name: moduleName(id), needs: needs.map(moduleName).join(", ") })), h("p", { class: "muted" }, t("modules.needsLead", { name: moduleName(id), needs: needs.map(moduleName).join(", ") })), h("div", { class: "stack" }, [...needs, id].map(one)), error, h("footer", null, closeButton(() => dialog, t("common.cancel")), both));
  }
}

/** Why a module cannot be turned off now, and where to take away what holds it */
function moduleHeldDialog(m) {
  let dialog;
  const line = (iconName, text, href) => h("div", { class: "module-held" }, icon(iconName), h("strong", { class: "grow" }, text), h("a", { class: "link with-icon", href, onclick: () => dialog.close() }, t("common.open"), icon("chevron")));
  // the module that stands on it first, then what of the person's uses it
  // the module that stands on it can be turned off right from here — if nothing holds that one in its turn
  const offToo = (other) => h("div", { class: "module-held" }, icon(MODULE_ICONS[other]), h("strong", { class: "grow" }, t("modules.heldBy", { name: moduleName(other) })), h("button", { type: "button", class: "link", onclick: () => { dialog.close(); const that = (state.modulesList ?? []).find((x) => x.id === other); if (that) void turnModuleOff(that); } }, t("modules.turnItOff")));
  const rows = [...m.neededBy.map(offToo), ...m.uses.map((use) => line(MODULE_ICONS[m.id], t("modules.use." + use.what, { n: use.count ?? "" }), MODULE_USE_AT[use.what] ?? "#/settings/modules"))];
  dialog = openDialog("confirm", h("h2", { class: "wrap" }, t("modules.heldTitle")), h("p", { class: "muted" }, t(m.neededBy.length ? "modules.neededLead" : "modules.heldLead", { name: moduleName(m.id), by: m.neededBy.map(moduleName).join(", ") })), h("div", { class: "stack" }, rows), h("footer", null, button(t("modules.understood"), { class: "primary", onclick: () => dialog.close() })));
}

async function turnModuleOff(m) {
  if (m.uses.length || m.neededBy.length) return moduleHeldDialog(m);
  try {
    modulesChanged((await api("PUT", `/api/modules/${m.id}`, { on: false })).modules);
    toast(t("modules.nowOff", { name: moduleName(m.id) }));
  } catch (e) {
    // it came into use since the list was read: the list is read again and says what holds it
    const list = (await api("GET", "/api/modules").catch(() => null))?.modules;
    const now = list?.find((x) => x.id === m.id);
    if (list) state.modulesList = list;
    if (now && (now.uses.length || now.neededBy.length)) moduleHeldDialog(now);
    else toast(errorText(e));
  }
}

/** In place of a page or a section of a module that is off: what it is, and the button */
function moduleOffCard(id) {
  const turn = isAdmin() && button(t("modules.turnOn"), { class: "primary", onclick: (e) => ((e.currentTarget.disabled = true), void turnModuleOn(id)) }, "check");
  return h("section", { class: "card pad stack" }, h("div", { class: "tool" }, h("span", { class: "app-icon plus" }, icon(MODULE_ICONS[id])), h("div", { class: "grow" }, h("div", { class: "tool-head" }, h("strong", null, moduleName(id)), h("span", { class: "state stopped" }, t("modules.off"))), h("p", { class: "muted small" }, t(`modules.${id}.what`)), h("p", { class: "muted small" }, t("modules.offLead"))), turn));
}

/** What was found here that a module is for, by module; asked once a page and kept */
async function loadModuleFinds() {
  if (state.moduleFinds) return;
  state.moduleFinds = (await api("GET", "/api/modules/found").catch(() => null))?.found ?? [];
}
const findsFor = (id) => (state.moduleFinds ?? []).filter((f) => f.module === id);
const findWords = (f) => t("modules.found." + f.what, { detail: f.detail });

function modulesSection() {
  const list = state.modulesList;
  if (!list) return [waitMark()];
  // what is here already shows on the cards of modules that are off; the look takes a few seconds
  if (!state.moduleFinds) void loadModuleFinds().then(() => state.route.view === "settings" && showsSection("modules") && renderSettings());
  const card = (m) => {
    const held = m.uses.length > 0 || m.neededBy.length > 0;
    const flip = h("button", { type: "button", role: "switch", class: "ha-switch", "aria-checked": String(m.on), "aria-label": t(m.on ? "modules.turnOff" : "modules.turnOn") + ": " + moduleName(m.id), onclick: (e) => (m.on ? void turnModuleOff(m) : ((e.currentTarget.disabled = true), void turnModuleOn(m.id))) }, h("i"));
    return h(
      "section",
      { class: "card module-card" + (m.on ? " on" : "") },
      h("div", { class: "module-card-head" }, h("span", { class: "app-icon plus" }, icon(MODULE_ICONS[m.id])), h("div", { class: "grow" }, h("strong", { class: "block" }, moduleName(m.id)), h("span", { class: "state " + (held ? "info" : m.on ? "running" : "stopped") }, t(held ? "modules.inUse" : m.on ? "modules.on" : "modules.off"))), flip),
      h("p", { class: "muted small" }, t(`modules.${m.id}.what`)),
      m.uses.map((use) => h("a", { class: "module-chip", href: MODULE_USE_AT[use.what] ?? MODULE_HOME[m.id] }, icon("link"), t("modules.use." + use.what, { n: use.count ?? "" }))),
      m.neededBy.map((other) => h("span", { class: "module-chip" }, icon("link"), t("modules.neededFor", { name: moduleName(other) }))),
      m.needs.length > 0 && h("p", { class: "muted small" }, "↳ ", t("modules.needsModule", { needs: m.needs.map(moduleName).join(", ") })),
      !m.on && findsFor(m.id).map((f) => h("span", { class: "module-chip found" }, icon("search"), findWords(f))),
      h("p", { class: "module-card-foot muted small" }, icon(m.on ? "check" : "plus"), h("span", { class: "grow" }, t(m.on ? "modules.added" : "modules.willAdd"), " ", t(`modules.${m.id}.adds`)), m.on && h("a", { class: "link", href: MODULE_HOME[m.id] }, t("common.open"))),
    );
  };
  const phone = matchMedia("(max-width: 760px)").matches;
  return [
    // nothing is written straight on the page's background: over a wallpaper it could not be read
    h(
      "section",
      { class: "card pad stack" },
      h("div", { class: "module-top" }, h("p", { class: "muted grow" }, t("modules.lead")), h("div", { class: "module-count" }, h("strong", null, t("modules.count", { on: list.filter((m) => m.on).length, of: list.length })), h("span", { class: "muted small" }, t("modules.on")))),
      h("div", { class: "module-base" }, icon("home"), h("span", null, h("strong", { class: "block" }, t("modules.base")), h("span", { class: "muted small" }, t("modules.baseList")))),
    ),
    // on a phone the groups are chosen one at a time
    h("div", { class: "module-filter" }, ["", ...MODULE_GROUPS].map((group) => h("button", { type: "button", class: "chip" + ((settingsUi.moduleGroup ?? "") === group ? " accent" : ""), onclick: () => ((settingsUi.moduleGroup = group), renderSettings()) }, group ? t("modules.group." + group) : t("modules.all")))),
    MODULE_GROUPS.filter((group) => !phone || !settingsUi.moduleGroup || settingsUi.moduleGroup === group).map((group) => {
      const mine = list.filter((m) => m.group === group);
      return mine.length > 0 && h("section", { class: "card pad stack" }, h("h2", { class: "module-group" }, t("modules.group." + group), h("span", { class: "muted" }, t("modules.groupCount", { on: mine.filter((m) => m.on).length, of: mine.length }))), h("div", { class: "module-cards" }, mine.map(card)));
    }),
  ];
}

const sections = () => SECTIONS.filter((item) => (!item.admin || isAdmin()) && (!SECTION_MODULE[item.id] || hasModule(SECTION_MODULE[item.id])));

function settingRow(title, hint, control) {
  return h("div", { class: "setting" }, h("div", { class: "grow" }, h("strong", null, title), hint && h("p", { class: "muted small" }, hint)), h("div", { class: "setting-control" }, control));
}

// --- What runs when ---------------------------------------------------------------------------------

/** How often, in words: every 30 min, every 6 h, once a day */
const everyWords = (ms) => (ms >= 86_400_000 ? t("schedule.daily") : ms >= 3_600_000 ? t("schedule.everyHours", { n: Math.round(ms / 3_600_000) }) : t("schedule.everyMinutes", { n: Math.round(ms / 60_000) }));

/** A moment ahead, in words: today at 05:00, tomorrow at 03:00, Sunday at 05:00 */
function aheadWords(at) {
  const when = new Date(at);
  const time = when.toLocaleTimeString(state.lang, { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(when).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return t("schedule.today", { time });
  if (days === 1) return t("schedule.tomorrow", { time });
  return t("schedule.onDay", { day: when.toLocaleDateString(state.lang, { weekday: "long" }), time });
}

const scheduleName = (one) => (one.kind === "proxmox" ? t("schedule.kind.proxmox", { name: one.name }) : t("schedule.kind." + one.kind));

async function moveScheduled(id, time) {
  try {
    state.schedule = await api("PUT", `/api/schedule/${encodeURIComponent(id)}`, { time });
    toast(t("schedule.moved", { time }));
  } catch (e) {
    toast(errorText(e), "error");
  }
  renderSettings();
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const weekdayName = (n) => new Date(2026, 10, 15 + n).toLocaleDateString(state.lang, { weekday: "short" });

/** Settings → Schedule: the server shut down at night and woken by its clock */
function powerCard() {
  const p = state.power;
  if (!p) return null;
  const s = p.schedule;
  const can = p.can === "ok";
  const on = h("input", { type: "checkbox", checked: s.on, disabled: !can && !s.on });
  const off = h("input", { type: "time", value: s.off, class: "short", "aria-label": t("power.off") });
  const wake = h("input", { type: "time", value: s.wake, class: "short", "aria-label": t("power.wake") });
  const days = WEEKDAYS.map((n) => h("label", { class: "day-tick" }, h("input", { type: "checkbox", value: n, checked: s.days.includes(n) }), weekdayName(n)));
  const error = h("p", { class: "error", role: "alert" });
  const save = button(t("settings.save"), {
    class: "primary small",
    onclick: async () => {
      error.textContent = "";
      try {
        state.power = { ...state.power, ...(await api("PUT", "/api/power/schedule", { on: on.checked, off: off.value, wake: wake.value, days: days.map((d) => d.firstChild).filter((x) => x.checked).map((x) => Number(x.value)) })) };
        state.schedule = await api("GET", "/api/schedule").catch(() => state.schedule);
        toast(t("power.saved"));
        renderSettings();
      } catch (e) {
        error.textContent = errorText(e);
      }
    },
  });
  const when = (ms) => new Date(ms).toLocaleString(state.lang, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const test = () =>
    confirmAction({
      title: t("power.test.title"),
      lead: t("power.test.lead"),
      label: t("power.test.go"),
      iconName: "power",
      run: async () => {
        await api("POST", "/api/power/try", { minutes: 3 });
        toast(t("power.test.gone"));
      },
    });
  return uiCard(
    { title: t("power.night.title"), lead: t("power.lead") },
    !can && h("p", { class: "banner warn small" }, t("power.cannot." + p.can)),
    h("label", { class: "with-icon" }, on, h("span", null, t("power.on"))),
    h("div", { class: "power-times" }, field(t("power.off"), off), field(t("power.wake"), wake)),
    h("div", { class: "power-days" }, days),
    p.next && h("p", { class: "small" }, t("power.next", { off: when(p.next.off), wake: when(p.next.wake) })),
    p.waiting && h("p", { class: "banner small" }, t("power.waiting", { what: has("power.what." + p.waiting.what) ? t("power.what." + p.waiting.what) : p.waiting.what })),
    h("p", { class: "muted small" }, t("power.hint")),
    error,
    h("div", { class: "row-actions" }, save, can && button(t("power.test.button"), { class: "small", onclick: test }, "power")),
  );
}

/** Settings → Schedule: one list of what Hata starts by itself, and when */
function scheduleSection() {
  const data = state.schedule;
  if (!data) return [waitMark()];
  if (data.error) return [uiCard({}, h("p", { class: "error" }, data.error))];
  const byId = new Map(data.timed.map((one) => [one.id, one]));
  const row = (one) => {
    const mine = data.clashes.filter((c) => c.id === one.id);
    const own = one.kind !== "power";
    const input = h("input", { type: "time", value: one.time, class: "short", "aria-label": t("schedule.time"), required: true });
    const save = button(t("settings.save"), { class: "small", hidden: true, onclick: () => input.value && moveScheduled(one.id, input.value) });
    input.addEventListener("input", () => (save.hidden = !input.value || input.value === one.time));
    const facts = [
      one.on ? (one.next ? t("schedule.next", { when: aheadWords(one.next) }) : "") : t("schedule.off"),
      one.last ? t(one.last.ok ? "schedule.lastOk" : "schedule.lastFailed", { when: ago(one.last.at) }) : one.last === null && one.on ? t("schedule.never") : "",
      one.scrub ? t("schedule.scrub") : "",
    ].filter(Boolean);
    return h(
      "div",
      { class: "setting schedule-row" + (one.on ? "" : " off") },
      h(
        "div",
        { class: "grow stack-tight" },
        h("strong", null, scheduleName(one)),
        h("p", { class: "muted small" }, t("schedule.what." + one.kind)),
        h("p", { class: "small" }, facts.join(" · ")),
        ...mine.map((c) =>
          h(
            "div",
            { class: "banner warn small schedule-clash" },
            h("span", { class: "grow" }, t(c.minutes === 0 ? "schedule.clashSame" : "schedule.clash", { other: scheduleName(byId.get(c.with)), time: byId.get(c.with).time, minutes: c.minutes }), " ", t(one.kind === "update" || byId.get(c.with).kind === "update" ? "schedule.why.update" : "schedule.why." + (one.touches.includes("disks") && byId.get(c.with).touches.includes("disks") ? "disks" : "apps"))),
            own && one.free && button(t("schedule.moveTo", { time: one.free }), { class: "small", onclick: () => moveScheduled(one.id, one.free) }),
          ),
        ),
        one.skipped && h("div", { class: "banner warn small schedule-clash" }, h("span", { class: "grow" }, t("schedule.whileOff", { off: state.power?.schedule.off ?? "", wake: state.power?.schedule.wake ?? "" }))),
      ),
      own ? h("div", { class: "setting-control schedule-time" }, input, save, h("a", { class: "btn small ghost", href: one.href }, t("schedule.open"))) : h("div", { class: "setting-control schedule-time" }, h("strong", null, one.time)),
    );
  };
  const repeating = (one) =>
    h(
      "div",
      { class: "setting" + (one.on ? "" : " off") },
      h("div", { class: "grow stack-tight" }, h("strong", null, t("schedule.repeat." + one.id)), h("p", { class: "muted small" }, [one.on ? everyWords(one.every) : t("schedule.off"), one.last ? t("schedule.lastAt", { when: ago(one.last) }) : ""].filter(Boolean).join(" · "))),
      h("div", { class: "setting-control" }, h("a", { class: "btn small ghost", href: one.href }, t("schedule.open"))),
    );
  return [
    powerCard(),
    uiCard(
      { title: t("schedule.timedTitle"), lead: t("schedule.timedLead", { zone: data.timezone }), marks: data.clashes.length > 0 && h("span", { class: "chip warn" }, t("schedule.clashes", { n: data.clashes.length })) },
      h("div", { class: "schedule-list" }, data.timed.map(row)),
    ),
    uiCard({ title: t("schedule.repeatTitle"), lead: t("schedule.repeatLead") }, h("div", { class: "schedule-list" }, data.repeating.map(repeating))),
  ];
}

/** The steps an update goes through as the page sees them; going back skips the download */
const UPDATE_STEPS = ["download", "verify", "restart", "start"];
/** The waits of a hard disk before it stops spinning, minutes: as `SLEEP_MINUTES` in power.ts */
const SLEEP_MINUTES = [0, 10, 20, 30, 60, 120, 240];
let updateFollow = null;

/**
 * Asks until the server answers with another version (the update went through) or says why it did not,
 * showing every step in a window of its own; asked again while one is followed, it only shows that window
 */
async function followUpdate(target, back = false) {
  if (updateFollow) return updateFollow.show();
  const steps = back ? UPDATE_STEPS.slice(2) : UPDATE_STEPS;
  const rows = new Map(steps.map((step) => [step, h("li", null, h("span", { class: "step-mark" }), h("div", { class: "grow" }, h("span", null, t("update.step." + step, { version: target })), h("small", { class: "muted" })))]));
  const fill = h("i");
  rows.get("download")?.querySelector(".grow").append(h("div", { class: "bar" }, fill));
  const said = h("p", { class: "muted small" }, t(back ? "update.stepsLeadBack" : "update.stepsLead"));
  const error = h("p", { class: "error", role: "alert" });
  const close = closeButton(() => dialog, t("update.hide"));
  // a stray Enter only hides the window
  close.autofocus = true;
  // until the new binary is put in place nothing is changed yet, so the update can be called off
  const cancel = !back && button(t("update.cancel"), {
    class: "danger-text",
    onclick: async () => {
      cancel.disabled = true;
      try {
        await api("POST", "/api/update/cancel", {});
        stopped = true;
      } catch (e) {
        cancel.disabled = false;
        toast(errorText(e), "error");
      }
    },
  });
  let dialog;
  let stopped = false;
  const show = () => {
    if (dialog?.open) return;
    dialog = openDialog("update-dialog", h("h2", null, t(back ? "update.goingBack" : "update.going", { version: target })), said, h("ol", { class: "update-steps" }, [...rows.values()]), error, h("footer", null, cancel || h("span"), close));
  };
  // the steps before `at` are done, `at` goes on (or failed), the rest wait; past the last — all done
  const mark = (at, failed = false) => {
    const index = at === "all" ? steps.length : steps.indexOf(at);
    steps.forEach((step, i) => {
      const row = rows.get(step);
      row.className = i < index ? "done" : i === index ? (failed ? "failed" : "now") : "";
      put(row.querySelector(".step-mark"), i < index ? icon("check") : i === index ? icon(failed ? "x" : "refresh", failed ? "" : "spin") : null);
    });
  };
  updateFollow = { show };
  show();
  mark(back ? "restart" : "download");
  const started = Date.now();
  let at = back ? "restart" : "download";
  let outcome = "slow";
  while (Date.now() - started < 4 * 60_000) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = await fetch("/api/state").then((r) => (r.ok ? r.json() : null), () => null);
    // the new version brings a new UI with it
    if (now?.version === target) {
      outcome = "done";
      break;
    }
    const status = await api("GET", "/api/update").catch(() => null);
    // no answer: the server is between the old version and the new one
    if (!status) at = at === "download" || at === "verify" ? at : "start";
    else {
      state.update = status;
      if (!status.stage && (status.error || status.last?.status === "rolledBack")) {
        outcome = status.error ? "error" : "rolledBack";
        error.textContent = status.error ? t("update.error", { message: status.error }) : t("update.rolledBack", { version: target });
        break;
      }
      // stopped here or from another page before anything was swapped
      if (!status.stage && (stopped || at === "download" || at === "verify")) {
        outcome = "cancelled";
        break;
      }
      if (status.stage) at = status.stage;
      const p = status.progress;
      const row = rows.get("download")?.querySelector("small");
      if (p && row) {
        // without the size from the server there is nothing to measure against: the bar waits for the check
        fill.style.width = p.total ? Math.round((p.got / p.total) * 100) + "%" : "0";
        row.textContent = p.total ? `${bytes(p.got)} / ${bytes(p.total)}` : bytes(p.got);
      }
    }
    if (at !== "download") fill.style.width = "100%";
    if (cancel) cancel.hidden = at !== "download" && at !== "verify";
    mark(at);
  }
  updateFollow = null;
  if (outcome === "cancelled") {
    if (dialog.open) dialog.close();
    toast(t("update.cancelled", { version: target }));
    if (state.route.view === "settings") renderSettings();
    return;
  }
  if (outcome === "done") {
    mark("all");
    said.textContent = t("update.ready", { version: target });
    close.disabled = true;
    return setTimeout(() => location.reload(), 1200);
  }
  if (!dialog.isConnected) show();
  if (cancel) cancel.hidden = true;
  mark(at, true);
  if (outcome === "slow") error.textContent = t("update.slow");
  close.lastChild.textContent = t("common.close");
  if (state.route.view === "settings") renderSettings();
}

let updateFx = "";

function updateRow() {
  const u = state.update;
  if (!u) return null;
  const busy = !!u.stage;
  const failed = !busy && u.last?.status === "rolledBack" && u.latest?.version === u.last.to;
  const hint = busy
    ? t("update.stage." + u.stage)
    : failed
      ? t("update.rolledBack", { version: u.last.to })
      : u.error
        ? t("update.error", { message: u.error })
        : u.available
          ? u.unsupported ? t("update.manual") : t("update.availableHint")
          : u.checkedAt ? t("update.upToDate", { time: ago(u.checkedAt) }) : t("update.notChecked");
  // what the last check found, said once by the row drawn after it
  const fx = updateFx;
  updateFx = "";
  const check = button(t("update.check"), {
    class: "small ghost",
    disabled: busy,
    onclick: async () => {
      check.disabled = true;
      check.querySelector(".ico").classList.add("spin");
      check.lastChild.textContent = t("update.checking");
      // a quick answer would only blink: the turn lasts long enough to be seen
      const [res] = await Promise.all([api("POST", "/api/update/check", {}).catch((e) => ({ ...state.update, error: errorText(e) })), new Promise((r) => setTimeout(r, 700))]);
      state.update = res;
      updateFx = res.error ? "error" : res.available ? "found" : "latest";
      renderSettings();
    },
  }, "refresh");
  const install = u.available && !u.unsupported && button(t("update.install", { version: u.latest.version }), {
    class: "small primary",
    disabled: busy,
    onclick: async () => {
      try {
        await api("POST", "/api/update/install", {});
        state.update = { ...u, stage: "download", error: "" };
        renderSettings();
        void followUpdate(u.latest.version);
      } catch (e) {
        toast(errorText(e), "error");
      }
    },
  }, "up");
  const back = u.previous && !u.unsupported && button(t("update.back", { version: u.previous }), { class: "small ghost", disabled: busy, onclick: () => rollbackDialog(u) });
  const row = settingRow(
    u.available ? t("update.available", { version: u.latest.version }) : t("update.title2"),
    hint,
    busy
      ? h("div", { class: "row-actions" }, button(t("update.showSteps"), { class: "small primary", onclick: () => followUpdate(u.latest?.version ?? u.previous) }, "refresh"))
      : h("div", { class: "row-actions" }, u.available && u.latest.url && h("a", { class: "link small", href: u.latest.url, target: "_blank", rel: "noopener noreferrer" }, t("update.notes"), icon("external")), back, check, install),
  );
  if (fx) {
    row.classList.add("checked", "checked-" + fx);
    if (fx === "latest") row.querySelector("p")?.prepend(icon("check", "fresh-check"));
    if (fx === "found" && install) install.classList.add("arrive");
  }
  return row;
}

/** Which releases are offered: stable ones, or pre-releases too; the check runs again at once */
function channelRow() {
  if (!state.update || !state.settings) return null;
  const channel = state.settings.update?.channel ?? "stable";
  const pick = h(
    "select",
    {
      "aria-label": t("update.channel"),
      onchange: async () => {
        pick.disabled = true;
        try {
          state.settings = await api("PUT", "/api/settings", { update: { channel: pick.value } });
          state.update = await api("POST", "/api/update/check", {}).catch(() => state.update);
        } catch (e) {
          toast(errorText(e), "error");
        }
        renderSettings();
      },
    },
    ["stable", "beta"].map((value) => h("option", { value, selected: value === channel }, t("update.channel." + value))),
  );
  return settingRow(t("update.channel"), t(channel === "beta" ? "update.channelBetaHint" : "update.channelHint"), pick);
}

/** The daily install of the version offered; off unless turned on, and only where Hata can replace itself */
function autoUpdateRow() {
  if (!state.update || !state.settings || state.update.unsupported) return null;
  const u = state.settings.update;
  const save = async (patch) => {
    try {
      state.settings = await api("PUT", "/api/settings", { update: patch });
    } catch (e) {
      toast(errorText(e), "error");
    }
    renderSettings();
  };
  const auto = h("input", { type: "checkbox", checked: u.auto, "aria-label": t("update.auto"), onchange: () => save({ auto: auto.checked }) });
  const time = h("input", { type: "time", value: u.time, class: "short mono", required: true, "aria-label": t("update.autoTime"), hidden: !u.auto, onchange: () => time.value && save({ time: time.value }) });
  return settingRow(t("update.auto"), t(u.auto ? "update.autoOnHint" : "update.autoHint", { zone: state.settings.systemTimezone }), h("div", { class: "row-actions" }, time, auto));
}

/** Going back to the version that ran before: the same watched restart as an update */
function rollbackDialog(u) {
  let dialog;
  const error = h("p", { class: "error", role: "alert" });
  const go = button(t("update.backGo", { version: u.previous }), {
    class: "primary",
    onclick: async () => {
      go.disabled = true;
      try {
        await api("POST", "/api/update/rollback", {});
        dialog.close();
        state.update = { ...u, stage: "restart", error: "" };
        renderSettings();
        void followUpdate(u.previous, true);
      } catch (e) {
        error.textContent = errorText(e);
        go.disabled = false;
      }
    },
  });
  dialog = openDialog("", h("h2", null, t("update.backTitle", { version: u.previous })), h("p", { class: "muted" }, t("update.backLead", { from: u.current, version: u.previous })), error, h("footer", null, closeButton(() => dialog, t("common.cancel")), go));
}

/** The configuration folder: where it is, and moving it — which restarts Hata in the new place */
/** What the server answered a move with: a job to follow, or the folder simply chosen (nothing was there to move) */
function dataRootMoved(res, done) {
  if (!res.job) {
    toast(t("data.chosen", { path: res.path }));
    return void done();
  }
  jobDialog(res.job, "move", "", done);
}

async function afterDataRoot() {
  state.settings = await api("GET", "/api/settings");
  if (state.route.view === "settings") renderSettings();
  if (state.route.view === "welcome") void loadWelcome();
}

/** The data folder chosen with the folder picker; a folder that holds data already is moved there */
function pickDataRoot() {
  const current = state.settings.dataRoot;
  folderPicker({
    title: t("data.chooseTitle"),
    start: current.split("/").slice(0, -1).join("/") || "/",
    confirmLabel: t("data.chooseHere"),
    allowed: (at) => at !== "/" && at !== current,
    action: async (path) => dataRootMoved(await api("POST", "/api/data-root/move", { path }), afterDataRoot),
  });
}

/** Moves the data folder with everything in it; `suggested` — a folder to offer (a disk just formatted) */
async function moveDataDialog(suggested = "") {
  const s = state.settings;
  const target = h("input", { type: "text", value: suggested, spellcheck: false, class: "mono", placeholder: "/mnt/disk/DATA" });
  const error = h("p", { class: "error", role: "alert" });
  const go = button(t("data.moveGo"), { class: "primary", disabled: !suggested });
  target.addEventListener("input", () => (go.disabled = !target.value.trim().startsWith("/")));
  // the disks Hata connected are where the folder usually goes
  const disks = await api("GET", "/api/disks").catch(() => null);
  const branches = Object.values(disks?.mounting?.pools ?? {}).flat();
  const places = Object.keys(disks?.mounting?.ours ?? {}).filter((path) => !(s.dataRoot + "/").startsWith(path + "/") && !branches.includes(path));
  let dialog;
  go.onclick = async () => {
    error.textContent = "";
    go.disabled = true;
    try {
      const res = await api("POST", "/api/data-root/move", { path: target.value.trim() });
      dialog.close();
      dataRootMoved(res, afterDataRoot);
    } catch (e) {
      error.textContent = errorText(e);
      go.disabled = false;
    }
  };
  dialog = openDialog(
    "wide",
    h("h2", null, t("data.moveTitle")),
    h("p", { class: "muted" }, t("data.moveLead", { from: s.dataRoot })),
    field(t("data.target"), h("span", { class: "pair" }, target, button(t("data.choose"), { onclick: () => folderPicker({ title: t("data.chooseTitle"), start: target.value.startsWith("/") ? target.value : "", confirmLabel: t("edit.pickHere"), action: (path) => void ((target.value = path), (go.disabled = false)) }) }, "folder")), t("data.targetHint")),
    places.length > 0 && h("div", { class: "row-actions wrap" }, places.map((path) => button(`${path}/DATA`, { class: "small mono", onclick: () => ((target.value = `${path}/DATA`), (go.disabled = false)) }))),
    h("p", { class: "banner" }, t("data.moveWarn")),
    error,
    h("footer", null, closeButton(() => dialog, t("common.cancel")), go),
  );
}

function stateDirCard() {
  const s = state.settings;
  const path = h("input", { value: s.stateDir, spellcheck: false, required: true, class: "mono", "aria-label": t("state.title") });
  const error = h("p", { class: "error", role: "alert" });
  const move = button(t("state.move"), { disabled: true, onclick: () => confirmMove() });
  path.addEventListener("input", () => (move.disabled = !s.stateMovable || path.value.trim().replace(/\/+$/, "") === s.stateDir));
  const confirmMove = () => {
    const target = path.value.trim().replace(/\/+$/, "");
    const inData = target === s.dataRoot || target.startsWith(s.dataRoot.replace(/\/$/, "") + "/");
    const dialog = openDialog(
      "confirm",
      h("h2", null, t("state.moveTitle")),
      h("p", { class: "muted" }, t("state.moveLead", { from: s.stateDir, to: target })),
      inData && h("p", { class: "banner" }, t("state.inDataRoot", { path: s.dataRoot })),
      h(
        "footer",
        null,
        closeButton(() => dialog, t("common.cancel")),
        button(t("state.moveConfirm"), {
          class: "primary",
          onclick: async () => {
            dialog.close();
            error.textContent = "";
            try {
              await api("POST", "/api/state-dir", { path: target });
            } catch (e) {
              return (error.textContent = errorText(e));
            }
            move.disabled = path.disabled = true;
            toast(t("state.moving"));
            // the service is back when it answers from the new folder
            for (let i = 0; i < 60; i++) {
              await new Promise((r) => setTimeout(r, 1500));
              const now = await fetch("/api/settings").then((r) => (r.ok ? r.json() : null), () => null);
              if (now?.stateDir === target) {
                toast(t("state.moved", { path: target }));
                return location.reload();
              }
            }
            error.textContent = t("state.notBack");
          },
        }),
      ),
    );
  };
  return h(
    "section",
    { class: "card pad" },
    h("h2", null, t("state.title")),
    h("p", { class: "muted small" }, t("state.lead")),
    settingRow(t("state.folder"), t(s.stateMovable ? "state.folderHint" : "state.notMovable"), h("span", { class: "pair" }, path, move)),
    error,
  );
}

function settingsSection(section) {
  const s = state.settings;
  const d = state.overview?.docker;
  const error = h("p", { class: "error", role: "alert" });
  const save = async (patch) => {
    error.textContent = "";
    try {
      state.settings = await api("PUT", "/api/settings", patch);
      toast(t("settings.saved"));
    } catch (err) {
      error.textContent = errorText(err);
    }
  };

  if (SECTION_MODULE[section] && !hasModule(SECTION_MODULE[section])) return [moduleOffCard(SECTION_MODULE[section])];
  if (section === "modules") return modulesSection();
  if (section === "account") return accountSection();
  if (section === "appearance") return appearanceSection(error);
  if (section === "general") {
    const language = languageSelect(() => void loadSettings());
    const port = h("input", { type: "number", min: 1, max: 65535, class: "short mono", value: s?.port || "", placeholder: String(location.port || 80) });
    return [
      h("section", { class: "card pad" }, h("h2", null, t("settings.general")), settingRow(t("settings.language"), t("settings.languageHint"), language), isAdmin() && settingRow(t("settings.port"), t("settings.portHint"), h("span", { class: "pair" }, port, button(t("settings.save"), { onclick: () => save({ port: Number(port.value) || 0 }) }))), isAdmin() && settingRow(t("welcome.again"), t("welcome.againHint"), h("a", { class: "btn", href: "#/welcome" }, t("common.open"))), error),
    ];
  }
  if (section === "apps") {
    const dataRoot = h("input", { value: s.dataRoot, spellcheck: false, required: true, class: "mono" });
    const puid = h("input", { value: s.puid, type: "number", min: 0, max: 65534, class: "short mono", required: true });
    const pgid = h("input", { value: s.pgid, type: "number", min: 0, max: 65534, class: "short mono", required: true });
    const tz = h("input", { value: s.timezone, spellcheck: false, placeholder: s.systemTimezone, class: "mono" });
    return [
      h(
        "form",
        {
          class: "card pad",
          onsubmit: (e) => {
            e.preventDefault();
            void save({ dataRoot: dataRoot.value.trim(), puid: Number(puid.value), pgid: Number(pgid.value), timezone: tz.value.trim() });
          },
        },
        h("h2", null, t("settings.apps")),
        settingRow(t("settings.dataRoot"), t("settings.dataRootHint"), h("span", { class: "pair" }, dataRoot, button(t("data.move"), { onclick: () => moveDataDialog() }))),
        settingRow(t("settings.ids"), t("settings.idsHint"), h("span", { class: "pair" }, puid, pgid)),
        settingRow(t("settings.timezone"), t("settings.timezoneHint", { tz: s.systemTimezone }), tz),
        error,
        h("footer", null, h("button", { class: "btn primary" }, t("settings.save"))),
      ),
      imagesCard(),
      stateDirCard(),
    ];
  }
  if (section === "https") return httpsSection(save, error);
  if (section === "dns") return dnsSection();
  if (section === "adblock") return adblockSection();
  if (section === "notifications") return notificationsSection();
  if (STORAGE_SECTIONS.includes(section)) return storageSection(section);
  if (section === "ports") return [portsCard()];
  if (section === "shares") return sharesSection();
  if (section === "network") return networkSection();
  if (section === "tools") return toolsSection();
  if (section === "schedule") return scheduleSection();
  if (section === "docker") return dockerSection();
  if (section === "remote") return remoteSection();
  if (section === "bluetooth") return bluetoothSection();
  if (section === "agents") return agentsSection();
  if (section === "assistant") return assistantSection();
  if (section === "stores") {
    const stores = state.store?.stores ?? [];
    return [
      h(
        "section",
        { class: "card pad" },
        h("div", { class: "section-head" }, h("h2", null, t("settings.stores")), button(t("store.sync"), { onclick: syncStores }, "refresh")),
        stores.map((store) =>
          settingRow(
            store.id,
            store.url,
            h("span", { class: "store-meta" }, h("span", { class: "muted small" }, t("settings.storeApps", { n: store.apps }) + (store.syncedAt ? " · " + ago(store.syncedAt) : "")), h("button", { type: "button", class: "icon-btn", title: t("store.remove"), "aria-label": `${t("store.remove")}: ${store.id}`, onclick: () => removeStoreDialog(store) }, icon("trash"))),
          ),
        ),
        addStoreForm(),
        h("p", { class: "muted small" }, t("settings.storesHint")),
      ),
    ];
  }
  return [
    h(
      "section",
      { class: "card pad" },
      h("h2", null, t("settings.about")),
      settingRow("Hata", t("settings.aboutHint"), h("span", { class: "mono" }, state.version)),
      updateRow(),
      channelRow(),
      autoUpdateRow(),
      settingRow("Docker", d?.available ? "" : (d?.error ?? ""), h("span", { class: "mono" }, d?.available ? `${d.version} · compose ${d.compose}` : "—")),
      settingRow(t("settings.source"), "", h("a", { class: "link", href: "https://github.com/sanyadez/hata", target: "_blank", rel: "noopener noreferrer" }, "github.com/sanyadez/hata", icon("external"))),
    ),
  ];
}
