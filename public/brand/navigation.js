// App-owned theme/gallery behaviour. Common launcher: /brand/launcher.js.
const theme = document.querySelector("#reader-theme");
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
