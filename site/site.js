// What the page cannot do without a script: copying the install command and showing a picture larger.
// Without it the command is plain text to select, and a picture is a link to its full size.
document.documentElement.classList.add("js");

for (const button of document.querySelectorAll(".cmd button")) {
  const label = button.textContent;
  let timer;
  button.addEventListener("click", async () => {
    const text = button.parentElement.querySelector("code").textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = button.dataset.done;
    } catch {
      getSelection().selectAllChildren(button.parentElement.querySelector("code"));
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => (button.textContent = label), 2000);
  });
}

const WORDS = {
  en: { close: "Close", previous: "Previous picture", next: "Next picture" },
  uk: { close: "Закрити", previous: "Попередній знімок", next: "Наступний знімок" },
}[document.documentElement.lang];
const PHONE = matchMedia("(max-width: 760px)");

const shots = [...document.querySelectorAll("a.zoom")];
const dialog = document.createElement("dialog");
dialog.className = "viewer";
const picture = document.createElement("img");
const caption = document.createElement("p");
const button = (name, text, go) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "viewer-btn " + name;
  b.setAttribute("aria-label", WORDS[name]);
  b.textContent = text;
  b.addEventListener("click", go);
  return b;
};
let at = 0;
const seen = () => shots.filter((a) => a.offsetParent);
const show = (link) => {
  at = seen().indexOf(link);
  const img = link.querySelector("img");
  // a phone's own picture is the one that reads there; a wide one would only shrink again
  const own = PHONE.matches && img.currentSrc !== img.src ? img : null;
  picture.src = own ? own.currentSrc : link.href;
  picture.width = own ? own.naturalWidth : link.dataset.w;
  picture.height = own ? own.naturalHeight : link.dataset.h;
  picture.alt = img.alt;
  caption.textContent = img.alt;
  dialog.scrollTop = 0;
};
const step = (by) => {
  const list = seen();
  show(list[(at + by + list.length) % list.length]);
};
dialog.append(button("close", "×", () => dialog.close()), button("previous", "‹", () => step(-1)), button("next", "›", () => step(1)), picture, caption);
document.body.append(dialog);
dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
dialog.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "ArrowRight") step(1);
});
dialog.addEventListener("close", () => picture.removeAttribute("src"));
for (const link of shots) {
  link.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    show(link);
    dialog.showModal();
  });
}
