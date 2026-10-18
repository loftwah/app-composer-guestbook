import { error, escape, html, json, limited, readJSON, text } from './common.ts';
import { resourceConfiguration, object, type ResourceConfiguration } from './resource-config.ts';
import { sanitisePNG } from './png.ts';
import { lineageEligibleSQL, lineageMediaAllowed, resourceRestoreEligibleSQL } from './resource-lineage.ts';
import { resourceEnabled, resourceMediaKey, type ResourceEnv, type ResourceRow } from './resources.ts';

interface PublicResource extends ResourceRow {
  config_json: string;
  config_revision: number;
  current_config: string;
}
interface ResourceItem {
  id: string;
  caption: string;
  author: string;
  revision: number;
  synthetic: number;
}
const itemView = (item: ResourceItem, url: URL, base: string, resource: PublicResource) => ({
  contract: 1,
  provider: 'guestbook',
  resource: resource.id,
  id: item.id,
  revision: item.revision,
  title: item.caption,
  description: item.author,
  visibility: 'public',
  url: `${url.origin}${base}/r/${resource.id}/c/${resource.config_revision}/item/${item.id}`,
  image: `${url.origin}${base}/r/${resource.id}/media/${item.id}`,
  synthetic: Boolean(item.synthetic),
});

async function submitResourcePostcard(req: Request, env: ResourceEnv, resource: PublicResource, current: ResourceConfiguration): Promise<Response> {
  if (req.headers.get('Origin') !== new URL(req.url).origin) return error('Open this guestbook before sending a postcard.', 403);
  if (current.guestAccess !== 'postcards' || resource.paused) return error('Guest postcards are closed for now.', 403);
  if (await limited(req, env, `resource:${resource.id}:guest-attempt`, 6)) return error('Too many attempts. Keep your message and try later.', 429);
  const raw: unknown = await readJSON(req, 150000);
  if (!object(raw) || Object.keys(raw).length !== 5 || Object.keys(raw).some(key => !['code', 'caption', 'author', 'consent', 'png'].includes(key))) return error('Send only the guest code, message, alias, consent and postcard image.');
  if (raw.code !== 'hunter2') return error('That guest code did not fit. Your message is still here.', 403);
  if (raw.consent !== true) return error('Confirm you want to submit this postcard for possible publication.');
  const caption = text(raw.caption, 160), author = text(raw.author, 60);
  if (!caption || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(caption + author)) return error('Write a short message using ordinary text.');
  if (typeof raw.png !== 'string' || raw.png.length > 140000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.png)) return error('The postcard image is too large or invalid.');
  const cleaned = await sanitisePNG(Uint8Array.from(atob(raw.png), char => char.charCodeAt(0)));
  if (cleaned.bytes.length > 100000 || cleaned.width > 1200 || cleaned.height > 900) return error('Use a postcard image up to 1200 × 900 pixels and 100 KB.');
  if (await limited(req, env, `resource:${resource.id}:guest-submit`, 2)) return error('Two postcards is enough for now. Keep your message and try later.', 429);
  const day = Math.floor(Date.now() / 86400000);
  const admitted = await env.DB.prepare('INSERT INTO rate_limits(id,n,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET n=n+1 WHERE n<8 RETURNING n')
    .bind(`resource:${resource.id}:guest-day:${day}`, (day + 1) * 86400000).first();
  if (!admitted) return error('Today’s postcard limit is reached. Keep your message and try tomorrow.', 429);
  const id = crypto.randomUUID(), key = resourceMediaKey(resource.id, id);
  let insertionAttempted = false;
  try {
    await env.MEDIA.put(key, cleaned.bytes, { httpMetadata: { contentType: 'image/png' } });
    // The current active configuration and safety controls are authoritative,
    // even when the visitor opened an older activated configuration URL.
    insertionAttempted = true;
    const inserted = await env.DB.prepare(`INSERT INTO guestbook_resource_items(id,resource_id,caption,author,status)
      SELECT ?,?,?,?,'pending' WHERE EXISTS(
        SELECT 1 FROM guestbook_resources r JOIN guestbook_resource_configs c ON c.resource_id=r.id AND c.revision=r.active_revision
        WHERE r.id=? AND r.visible=1 AND r.paused=0 AND json_extract(c.config_json,'$.guestAccess')='postcards')
      AND (SELECT COUNT(*) FROM guestbook_resource_items WHERE resource_id=? AND status='pending')<16
      AND (SELECT COUNT(*) FROM guestbook_resource_items WHERE resource_id=? AND status!='deleted')<200 RETURNING id`)
      .bind(id, resource.id, caption, author, resource.id, resource.id, resource.id).first();
    if (!inserted) {
      await env.MEDIA.delete(key);
      return error('This guestbook is closed or its review queue is full. Keep your message and try later.', 409);
    }
    return json({ id, resource: resource.id, status: 'pending', message: 'Your postcard is with the owner. It stays private unless they approve it.' }, 201);
  } catch {
    if (insertionAttempted) {
      try {
        const committed = await env.DB.prepare('SELECT id FROM guestbook_resource_items WHERE resource_id=? AND id=? AND caption=? AND author=?')
          .bind(resource.id, id, caption, author).first();
        if (committed) return json({ id, resource: resource.id, status: 'pending', message: 'Your postcard is with the owner. It stays private unless they approve it.' }, 201);
      } catch { /* An unavailable reconciliation read cannot prove rollback. */ }
      // A failed database acknowledgement may follow a committed insert. Keep
      // its private scoped object while the outcome is unknown; deleting it
      // would destroy a potentially accepted contribution.
      return json({ id, resource: resource.id, outcome: 'unknown', message: 'Your postcard may already be waiting for review. Keep your message and check before sending it again.' }, 503);
    }
    try { await env.MEDIA.delete(key); } catch { /* No item grants access to an uncommitted object. */ }
    return error('The postcard could not be stored. Keep your message and check before retrying.', 503);
  }
}

function contributionForm(resourceBase: string, assetBase: string) {
  return `<h1>Leave a postcard.</h1><p>Your message stays private until the owner approves it.</p>
    <form id="guest-postcard" method="post" action="${resourceBase}/api/guest-postcard"><fieldset><legend>Your postcard</legend>
    <label>Guest code<input name="code" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="32" required></label>
    <label>Your message<textarea name="caption" maxlength="160" rows="4" required></textarea></label>
    <label>Name or alias (optional)<input name="author" maxlength="60" autocomplete="off"></label>
    <label class="postcard-consent"><input name="consent" type="checkbox" required> I wrote this and agree that the owner may publish my postcard and alias.</label>
    <button disabled>Send for approval</button><noscript><p>JavaScript is needed to prepare your postcard image.</p></noscript></fieldset>
    <p id="postcard-status" role="status" aria-live="polite" tabindex="-1"></p></form>
    <figure class="postcard-preview"><canvas id="postcard-canvas" width="1200" height="900" aria-hidden="true"></canvas><figcaption>Postcard preview.</figcaption></figure>
    <script src="${assetBase}/brand/guest-postcard.js" defer></script>`;
}

export async function resourcePublicRoute(req: Request, env: ResourceEnv, base: string, path: string): Promise<Response> {
  try {
    if (!resourceEnabled(env)) return error('This guestbook is unavailable.', 404);
    const match = path.match(/^\/r\/([a-z0-9-]{6,64})(?:\/c\/([1-9][0-9]{0,9}))?(\/.*)?$/);
    if (!match) return error('This guestbook is unavailable.', 404);
    const id = match[1]!, revision = match[2] ? Number(match[2]) : null, tail = match[3] ?? '/';
    const row = await env.DB.prepare(`SELECT r.*,c.config_json,c.revision AS config_revision,a.config_json AS current_config
      FROM guestbook_resources r JOIN guestbook_resource_configs a ON a.resource_id=r.id AND a.revision=r.active_revision
      JOIN guestbook_resource_configs c ON c.resource_id=r.id AND c.revision=COALESCE(?,r.active_revision)
      WHERE r.id=? AND r.account_id=? AND r.environment=? AND r.visible=1 AND c.activated_at IS NOT NULL AND ${resourceRestoreEligibleSQL('r')}
        AND NOT EXISTS(SELECT 1 FROM guestbook_resource_items restored WHERE restored.resource_id=r.id AND restored.status!='deleted' AND NOT (${lineageEligibleSQL('restored')}))`)
      .bind(revision, id, env.RESOURCE_ACCOUNT_ID!, env.RESOURCE_ENVIRONMENT!).first<PublicResource>();
    if (!row) return error('This guestbook is unavailable.', 404);
    const config = resourceConfiguration(JSON.parse(row.config_json) as unknown);
    const current = resourceConfiguration(JSON.parse(row.current_config) as unknown);
    const resourceBase = `${base}/r/${id}`, publicBase = `${resourceBase}/c/${row.config_revision}`, url = new URL(req.url);
    if (tail === '/api/guest-postcard' && req.method === 'POST') return await submitResourcePostcard(req, env, row, current);
    if (req.method !== 'GET') return error('This public route is read-only.', 405);
    if (tail === '/' && revision === null) return new Response(null, { status: 302, headers: { Location: publicBase + '/', 'Cache-Control': 'no-store' } });
    const media = tail.match(/^\/media\/([a-z0-9-]{6,64})$/);
    if (media) {
      const item = await env.DB.prepare(`SELECT id FROM guestbook_resource_items i WHERE resource_id=? AND id=? AND status='approved' AND ${lineageEligibleSQL('i')}`).bind(id, media[1]!).first();
      const object = item ? await env.MEDIA.get(resourceMediaKey(id, media[1]!)) : null;
      return object && await lineageMediaAllowed(env, id, media[1]!, true) ? new Response(object.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) : error('This image is unavailable.', 404);
    }
    const detail = tail.match(/^\/(api\/items|item)\/([a-z0-9-]{6,64})$/);
    if (detail) {
      const item = await env.DB.prepare(`SELECT id,caption,author,revision,synthetic FROM guestbook_resource_items i WHERE resource_id=? AND id=? AND status='approved' AND ${lineageEligibleSQL('i')}`).bind(id, detail[2]!).first<ResourceItem>();
      if (!item) return error('This contribution is not public.', 404);
      if (detail[1] === 'api/items') return json(itemView(item, url, base, row));
      return html(item.caption, `<a href="${publicBase}/">Back to ${escape(config.title)}</a><h1>${escape(item.caption)}</h1><img class="detail-media" src="${resourceBase}/media/${item.id}" alt="${escape(item.caption)}" width="1200" height="900"><p>${escape(item.author)}</p>`, base, 'guestbook', config.theme, item.caption, url.origin, path, url.origin, config.title);
    }
    if (tail === '/contribute') {
      const open = current.guestAccess === 'postcards' && !row.paused;
      return html(config.title, `<a href="${publicBase}/">Back to ${escape(config.title)}</a>${open ? contributionForm(resourceBase, base) : '<h1>Postcards are closed</h1><p>You can still browse the approved collection.</p>'}`, base, 'guestbook', config.theme, 'Send a postcard for owner approval.', url.origin, path, url.origin, config.title);
    }
    const items = await env.DB.prepare(`SELECT id,caption,author,revision,synthetic FROM guestbook_resource_items i WHERE resource_id=? AND status='approved' AND ${lineageEligibleSQL('i')} ORDER BY created_at DESC,id LIMIT 100`).bind(id).all<ResourceItem>();
    if (tail === '/api/items') return json({ contract: 1, provider: 'guestbook', resource: id, items: items.results.map(item => itemView(item, url, base, row)) });
    if (tail !== '/') return error('Page not found.', 404);
    const open = current.guestAccess === 'postcards' && !row.paused;
    return html(config.title, `<h1>${escape(config.title)}</h1><p class="lede">${escape(config.intro)}</p>${open ? `<p><a class="button" href="${publicBase}/contribute">Leave a postcard</a></p>` : '<p>Guest postcards are closed for now.</p>'}
      <section aria-label="Published contributions"><div class="gallery ${config.layout}">${items.results.map(item => `<article><a href="${publicBase}/item/${item.id}"><img src="${resourceBase}/media/${item.id}" alt="${escape(item.caption)}" width="1200" height="900" loading="lazy"><h2>${escape(item.caption)}</h2></a><p>${escape(item.author)}${item.synthetic ? ' · Fictional demonstration' : ''}</p></article>`).join('') || '<p>No published moments yet. The owner reviews every contribution before it appears here.</p>'}</div></section>`,
      base, 'guestbook', config.theme, config.intro, url.origin, path, url.origin, config.title);
  } catch {
    return error('This guestbook could not be opened. Try again later.', 503);
  }
}
