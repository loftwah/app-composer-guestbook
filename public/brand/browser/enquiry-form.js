// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
import { enquiryValues } from "../enquiry-model.js";
// This form keeps private text in the page. Only an opaque delivery intent is
// retained in this tab so an interrupted acknowledgement can be checked later.
(() => {
    const selected = document.querySelector("#private-enquiry");
    if (!selected)
        return;
    const form = selected;
    const required = (selector) => {
        const element = form.querySelector(selector);
        if (!element)
            throw Error("The declared enquiry form is incomplete.");
        return element;
    };
    const status = required("[data-status]"), send = required("[data-send]"), check = required("[data-check]"), receiptPanel = required("[data-receipt-panel]"), intentLabel = required("[data-intent]"), deliverables = required("[data-deliverables]"), add = required("[data-add-deliverable]"), start = required("[name=starting_point]"), existing = required("[data-existing-site]");
    const storageKey = "guestbook.enquiry/1:" + location.origin + location.pathname;
    const intentPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    let generation = 0, acknowledged = 0, pending = false, uncertain = null;
    function say(message) {
        status.textContent = message;
    }
    function remember() {
        try {
            if (uncertain)
                sessionStorage.setItem(storageKey, uncertain);
            else
                sessionStorage.removeItem(storageKey);
        }
        catch {
            /* This page still retains the intent if tab storage is unavailable. */
        }
    }
    try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved && intentPattern.test(saved))
            uncertain = saved;
    }
    catch {
        /* No private body is stored in browser storage. */
    }
    function paint() {
        send.disabled = pending || uncertain !== null;
        check.disabled = pending;
        add.disabled = deliverables.children.length >= 8;
        receiptPanel.hidden = uncertain === null;
        intentLabel.textContent = uncertain ? "Delivery intent: " + uncertain : "";
        existing.hidden = start.value !== "Existing site";
        required("[name=existing_site]").disabled =
            existing.hidden;
        form.setAttribute("aria-busy", String(pending));
    }
    function changed() {
        generation++;
        paint();
    }
    form.addEventListener("input", changed);
    form.addEventListener("change", changed);
    add.addEventListener("click", () => {
        if (deliverables.children.length >= 8)
            return;
        const row = document.createElement("div");
        row.className = "enquiry-deliverable";
        const label = document.createElement("label"), input = document.createElement("input");
        label.textContent = "Deliverable";
        input.required = true;
        input.maxLength = 120;
        input.dataset.item = "";
        label.append(input);
        const detailLabel = document.createElement("label"), detail = document.createElement("textarea");
        detailLabel.textContent = "Useful detail (optional)";
        detail.maxLength = 300;
        detail.rows = 2;
        detail.dataset.detail = "";
        detailLabel.append(detail);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary";
        remove.textContent = "Remove deliverable";
        remove.addEventListener("click", () => {
            row.remove();
            changed();
            add.focus();
        });
        row.append(label, detailLabel, remove);
        deliverables.append(row);
        changed();
        input.focus();
    });
    function values() {
        const data = new FormData(form);
        return {
            title: String(data.get("title") ?? ""),
            goal: String(data.get("goal") ?? ""),
            starting_point: start.value,
            ...(start.value === "Existing site" && data.get("existing_site")
                ? { existing_site: String(data.get("existing_site")) }
                : {}),
            deliverables: [...deliverables.children].map((row) => ({
                item: row.querySelector("[data-item]").value,
                detail: row.querySelector("[data-detail]").value,
            })),
        };
    }
    async function request(url, payload) {
        const response = await fetch(url, {
            method: "POST",
            credentials: "omit",
            redirect: "error",
            headers: {
                "Content-Type": "application/json",
                "X-Guestbook-Enquiry-Source": form.dataset.source,
                "X-Guestbook-Enquiry-Target": form.dataset.target,
            },
            body: JSON.stringify(payload),
        });
        const raw = await response.json();
        if (!response.ok) {
            const message = raw &&
                typeof raw === "object" &&
                "error" in raw &&
                typeof raw.error === "string"
                ? raw.error
                : "The delivery could not be confirmed.";
            throw Error(message);
        }
        return raw;
    }
    function receipt(raw, intent) {
        return Boolean(raw &&
            typeof raw === "object" &&
            "contract" in raw &&
            raw.contract === 1 &&
            "intent" in raw &&
            raw.intent === intent &&
            "received" in raw &&
            typeof raw.received === "boolean" &&
            Object.keys(raw).length === 3);
    }
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (pending || uncertain || !form.reportValidity())
            return;
        let clean;
        try {
            clean = enquiryValues(values());
            if (new TextEncoder().encode(JSON.stringify(clean)).byteLength > 10240)
                throw Error("Keep the private brief within10 KB of text.");
        }
        catch (error) {
            say(error instanceof Error
                ? error.message
                : "Check the declared brief fields.");
            status.focus();
            return;
        }
        const submittedGeneration = generation, intent = crypto.randomUUID();
        const payload = {
            contract: 1,
            intent,
            values: clean,
            consent: required("[name=consent]").checked,
        };
        // Store the intent before dispatch: a timeout, malformed response or unknown
        // status can follow a committed write. None of those permits another send.
        uncertain = intent;
        remember();
        pending = true;
        paint();
        say("Sending privately… Your text remains editable here.");
        try {
            const result = await request(form.action, payload);
            if (!receipt(result, intent) || !result.received)
                throw Error("The app returned an incomplete delivery receipt.");
            uncertain = null;
            remember();
            if (generation === submittedGeneration) {
                form.reset();
                deliverables.replaceChildren();
                generation++;
                acknowledged = generation;
                say("Received privately. No notification or reply was sent. The owner can review this brief for up to30 days.");
            }
            else {
                say("The submitted brief was received privately. Your newer text is still here and has not been sent.");
            }
        }
        catch (error) {
            say((error instanceof Error
                ? error.message
                : "Delivery could not be confirmed.") +
                " Keep this intent and check its receipt. Nothing will be resent automatically.");
        }
        finally {
            pending = false;
            paint();
        }
    });
    check.addEventListener("click", async () => {
        if (pending || !uncertain)
            return;
        const intent = uncertain;
        pending = true;
        paint();
        say("Checking the bounded delivery receipt…");
        try {
            const result = await request(form.dataset.receipt, {
                contract: 1,
                intent,
            });
            if (!receipt(result, intent))
                throw Error("The receipt response could not be validated.");
            if (!result.received) {
                say("No receipt is currently available. That does not prove delivery failed. Keep your brief and intent; this form will not resend it.");
                return;
            }
            uncertain = null;
            remember();
            // Never clear text after a receipt wait: it may contain a newer draft.
            say("That delivery was received privately. The text still in this form has been retained; check it before choosing to send a new brief.");
        }
        catch (error) {
            say((error instanceof Error
                ? error.message
                : "The receipt is unavailable.") +
                " Your text and delivery intent are retained.");
        }
        finally {
            pending = false;
            paint();
        }
    });
    window.addEventListener("beforeunload", (event) => {
        if (pending || uncertain || generation !== acknowledged) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
    if (uncertain)
        say("An earlier delivery in this tab is still uncertain. Check its receipt before another brief. Private text was not stored in browser storage.");
    paint();
})();
