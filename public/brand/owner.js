// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
// MIT. App-owned login, configuration and photo moderation controls.
const client = document.querySelector("script[data-owner-client]");
const base = client?.dataset.base ?? "";
const output = document.querySelector("main [role=status]");
async function api(path, data) {
    const response = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("The server returned an invalid response.");
    const result = value;
    if (!response.ok)
        throw Error(typeof result.error === "string" ? result.error : "Request failed");
    return result;
}
function report(error) {
    if (output)
        output.textContent = error instanceof Error ? error.message : String(error);
}
const login = document.querySelector("#login");
login?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        await api("/api/login", { token: new FormData(login).get("token") });
        location.reload();
    }
    catch (error) {
        report(error);
    }
});
document.querySelector("#logout")?.addEventListener("click", async () => {
    try {
        await api("/api/logout", {});
        location.reload();
    }
    catch (error) {
        report(error);
    }
});
const config = document.querySelector("#config");
config?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        await api("/api/config", Object.fromEntries(new FormData(config)));
        location.reload();
    }
    catch (error) {
        report(error);
    }
});
for (const button of document.querySelectorAll("[data-status]"))
    button.addEventListener("click", async () => {
        if (button.dataset.status === "deleted" &&
            !confirm("Delete the original photo? This cannot be undone."))
            return;
        try {
            await api("/api/moderate", {
                id: button.dataset.id,
                status: button.dataset.status,
            });
            location.reload();
        }
        catch (error) {
            report(error);
        }
    });
const upload = document.querySelector("#upload");
upload?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = upload.querySelector("button");
    button.disabled = true;
    try {
        const values = new FormData(upload), file = values.get("image");
        if (!(file instanceof File))
            throw Error("Choose an image.");
        if (file.size > 10000000)
            throw Error("Choose an image under 10 MB");
        const image = await createImageBitmap(file);
        const scale = Math.min(1, 1200 / image.width, 1200 / image.height), canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        if (!context) {
            image.close();
            throw Error("Your browser could not prepare the image.");
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = canvas.toDataURL("image/png").split(",")[1];
        image.close();
        const value = await api("/api/upload", {
            png,
            caption: values.get("caption"),
            author: values.get("author"),
            consent: values.has("consent"),
        });
        if (output)
            output.textContent =
                typeof value.message === "string"
                    ? value.message
                    : "Submitted for review.";
        upload.reset();
    }
    catch (error) {
        report(error);
    }
    finally {
        button.disabled = false;
    }
});
export {};
