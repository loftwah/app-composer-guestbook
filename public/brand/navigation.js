const dialog = document.querySelector("#app-navigation");
const search = dialog.querySelector("input");
const links = [...dialog.querySelectorAll("[data-destination]")];
const trigger = document.querySelector("[data-open-apps]");
const theme = document.querySelector("#reader-theme");
const app = document.documentElement.dataset.app;
const key = app + ":reader-theme";
function themeLabel() {
  theme.textContent =
    document.documentElement.dataset.theme === "light"
      ? "Dark mode"
      : "Light mode";
}
try {
  const saved = localStorage.getItem(key);
  if (saved === "light" || saved === "dark")
    document.documentElement.dataset.theme = saved;
} catch {}
themeLabel();
theme.addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(key, next);
  } catch {}
  themeLabel();
});
function filter() {
  let count = 0;
  for (const link of links) {
    link.hidden = !link.textContent
      .toLowerCase()
      .includes(search.value.trim().toLowerCase());
    if (!link.hidden) count++;
  }
  dialog.querySelector("[role=status]").textContent = count
    ? `${count} destinations`
    : "No matches. Try an app or task name.";
}
function open() {
  dialog.showModal();
  search.value = "";
  filter();
  search.focus();
}
trigger.addEventListener("click", open);
dialog
  .querySelector("[data-close-apps]")
  .addEventListener("click", () => dialog.close());
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    dialog.open ? dialog.close() : open();
  }
});
search.addEventListener("input", filter);
search.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    dialog.close();
    trigger.focus();
    return;
  }
  if (e.key === "Enter") {
    const first = links.find((l) => !l.hidden)?.querySelector("a");
    if (first) {
      e.preventDefault();
      first.click();
    }
  }
});
