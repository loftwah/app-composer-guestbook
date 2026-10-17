// App-owned theme/gallery behaviour. Common launcher: /brand/launcher.js.
const theme = document.querySelector<HTMLButtonElement>("#reader-theme")!;
const app = document.documentElement.dataset.app;
const key = document.documentElement.dataset.themeKey || app + ":reader-theme";
function themeLabel() {
  const control = theme;
  const dark = document.documentElement.dataset.theme !== "light";
  control.setAttribute("aria-label", "Dark theme");
  control.setAttribute("aria-pressed", String(dark));
  control.title = dark ? "Switch to light theme" : "Switch to dark theme";
}
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

// Collection filtering stays app-owned; the shared launcher only finds apps.
const search = document.querySelector<HTMLInputElement>("#gallery-search");
const items = [
  ...document.querySelectorAll<HTMLElement>("[data-gallery-item]"),
];
const count = document.querySelector<HTMLElement>("#gallery-count");
const empty = document.querySelector<HTMLElement>("#gallery-empty");
function filterCollection() {
  const query = search?.value.trim().toLocaleLowerCase() ?? "";
  let visible = 0;
  for (const item of items) {
    item.hidden = !(item.textContent ?? "").toLocaleLowerCase().includes(query);
    if (!item.hidden) visible++;
  }
  if (count) count.textContent = `${visible} of ${items.length} moments`;
  if (empty) empty.hidden = visible !== 0;
}
if (search) {
  search.addEventListener("input", filterCollection);
  filterCollection();
}
