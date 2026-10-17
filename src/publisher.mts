// MIT. Copied with attribution by independent mini-apps; no customer runtime dependency.
export function health(
  request: Request,
  path: string,
  app: string,
  revision: string,
): Response | null {
  if (new URL(request.url).pathname !== path) return null;
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  return new Response(
    request.method === "HEAD"
      ? null
      : JSON.stringify({ status: "up", check: "liveness", app, revision }),
    { headers },
  );
}
export interface PublisherEnv {
  USAGE_ENDPOINT?: string;
  USAGE_TOKEN?: string;
}
const cappedEndpoints = new Map<string, string>();
export function publish(
  env: PublisherEnv,
  context: Pick<ExecutionContext, "waitUntil"> | undefined,
  request: Request,
  event: string,
  send: typeof fetch = fetch,
): void {
  // The header suppresses synthetic release probes; it grants no access.
  if (
    request.headers.get("X-Composer-Verification") === "1" ||
    !env.USAGE_ENDPOINT ||
    !env.USAGE_TOKEN ||
    !context
  )
    return;
  let target;
  try {
    target = new URL(env.USAGE_ENDPOINT);
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      return;
  } catch {
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  for (const [key, date] of cappedEndpoints)
    if (date !== day) cappedEndpoints.delete(key);
  const key = target.href + ":" + event;
  if (cappedEndpoints.has(key)) return;
  context.waitUntil(
    (async () => {
      try {
        const response = await send(target.href, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + env.USAGE_TOKEN,
          },
          body: JSON.stringify({ contract: 1, event }),
          redirect: "manual",
          signal: AbortSignal.timeout(1500),
        });
        if (response.headers.get("X-Usage-Limit") === "reached")
          cappedEndpoints.set(key, day);
        await response.body?.cancel();
      } catch {
        /* Optional counts never interrupt the app. No retries or request-body logging. */
      }
    })(),
  );
}
export function pageEvent(
  request: Request,
  response: Response,
  base = "",
): string | null {
  if (
    request.method !== "GET" ||
    response.status !== 200 ||
    !response.headers.get("Content-Type")?.startsWith("text/html")
  )
    return null;
  const path = new URL(request.url).pathname;
  if (path === base + "/" || path === base) return "app_open";
  if (base.includes("guestbook") || !base) {
    if (/^\/item\/[a-f0-9-]{36}$/.test(path.slice(base.length)))
      return "item_open";
  }
  return null;
}

// Receipt means a new committed pending record, never publication or a unique visitor.
export function postcardReceiptEvent(
  request: Request,
  response: Response,
  base = "",
): string | null {
  if (
    request.method !== "POST" ||
    response.status !== 201 ||
    response.headers.get("Content-Type")?.split(";")[0] !== "application/json"
  )
    return null;
  return new URL(request.url).pathname === base + "/api/guest-postcard"
    ? "postcard_received"
    : null;
}
