import {error, json, limited, readJSON, settings, text, type BaseEnv} from './common.ts';
import {sanitisePNG} from './png.ts';

export const guestDefaults = {guestAccess: 'closed'};
// A public puzzle, never an owner credential. Authorisation is the route's narrow capability.
export const guestCode = 'hunter2';
type GuestEnv = BaseEnv & {MEDIA: R2Bucket};

export async function submitPostcard(req: Request, env: GuestEnv) {
  if (req.headers.get('Origin') !== new URL(req.url).origin)
    return error('Open the guestbook and send your postcard from there.', 403);
  const config = await settings(env, guestDefaults);
  if (config.guestAccess !== 'postcards' || config.submissionsPaused)
    return error('Guest postcards are closed for now.', 403);
  if (await limited(req, env, 'guest-attempt', 6))
    return error('Too many attempts. Keep your message and try again in 15 minutes.', 429);
  const raw = await readJSON(req, 150000);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== 5 || Object.keys(raw).some(key => !['code','caption','author','consent','png'].includes(key)))
    return error('Send only the guest code, message, alias, consent and postcard image.');
  if (raw.code !== guestCode) return error('That guest code did not fit. Your message is still here.', 403);
  if (raw.consent !== true) return error('Confirm you want to submit this postcard for possible publication.');
  const caption = text(raw.caption, 160), author = text(raw.author, 60);
  if (!caption || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(caption + author))
    return error('Write a short message using ordinary text.');
  if (typeof raw.png !== 'string' || raw.png.length > 140000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.png))
    return error('The postcard image is too large or invalid. Shorten the message and try again.');
  const cleaned = await sanitisePNG(Uint8Array.from(atob(raw.png), char => char.charCodeAt(0)));
  if (cleaned.bytes.length > 100000 || cleaned.width > 1200 || cleaned.height > 900)
    return error('Use a postcard image up to 1200 × 900 pixels and 100 KB.');
  if (await limited(req, env, 'guest-submit', 2))
    return error('Two postcards is enough for now. Keep this message and try again in 15 minutes.', 429);
  const day = Math.floor(Date.now() / 86400000);
  // Atomic admission caps all guests together. Failed storage attempts consume a slot, never retry themselves.
  const admission = await env.DB.prepare(
    'INSERT INTO rate_limits(id,n,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET n=n+1 WHERE n<8 RETURNING n',
  ).bind('guest-day:' + day, (day + 1) * 86400000).first();
  if (!admission) return error('Today’s postcard limit is reached. Keep your message and try tomorrow.', 429);
  const id = crypto.randomUUID(), key = 'photos/' + id + '.png';
  try {
    await env.MEDIA.put(key, cleaned.bytes, {httpMetadata: {contentType: 'image/png'}});
    // Recheck closure/pause and both collection bounds at commit, after the asynchronous upload.
    const inserted = await env.DB.prepare(`INSERT INTO photos(id,caption,author,status)
      SELECT ?,?,?,'pending' WHERE
      EXISTS(SELECT 1 FROM settings WHERE id='config' AND json_extract(value,'$.guestAccess')='postcards'
        AND COALESCE(json_extract(value,'$.submissionsPaused'),0)=0)
      AND (SELECT COUNT(*) FROM photos WHERE status='pending')<16
      AND (SELECT COUNT(*) FROM photos WHERE status!='deleted')<200 RETURNING id`)
      .bind(id, caption, author).first();
    if (!inserted) {
      await env.MEDIA.delete(key);
      return error('The guestbook is closed or its review queue is full. Keep your message and try later.', 409);
    }
  } catch {
    try { await env.MEDIA.delete(key); } catch { /* No database row exposes this generated key. */ }
    return error('The postcard could not be stored. Your message is still here; try again later.', 503);
  }
  return json({id, status:'pending', message:'Your postcard is with the owner. It stays private unless they approve it.'}, 201);
}
