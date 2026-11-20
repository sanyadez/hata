// A part of Hata's web UI: the parts share one scope and load in order (01-core.js says more).
"use strict";

// --- Start --------------------------------------------------------------------------------------

async function enter() {
  // sent here by a protected app: now that the visitor is signed in, back to it
  if (NEXT) return location.replace(NEXT);
  // signed in just now: which modules are on came with nobody's name on the first answer
  if (!state.modules) await loadModules();
  // a new server opens with the walk through its first choices; any other address is left alone
  if (state.welcome && isAdmin() && !/^#\/./.test(location.hash)) history.replaceState(null, "", location.pathname + "#/welcome");
  state.route = parseRoute();
  render();
  await refresh();
  startEvents();
  if (isAdmin() && state.route.view !== "welcome") api("GET", "/api/settings").then((s) => (state.settings = s), () => {});
  void pushResync();
  onRoute();
}

async function main() {
  let server;
  try {
    server = await api("GET", "/api/state");
  } catch {
    await loadLanguage("en");
    $app.replaceChildren(h("main", { class: "center" }, h("p", { class: "banner" }, t("error.network"))));
    return setTimeout(main, 3000);
  }
  applyAppearance((state.appearance = server.appearance ?? null));
  state.wallpapers = server.wallpapers ?? [];
  Object.assign(state, { modules: server.modules ?? null, version: server.version, setup: server.setup, welcome: !!server.welcome, user: server.user, languages: server.languages, passkeys: !!server.passkeys && !!window.PublicKeyCredential });
  await loadLanguage(pickLanguage(server));
  if (state.user) await enter();
  else render();
}

// the right click of every page: its handlers are spread over the parts, all loaded by now
contextMenus();
void main();
