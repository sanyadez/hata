// The one thing the page cannot do without a script: copying the install command. Without it the command is plain text to select.
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
