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
  console.info(
    "  [ postcard ]\nA familiar password joke opens the letterbox: hunter2\nGuest code → new pending postcard. Owner approval → public.\nSource: https://github.com/loftwah/app-composer-guestbook",
  );
  const caption = form.elements.namedItem("caption") as HTMLTextAreaElement;
  const authorField = form.elements.namedItem("author") as HTMLInputElement;
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
    if (busy) return;
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
      if (!result || typeof result !== "object")
        throw Error("The server returned an invalid postcard response.");
      const reply = result as { error?: unknown; message?: unknown };
      if (!response.ok)
        throw new Error(
          typeof reply.error === "string"
            ? reply.error
            : "The postcard was not accepted. Keep your message and try again.",
        );
      sent = true;
      status.textContent =
        typeof reply.message === "string"
          ? reply.message
          : "Your postcard is waiting for owner review.";
      button.textContent = "Postcard sent";
      status.focus();
    } catch (error) {
      status.textContent =
        error instanceof Error && error.name === "AbortError"
          ? "The connection timed out. Your postcard may already be waiting for review. Your message is retained here."
          : (error instanceof Error && error.message) ||
            "The connection failed. Your message is still here; try again when connected.";
      button.textContent = "Send for approval";
    } finally {
      clearTimeout(timeout);
      busy = false;
      fieldset.disabled = false;
      button.disabled = sent;
    }
  });
  form.addEventListener("input", () => {
    if (!busy) {
      button.disabled = false;
      button.textContent = "Send for approval";
    }
  });
  draw();
  button.disabled = false;
})();
