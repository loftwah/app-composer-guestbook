export interface BaseEnv {
  DB: D1Database;
  OWNER_API_TOKEN: string;
  PUBLIC_ORIGIN: string;
}
export const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export const error = (message: string, status = 400) =>
  json({ error: message }, status);
const hex = (a: ArrayBuffer) =>
  Array.from(new Uint8Array(a), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
async function sign(value: string, key: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(value)),
  );
}
export async function authorised(req: Request, env: BaseEnv, name: string) {
  if (!env.OWNER_API_TOKEN) return false;
  const b = req.headers.get("Authorization");
  if (b?.startsWith("Bearer ")) {
    const lhs = await sign(b.slice(7), env.OWNER_API_TOKEN);
    const rhs = await sign(env.OWNER_API_TOKEN, env.OWNER_API_TOKEN);
    return lhs === rhs;
  }
  const raw = req.headers
    .get("Cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
  if (!raw) return false;
  const [expiry, nonce, signature] = raw.split(".");
  return (
    Number(expiry) > Date.now() &&
    Number(expiry) < Date.now() + 86400001 &&
    signature === (await sign(expiry + "." + nonce, env.OWNER_API_TOKEN))
  );
}
export async function sessionCookie(env: BaseEnv, name: string, base: string) {
  const v = Date.now() + 8 * 3600000 + "." + crypto.randomUUID();
  return (
    name +
    "=" +
    v +
    "." +
    (await sign(v, env.OWNER_API_TOKEN)) +
    "; HttpOnly; Secure; SameSite=Strict; Path=" +
    (base || "/") +
    "; Max-Age=28800"
  );
}
export async function limited(
  req: Request,
  env: BaseEnv,
  action: string,
  max = 15,
) {
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  const bucket = Math.floor(Date.now() / 900000);
  const key =
    action +
    ":" +
    hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip))) +
    ":" +
    bucket;
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (id,n,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET n=n+1 RETURNING n",
  )
    .bind(key, (bucket + 1) * 900000)
    .first<{ n: number }>();
  await env.DB.prepare("DELETE FROM rate_limits WHERE expires < ?")
    .bind(Date.now())
    .run();
  return (row?.n ?? 999) > max;
}
export async function readJSON(req: Request, max = 8192): Promise<any> {
  if (Number(req.headers.get("Content-Length") ?? 0) > max)
    throw new Error("Request is too large");
  const reader = req.body?.getReader();
  let size = 0;
  const chunks = [];
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new Error("Request is too large");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function text(v: unknown, max = 240) {
  if (typeof v !== "string" || v.length > max)
    throw new Error("Text must be at most " + max + " characters");
  return v.trim();
}
export function safeURL(v: unknown) {
  const u = new URL(String(v));
  if (u.protocol !== "https:" || u.username || u.password)
    throw new Error("Use a public HTTPS destination");
  return u.href;
}
export function basePath(url: URL, app: string) {
  return url.pathname === "/" + app || url.pathname.startsWith("/" + app + "/")
    ? "/" + app
    : "";
}
export async function settings(
  env: BaseEnv,
  defaults: Record<string, unknown>,
) {
  const r = await env.DB.prepare(
    "SELECT value FROM settings WHERE id='config'",
  ).first<{ value: string }>();
  return { ...defaults, ...(r ? JSON.parse(r.value) : {}) };
}
export const style = `@font-face{font-family:Space;src:url('/brand/space.woff2') format('woff2');font-display:swap}*{box-sizing:border-box}body{margin:0;background:#f4f0e7;color:#20241e;font:17px/1.55 system-ui,sans-serif}body.midnight{background:#17201b;color:#f4f0e7}header,main,footer{max-width:1240px;margin:auto;padding:24px 36px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #758174;gap:16px}a{color:inherit;text-underline-offset:4px}h1,h2,h3{font-family:Space,system-ui;line-height:1.1;letter-spacing:-.025em}h1{font-size:clamp(3rem,7vw,6rem);font-weight:600;margin:32px 0 18px;max-width:14ch}h2{font-size:2rem;margin-top:48px}p{max-width:68ch}.lede{font-size:1.3rem;max-width:42ch;margin-bottom:36px}nav{display:flex;gap:20px;flex-wrap:wrap}.gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px;margin:36px 0}.gallery img{width:100%;height:310px;object-fit:cover;border-radius:12px;display:block}.gallery h3{margin:16px 0 8px;font-size:1.4rem}.editorial{grid-template-columns:repeat(2,minmax(0,1fr))}.editorial img{height:430px}button,.button{display:inline-block;cursor:pointer;padding:12px 20px;border:0;border-radius:8px;background:#244c3d;color:#fff;font:inherit;text-decoration:none;min-height:48px}button.secondary{background:#dfdacd;color:#20241e}input,textarea,select{display:block;width:100%;max-width:560px;font:inherit;padding:12px;border:1px solid #728074;border-radius:6px;margin:6px 0 24px;background:#fff;color:#18291e}label{display:block;margin:12px 0}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}article{min-width:0}.small{font-size:.88rem}form{margin:28px 0}fieldset{border:1px solid #879183;padding:20px;max-width:650px}legend{padding:0 8px}.message{padding:12px 0;min-height:36px}:focus-visible{outline:3px solid #e85d32;outline-offset:4px}.badge{padding:5px 10px;background:#e3ddcb;color:#31382f;font-size:.83rem;border-radius:5px}.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:white;padding:12px;z-index:4}footer{border-top:1px solid #879183;margin-top:48px;font-size:.9rem}dialog{max-width:90vw;border:none;border-radius:12px}dialog img{max-width:75vw;max-height:70vh}img{max-width:100%}@media(max-width:700px){header,main,footer{padding:20px}.gallery,.editorial{grid-template-columns:1fr}.gallery img{height:auto;aspect-ratio:4/3}h1{margin-top:20px}nav{gap:12px}header{align-items:flex-start}h1{font-size:3.2rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
:root{color-scheme:dark;--bg:#17181b;--fg:#f2f3f5;--muted:#afb3bb;--surface:#23252a;--field:#1d1f23;--border:#444952;--control:#797f8a;--accent:#ff9b55}:root[data-theme=light]{color-scheme:light;--bg:#faf9f7;--fg:#22252b;--muted:#5c616a;--surface:#efeeea;--field:#fff;--border:#d3d1cc;--control:#747983;--accent:#a63d08}body,body.midnight{background:var(--bg);color:var(--fg);font-size:16px}header,main,footer{max-width:1248px;padding:24px 32px}header{flex-wrap:wrap;border-color:var(--border)}header>a{text-decoration:none;font-family:Space,sans-serif;font-size:22px}h1{font-size:3.5rem;max-width:18ch;margin:28px 0 18px}h2{font-size:1.6rem}main{padding-top:36px}.lede{font-size:20px;color:var(--muted);max-width:58ch}.small{color:var(--muted)}input,textarea,select{background:var(--field);color:var(--fg);border-color:var(--control)}button,.button{background:var(--accent);color:var(--bg);font-size:15px;font-weight:600}:root[data-theme=light] button:not(.secondary),:root[data-theme=light] .button{color:white}button.secondary{background:var(--surface);color:var(--fg);border:1px solid var(--control)}.badge{background:var(--surface);color:var(--muted)}.gallery{gap:28px;margin:32px 0 40px}.gallery img{height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:8px}.editorial img{aspect-ratio:4/3}.gallery article{padding-bottom:20px;border-bottom:1px solid var(--border)}.gallery h3{font-size:20px}.gallery a{text-decoration:none}.gallery a:hover h3{text-decoration:underline}footer{border-color:var(--border);color:var(--muted)}:focus-visible{outline-color:var(--accent)}button:hover,.button:hover{filter:brightness(1.1)}.row{gap:12px}.mini-cover{height:auto;display:block;width:100%;max-height:340px;object-fit:cover;aspect-ratio:2.6;border-radius:8px;margin:24px 0 32px}@media(max-width:740px){header,main,footer{padding:20px}h1{font-size:2.5rem;max-width:16ch}main{padding-top:24px}.lede{font-size:18px}.mini-cover{aspect-ratio:1.7;max-height:none}}
header{gap:16px 24px}header nav{gap:8px 20px}header nav a{display:inline-flex;align-items:center;min-height:44px;white-space:nowrap}header nav a[aria-current]{color:var(--accent);text-decoration-thickness:2px}.composition-home{white-space:nowrap;line-height:1.2}.composition-home span{display:block;font:13px/1.5 system-ui;color:var(--muted);margin-top:4px}h1{max-width:24ch;font-size:clamp(2.5rem,4.5vw,3.5rem);text-wrap:balance}header .app-tools{margin-left:auto;flex-wrap:nowrap}.detail-media{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:contain;background:var(--surface);border-radius:8px}.app-tools kbd{display:none}@media(max-width:1100px){header{align-items:flex-start}header nav{order:3;width:100%}}@media(max-width:600px){header,main,footer{padding:18px 20px}header{gap:12px}header .app-tools{width:100%;margin-left:0;justify-content:flex-start;gap:8px;flex-wrap:wrap}header .app-tools a{display:none}header>a:not(.composer-return--secondary){width:auto}header nav{gap:8px 18px}header nav a{font-size:14px}main{padding-top:24px}.gallery{gap:24px}}
.about-app{margin:40px 0 12px;border-top:1px solid var(--border);padding-top:20px}.about-app summary{cursor:pointer;font-weight:600;min-height:44px;padding:8px 0}.gallery-controls{display:flex;gap:20px;max-width:760px;margin:28px 0 0}.gallery-controls label{flex:1;font-size:14px;margin:0}.gallery-controls input,.gallery-controls select{margin-bottom:12px;max-width:none}.gallery-empty{min-height:40px}.link-preview{min-height:180px;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:28px;background:var(--surface);border-radius:8px;overflow-wrap:anywhere}.link-preview span{font-size:13px;color:var(--muted)}.link-preview strong{font:500 22px/1.3 Space,system-ui}.gallery a:focus-visible{display:block}@media(max-width:600px){.gallery-controls{flex-direction:column;gap:8px}}
.collection-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.08fr);gap:clamp(28px,5vw,64px);align-items:center;padding:20px 0 48px;border-bottom:1px solid var(--border)}.collection-copy{min-width:0}.collection-kicker{font:600 13px/1.5 Space,system-ui;letter-spacing:.06em;color:var(--accent);margin:0 0 18px}.collection-hero h1{font-size:clamp(2.5rem,4.6vw,4.4rem);line-height:1.04;max-width:14ch;margin:0 0 24px;overflow-wrap:anywhere}.collection-hero .lede{font-size:clamp(18px,1.5vw,21px);margin:0 0 24px;line-height:1.55}.collection-hero figure{margin:0;min-width:0}.collection-art{display:block;width:100%;height:auto;aspect-ratio:3/2;border-radius:6px}.collection-hero figcaption{font-size:12px;color:var(--muted);margin-top:10px}.collection-actions{display:flex;gap:12px 20px;align-items:center;flex-wrap:wrap}.collection-actions>a:not(.button){display:inline-flex;align-items:center;min-height:44px;font-size:14px}.collection-note{font-size:13px;color:var(--muted);margin:16px 0 0}.collection-heading{display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-top:36px}.collection-heading h2{margin:0;font-size:24px}.collection-heading p{margin:0;font-size:14px;color:var(--muted)}.collection-section{scroll-margin-top:24px}.collection-context{padding:20px 0 0;border-top:1px solid var(--border);font-size:14px;color:var(--muted)}.collection-context p{max-width:74ch}.collection-context a{color:var(--fg)}.collection-section .gallery-controls{margin-top:20px}.collection-section .gallery{margin-top:24px}.collection-empty{padding:32px;background:var(--surface);border:1px solid var(--border);border-radius:8px;grid-column:1/-1}.collection-empty h3{margin:0 0 12px}.collection-empty p{margin:0}
@media(max-width:820px){.collection-hero{grid-template-columns:1fr;gap:28px;padding-top:12px;padding-bottom:28px}.collection-hero h1{max-width:20ch;font-size:clamp(2.5rem,7vw,3.8rem)}.collection-hero .lede{max-width:52ch}.collection-hero figure{max-width:680px}.collection-heading{align-items:flex-start;flex-direction:column;gap:8px;margin-top:28px}.collection-empty{padding:24px}}
h1,h2,h3,p,header>a:first-child{overflow-wrap:anywhere}header>a:first-child{min-width:0}
.postcard-workbench{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px;align-items:start}.postcard-workbench fieldset{min-width:0;margin:0}.postcard-workbench form{margin:0}.postcard-workbench input,.postcard-workbench textarea{max-width:none;margin-bottom:8px}.postcard-workbench .small{margin-top:0}.postcard-preview{margin:0;position:sticky;top:24px}.postcard-preview canvas{display:block;width:100%;height:auto;border-radius:8px}.postcard-preview figcaption{font-size:13px;color:var(--muted);margin-top:12px}.postcard-consent{display:flex;align-items:flex-start;gap:12px}.postcard-consent input{width:20px;height:20px;flex:none;margin-top:3px}.postcard-workbench button:disabled{opacity:.6;cursor:wait}#postcard-status{min-height:48px;overflow-wrap:anywhere}@media(max-width:820px){.postcard-workbench{grid-template-columns:1fr;gap:28px}.postcard-preview{position:static}.postcard-workbench fieldset{padding:16px}}

`;
export function html(
  title: string,
  body: string,
  base: string,
  kind: string,
  theme = "daylight",
  description = "Independent mini-app. Original source, your configuration.",
  publicOrigin = "https://example.invalid",
  pagePath = "/",
  mediaOrigin = publicOrigin,
  brandTitle = title,
) {
  const origin = new URL(publicOrigin).origin;
  const canonical = origin + base + (pagePath === "/" ? "/" : pagePath);
  const themeKey = base ? "composer-theme" : kind + ":reader-theme";
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );
  return new Response(
    `<!doctype html><html lang="en" data-app="${kind}" data-theme-key="${themeKey}" data-theme="${theme === "midnight" ? "dark" : "light"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(canonical)}">${pagePath === "/owner" ? '<meta name="robots" content="noindex,nofollow">' : ""}<meta name="theme-color" content="#17181b"><script nonce="${nonce}">try{const saved=localStorage.getItem(${JSON.stringify(themeKey)});if(saved==="light"||saved==="dark")document.documentElement.dataset.theme=saved;}catch{}</script><link rel="preload" href="${base}/brand/space.woff2" as="font" type="font/woff2" crossorigin><link rel="icon" href="${base}/brand/mark.svg"><link rel="apple-touch-icon" href="${base}/brand/icon.png"><meta property="og:type" content="website"><meta property="og:url" content="${escape(canonical)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${origin}${base}/brand/guestbook-share-v2.jpg"><meta name="twitter:image:alt" content="A magpie on an orange letterbox with illustrated coastal and city postcards."><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="${origin}${base}/brand/guestbook-share-v2.jpg"><meta property="og:image:alt" content="A magpie on an orange letterbox with illustrated coastal and city postcards."><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:type" content="image/jpeg"><link rel="stylesheet" href="${base}/brand/navigation.css"><style>${style.replaceAll("url('/brand/", `url('${base}/brand/`)}</style></head><body class="${escape(theme)}"><a class="skip" href="#main">Skip to content</a><header>${base ? `<a class="composer-return composition-home" href="/"><img src="${base}/brand/mark.svg" width="28" height="28" alt=""><span><span class="composer-name">App Composer</span><span class="composer-context">Photo collection</span></span></a>` : `<a href="/"><strong>${escape(brandTitle)}</strong></a>`}${base ? "" : `<a class="composer-return composer-return--secondary" href="https://composer.loftwah.com/"><img src="${base}/brand/mark.svg" width="28" height="28" alt=""><span>App Composer</span></a>`}<nav aria-label="${base ? "Collection navigation" : "App navigation"}">${base ? `<a href="/guestbook/" ${kind === "guestbook" ? 'aria-current="page"' : ""}>Guestbook</a><a href="/showcase/" ${kind === "showcase" ? 'aria-current="page"' : ""}>Linkarooie</a>` : '<a href="https://composer.loftwah.com/demo">Try the composition</a>'}<a href="${base}/owner">Owner studio</a></nav><div class="app-tools"><a href="https://composer.loftwah.com/apps">All apps</a><button type="button" class="secondary" data-open-apps aria-haspopup="dialog" title="Apps and shortcuts (Ctrl/Cmd+K)"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>Apps <kbd>⌘K / Ctrl K</kbd></button><button type="button" class="secondary" id="reader-theme">Light mode</button></div></header><dialog id="app-navigation" aria-labelledby="app-navigation-title"><div class="dialog-heading"><h2 id="app-navigation-title">Apps and shortcuts</h2><button type="button" data-close-apps>Close</button></div><label>Find an app or task<input type="search" placeholder="App name, Get Ready, Init…" autocomplete="off"></label><p role="status" aria-live="polite"></p><ul><li data-destination><a href="${base ? "/guestbook/" : "https://guestbook.loftwah.com"}"><img src="${base}/brand/apps/guestbook-small-v2.webp" width="40" height="40" alt=""><span>Here / there<small>Photo guestbook</small></span></a></li><li data-destination><a href="${base ? "/showcase/" : "https://showcase.loftwah.com"}"><img src="${base}/brand/apps/showcase-small-v2.webp" width="40" height="40" alt=""><span>Linkarooie<small>Curated collection</small></span></a></li><li data-destination><a href="https://share.loftwah.com"><img src="${base}/brand/apps/linkcheck-small-v1.webp" width="40" height="40" alt=""><span>Link Check<small>SEO and sharing</small></span></a></li><li data-destination><a href="https://ready.loftwah.com"><img src="${base}/brand/apps/hello-small-v1.webp" width="40" height="40" alt=""><span>Hello World<small>Deployment reference</small></span></a></li><li data-destination><a href="https://ai.loftwah.com"><img src="${base}/brand/apps/state-small-v1.webp" width="40" height="40" alt=""><span>Portable AI State<small>Fictional encrypted assistant</small></span></a></li><li data-destination><a href="https://composer.loftwah.com/ready">Get Ready<small>Composer task</small></a></li><li data-destination><a href="https://composer.loftwah.com/init">Init<small>Composer task</small></a></li></ul></dialog><main id="main">${body.replaceAll("<script>", '<script nonce="' + nonce + '">')}${pagePath === "/" ? '<details class="about-app"><summary>About Here / there</summary><p>A photo guestbook for a community, event or personal collection. Browse approved moments, search captions and open an original contribution.</p><p>An invited owner uses the studio to upload, review, publish or hide photos and change the title, introduction, theme and layout. Photos stay private until approved. Linkarooie can feature approved contributions; hiding the source revokes both public views on the next request.</p><a href="https://composer.loftwah.com/init">Prepare your own configuration in Init</a></details>' : ""}</main><footer>Original mini-app by Loftwah · <a href="https://github.com/loftwah/app-composer-${kind}">Own the source</a> · Reviewed 14 October 2026</footer><script nonce="${nonce}" src="${base}/brand/navigation.js"></script><script type="module" src="${base}/brand/page-performance.mjs"></script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://static.cloudflareinsights.com/beacon.min.js; style-src 'self' 'unsafe-inline'; img-src 'self' ${new URL(mediaOrigin).origin}; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
      },
    },
  );
}
export function client(base: string, cookie: string) {
  return `<script>const base=${JSON.stringify(base)};const output=document.querySelector('main [role=status]');async function api(path,data){const res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const value=await res.json();if(!res.ok)throw new Error(value.error||'Request failed');return value;}function report(e){if(output)output.textContent=e.message||e;}document.querySelector('#login')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/login',{token:new FormData(e.target).get('token')});location.reload();}catch(e){report(e);}});document.querySelector('#logout')?.addEventListener('click',async()=>{try{await api('/api/logout',{});location.reload();}catch(e){report(e);}});document.querySelector('#config')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/config',Object.fromEntries(new FormData(e.target)));location.reload();}catch(e){report(e);}});</script>`;
}
export function configForm(c: Record<string, any>) {
  return `<form id="config"><fieldset><legend>Make it yours</legend><label>Title<input name="title" maxlength="80" value="${escape(c.title)}" required></label><label>Introduction<textarea name="intro" maxlength="240">${escape(c.intro)}</textarea></label><label>Theme<select name="theme"><option ${c.theme === "daylight" ? "selected" : ""}>daylight</option><option ${c.theme === "midnight" ? "selected" : ""}>midnight</option></select></label><label>Layout<select name="layout"><option ${c.layout === "grid" ? "selected" : ""}>grid</option><option ${c.layout === "editorial" ? "selected" : ""}>editorial</option></select></label><label>Guest contributions<select name="guestAccess"><option value="closed" ${c.guestAccess !== 'postcards' ? 'selected' : ''}>Closed</option><option value="postcards" ${c.guestAccess === 'postcards' ? 'selected' : ''}>Postcards with guest code</option></select></label><p class="small">The public puzzle code is hunter2. Guests can only send new pending postcards: 2 per connection per 15 minutes, 8 per day in total, with a 16-item review queue. Your owner credential stays separate.</p><button>Save configuration</button></fieldset></form>`;
}
export async function commonAPI(
  req: Request,
  env: BaseEnv,
  path: string,
  base: string,
  name: string,
) {
  if (req.method !== "POST") return null;
  if (
    req.headers.get("Origin") !== new URL(req.url).origin &&
    !req.headers.get("Authorization")
  )
    return error("Write origin is not authorised", 403);
  if (path === "/api/login") {
    if (await limited(req, env, "login", 10))
      return error("Too many attempts; try again in 15 minutes", 429);
    const b = await readJSON(req);
    if (!env.OWNER_API_TOKEN || b.token !== env.OWNER_API_TOKEN)
      return error("Owner credential was not accepted", 401);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Set-Cookie": await sessionCookie(env, name, base),
      },
    });
  }
  if (path === "/api/logout")
    return new Response("{}", {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Set-Cookie":
          name +
          "=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=" +
          (base || "/"),
      },
    });
  if (path === "/api/config") {
    if (!(await authorised(req, env, name)))
      return error("Owner sign-in required", 401);
    const b = await readJSON(req);
    if (b.guestAccess !== undefined && !['closed','postcards'].includes(b.guestAccess))
      return error('Choose closed or moderated guest postcards.');
    const c = {
      ...(b.guestAccess === undefined ? {} : {guestAccess:b.guestAccess}),
      title: text(b.title, 80),
      intro: text(b.intro),
      theme: ["daylight", "midnight"].includes(b.theme) ? b.theme : "daylight",
      layout: ["grid", "editorial"].includes(b.layout) ? b.layout : "grid",
    };
    await env.DB.prepare(
      "INSERT INTO settings(id,value) VALUES('config',?) ON CONFLICT(id) DO UPDATE SET value=json_patch(settings.value,excluded.value)",
    )
      .bind(JSON.stringify(c))
      .run();
    return json({ ok: true, config: c });
  }
  return null;
}
export function login() {
  return `<h1>Owner studio</h1><p>This is the private owner entrance. Guest codes do not work here. The private owner credential grants moderation and configuration access; it is never included in a portable spec.</p><form id="login"><label>Owner credential<input name="token" type="password" autocomplete="current-password" required></label><button>Sign in securely</button></form><p role="status" class="message" aria-live="polite"></p>`;
}
