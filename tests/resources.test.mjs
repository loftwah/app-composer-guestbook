import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import worker from '../src/worker.ts';

const source = 'a'.repeat(40), account = '1003dc1d93af0ebea56b2f1252f89627';
const workspace = 'fictional-workspace-0001';
const resourceA = 'fictional-resource-0001', resourceB = 'fictional-resource-0002';
const config = (title, patch = {}) => ({ title, intro: 'Fictional demonstration', theme: 'midnight', layout: 'grid', guestAccess: 'postcards', ...patch });

function png() {
  const crc = data => { let c = 0xffffffff; for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), check = Buffer.alloc(4); size.writeUInt32BE(data.length); check.writeUInt32BE(crc(body)); return Buffer.concat([size, body, check]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const postcard = caption => ({ code: 'hunter2', caption, author: 'Fictional visitor', consent: true, png: png() });

function fixture(base = '') {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of ['0001.sql', '0002_owned_resources.sql']) sqlite.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  const objects = new Map(), origin = 'https://guestbook.example.test';
  let beforeBatch, afterBatch;
  const statement = (sql, params = []) => ({ sql, params,
    bind(...values) { return statement(sql, values); },
    async first() { return sqlite.prepare(sql).get(...params) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...params) }; },
    async run() { const result = sqlite.prepare(sql).run(...params); return { success: true, meta: { changes: Number(result.changes) } }; },
  });
  const env = {
    DB: { prepare: statement, async batch(statements) {
      if (beforeBatch) await beforeBatch(statements);
      sqlite.exec('BEGIN IMMEDIATE');
      let results;
      try {
        results = statements.map(({ sql, params }) => ({ success: true, results: sqlite.prepare(sql).all(...params) }));
        sqlite.exec('COMMIT');
      } catch (failure) { sqlite.exec('ROLLBACK'); throw failure; }
      if (afterBatch) await afterBatch(statements);
      return results;
    } },
    OWNER_API_TOKEN: 'fictional-owner-token', PUBLIC_ORIGIN: origin,
    RESOURCE_ACCOUNT_ID: account, RESOURCE_ENVIRONMENT: 'production',
    MEDIA: {
      async put(key, bytes) { objects.set(key, bytes); },
      async delete(key) { objects.delete(key); },
      async get(key) { return objects.has(key) ? { body: new Blob([objects.get(key)]).stream() } : null; },
    },
  };
  globalThis.BUILD_SHA = source; globalThis.MANIFEST = { contract: 1, id: 'guestbook' };
  const request = (path, body, options = {}) => worker.fetch(new Request(origin + base + path, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': options.ip ?? '192.0.2.1',
      ...(options.owner === false ? {} : { Authorization: 'Bearer ' + env.OWNER_API_TOKEN }),
      'X-Composer-Workspace': workspace, 'X-Composer-Account': account,
      'X-Composer-Environment': 'production', 'X-Composer-Source': source,
      'X-Composer-Target': origin + base, ...options.headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, { waitUntil() {} });
  let next = 0;
  const command = async (id, action, fields = {}, options = {}) => {
    const response = await request('/api/resources/' + id, { action, operationId: 'fixture-operation-' + (++next), ...fields }, options);
    return { status: response.status, body: await response.json() };
  };
  const create = async (id, title) => {
    const created = await command(id, 'create'); assert.equal(created.status, 200, JSON.stringify(created.body));
    const staged = await command(id, 'stage', { expectedVersion: created.body.resource.version, configuration: config(title) }); assert.equal(staged.status, 200, JSON.stringify(staged.body));
    const active = await command(id, 'activate', { expectedVersion: staged.body.resource.version, configurationRevision: staged.body.configuration.revision, configurationDigest: staged.body.configuration.digest });
    assert.equal(active.status, 200, JSON.stringify(active.body));
    return active.body;
  };
  return { sqlite, env, objects, request, command, create,
    hooks(before, after) { beforeBatch = before; afterBatch = after; },
    close() { sqlite.close(); },
  };
}

for (const base of ['', '/guestbook']) test('two real resource scopes keep independent settings, contributions and media: ' + (base || 'standalone'), async () => {
  const f = fixture(base);
  try {
    const a = await f.create(resourceA, 'Fictional Trail Notes');
    const b = await f.create(resourceB, 'Fictional Launch Board');
    assert.deepEqual(a.configuration.values, config('Fictional Trail Notes'), 'reuse/reconciliation can inherit app-confirmed values without trusting a local override');
    const pageA = `/r/${resourceA}/c/${a.configuration.revision}`;
    const pageB = `/r/${resourceB}/c/${b.configuration.revision}`;
    assert.match(await (await f.request(pageA + '/', null, { owner: false })).text(), /Fictional Trail Notes/);
    assert.doesNotMatch(await (await f.request(pageB + '/', null, { owner: false })).text(), /Fictional Trail Notes/);
    const pending = await f.request(`/r/${resourceA}/api/guest-postcard`, postcard('Only resource A'), { owner: false });
    assert.equal(pending.status, 201); const item = await pending.json();
    assert.equal((await f.request(`/r/${resourceA}/media/${item.id}`, null, { owner: false })).status, 404);
    const moderated = await f.command(resourceA, 'moderate', { expectedVersion: a.resource.version, item: item.id, itemRevision: 1, status: 'approved' });
    assert.equal(moderated.status, 200);
    const foreignModeration = await f.command(resourceB, 'moderate', { expectedVersion: b.resource.version, item: item.id, itemRevision: 2, status: 'deleted' });
    assert.equal(foreignModeration.status, 409, 'an owner-selected resource cannot moderate an item in a different resource');
    assert.equal((await f.request(`/r/${resourceA}/media/${item.id}`, null, { owner: false })).status, 200);
    for (const path of [`/r/${resourceB}/media/${item.id}`, `/r/${resourceB}/c/${b.configuration.revision}/api/items/${item.id}`, `/media/${item.id}`, `/api/items/${item.id}`]) assert.equal((await f.request(path, null, { owner: false })).status, 404, path);
    assert.deepEqual((await (await f.request(pageB + '/api/items', null, { owner: false })).json()).items, []);
    assert.equal(f.objects.has(`resources/${resourceA}/photos/${item.id}.png`), true);
    assert.equal(f.objects.size, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM photos').get().n, 0);
    const changed = await f.command(resourceA, 'stage', { expectedVersion: moderated.body.resource.version, configuration: config('Changed A') });
    await f.command(resourceA, 'activate', { expectedVersion: changed.body.resource.version, configurationRevision: changed.body.configuration.revision, configurationDigest: changed.body.configuration.digest });
    assert.match(await (await f.request(`/r/${resourceA}/c/${changed.body.configuration.revision}/`, null, { owner: false })).text(), /Changed A/);
    assert.match(await (await f.request(pageB + '/', null, { owner: false })).text(), /Fictional Launch Board/);
    assert.match(await (await f.request(pageA + '/', null, { owner: false })).text(), /Fictional Trail Notes/, 'previously activated configuration identity stays immutable');
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('actual writes require exact app source, runtime account/environment, management target and workspace', async () => {
  const f = fixture();
  try {
    const a = await f.create(resourceA, 'Scoped A');
    const before = JSON.stringify(f.sqlite.prepare('SELECT * FROM guestbook_resources').all());
    for (const headers of [
      { 'X-Composer-Source': 'b'.repeat(40) }, { 'X-Composer-Account': 'other-account' },
      { 'X-Composer-Environment': 'preview' }, { 'X-Composer-Target': 'https://other.example.test' },
      { 'X-Composer-Workspace': 'foreign-workspace-0002' },
    ]) {
      const refused = await f.command(resourceA, 'stage', { expectedVersion: a.resource.version, configuration: config('Refused') }, { headers });
      assert.equal(refused.status, 403);
      assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM guestbook_resources').all()), before);
    }
    assert.equal((await f.command(resourceA, 'stage', { expectedVersion: a.resource.version, configuration: config('Refused') }, { owner: false })).status, 401);
    delete f.env.RESOURCE_ACCOUNT_ID;
    assert.equal((await f.command(resourceB, 'create')).status, 503);
    assert.equal((await f.request(`/r/${resourceA}/c/1/`, null, { owner: false })).status, 404);
  } finally { f.close(); }
});

test('staged configuration is private, atomic activation failures preserve the previous page and history', async () => {
  const f = fixture();
  try {
    const a = await f.create(resourceA, 'Published before');
    const staged = await f.command(resourceA, 'stage', { expectedVersion: a.resource.version, configuration: config('PRIVATE STAGED TITLE') });
    assert.equal((await f.request(`/r/${resourceA}/c/${staged.body.configuration.revision}/`, null, { owner: false })).status, 404);
    f.sqlite.exec("CREATE TRIGGER fail_activate BEFORE UPDATE OF active_revision ON guestbook_resources BEGIN SELECT RAISE(ABORT,'injected private diagnostic'); END;");
    const failed = await f.command(resourceA, 'activate', { expectedVersion: staged.body.resource.version, configurationRevision: staged.body.configuration.revision, configurationDigest: staged.body.configuration.digest });
    assert.equal(failed.status, 503); assert.equal(failed.body.outcome, 'unknown'); assert.doesNotMatch(JSON.stringify(failed.body), /private diagnostic/);
    assert.equal(f.sqlite.prepare('SELECT version,active_revision FROM guestbook_resources WHERE id=?').get(resourceA).active_revision, a.configuration.revision);
    assert.equal(f.sqlite.prepare('SELECT activated_at FROM guestbook_resource_configs WHERE resource_id=? AND revision=?').get(resourceA, staged.body.configuration.revision).activated_at, null);
    assert.doesNotMatch(await (await f.request(`/r/${resourceA}/c/${a.configuration.revision}/`, null, { owner: false })).text(), /PRIVATE STAGED TITLE/);
    f.sqlite.exec('DROP TRIGGER fail_activate;');
    const activated = await f.command(resourceA, 'activate', { expectedVersion: staged.body.resource.version, configurationRevision: staged.body.configuration.revision, configurationDigest: staged.body.configuration.digest });
    assert.equal(activated.status, 200);
    assert.match(await (await f.request(`/r/${resourceA}/c/${staged.body.configuration.revision}/`, null, { owner: false })).text(), /PRIVATE STAGED TITLE/);
  } finally { f.close(); }
});

test('operation receipts reconcile a lost acknowledgement, bound retries and reject changed payloads', async () => {
  const f = fixture();
  try {
    const a = await f.create(resourceA, 'A');
    let failed = false;
    f.hooks(null, async () => { if (!failed) { failed = true; throw Error('connection lost after commit'); } });
    const command = { action: 'stage', operationId: 'lost-acknowledgement-0001', expectedVersion: a.resource.version, configuration: config('Saved remotely') };
    const result = await f.request('/api/resources/' + resourceA, command);
    assert.equal(result.status, 503); assert.equal((await result.json()).outcome, 'unknown');
    f.hooks(null, null);
    const reconciled = await (await f.request(`/api/resources/${resourceA}?operation=${command.operationId}`)).json();
    assert.equal(reconciled.recorded, true); assert.equal(reconciled.current.version, a.resource.version + 1);
    const retry = await f.request('/api/resources/' + resourceA, command);
    assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), reconciled.result);
    const mismatch = await f.request('/api/resources/' + resourceA, { ...command, configuration: config('Different payload') });
    assert.equal(mismatch.status, 409);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM guestbook_resource_configs WHERE resource_id=?').get(resourceA).n, 2);
  } finally { f.close(); }
});

test('competing stages and stale activation cannot overwrite the winning candidate', async () => {
  const f = fixture();
  try {
    const a = await f.create(resourceA, 'A');
    let raced = false;
    f.hooks(async () => {
      if (!raced) { raced = true; assert.equal((await f.command(resourceA, 'stage', { expectedVersion: a.resource.version, configuration: config('Winner') })).status, 200); }
    });
    const loser = await f.command(resourceA, 'stage', { expectedVersion: a.resource.version, configuration: config('Loser') });
    assert.equal(loser.status, 409);
    const candidates = f.sqlite.prepare('SELECT * FROM guestbook_resource_configs WHERE resource_id=? ORDER BY revision').all(resourceA);
    assert.equal(candidates.length, 2); assert.equal(JSON.parse(candidates[1].config_json).title, 'Winner');
    const stale = await f.command(resourceA, 'activate', { expectedVersion: a.resource.version, configurationRevision: a.configuration.revision, configurationDigest: a.configuration.digest });
    assert.equal(stale.status, 409);
  } finally { f.close(); }
});

test('current closure, pause, visibility and item revocation apply to every historical configuration', async () => {
  const f = fixture();
  try {
    const a = await f.create(resourceA, 'Original open page');
    const item = await (await f.request(`/r/${resourceA}/api/guest-postcard`, postcard('Revocable postcard'), { owner: false })).json();
    const approved = await f.command(resourceA, 'moderate', { expectedVersion: a.resource.version, item: item.id, itemRevision: 1, status: 'approved' });
    assert.equal(approved.status, 200);
    const stage = await f.command(resourceA, 'stage', { expectedVersion: approved.body.resource.version, configuration: config('New closed page', { guestAccess: 'closed' }) });
    const active = await f.command(resourceA, 'activate', { expectedVersion: stage.body.resource.version, configurationRevision: stage.body.configuration.revision, configurationDigest: stage.body.configuration.digest });
    const old = `/r/${resourceA}/c/${a.configuration.revision}`;
    assert.doesNotMatch(await (await f.request(old + '/contribute', null, { owner: false })).text(), /id="guest-postcard"/);
    assert.equal((await f.request(old + '/api/guest-postcard', postcard('Must not arrive'), { owner: false })).status, 403);
    const deleted = await f.command(resourceA, 'moderate', { expectedVersion: active.body.resource.version, item: item.id, itemRevision: 2, status: 'deleted' });
    assert.equal(deleted.status, 200);
    for (const path of [old + '/item/' + item.id, old + '/api/items/' + item.id, `/r/${resourceA}/media/${item.id}`, `/api/resources/${resourceA}/media/${item.id}`]) assert.equal((await f.request(path)).status, 404);
    assert.equal((await f.command(resourceA, 'moderate', { expectedVersion: deleted.body.resource.version, item: item.id, itemRevision: 3, status: 'approved' })).status, 409);
    const hidden = await f.command(resourceA, 'control', { expectedVersion: deleted.body.resource.version, visible: false, paused: true });
    assert.equal(hidden.status, 200);
    assert.equal((await f.request(old + '/', null, { owner: false })).status, 404);
    const exported = await (await f.request(`/api/resources/${resourceA}/export`)).json();
    assert.equal(exported.items[0].status, 'deleted'); assert.equal(exported.covers.media, false);
    assert.equal(JSON.stringify(exported).includes(f.env.OWNER_API_TOKEN), false);
  } finally { f.close(); }
});

test('storage-time closure prevents committing a guest item and removes only its scoped object', async () => {
  const f = fixture();
  try {
    const a = await f.create(resourceA, 'A');
    const put = f.env.MEDIA.put;
    f.env.MEDIA.put = async (...args) => {
      await put(...args);
      assert.equal((await f.command(resourceA, 'control', { expectedVersion: a.resource.version, visible: true, paused: true })).status, 200);
    };
    const res = await f.request(`/r/${resourceA}/api/guest-postcard`, postcard('Interrupted admission'), { owner: false });
    assert.equal(res.status, 409); assert.equal(f.objects.size, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM guestbook_resource_items').get().n, 0);
  } finally { f.close(); }
});

test('interrupted creation rolls back its resource identity and the same operation can retry safely', async () => {
  const f = fixture();
  try {
    f.sqlite.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON guestbook_resource_operations BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END;");
    const command = { action: 'create', operationId: 'retryable-creation-0001' };
    assert.equal((await f.request('/api/resources/' + resourceA, command)).status, 503);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM guestbook_resources').get().n, 0);
    assert.deepEqual(await (await f.request(`/api/resources/${resourceA}?operation=${command.operationId}`)).json(), { contract: 1, recorded: false, current: null });
    f.sqlite.exec('DROP TRIGGER fail_receipt;');
    const first = await (await f.request('/api/resources/' + resourceA, command)).json();
    const retry = await (await f.request('/api/resources/' + resourceA, command)).json();
    assert.deepEqual(retry, first);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM guestbook_resources').get().n, 1);
    assert.equal((await f.command(resourceA, 'create')).status, 409, 'another creation operation cannot silently adopt this resource');
  } finally { f.close(); }
});

test('source drift after staging refuses activation at the app write boundary', async () => {
  const f = fixture();
  try {
    const a = await f.create(resourceA, 'Previous usable page');
    const staged = await f.command(resourceA, 'stage', { expectedVersion: a.resource.version, configuration: config('Staged against old source') });
    globalThis.BUILD_SHA = 'b'.repeat(40);
    const command = { expectedVersion: staged.body.resource.version, configurationRevision: staged.body.configuration.revision, configurationDigest: staged.body.configuration.digest };
    assert.equal((await f.command(resourceA, 'activate', command)).status, 403, 'stale source header is refused');
    assert.equal((await f.command(resourceA, 'activate', command, { headers: { 'X-Composer-Source': 'b'.repeat(40) } })).status, 409, 'a candidate from another source is refused even with the new source header');
    assert.match(await (await f.request(`/r/${resourceA}/c/${a.configuration.revision}/`, null, { owner: false })).text(), /Previous usable page/);
  } finally { globalThis.BUILD_SHA = source; f.close(); }
});

for (const mode of ['confirmed', 'unknown']) test('a lost item-insert acknowledgement preserves media: ' + mode, async () => {
  const f = fixture();
  try {
    const resource = await f.create(resourceA, 'Preserve accepted media');
    const prepare = f.env.DB.prepare;
    f.env.DB.prepare = sql => {
      const statement = prepare(sql), bind = statement.bind;
      statement.bind = (...values) => {
        const bound = bind(...values), first = bound.first;
        if (sql.startsWith('INSERT INTO guestbook_resource_items')) bound.first = async () => { await first(); throw Error('insert acknowledgement lost after commit'); };
        if (mode === 'unknown' && sql.startsWith('SELECT id FROM guestbook_resource_items WHERE resource_id=? AND id=? AND caption=')) bound.first = async () => { throw Error('reconciliation unavailable'); };
        return bound;
      };
      return statement;
    };
    const response = await f.request(`/r/${resourceA}/api/guest-postcard`, postcard('Accepted despite lost acknowledgement'), { owner: false });
    assert.equal(response.status, mode === 'confirmed' ? 201 : 503);
    const result = await response.json();
    if (mode === 'unknown') assert.equal(result.outcome, 'unknown');
    f.env.DB.prepare = prepare;
    const stored = f.sqlite.prepare('SELECT id,status FROM guestbook_resource_items WHERE resource_id=?').get(resourceA);
    assert.equal(stored.id, result.id); assert.equal(stored.status, 'pending');
    assert.equal(f.objects.has(`resources/${resourceA}/photos/${stored.id}.png`), true);
    assert.equal((await f.command(resourceA, 'moderate', { expectedVersion: resource.resource.version, item: stored.id, itemRevision: 1, status: 'approved' })).status, 200);
    assert.equal((await f.request(`/r/${resourceA}/media/${stored.id}`, null, { owner: false })).status, 200);
  } finally { f.close(); }
});

test('a definitive object-storage failure creates no item and cleans its generated key', async () => {
  const f = fixture();
  try {
    await f.create(resourceA, 'Storage failure');
    f.env.MEDIA.put = async (key, bytes) => { f.objects.set(key, bytes); throw Error('storage acknowledgement unavailable before database insert'); };
    const response = await f.request(`/r/${resourceA}/api/guest-postcard`, postcard('Not inserted'), { owner: false });
    assert.equal(response.status, 503);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM guestbook_resource_items').get().n, 0);
    assert.equal(f.objects.size, 0);
  } finally { f.close(); }
});

function postcardBrowser(action, fetch) {
  const values = new Map(Object.entries({
    code: 'hunter2', caption: 'Controller-owned fictional postcard',
    author: 'Fictional visitor', consent: true,
  }));
  const listeners = new Map(), windowListeners = new Map();
  const button = { disabled: true, textContent: '' };
  const fieldset = { disabled: false };
  const status = { textContent: '', focused: false, focus() { this.focused = true; } };
  const form = {
    action,
    elements: { namedItem(name) { return { get value() { return values.get(name); } }; } },
    querySelector(selector) { return selector === 'button' ? button : fieldset; },
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
  };
  const canvas = {
    getContext() {
      return { fillRect() {}, strokeRect() {}, fillText() {}, measureText(text) { return { width: text.length * 20 }; } };
    },
    toDataURL() { return 'data:image/png;base64,' + png(); },
  };
  const requests = [];
  const browser = {
    document: { querySelector(selector) { return { '#guest-postcard': form, '#postcard-canvas': canvas, '#postcard-status': status }[selector]; } },
    window: { addEventListener(name, listener) { windowListeners.set(name, listener); } },
    FormData: class {
      get(name) { return values.get(name) ?? null; }
      has(name) { return values.has(name); }
    },
    URL, AbortController, setTimeout, clearTimeout,
    console: { info() {} },
    async fetch(url, options) {
      requests.push({ url, payload: JSON.parse(options.body) });
      return fetch(url, options);
    },
  };
  runInNewContext(readFileSync(new URL('../public/brand/guest-postcard.js', import.meta.url), 'utf8'), browser);
  return {
    button, fieldset, status, values, requests,
    async submit() {
      for (const listener of listeners.get('submit')) await listener({ preventDefault() {} });
    },
    input(name, value) {
      values.set(name, value);
      for (const listener of listeners.get('input')) listener({});
    },
    leavingWarns() {
      let warned = false;
      windowListeners.get('beforeunload')({ preventDefault() { warned = true; } });
      return warned;
    },
  };
}

for (const base of ['', '/guestbook']) {
  test('the checked postcard controller submits the actual scoped form action: ' + (base || 'standalone'), async () => {
    const f = fixture(base);
    try {
      await f.create(resourceA, 'Controller resource A');
      await f.create(resourceB, 'Controller resource B');
      const page = await (await f.request(`/r/${resourceA}/c/1/contribute`, null, { owner: false })).text();
      const action = page.match(/<form id="guest-postcard" method="post" action="([^"]+)"/)?.[1];
      assert.equal(action, `${base}/r/${resourceA}/api/guest-postcard`);
      const expected = new URL(action, f.env.PUBLIC_ORIGIN).href;
      let requested, responseStatus;
      const browser = postcardBrowser(expected, async (url, options) => {
        requested = new URL(url, f.env.PUBLIC_ORIGIN).href;
        const headers = new Headers(options.headers);
        headers.set('Origin', f.env.PUBLIC_ORIGIN);
        headers.set('CF-Connecting-IP', '192.0.2.55');
        const response = await worker.fetch(new Request(requested, { ...options, headers }), f.env, { waitUntil() {} });
        responseStatus = response.status;
        return response;
      });
      assert.equal(browser.button.disabled, false);
      await browser.submit();
      assert.equal(requested, expected, 'the maintained browser controller must not fall back to the global postcard API');
      assert.equal(responseStatus, 201);
      assert.equal(browser.status.focused, true);
      assert.equal(browser.button.textContent, 'Postcard sent');
      assert.equal(browser.button.disabled, true);
      const item = f.sqlite.prepare('SELECT id,resource_id,status FROM guestbook_resource_items').get();
      assert.equal(item.resource_id, resourceA);
      assert.equal(item.status, 'pending');
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM photos').get().n, 0, 'the legacy owner collection stays untouched');
      assert.equal(f.objects.has(`resources/${resourceA}/photos/${item.id}.png`), true);
      for (const path of [`/r/${resourceA}/media/${item.id}`, `/r/${resourceB}/media/${item.id}`, `/media/${item.id}`]) {
        assert.equal((await f.request(path, null, { owner: false })).status, 404, path);
      }
      const guestApproval = await f.command(resourceA, 'moderate', { expectedVersion: 2, item: item.id, itemRevision: 1, status: 'approved' }, { owner: false });
      assert.equal(guestApproval.status, 401, 'a guest submission does not grant moderation authority');
      assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { f.close(); }
  });
}

test('a committed postcard with a lost insert acknowledgement remains private and blocks duplicate browser retries', async () => {
  const f = fixture('/guestbook');
  try {
    const resource = await f.create(resourceA, 'Unknown receipt');
    await f.create(resourceB, 'Other resource');
    const prepare = f.env.DB.prepare;
    f.env.DB.prepare = sql => {
      const statement = prepare(sql), bind = statement.bind;
      statement.bind = (...values) => {
        const bound = bind(...values), first = bound.first;
        if (sql.startsWith('INSERT INTO guestbook_resource_items')) bound.first = async () => {
          await first();
          throw Error('insert acknowledgement lost after commit');
        };
        if (sql.startsWith('SELECT id FROM guestbook_resource_items WHERE resource_id=? AND id=? AND caption=')) bound.first = async () => {
          throw Error('reconciliation unavailable');
        };
        return bound;
      };
      return statement;
    };
    let responseStatus;
    const browser = postcardBrowser(`${f.env.PUBLIC_ORIGIN}/guestbook/r/${resourceA}/api/guest-postcard`, async (url, options) => {
      const response = await f.request(new URL(url).pathname.slice('/guestbook'.length), JSON.parse(options.body), { owner: false });
      responseStatus = response.status;
      return response;
    });
    await browser.submit();
    assert.equal(responseStatus, 503);
    const item = f.sqlite.prepare('SELECT id,resource_id,status FROM guestbook_resource_items').get();
    assert.equal(item.status, 'pending');
    assert.equal(item.resource_id, resourceA);
    assert.match(browser.status.textContent, /Your postcard may already be waiting for review/);
    assert.ok(browser.status.textContent.includes(`Reference: ${resourceA}/${item.id}.`));
    assert.match(browser.status.textContent, /ask the owner to check whether it arrived before resending/);
    assert.doesNotMatch(browser.status.textContent, /not accepted|try again/);
    assert.equal(browser.button.disabled, true);
    assert.equal(browser.status.focused, true);
    assert.equal(browser.fieldset.disabled, false);
    assert.equal(browser.values.get('caption'), 'Controller-owned fictional postcard');
    assert.equal(browser.leavingWarns(), true);
    await browser.submit();
    browser.input('code', 'different code');
    assert.equal(browser.button.disabled, true, 'changing a guest code cannot unlock an uncertain duplicate');
    await browser.submit();
    assert.equal(browser.requests.length, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM guestbook_resource_items').get().n, 1);
    assert.equal(f.objects.size, 1);
    f.env.DB.prepare = prepare;
    for (const path of [`/r/${resourceA}/media/${item.id}`, `/r/${resourceB}/media/${item.id}`, `/media/${item.id}`]) {
      assert.equal((await f.request(path, null, { owner: false })).status, 404, path);
    }
    assert.equal((await f.command(resourceA, 'moderate', { expectedVersion: resource.resource.version, item: item.id, itemRevision: 1, status: 'approved' })).status, 200);
    assert.equal((await f.request(`/r/${resourceA}/media/${item.id}`, null, { owner: false })).status, 200);
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

for (const [name, respond] of [
  ['transport failure', async () => { throw Error('connection interrupted after sending'); }],
  ['timeout', async () => { throw new DOMException('Timed out after sending', 'AbortError'); }],
  ['malformed JSON', async () => new Response('{', { status: 201 })],
  ['missing receipt', async () => Response.json({ message: 'Nothing to see here' }, { status: 201 })],
  ['non-pending receipt', async () => Response.json({ id: 'fictional-postcard-0001', resource: resourceA, status: 'approved' }, { status: 201 })],
  ['conflicting outcome', async () => Response.json({ id: 'fictional-postcard-0001', resource: resourceA, status: 'pending', outcome: 'refused' }, { status: 201 })],
  ['wrong resource receipt', async () => Response.json({ id: 'fictional-postcard-0001', resource: resourceB, status: 'pending' }, { status: 201 })],
  ['invalid receipt ID', async () => Response.json({ id: '<invalid>', resource: resourceA, status: 'pending' }, { status: 201 })],
]) test('the checked controller preserves work and prevents uncertain replay after ' + name, async () => {
  const browser = postcardBrowser(`https://guestbook.example.test/r/${resourceA}/api/guest-postcard`, respond);
  await browser.submit();
  assert.equal(browser.button.disabled, true);
  assert.notEqual(browser.button.textContent, 'Postcard sent');
  assert.match(browser.status.textContent, /may already be waiting for review/);
  assert.match(browser.status.textContent, /No receipt reference was returned/);
  assert.match(browser.status.textContent, /ask the owner to check/);
  assert.equal(browser.values.get('caption'), 'Controller-owned fictional postcard');
  assert.equal(browser.leavingWarns(), true);
  await browser.submit();
  assert.equal(browser.requests.length, 1);
  browser.input('caption', 'A different, intentional postcard');
  assert.equal(browser.button.disabled, false);
  browser.input('caption', ' Controller-owned   fictional postcard ');
  assert.equal(browser.button.disabled, true, 'cosmetic whitespace must not unlock an uncertain repeat');
});

test('each uncertain postcard remains blocked when another message also has no confirmed receipt', async () => {
  const browser = postcardBrowser(`https://guestbook.example.test/r/${resourceA}/api/guest-postcard`, async () => { throw Error('response lost'); });
  await browser.submit();
  browser.input('caption', 'Another fictional message');
  await browser.submit();
  browser.input('caption', 'Controller-owned fictional postcard');
  assert.equal(browser.button.disabled, true);
  await browser.submit();
  assert.equal(browser.requests.length, 2, 'a later unknown result cannot forget the earlier uncertain payload');
});

test('a definite guest-code refusal allows correction without claiming an uncertain submission', async () => {
  const browser = postcardBrowser(`https://guestbook.example.test/r/${resourceA}/api/guest-postcard`, async () => Response.json({ error: 'That guest code did not fit. Your message is still here.' }, { status: 403 }));
  await browser.submit();
  assert.equal(browser.button.disabled, false);
  assert.equal(browser.button.textContent, 'Send for approval');
  assert.match(browser.status.textContent, /guest code did not fit/);
  assert.doesNotMatch(browser.status.textContent, /may already|No receipt reference/);
});

test('a confirmed legacy global receipt still marks the postcard sent', async () => {
  const browser = postcardBrowser('https://guestbook.example.test/guestbook/api/guest-postcard', async () => Response.json({ id: 'fictional-postcard-0001', status: 'pending', message: 'With the owner.' }, { status: 201 }));
  await browser.submit();
  assert.equal(browser.button.disabled, true);
  assert.equal(browser.button.textContent, 'Postcard sent');
  assert.equal(browser.status.textContent, 'With the owner.');
  assert.equal(browser.leavingWarns(), false);
});
