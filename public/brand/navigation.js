const dialog = document.querySelector("#app-navigation");
const search = dialog.querySelector("input");
const links = [...dialog.querySelectorAll("[data-destination]")];
const trigger = document.querySelector("[data-open-apps]");
const theme = document.querySelector("#reader-theme");
const app = document.documentElement.dataset.app;
const key = document.documentElement.dataset.themeKey || app + ":reader-theme";
function themeLabel() {
  theme.textContent =
    document.documentElement.dataset.theme === "light"
      ? "Dark mode"
      : "Light mode";
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
function fit(){const viewport=window.visualViewport,height=viewport?.height??window.innerHeight;dialog.style.setProperty("--menu-height",`${height}px`);dialog.style.top=`${(viewport?.offsetTop??0)+Math.max(12,(height-650)/2)}px`;dialog.style.bottom="auto";dialog.style.margin="0 auto";}
window.visualViewport?.addEventListener("resize",fit);window.addEventListener("resize",fit);dialog.addEventListener("close",()=>trigger.focus());
function open() {
  fit();
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

const gallerySearch=document.querySelector('#gallery-search');
if(gallerySearch){
 const items=[...document.querySelectorAll('[data-gallery-item]')],type=document.querySelector('#gallery-type'),status=document.querySelector('#gallery-count'),empty=document.querySelector('#gallery-empty');
 function filterGallery(){let count=0;for(const item of items){item.hidden=!(item.textContent.toLowerCase().includes(gallerySearch.value.trim().toLowerCase())&&(!type?.value||item.dataset.kind===type.value));if(!item.hidden)count++;}status.textContent=`${count} ${count===1?'item':'items'} shown`;empty.hidden=items.length===0||count!==0;}
 gallerySearch.addEventListener('input',filterGallery);type?.addEventListener('change',filterGallery);filterGallery();
}
