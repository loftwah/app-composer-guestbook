import {health,publish,pageEvent,postcardReceiptEvent,type PublisherEnv} from "./publisher.mjs";
import {
  authorised,
  basePath,
  client,
  commonAPI,
  configForm,
  error,
  escape,
  html,
  json,
  limited,
  login,
  readJSON,
  settings,
  text,
  type BaseEnv,
} from "./common.ts";
import { sanitisePNG } from "./png.ts";
import {guestDefaults, submitPostcard} from "./guest.ts";
import { resourceEnabled, resourceRoutes, type ResourceEnv } from './resources.ts';
interface Env extends BaseEnv, PublisherEnv, ResourceEnv {
  MEDIA: R2Bucket;
  ASSETS?: Fetcher;
}
const defaults = {
  ...guestDefaults,
  title: "Here / there",
  intro:
    "Leave a little piece of where you are. A photo guestbook for moments worth keeping.",
  theme: "daylight",
  layout: "grid",
};
function item(p: any, origin: string, base: string) {
  return {
    contract: 1,
    provider: "guestbook",
    id: p.id,
    revision: p.revision,
    title: p.caption,
    description: p.author,
    visibility: "public",
    url: origin + base + "/item/" + p.id,
    image: origin + base + "/media/" + p.id,
    synthetic: !!p.synthetic,
  };
}
const app = {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const u = new URL(req.url),
        base = basePath(u, "guestbook"),
        path = u.pathname.slice(base.length) || "/";
      const owner = await authorised(req, env, "guestbook_session");
      const resource = await resourceRoutes(req, env, base, path, BUILD_SHA);
      if (resource) return resource;
      const common = await commonAPI(req, env, path, base, "guestbook_session");
      if (common) return common;
      if (path === "/api/guest-postcard" && req.method === "POST")
        return await submitPostcard(req, env);
      if (path === "/build.json")
        return json({
          app: "guestbook",
          revision: BUILD_SHA,
          contract: 1,
          dataVersion: 1,
          resourceContract: 1,
          resourcesEnabled: resourceEnabled(env),
          resourceAccount: env.RESOURCE_ACCOUNT_ID ?? null,
          resourceEnvironment: env.RESOURCE_ENVIRONMENT ?? null,
        });
      if (path === "/app.manifest.json") return json(MANIFEST);
      if (path === "/api/items" && req.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM photos WHERE status='approved' ORDER BY created_at DESC LIMIT 100",
        ).all();
        return json({
          contract: 1,
          provider: "guestbook",
          items: results.map((p) => item(p, u.origin, base)),
        });
      }
      const match = path.match(/^\/api\/items\/([a-zA-Z0-9-]{1,64})$/);
      if (match && req.method === "GET") {
        const p = await env.DB.prepare(
          "SELECT * FROM photos WHERE id=? AND status='approved'",
        )
          .bind(match[1])
          .first();
        return p
          ? json(item(p, u.origin, base))
          : error("This contribution is not public", 404);
      }
      const media = path.match(/^\/media\/([a-zA-Z0-9-]{1,64})$/);
      if (media && req.method === "GET") {
        const p = await env.DB.prepare("SELECT status FROM photos WHERE id=?")
          .bind(media[1])
          .first<{ status: string }>();
        if (!p || p.status === "deleted" || (p.status !== "approved" && !owner))
          return error("This image is not available", 404);
        const object = await env.MEDIA.get("photos/" + media[1] + ".png");
        if (!object) return error("Image unavailable", 404);
        return new Response(object.body, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "private, no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (path === "/api/upload" && req.method === "POST") {
        if (!owner)
          return error(
            "This gallery accepts invited owner submissions only",
            401,
          );
        if (
          req.headers.get("Origin") !== u.origin &&
          !req.headers.get("Authorization")
        )
          return error("Write origin is not authorised", 403);
        if (await limited(req, env, "upload", 20))
          return error("Upload limit reached; try again in 15 minutes", 429);
        const s = await settings(env, defaults);
        if (s.submissionsPaused)
          return error("Submissions are paused by the owner", 403);
        const count = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM photos WHERE status!='deleted'",
        ).first<{ n: number }>();
        if ((count?.n ?? 200) >= 200)
          return error(
            "Gallery storage cap reached; delete unwanted contributions first",
            429,
          );
        if (Number(req.headers.get("Content-Length") ?? 0) > 1400000)
          return error("Upload is too large", 413);
        const raw = await readJSON(req, 1400000);
        if (raw.consent !== true)
          return error("Confirm you have permission to share this image");
        const caption = text(raw.caption, 160),
          author = text(raw.author ?? "", 60);
        if (!caption) return error("Add an image description");
        const b64 = text(raw.png, 1400000);
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const cleaned = await sanitisePNG(bytes);
        const id = crypto.randomUUID();
        await env.MEDIA.put("photos/" + id + ".png", cleaned.bytes, {
          httpMetadata: { contentType: "image/png" },
        });
        try {
          await env.DB.prepare(
            "INSERT INTO photos(id,caption,author,status) VALUES(?,?,?,'pending')",
          )
            .bind(id, caption, author)
            .run();
        } catch (e) {
          await env.MEDIA.delete("photos/" + id + ".png");
          throw e;
        }
        return json(
          {
            id,
            status: "pending",
            message:
              "Submitted privately. Owner approval is required before publication.",
          },
          201,
        );
      }
      if (path === "/api/moderate" && req.method === "POST") {
        if (!owner) return error("Owner sign-in required", 401);
        if (
          req.headers.get("Origin") !== u.origin &&
          !req.headers.get("Authorization")
        )
          return error("Write origin is not authorised", 403);
        const b = await readJSON(req);
        const id = text(b.id, 64),
          status = text(b.status, 20);
        if (!["approved", "hidden", "rejected", "deleted"].includes(status))
          return error("Unknown moderation action");
        const p = await env.DB.prepare("SELECT * FROM photos WHERE id=?")
          .bind(id)
          .first();
        if (!p || p.status === "deleted")
          return error("Contribution is unavailable", 404);
        const changed = await env.DB.prepare(
          "UPDATE photos SET status=?,revision=revision+1 WHERE id=? AND revision=? RETURNING id",
        )
          .bind(status, id, p.revision)
          .first();
        if (!changed)
          return error(
            "Contribution changed during moderation. Refresh before retrying.",
            409,
          );
        if (status === "deleted")
          await env.MEDIA.delete("photos/" + id + ".png");
        return json({ id, status });
      }
      if (path === "/api/pause" && req.method === "POST") {
        if (!owner) return error("Owner sign-in required", 401);
        if (
          req.headers.get("Origin") !== u.origin &&
          !req.headers.get("Authorization")
        )
          return error("Write origin is not authorised", 403);
        const b = await readJSON(req);
        await env.DB.prepare(
          "INSERT INTO settings(id,value) VALUES('config',?) ON CONFLICT(id) DO UPDATE SET value=json_patch(settings.value,excluded.value)",
        )
          .bind(JSON.stringify({ submissionsPaused: !!b.paused }))
          .run();
        return json({ ok: true });
      }
      if (path === "/api/export" && req.method === "GET") {
        if (!owner) return error("Owner sign-in required", 401);
        const { results } = await env.DB.prepare("SELECT * FROM photos").all();
        return json({
          contract: 1,
          dataVersion: 1,
          config: await settings(env, defaults),
          items: results,
          mediaPolicy:
            "Private R2; export media separately through an authorised owner request.",
        });
      }
      const config = await settings(env, defaults);
      if (path === "/owner") {
        if (!owner)
          return html(
            String(config.title),
            login() + client(base, "guestbook_session"),
            base,
            "guestbook",
            String(config.theme),
            String(config.intro),
            env.PUBLIC_ORIGIN,
            path,
          );
        const { results } = await env.DB.prepare(
          "SELECT * FROM photos WHERE status!='deleted' ORDER BY created_at DESC LIMIT 100",
        ).all();
        return html(
          String(config.title),
          `<h1>The guestbook studio.</h1><p>Approval makes a contribution public. Hiding or deletion revokes all controlled media and Showcase paths on the next request. Downloaded copies cannot be recalled.</p><div class="row"><button id="logout" class="secondary">Sign out</button><a href="${base}/api/export">Export gallery metadata</a></div><p role="status" aria-live="polite" class="message"></p>${configForm(config)}<p>Guest postcards: ${config.guestAccess === "postcards" ? (config.submissionsPaused ? "paused" : "open, pending approval") : "closed"}. The guest code never grants owner access.</p><h2>Add a moment</h2><form id="upload"><label>Image<input type="file" name="image" accept="image/*" required></label><p class="small">Your browser removes metadata and resizes to 1200 pixels. The server independently validates a PNG up to 1 MB.</p><label>Image description<input name="caption" maxlength="160" required></label><label>Name or alias (optional)<input name="author" maxlength="60"></label><label><input name="consent" type="checkbox" required style="display:inline;width:auto"> I have permission to publish this image.</label><button>Submit for review</button></form><h2>Review contributions</h2><div class="gallery">${results.map((p: any) => `<article><img src="${base}/media/${escape(p.id)}" alt="${escape(p.caption)}" loading="lazy"><h3>${escape(p.caption)}</h3><span class="badge">${escape(p.status)}</span><div class="row">${["approved", "hidden", "rejected", "deleted"].map((status) => `<button data-id="${escape(p.id)}" data-status="${status}" class="secondary">${({ approved: "Publish", hidden: "Hide", rejected: "Reject", deleted: "Delete" } as any)[status]}</button>`).join("")}</div></article>`).join("")}</div>${client(base, "guestbook_session")}<script>document.querySelectorAll('[data-status]').forEach(b=>b.addEventListener('click',async()=>{if(b.dataset.status==='deleted'&&!confirm('Delete the original photo? This cannot be undone.'))return;try{await api('/api/moderate',{id:b.dataset.id,status:b.dataset.status});location.reload();}catch(e){report(e);}}));document.querySelector('#upload').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const f=new FormData(e.target),file=f.get('image');if(file.size>10000000)throw new Error('Choose an image under 10 MB');const image=await createImageBitmap(file);const scale=Math.min(1,1200/image.width,1200/image.height),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const png=canvas.toDataURL('image/png').split(',')[1];image.close();const v=await api('/api/upload',{png,caption:f.get('caption'),author:f.get('author'),consent:f.has('consent')});output.textContent=v.message;e.target.reset();}catch(e){report(e);}finally{button.disabled=false;}});</script>`,
          base,
          "guestbook",
          String(config.theme),
          String(config.intro),
          env.PUBLIC_ORIGIN,
          path,
        );
      }
      if (path === "/contribute") {
        const open = config.guestAccess === 'postcards' && !config.submissionsPaused;
        return html(String(config.title), `<a href="${base || '/'}">Back to the guestbook</a><h1>Leave a postcard.</h1>${open ? `<p>A small message for this corner of the internet. It stays private until the owner approves it.</p><div class="postcard-workbench"><form id="guest-postcard" method="post" action="${base}/api/guest-postcard"><fieldset><legend>Your postcard</legend><label>Guest code<input name="code" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="32" required aria-describedby="code-hint"></label><p id="code-hint" class="small">An old internet password joke. The browser console has a clue.</p><label>Your message<textarea name="caption" maxlength="160" rows="4" required aria-describedby="message-limit"></textarea></label><p id="message-limit" class="small">Up to 160 characters. Leave out private contact details.</p><label>Name or alias (optional)<input name="author" maxlength="60" autocomplete="off"></label><label class="postcard-consent"><input name="consent" type="checkbox" required> I wrote this and agree that the owner may publish my postcard and alias.</label><button disabled>Send for approval</button><noscript><p>JavaScript is needed to prepare the postcard image. Nothing is submitted without it.</p></noscript></fieldset><p id="postcard-status" role="status" aria-live="polite" tabindex="-1"></p></form><figure class="postcard-preview"><canvas id="postcard-canvas" width="1200" height="900" aria-hidden="true"></canvas><figcaption>Postcard preview. Your message and alias above are included in the submitted image.</figcaption></figure></div><script src="${base}/brand/guest-postcard.js" defer></script>` : '<p>Guest postcards are closed for now. You can still browse the approved collection.</p>'}`, base, 'guestbook', String(config.theme), 'Send a postcard for owner approval.', env.PUBLIC_ORIGIN, path);
      }
      const detail = path.match(/^\/item\/([a-zA-Z0-9-]{1,64})$/);
      if (detail) {
        const p = await env.DB.prepare(
          "SELECT * FROM photos WHERE id=? AND status='approved'",
        )
          .bind(detail[1])
          .first<any>();
        if (!p)
          return html(
            "This postcard is not available",
            `<h1>This postcard is not available</h1><p>It is unpublished, private or has been removed.</p><p><a href="${base || "/"}">Back to the collection</a></p>`,
            base,
            "guestbook",
            String(config.theme),
            "This contribution is unpublished, private or has been removed.",
            env.PUBLIC_ORIGIN,
            path,
            env.PUBLIC_ORIGIN,
            String(config.title),
            404,
          );
        return html(
          p.caption,
          `<a href="${base || "/"}">Back to the guestbook</a><h1>${escape(p.caption)}</h1><img class="detail-media" src="${base}/media/${escape(p.id)}" alt="${escape(p.caption)}" width="1200" height="900"><p>${escape(p.author)}${p.synthetic ? " · Original illustrative demo artwork" : ""}</p>`,
          base,
          "guestbook",
          String(config.theme),
          p.caption,
          env.PUBLIC_ORIGIN,
          path,
          env.PUBLIC_ORIGIN,
          String(config.title),
        );
      }
      if (path === "/") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM photos WHERE status='approved' ORDER BY created_at DESC LIMIT 100",
        ).all();
        const postcardsOpen = config.guestAccess === "postcards" && !config.submissionsPaused;
        const published = results.length > 0;
        const heroActions = published
          ? `<a class="button" href="#collection">Explore the moments</a>${postcardsOpen ? `<a href="${base}/contribute">Know the guest code? Leave a postcard</a>` : `<a href="${base}/owner">Owner studio</a>`}`
          : `<a class="button" href="${postcardsOpen ? `${base}/contribute` : `${base}/owner`}">${postcardsOpen ? "Leave the first postcard" : "Open the owner studio"}</a>${postcardsOpen ? `<a href="${base}/owner">Owner studio</a>` : ""}`;
        const collectionNote = published
          ? "Contributions are reviewed before they become public."
          : postcardsOpen
            ? "Nothing is published yet. A postcard appears here once the owner approves it."
            : "Nothing is published yet. Postcards are closed, so no new contributions can be sent for now.";
        return html(
          String(config.title),
          `<section class="collection-hero" aria-labelledby="collection-title"><div class="collection-copy"><p class="collection-kicker">Here / there · Photo guestbook</p><h1 id="collection-title">${escape(config.title)}</h1><p class="lede">${escape(config.intro)}</p><div class="collection-actions">${heroActions}</div><p class="collection-note">${collectionNote}</p></div><figure><img class="collection-art" src="${base}/brand/herethere-art-v4-960.webp" srcset="${base}/brand/herethere-art-v4-480.webp 480w, ${base}/brand/herethere-art-v4-960.webp 960w" sizes="(max-width: 820px) calc(100vw - 40px), (max-width: 1248px) 50vw, 584px" width="960" height="960" fetchpriority="high" alt="An original animated-style illustration of a visitor station: a tall alien pins a postcard onto a wall of contributions while a small robot carries a tall stack of cards."><figcaption>Original illustration for Here / there. The collection below holds the published items.</figcaption></figure></section><section class="collection-section" id="collection" aria-labelledby="moments-title"><div class="collection-heading"><h2 id="moments-title">From the guestbook</h2>${published ? "<p>A place, a face, a little piece of the day.</p>" : ""}</div>${results.length > 1 ? `<div class="gallery-controls"><label>Find in this collection<input id="gallery-search" type="search" placeholder="Caption, title or alias" autocomplete="off"></label></div><p id="gallery-count" class="small" role="status" aria-live="polite"></p><p id="gallery-empty" class="gallery-empty" hidden>No items match. Try another search.</p>` : ""}<div class="gallery ${escape(config.layout)}">${results.map((p: any) => `<article data-gallery-item><a href="${base}/item/${escape(p.id)}"><img src="${base}/media/${escape(p.id)}" alt="${escape(p.caption)}" width="1200" height="900" loading="lazy"><h3>${escape(p.caption)}</h3></a><p>${escape(p.author)} ${p.synthetic ? '<span class="badge">Demo artwork</span>' : ""}</p></article>`).join("") || `<div class="collection-empty"><h3>No published moments yet</h3><p>The owner reviews each contribution before it appears here.${postcardsOpen ? " Anyone with the guest code can send a postcard now." : " Postcards are closed for now."}</p>${postcardsOpen ? `<p><a class="button" href="${base}/contribute">Leave a postcard</a></p>` : ""}</div>`}</div></section><aside class="collection-context"><p>For a birthday, a neighbourhood or the places you want to remember. The owner chooses what is shared. An approved moment can also appear in <a href="${base ? "/showcase/" : "https://showcase.loftwah.com/"}">Linkarooie</a>; hiding it here removes it from both public views.</p></aside>${config.guestAccess === 'postcards' && !config.submissionsPaused ? `<script>console.info('  [ postcard ]\\nGuestbook discovery: hunter2 → ${base}/contribute\\nA guest code sends a pending postcard. Your owner credential stays private.');</script>` : ''}`,
          base,
          "guestbook",
          String(config.theme),
          String(config.intro),
          env.PUBLIC_ORIGIN,
          path,
        );
      }
      if (env.ASSETS)
        return env.ASSETS.fetch(new Request(u.origin + path, req));
      return error("Page not found", 404);
    } catch (e) {
      return error(e instanceof Error ? e.message : "Request failed", 400);
    }
  },
} satisfies ExportedHandler<Env>;
declare const BUILD_SHA: string;
declare const MANIFEST: unknown;

export default {async fetch(req:Request,env:Env,context:ExecutionContext){
 const base=basePath(new URL(req.url),"guestbook");
 const probe=health(req,base+'/healthz',"guestbook",BUILD_SHA);if(probe)return probe;
 const response=await app.fetch(req,env);const event=postcardReceiptEvent(req,response,base)??pageEvent(req,response,base);
 if(event)publish(env,context,req,event);return response;
}} satisfies ExportedHandler<Env>;
