// Generated from src/browser/launcher.ts; edit that source. MIT.
"use strict";
// MIT. Maintained launcher controller for Composer and its independent apps.
// Generated copies live at public/brand/launcher.js. Destinations and themes
// remain app-owned. See docs/source-maintenance.md for the markup contract.
(() => {
    const dialog = document.querySelector("#app-navigation");
    const trigger = document.querySelector("[data-open-apps]");
    if (!dialog || !trigger)
        return;
    const search = dialog.querySelector('input[type="search"]');
    const closeButton = dialog.querySelector("[data-close-apps]");
    const status = dialog.querySelector('[role="status"]');
    const list = dialog.querySelector("ul");
    const entries = [...dialog.querySelectorAll("[data-destination]")];
    let lastFocus = null;
    let scrollPosition = { x: 0, y: 0 };
    const bodyProperties = ["position", "top", "right", "bottom", "left", "width"];
    let bodyStyle = [];
    // Both native initial focus and explicit focus must choose a non-editable
    // control. Otherwise showModal alone can still summon a software keyboard.
    closeButton?.setAttribute("autofocus", "");
    search?.removeAttribute("autofocus");
    trigger.setAttribute("aria-controls", dialog.id);
    trigger.setAttribute("aria-expanded", "false");
    function fit() {
        if (!dialog)
            return;
        const viewport = window.visualViewport;
        const height = viewport?.height ?? window.innerHeight;
        const width = viewport?.width ?? window.innerWidth;
        const inset = 12;
        const usableHeight = Math.max(0, Math.min(650, height - inset * 2));
        dialog.style.setProperty("--launcher-height", `${usableHeight}px`);
        dialog.style.setProperty("--launcher-width", `${Math.max(0, width - inset * 2)}px`);
        dialog.style.setProperty("--launcher-top", `${(viewport?.offsetTop ?? 0) + Math.max(inset, (height - usableHeight) / 2)}px`);
        dialog.style.setProperty("--launcher-left", `${(viewport?.offsetLeft ?? 0) + width / 2}px`);
    }
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    function filter() {
        const query = (search?.value ?? "").trim().toLowerCase();
        let count = 0;
        for (const entry of entries) {
            entry.hidden = !(entry.textContent ?? "").toLowerCase().includes(query);
            if (!entry.hidden)
                count++;
        }
        if (status)
            status.textContent = count
                ? `${count} ${count === 1 ? "destination" : "destinations"}`
                : "No matches. Try an app or task name.";
        if (dialog)
            dialog.dataset.empty = String(count === 0);
        if (list)
            list.scrollTop = 0;
    }
    function markCurrent() {
        if (dialog?.querySelector('[aria-current="page"]'))
            return;
        const path = (value) => value.replace(/\/$/, "") || "/";
        const here = new URL(location.href);
        for (const entry of entries) {
            const link = entry.querySelector("a");
            if (!link)
                continue;
            const target = new URL(link.href, location.href);
            if (target.origin === here.origin && path(target.pathname) === path(here.pathname)) {
                link.setAttribute("aria-current", "page");
                break;
            }
        }
    }
    function lockPage() {
        scrollPosition = { x: window.scrollX, y: window.scrollY };
        bodyStyle = bodyProperties.map(name => ({ name, value: document.body.style.getPropertyValue(name), priority: document.body.style.getPropertyPriority(name) }));
        // A fixed body also prevents the underlying page moving in iOS Safari.
        // The scrollbar gutter keeps the content width stable on desktop.
        document.documentElement.classList.add("launcher-open");
        document.body.style.position = "fixed";
        document.body.style.top = `${-scrollPosition.y}px`;
        document.body.style.right = "0";
        document.body.style.bottom = "auto";
        document.body.style.left = `${-scrollPosition.x}px`;
        document.body.style.width = "100%";
    }
    function unlockPage() {
        // Restore through individual CSSOM properties: setAttribute(style) is
        // blocked by the strict style-src policy used by Hello and Carry / forward.
        for (const { name, value, priority } of bodyStyle) {
            if (value)
                document.body.style.setProperty(name, value, priority);
            else
                document.body.style.removeProperty(name);
        }
        document.documentElement.classList.remove("launcher-open");
        window.scrollTo({ left: scrollPosition.x, top: scrollPosition.y, behavior: "instant" });
    }
    function open(focusSearch = false, returnFocus = null) {
        if (!dialog || dialog.open)
            return;
        // Safari does not focus buttons on pointer activation. Remember the
        // actual trigger for click opening; shortcut opening retains the prior field.
        lastFocus = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : trigger);
        lockPage();
        fit();
        if (search)
            search.value = "";
        filter();
        markCurrent();
        dialog.showModal();
        trigger?.setAttribute("aria-expanded", "true");
        (focusSearch ? search : closeButton)?.focus({ preventScroll: true });
    }
    function close() {
        if (dialog?.open)
            dialog.close();
    }
    trigger.addEventListener("click", () => open(false, trigger));
    closeButton?.addEventListener("click", close);
    dialog.addEventListener("close", () => {
        unlockPage();
        trigger.setAttribute("aria-expanded", "false");
        (lastFocus?.isConnected ? lastFocus : trigger).focus({ preventScroll: true });
        lastFocus = null;
    });
    dialog.addEventListener("click", event => {
        if (event.target !== dialog)
            return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom)
            close();
    });
    // Safari can omit links from sequential keyboard focus when Full Keyboard
    // Access is disabled. Keep Tab within the menu with the same visible controls.
    dialog.addEventListener("keydown", event => {
        if (event.key !== "Tab")
            return;
        const controls = [...dialog.querySelectorAll('a[href], button, input, select, textarea, [tabindex="0"]')].filter(control => !control.matches(":disabled, [hidden]") && control.getClientRects().length > 0);
        if (!controls.length)
            return;
        const index = controls.indexOf(document.activeElement);
        const next = event.shiftKey
            ? (index <= 0 ? controls.length - 1 : index - 1)
            : (index + 1) % controls.length;
        event.preventDefault();
        controls[next].focus();
    });
    // Escape uses the browser's native modal cancel path and the close handler.
    document.addEventListener("keydown", event => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
            event.preventDefault();
            if (!dialog.open)
                open(true);
            else
                search?.focus({ preventScroll: true });
        }
    });
    search?.addEventListener("input", filter);
    search?.addEventListener("keydown", event => {
        if (event.key !== "Enter")
            return;
        const first = entries.find(entry => !entry.hidden)?.querySelector("a");
        if (first) {
            event.preventDefault();
            first.click();
        }
    });
    for (const link of dialog.querySelectorAll("a"))
        link.addEventListener("click", close);
    // Navigation restored from the browser's page cache must not keep a modal or
    // stale fixed-body lock over the page, including modified/new-tab clicks.
    window.addEventListener("pageshow", () => { if (dialog.open)
        close(); });
    for (const image of dialog.querySelectorAll("li img")) {
        const missing = () => image.setAttribute("data-launcher-missing", "");
        image.addEventListener("error", missing);
        if (image.complete && image.naturalWidth === 0)
            missing();
    }
    filter();
})();
