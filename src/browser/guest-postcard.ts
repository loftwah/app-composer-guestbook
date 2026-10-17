(() => {
  const form = document.querySelector<HTMLFormElement>("#guest-postcard");
  if (!form) return;
  const canvas = document.querySelector<HTMLCanvasElement>("#postcard-canvas")!;
  const status = document.querySelector<HTMLElement>("#postcard-status")!;
  const fieldset = form.querySelector<HTMLFieldSetElement>("fieldset")!;
  const button = form.querySelector<HTMLButtonElement>("button")!;
  const context = canvas.getContext("2d");
  if (!context) {
    status.textContent =
      "Your browser could not prepare a postcard. Try another browser; nothing was sent.";
    return;
  }
  let busy = false,
    sent = false;
  const uncertain = new Map<string, string>();
  const uncertainMessages = () =>
    [...uncertain.values()].join(" Earlier postcard: ");
  console.info(
    "  [ postcard ]\nA familiar password joke opens the letterbox: hunter2\nGuest code → new pending postcard. Owner approval → public.\nSource: https://github.com/loftwah/app-composer-guestbook",
  );
  const caption = form.elements.namedItem("caption") as HTMLTextAreaElement;
  const authorField = form.elements.namedItem("author") as HTMLInputElement;
  const resource = new URL(form.action).pathname.match(
    /\/r\/([a-z0-9-]{6,64})\/api\/guest-postcard$/,
  )?.[1];
  const contentKey = () =>
    JSON.stringify([
      caption.value.trim().replace(/\s+/gu, " "),
      authorField.value.trim(),
    ]);
  const identifier = (value: unknown): value is string =>
    typeof value === "string" && /^[a-z0-9-]{6,64}$/.test(value);
  function unknown(content: string, message: string, reference?: string) {
    const notice =
      message +
      " " +
      (reference
        ? `Reference: ${resource ? resource + "/" : ""}${reference}. `
        : "No receipt reference was returned. ") +
      "Keep this page and ask the owner to check whether it arrived before resending. Your message is retained here.";
    uncertain.set(content, notice);
    status.textContent = uncertainMessages();
    button.textContent = "Check with owner before resending";
    sent = false;
  }
  function draw() {
    if (!context) return;
    const message =
      caption.value.trim().replace(/\s+/gu, " ") ||
      "A little piece of your day…";
    const author = authorField.value.trim();
    context.fillStyle = "#f4f0e7";
    context.fillRect(0, 0, 1200, 900);
    context.strokeStyle = "#758174";
    context.lineWidth = 2;
    context.strokeRect(48, 48, 1104, 804);
    context.fillStyle = "#a63d08";
    context.font = "600 28px system-ui";
    context.fillText("A postcard for the guestbook", 92, 128);
    context.fillStyle = "#20241e";
    context.font = "40px system-ui";
    // Wrap by Unicode code points, including a single unbroken URL/word. Caption remains real accessible text outside the image.
    let line = "",
      y = 250;
    for (const char of Array.from(message)) {
      if (char === "\n") {
        context.fillText(line, 92, y);
        line = "";
        y += 62;
        continue;
      }
      if (context.measureText(line + char).width > 1016) {
        context.fillText(line, 92, y);
        line = "";
        y += 62;
      }
      line += char;
    }
    context.fillText(line, 92, y);
    context.font = "28px system-ui";
    // The full alias remains accessible in the page and caption metadata, even if unusually wide in the preview.
    context.fillText(
      author ? "From " + author : "From a passing visitor",
      92,
      790,
      1016,
    );
  }
  form.addEventListener("input", () => {
    sent = false;
    draw();
  });
  window.addEventListener("beforeunload", (event) => {
    if (
      busy ||
      uncertain.size > 0 ||
      (!sent &&
        (caption.value.trim().replace(/\s+/gu, " ") ||
          authorField.value.trim()))
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || sent) return;
    const content = contentKey();
    if (uncertain.has(content)) {
      status.textContent = uncertainMessages();
      button.disabled = true;
      return;
    }
    const values = new FormData(form);
    draw();
    const payload = {
      code: values.get("code"),
      caption: values.get("caption"),
      author: values.get("author"),
      consent: values.has("consent"),
      png: canvas.toDataURL("image/png").split(",")[1],
    };
    busy = true;
    fieldset.disabled = true;
    button.textContent = "Sending postcard…";
    status.textContent = "Sending privately for owner review…";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(form.action, {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw Error("The server returned an invalid postcard response.");
      const reply = result as Record<string, unknown>;
      const sameResource = resource
        ? reply.resource === resource
        : reply.resource === undefined;
      const message =
        typeof reply.message === "string" && reply.message.length <= 1000
          ? reply.message
          : "The response did not confirm whether your postcard arrived. It may already be waiting for review.";
      if (reply.outcome === "unknown") {
        unknown(
          content,
          message,
          sameResource && identifier(reply.id) ? reply.id : undefined,
        );
        status.focus();
        return;
      }
      if (
        !response.ok &&
        response.status >= 400 &&
        response.status < 500 &&
        typeof reply.error === "string"
      ) {
        status.textContent = reply.error;
        button.textContent = "Send for approval";
        return;
      }
      if (
        !response.ok ||
        reply.outcome !== undefined ||
        reply.status !== "pending" ||
        !identifier(reply.id) ||
        !sameResource
      )
        throw Error(
          "The server did not return a confirmed pending postcard receipt.",
        );
      sent = true;
      status.textContent =
        typeof reply.message === "string"
          ? reply.message
          : "Your postcard is waiting for owner review.";
      if (uncertain.size > 0)
        status.textContent += " Earlier postcard: " + uncertainMessages();
      button.textContent = "Postcard sent";
      status.focus();
    } catch (error) {
      unknown(
        content,
        error instanceof Error && error.name === "AbortError"
          ? "The connection timed out. Your postcard may already be waiting for review."
          : "The response did not confirm whether your postcard arrived. It may already be waiting for review.",
      );
      status.focus();
    } finally {
      clearTimeout(timeout);
      busy = false;
      fieldset.disabled = false;
      button.disabled = sent || uncertain.has(contentKey());
    }
  });
  form.addEventListener("input", () => {
    if (!busy) {
      const blocked = uncertain.has(contentKey());
      button.disabled = blocked;
      button.textContent = blocked
        ? "Check with owner before resending"
        : "Send for approval";
      if (uncertain.size > 0) status.textContent = uncertainMessages();
    }
  });
  draw();
  button.disabled = false;
})();
