import { authorised, error, json, readJSON, type BaseEnv } from './common.ts';
import { object, resourceConfiguration } from './resource-config.ts';
import { resourcePublicRoute } from './resource-public.ts';

export interface ResourceEnv extends BaseEnv {
  MEDIA: R2Bucket;
  RESOURCE_ACCOUNT_ID?: string;
  RESOURCE_ENVIRONMENT?: string;
}
export interface ResourceIdentity {
  workspace: string;
  account: string;
  environment: string;
  source: string;
  target: string;
}
export interface ResourceRow {
  id: string;
  workspace_id: string;
  account_id: string;
  environment: string;
  target: string;
  version: number;
  active_revision: number | null;
  visible: number;
  paused: number;
}
interface OperationRow {
  fingerprint: string;
  status: 'pending' | 'completed';
  result_json: string | null;
}
class ResourceError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{6,64}$/.test(value);
const operationId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value);
const version = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const resourceMediaKey = (resource: string, item: string) => `resources/${resource}/photos/${item}.png`;
export const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
export const resourceEnabled = (env: ResourceEnv) => Boolean(env.RESOURCE_ACCOUNT_ID && /^[a-z0-9-]{1,40}$/.test(env.RESOURCE_ENVIRONMENT ?? ''));

// The actual write boundary verifies deployed source and runtime identity.
// A source-status page or old Composer receipt cannot substitute for this.
async function identity(req: Request, env: ResourceEnv, base: string, source: string): Promise<ResourceIdentity> {
  if (!resourceEnabled(env)) throw new ResourceError('Owned Guestbooks are not connected in this environment.', 503);
  if (!req.headers.get('Authorization')?.startsWith('Bearer ') || !await authorised(req, env, 'unused_resource_session')) {
    throw new ResourceError('The server-side app connection is required.', 401);
  }
  const workspace = req.headers.get('X-Composer-Workspace');
  const account = req.headers.get('X-Composer-Account');
  const environment = req.headers.get('X-Composer-Environment');
  const expectedSource = req.headers.get('X-Composer-Source');
  const target = req.headers.get('X-Composer-Target');
  const url = new URL(req.url);
  if (!identifier(workspace) || account !== env.RESOURCE_ACCOUNT_ID || environment !== env.RESOURCE_ENVIRONMENT ||
      expectedSource !== source || !/^[a-f0-9]{40}$/.test(source) || target !== url.origin + base ||
      (req.headers.has('Origin') && req.headers.get('Origin') !== url.origin)) {
    throw new ResourceError('The selected workspace, app source or deployment target does not match.', 403);
  }
  return { workspace, account, environment, source, target };
}

async function ownedResource(db: D1Database, id: string, identity: ResourceIdentity): Promise<ResourceRow> {
  const row = await db.prepare('SELECT * FROM guestbook_resources WHERE id=? AND workspace_id=? AND account_id=? AND environment=? AND target=?')
    .bind(id, identity.workspace, identity.account, identity.environment, identity.target).first<ResourceRow>();
  if (!row) throw new ResourceError('This resource is not owned by the selected workspace and target.', 403);
  return row;
}

// Store the exact acknowledgement inside the same D1 transaction as the write.
// A failed acknowledgement is recovered by reading this operation, never by
// blindly resending a configuration or allocating another resource.
function operationResult(row: OperationRow | null, fingerprint?: string): unknown {
  if (!row) throw new ResourceError('The resource changed. Reconcile its current version before retrying.', 409);
  if (fingerprint && row.fingerprint !== fingerprint) throw new ResourceError('This operation identity already belongs to another request.', 409);
  if (row.status !== 'completed' || !row.result_json) throw new ResourceError('The operation outcome needs reconciliation.', 503);
  return JSON.parse(row.result_json) as unknown;
}

const resultJSON = `json_object('contract',1,'outcome','applied','resource',json_object(
  'id',r.id,'workspace',r.workspace_id,'account',r.account_id,'environment',r.environment,'target',r.target,
  'version',r.version,'activeRevision',r.active_revision,'visible',json(CASE r.visible WHEN 1 THEN 'true' ELSE 'false' END),
  'paused',json(CASE r.paused WHEN 1 THEN 'true' ELSE 'false' END)),
  'configuration',CASE WHEN c.revision IS NULL THEN NULL ELSE json_object('revision',c.revision,'digest',c.digest,'source',c.source_revision,'values',json(c.config_json)) END)`;
const snapshotSelect = `SELECT ${resultJSON} AS snapshot FROM guestbook_resources r
  LEFT JOIN guestbook_resource_configs c ON c.resource_id=r.id AND c.revision=r.active_revision WHERE r.id=?`;

async function createResource(db: D1Database, id: string, proof: ResourceIdentity, operation: string, fingerprint: string) {
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO guestbook_resources(id,workspace_id,account_id,environment,target,creation_operation)
      SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM guestbook_resources WHERE workspace_id=?)<32`)
      .bind(id, proof.workspace, proof.account, proof.environment, proof.target, operation, proof.workspace),
    db.prepare(`INSERT OR IGNORE INTO guestbook_resource_operations(resource_id,id,action,fingerprint,status,result_json)
      SELECT r.id,?,'create',?,'completed',${resultJSON} FROM guestbook_resources r
      LEFT JOIN guestbook_resource_configs c ON c.resource_id=r.id AND c.revision=r.active_revision
      WHERE r.id=? AND r.creation_operation=? AND r.workspace_id=? AND r.account_id=? AND r.environment=? AND r.target=?`)
      .bind(operation, fingerprint, id, operation, proof.workspace, proof.account, proof.environment, proof.target),
    db.prepare('SELECT fingerprint,status,result_json FROM guestbook_resource_operations WHERE resource_id=? AND id=?')
      .bind(id, operation),
  ]);
  return operationResult(results[2]?.results?.[0] as OperationRow | undefined ?? null, fingerprint);
}

async function mutateResource(db: D1Database, id: string, proof: ResourceIdentity, command: Record<string, unknown>) {
  const action = command.action;
  if (!['stage', 'activate', 'control', 'moderate'].includes(String(action)) || !operationId(command.operationId) || !version(command.expectedVersion)) {
    throw new ResourceError('Choose a supported operation and the current resource version.');
  }
  const operation = command.operationId, expected = command.expectedVersion;
  const row = await ownedResource(db, id, proof);
  const clean: Record<string, unknown> = { action, expectedVersion: expected };
  let configurationJSON = '', configurationDigest = '';
  if (action === 'stage') {
    try { clean.configuration = resourceConfiguration(command.configuration); }
    catch (failure) { throw new ResourceError(failure instanceof Error ? failure.message : 'Check the declared configuration.'); }
    configurationJSON = JSON.stringify(clean.configuration);
    configurationDigest = await digest(configurationJSON);
  } else if (action === 'activate') {
    if (!version(command.configurationRevision) || command.configurationRevision < 1 || typeof command.configurationDigest !== 'string') throw new ResourceError('Choose the staged configuration revision and digest.');
    clean.configurationRevision = command.configurationRevision;
    clean.configurationDigest = command.configurationDigest;
  } else if (action === 'control') {
    if (typeof command.visible !== 'boolean' || typeof command.paused !== 'boolean') throw new ResourceError('Choose explicit visibility and submission controls.');
    clean.visible = command.visible;
    clean.paused = command.paused;
  } else {
    if (!identifier(command.item) || !version(command.itemRevision) || command.itemRevision < 1 || !['approved', 'hidden', 'rejected', 'deleted'].includes(String(command.status))) throw new ResourceError('Choose this resource’s item, current revision and moderation state.');
    clean.item = command.item;
    clean.itemRevision = command.itemRevision;
    clean.status = command.status;
  }
  if (Object.keys(command).some(key => !['action', 'operationId', ...Object.keys(clean)].includes(key))) throw new ResourceError('This operation contains unsupported fields.');
  const fingerprint = await digest(JSON.stringify({ ...proof, resource: id, ...clean }));
  const previous = await db.prepare('SELECT fingerprint,status,result_json FROM guestbook_resource_operations WHERE resource_id=? AND id=?')
    .bind(id, operation).first<OperationRow>();
  if (previous) return operationResult(previous, fingerprint);
  if (row.version !== expected) throw new ResourceError('The resource changed. Reconcile its current version before retrying.', 409);
  let eligible = '', eligibilityValues: (string | number)[] = [];
  if (action === 'activate') {
    eligible = 'AND EXISTS(SELECT 1 FROM guestbook_resource_configs WHERE resource_id=r.id AND revision=? AND digest=? AND source_revision=?)';
    eligibilityValues = [Number(clean.configurationRevision), String(clean.configurationDigest), proof.source];
  } else if (action === 'moderate') {
    eligible = "AND EXISTS(SELECT 1 FROM guestbook_resource_items WHERE resource_id=r.id AND id=? AND revision=? AND status!='deleted')";
    eligibilityValues = [String(clean.item), Number(clean.itemRevision)];
  }
  const statements = [db.prepare(`INSERT OR IGNORE INTO guestbook_resource_operations(resource_id,id,action,fingerprint,status)
    SELECT r.id,?,?,?,'pending' FROM guestbook_resources r WHERE r.id=? AND r.version=? ${eligible}`)
    .bind(operation, String(action), fingerprint, id, expected, ...eligibilityValues)];
  const pending = 'EXISTS(SELECT 1 FROM guestbook_resource_operations WHERE resource_id=? AND id=? AND fingerprint=? AND status=\'pending\')';
  const pendingValues = [id, operation, fingerprint];
  if (action === 'stage') statements.push(db.prepare(`INSERT INTO guestbook_resource_configs(resource_id,revision,config_json,digest,source_revision)
    SELECT ?,?,?,?,? WHERE ${pending}`).bind(id, expected + 1, configurationJSON, configurationDigest, proof.source, ...pendingValues));
  if (action === 'activate') statements.push(db.prepare(`UPDATE guestbook_resource_configs SET activated_at=COALESCE(activated_at,CURRENT_TIMESTAMP)
    WHERE resource_id=? AND revision=? AND ${pending}`).bind(id, Number(clean.configurationRevision), ...pendingValues));
  if (action === 'moderate') statements.push(db.prepare(`UPDATE guestbook_resource_items SET status=?,revision=revision+1
    WHERE resource_id=? AND id=? AND revision=? AND ${pending}`).bind(String(clean.status), id, String(clean.item), Number(clean.itemRevision), ...pendingValues));
  let changes = '';
  const changeValues: (string | number)[] = [];
  if (action === 'activate') { changes = ',active_revision=?'; changeValues.push(Number(clean.configurationRevision)); }
  if (action === 'control') { changes = ',visible=?,paused=?'; changeValues.push(clean.visible ? 1 : 0, clean.paused ? 1 : 0); }
  statements.push(db.prepare(`UPDATE guestbook_resources SET version=version+1${changes} WHERE id=? AND version=? AND ${pending}`)
    .bind(...changeValues, id, expected, ...pendingValues));
  // A stage acknowledgement identifies its private candidate; activate/control
  // identify the configuration actually active after this transaction.
  const configuration = action === 'stage' ? expected + 1 : null;
  const operationSnapshot = configuration === null ? snapshotSelect : snapshotSelect.replace('c.revision=r.active_revision', `c.revision=${configuration}`);
  statements.push(db.prepare(`UPDATE guestbook_resource_operations SET status='completed',result_json=(${operationSnapshot})
    WHERE resource_id=? AND id=? AND fingerprint=? AND status='pending'
    AND EXISTS(SELECT 1 FROM guestbook_resources WHERE id=? AND version=?)`)
    .bind(id, ...pendingValues, id, expected + 1));
  statements.push(db.prepare('SELECT fingerprint,status,result_json FROM guestbook_resource_operations WHERE resource_id=? AND id=?').bind(id, operation));
  const results = await db.batch(statements);
  return operationResult(results.at(-1)?.results?.[0] as OperationRow | undefined ?? null, fingerprint);
}

export async function resourceRoutes(req: Request, env: ResourceEnv, base: string, path: string, source: string): Promise<Response | null> {
  if (path.startsWith('/r/')) return resourcePublicRoute(req, env, base, path);
  if (!path.startsWith('/api/resources/')) return null;
  try {
    const match = path.match(/^\/api\/resources\/([a-z0-9-]{6,64})(?:\/(export|media\/([a-z0-9-]{6,64})))?$/);
    if (!match) throw new ResourceError('Choose a resource route.', 404);
    const id = match[1]!, proof = await identity(req, env, base, source);
    if (!['GET', 'POST'].includes(req.method)) throw new ResourceError('Use the supported resource request method.', 405);
    if (req.method === 'GET') {
      const requestedOperation = new URL(req.url).searchParams.get('operation');
      if (requestedOperation && operationId(requestedOperation) && !await env.DB.prepare('SELECT id FROM guestbook_resources WHERE id=?').bind(id).first()) {
        return json({ contract: 1, recorded: false, current: null });
      }
      const resource = await ownedResource(env.DB, id, proof);
      if (match[2]?.startsWith('media/')) {
        const item = await env.DB.prepare("SELECT id FROM guestbook_resource_items WHERE resource_id=? AND id=? AND status!='deleted'").bind(id, match[3]!).first();
        const media = item ? await env.MEDIA.get(resourceMediaKey(id, match[3]!)) : null;
        return media ? new Response(media.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) : error('This media is unavailable.', 404);
      }
      if (match[2] === 'export') {
        const items = await env.DB.prepare('SELECT id,caption,author,status,revision,synthetic,created_at FROM guestbook_resource_items WHERE resource_id=? ORDER BY id').bind(id).all();
        const configurations = await env.DB.prepare('SELECT revision,config_json,digest,source_revision,activated_at FROM guestbook_resource_configs WHERE resource_id=? ORDER BY revision').bind(id).all();
        return json({ contract: 1, format: 'guestbook.resource-export/v1', resource, configurations: configurations.results, items: items.results,
          covers: { configuration: true, itemMetadata: true, media: false, credentials: false }, media: 'Download non-deleted media through this resource’s authenticated media route. Deletions remain revoked.' });
      }
      const operation = new URL(req.url).searchParams.get('operation');
      if (operation) {
        if (!operationId(operation)) throw new ResourceError('Choose an operation identity.');
        const recorded = await env.DB.prepare('SELECT fingerprint,status,result_json FROM guestbook_resource_operations WHERE resource_id=? AND id=?').bind(id, operation).first<OperationRow>();
        return recorded ? json({ contract: 1, recorded: true, result: operationResult(recorded), current: resource }) : json({ contract: 1, recorded: false, current: resource });
      }
      const snapshot = await env.DB.prepare(snapshotSelect).bind(id).first<{ snapshot: string }>();
      return json(snapshot ? JSON.parse(snapshot.snapshot) as unknown : null);
    }
    if (match[2]) throw new ResourceError('This resource route is read-only.', 405);
    const raw: unknown = await readJSON(req, 8192);
    if (!object(raw)) throw new ResourceError('Choose a resource command.');
    if (raw.action === 'create') {
      if (!operationId(raw.operationId) || Object.keys(raw).some(key => !['action', 'operationId'].includes(key))) throw new ResourceError('Choose a creation operation identity.');
      const fingerprint = await digest(JSON.stringify({ ...proof, resource: id, action: 'create' }));
      return json(await createResource(env.DB, id, proof, raw.operationId, fingerprint));
    }
    const result = await mutateResource(env.DB, id, proof, raw);
    // Deleted items stay deleted even if object deletion is unavailable. No
    // controlled public or owner media request can expose their keys again.
    if (raw.action === 'moderate' && raw.status === 'deleted' && identifier(raw.item)) {
      try { await env.MEDIA.delete(resourceMediaKey(id, raw.item)); } catch { /* Logical revocation already committed. */ }
    }
    return json(result);
  } catch (failure) {
    if (failure instanceof ResourceError) return error(failure.message, failure.status);
    // Storage/transport errors can follow a committed mutation. Never label
    // them unchanged or automatically retry; callers reconcile operationId.
    return json({ contract: 1, outcome: 'unknown', error: 'The resource outcome could not be confirmed. Reconcile the operation before retrying.' }, 503);
  }
}
