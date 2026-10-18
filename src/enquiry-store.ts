import type { ResourceIdentity, ResourceRow } from "./resources.ts";
import { resourceRestoreEligibleSQL } from "./resource-lineage.ts";
import {
  EnquiryError,
  enquiryDigest,
  enquiryScopeKey,
  enquiryOwnerDailyLimit,
  enquiryScopeLimit,
  enquiryRevision,
  enquiryIntent,
  enquiryID,
  enquiryScope,
  enquiryQueueLimit,
  enquiryDailyLimit,
  enquiryStoredLimit,
  type EnquiryScope,
  type EnquirySubmission,
} from "./enquiry-contract.ts";

export interface EnquiryOwnerContext {
  resource: ResourceRow;
  proof: ResourceIdentity;
}
interface OperationRow {
  fingerprint: string;
  status: string;
  result_json: string | null;
}
export interface ScopeRow {
  resource_id: string;
  scope_key: string;
  kind: EnquiryScope["kind"];
  configuration_revision: number;
  provenance_json: string;
  enabled: number;
  revision: number;
}
const identitySQL =
  "r.workspace_id=? AND r.account_id=? AND r.environment=? AND r.target=?";
const identityValues = (proof: ResourceIdentity) => [
  proof.workspace,
  proof.account,
  proof.environment,
  proof.target,
];

// Reads always filter expiry as well. Cleanup failures never re-expose an expired
// body; the daily Worker task supplies physical removal without needing traffic.
export async function purgeEnquiries(db: D1Database) {
  await db.batch([
    db.prepare(
      "UPDATE guestbook_enquiries SET values_json=NULL,status='expired',revision=revision+1 WHERE values_json IS NOT NULL AND expires_at<=CURRENT_TIMESTAMP",
    ),
    db.prepare(
      "DELETE FROM guestbook_enquiries WHERE created_at<datetime('now','-35 days')",
    ),
    db.prepare(
      "DELETE FROM guestbook_enquiry_operations WHERE created_at<datetime('now','-35 days')",
    ),
  ]);
}
function operationResult(
  row: OperationRow | null | undefined,
  fingerprint?: string,
): unknown {
  if (!row)
    throw new EnquiryError(
      "The resource or enquiry changed, or its bounded operation limit was reached. Refresh before choosing another operation.",
      409,
    );
  if (fingerprint && row.fingerprint !== fingerprint)
    throw new EnquiryError(
      "This operation identity belongs to another exact request.",
      409,
    );
  if (row.status !== "completed" || !row.result_json)
    throw new EnquiryError(
      "The private enquiry outcome needs reconciliation.",
      503,
    );
  return JSON.parse(row.result_json) as unknown;
}
export async function enquiryOperation(
  db: D1Database,
  resource: string,
  operation: string,
) {
  if (!enquiryIntent(operation))
    throw new EnquiryError("Choose an exact enquiry operation identity.");
  const row = await db
    .prepare(
      "SELECT fingerprint,status,result_json FROM guestbook_enquiry_operations WHERE resource_id=? AND id=?",
    )
    .bind(resource, operation)
    .first<OperationRow>();
  return row
    ? { contract: 1, recorded: true, result: operationResult(row) }
    : { contract: 1, recorded: false };
}
const pendingSQL =
  "EXISTS(SELECT 1 FROM guestbook_enquiry_operations WHERE resource_id=? AND id=? AND fingerprint=? AND status='pending')";
const operationDayLimitSQL =
  "(SELECT COUNT(*) FROM guestbook_enquiry_operations WHERE resource_id=r.id AND created_at>=date('now'))<?";
function completedSQL(scope: string, item: string) {
  return `json_object('contract',1,'format','guestbook.enquiry-operation/v1','operation',?,'action',?,'outcome','applied','source',?,
    'resource',json_object('id',r.id,'workspace',r.workspace_id,'account',r.account_id,'environment',r.environment,'target',r.target,'version',r.version),
    'scope',${scope},'item',${item})`;
}
// Called only after the resource dispatcher has authenticated its exact owner
// identity. Every mutating statement repeats that durable identity/version guard.
export async function configureEnquiryScope(
  db: D1Database,
  context: EnquiryOwnerContext,
  scope: EnquiryScope,
  enabled: boolean,
  expectedScopeRevision: number,
  expectedVersion: number,
  operation: string,
) {
  if (
    !enquiryIntent(operation) ||
    !enquiryRevision(expectedVersion, true) ||
    !enquiryRevision(expectedScopeRevision, true) ||
    typeof enabled !== "boolean" ||
    scope.resource !== context.resource.id
  )
    throw new EnquiryError(
      "Choose the exact resource, form revision and operation.",
    );
  const id = context.resource.id,
    key = await enquiryScopeKey(scope),
    provenance = JSON.stringify(scope);
  const fingerprint = await enquiryDigest(
    JSON.stringify({
      identity: context.proof,
      resource: id,
      action: "configure",
      scope,
      enabled,
      expectedScopeRevision,
      expectedVersion,
    }),
  );
  const old = await db
    .prepare(
      "SELECT fingerprint,status,result_json FROM guestbook_enquiry_operations WHERE resource_id=? AND id=?",
    )
    .bind(id, operation)
    .first<OperationRow>();
  if (old) return operationResult(old, fingerprint);
  const pendingValues = [id, operation, fingerprint];
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO guestbook_enquiry_operations(resource_id,id,fingerprint,action,status)
      SELECT r.id,?,?,'configure','pending' FROM guestbook_resources r WHERE r.id=? AND r.version=? AND ${identitySQL}
      AND EXISTS(SELECT 1 FROM guestbook_resource_configs c WHERE c.resource_id=r.id AND c.revision=? AND c.activated_at IS NOT NULL)
      AND ((?=0 AND NOT EXISTS(SELECT 1 FROM guestbook_enquiry_scopes s WHERE s.resource_id=r.id AND s.scope_key=?) AND (SELECT COUNT(*) FROM guestbook_enquiry_scopes s WHERE s.resource_id=r.id)<?)
        OR EXISTS(SELECT 1 FROM guestbook_enquiry_scopes s WHERE s.resource_id=r.id AND s.scope_key=? AND s.revision=?))
      AND (?=0 OR (r.visible=1 AND r.paused=0 AND ${resourceRestoreEligibleSQL("r")}))
      AND ${operationDayLimitSQL}`,
      )
      .bind(
        operation,
        fingerprint,
        id,
        expectedVersion,
        ...identityValues(context.proof),
        scope.configuration,
        expectedScopeRevision,
        key,
        enquiryScopeLimit,
        key,
        expectedScopeRevision,
        enabled ? 1 : 0,
        enquiryOwnerDailyLimit,
      ),
    db
      .prepare(
        `INSERT INTO guestbook_enquiry_scopes(resource_id,scope_key,kind,configuration_revision,provenance_json,enabled)
      SELECT ?,?,?,?,?,? WHERE ${pendingSQL}
      ON CONFLICT(resource_id,scope_key) DO UPDATE SET kind=excluded.kind,configuration_revision=excluded.configuration_revision,provenance_json=excluded.provenance_json,enabled=excluded.enabled,revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE guestbook_enquiry_scopes.revision=?`,
      )
      .bind(
        id,
        key,
        scope.kind,
        scope.configuration,
        provenance,
        enabled ? 1 : 0,
        ...pendingValues,
        expectedScopeRevision,
      ),
    db
      .prepare(
        `UPDATE guestbook_resources SET version=version+1 WHERE id=? AND version=? AND ${pendingSQL}`,
      )
      .bind(id, expectedVersion, ...pendingValues),
    db
      .prepare(
        `UPDATE guestbook_enquiry_operations SET status='completed',result_json=(SELECT ${completedSQL("json_object('key',s.scope_key,'provenance',json(s.provenance_json),'enabled',json(CASE s.enabled WHEN 1 THEN 'true' ELSE 'false' END),'revision',s.revision)", "NULL")}
      FROM guestbook_resources r JOIN guestbook_enquiry_scopes s ON s.resource_id=r.id AND s.scope_key=? WHERE r.id=? AND r.version=?)
      WHERE resource_id=? AND id=? AND fingerprint=? AND status='pending' AND EXISTS(SELECT 1 FROM guestbook_resources WHERE id=? AND version=?)`,
      )
      .bind(
        operation,
        "configure",
        context.proof.source,
        key,
        id,
        expectedVersion + 1,
        ...pendingValues,
        id,
        expectedVersion + 1,
      ),
    db
      .prepare(
        "SELECT fingerprint,status,result_json FROM guestbook_enquiry_operations WHERE resource_id=? AND id=?",
      )
      .bind(id, operation),
  ]);
  return operationResult(
    results.at(-1)?.results?.[0] as OperationRow | undefined,
    fingerprint,
  );
}
export async function moderateEnquiry(
  db: D1Database,
  context: EnquiryOwnerContext,
  action: "review" | "reject" | "delete",
  item: string,
  expectedRevision: number,
  expectedVersion: number,
  operation: string,
) {
  if (
    !enquiryIntent(operation) ||
    !enquiryID(item) ||
    !enquiryRevision(expectedRevision) ||
    !enquiryRevision(expectedVersion, true) ||
    !["review", "reject", "delete"].includes(action)
  )
    throw new EnquiryError(
      "Choose the current enquiry, revision and exact operation.",
    );
  const id = context.resource.id,
    status =
      action === "review"
        ? "reviewed"
        : action === "reject"
          ? "rejected"
          : "deleted";
  const fingerprint = await enquiryDigest(
    JSON.stringify({
      identity: context.proof,
      resource: id,
      action,
      item,
      expectedRevision,
      expectedVersion,
    }),
  );
  const old = await db
    .prepare(
      "SELECT fingerprint,status,result_json FROM guestbook_enquiry_operations WHERE resource_id=? AND id=?",
    )
    .bind(id, operation)
    .first<OperationRow>();
  if (old) return operationResult(old, fingerprint);
  const pendingValues = [id, operation, fingerprint];
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO guestbook_enquiry_operations(resource_id,id,fingerprint,action,status)
      SELECT r.id,?,?,?,'pending' FROM guestbook_resources r WHERE r.id=? AND r.version=? AND ${identitySQL}
      AND EXISTS(SELECT 1 FROM guestbook_enquiries e WHERE e.resource_id=r.id AND e.id=? AND e.revision=? AND e.values_json IS NOT NULL AND e.expires_at>CURRENT_TIMESTAMP AND e.status NOT IN ('deleted','expired') AND e.status!=?)
      AND ${operationDayLimitSQL}`,
      )
      .bind(
        operation,
        fingerprint,
        action,
        id,
        expectedVersion,
        ...identityValues(context.proof),
        item,
        expectedRevision,
        status,
        enquiryOwnerDailyLimit,
      ),
    db
      .prepare(
        `UPDATE guestbook_enquiries SET status=?,revision=revision+1,values_json=CASE WHEN ?='deleted' THEN NULL ELSE values_json END
      WHERE resource_id=? AND id=? AND revision=? AND ${pendingSQL}`,
      )
      .bind(status, status, id, item, expectedRevision, ...pendingValues),
    db
      .prepare(
        `UPDATE guestbook_resources SET version=version+1 WHERE id=? AND version=? AND ${pendingSQL}`,
      )
      .bind(id, expectedVersion, ...pendingValues),
    db
      .prepare(
        `UPDATE guestbook_enquiry_operations SET status='completed',result_json=(SELECT ${completedSQL("NULL", "json_object('id',e.id,'status',e.status,'revision',e.revision)")}
      FROM guestbook_resources r JOIN guestbook_enquiries e ON e.resource_id=r.id AND e.id=? WHERE r.id=? AND r.version=?)
      WHERE resource_id=? AND id=? AND fingerprint=? AND status='pending' AND EXISTS(SELECT 1 FROM guestbook_resources WHERE id=? AND version=?)`,
      )
      .bind(
        operation,
        action,
        context.proof.source,
        item,
        id,
        expectedVersion + 1,
        ...pendingValues,
        id,
        expectedVersion + 1,
      ),
    db
      .prepare(
        "SELECT fingerprint,status,result_json FROM guestbook_enquiry_operations WHERE resource_id=? AND id=?",
      )
      .bind(id, operation),
  ]);
  return operationResult(
    results.at(-1)?.results?.[0] as OperationRow | undefined,
    fingerprint,
  );
}

export async function publicEnquiryScope(
  db: D1Database,
  resource: string,
  key: string,
  configuration: number,
  account: string,
  environment: string,
  target: string,
) {
  return db
    .prepare(
      `SELECT s.* FROM guestbook_enquiry_scopes s JOIN guestbook_resources r ON r.id=s.resource_id
    JOIN guestbook_resource_configs c ON c.resource_id=r.id AND c.revision=s.configuration_revision
    WHERE r.id=? AND r.account_id=? AND r.environment=? AND r.target=? AND r.visible=1 AND r.paused=0
      AND s.scope_key=? AND s.configuration_revision=? AND s.enabled=1 AND c.activated_at IS NOT NULL AND ${resourceRestoreEligibleSQL("r")}`,
    )
    .bind(resource, account, environment, target, key, configuration)
    .first<ScopeRow>();
}
// The fixed public form and authenticated Composer broker share this admission
// function. Callers supply a scope resolved from the route, never public input.
export async function admitEnquiry(
  db: D1Database,
  scope: ScopeRow,
  submission: EnquirySubmission,
  account: string,
  environment: string,
  target: string,
  source: string,
) {
  if (!/^[a-f0-9]{40}$/.test(source))
    throw new EnquiryError(
      "The current app source could not be verified.",
      503,
    );
  const stored = JSON.parse(scope.provenance_json) as Record<string, unknown>;
  const { resource, ...selection } = stored;
  const provenance = enquiryScope(selection, scope.resource_id);
  if (
    resource !== scope.resource_id ||
    provenance.configuration !== scope.configuration_revision ||
    provenance.kind !== scope.kind ||
    (await enquiryScopeKey(provenance)) !== scope.scope_key
  )
    throw new EnquiryError("The stored enquiry scope is unavailable.", 503);
  const fingerprint = await enquiryDigest(
    JSON.stringify({
      scope: provenance,
      intent: submission.intent,
      model: 1,
      values: submission.values,
      consent: 1,
    }),
  );
  const receiptQuery = () =>
    db
      .prepare(
        `SELECT e.fingerprint FROM guestbook_enquiries e JOIN guestbook_resources r ON r.id=e.resource_id JOIN guestbook_enquiry_scopes s ON s.resource_id=r.id AND s.scope_key=e.scope_key WHERE e.resource_id=? AND e.intent_id=? AND r.account_id=? AND r.environment=? AND r.target=? AND r.visible=1 AND r.paused=0 AND s.scope_key=? AND s.revision=? AND s.configuration_revision=? AND s.enabled=1 AND ${resourceRestoreEligibleSQL("r")}`,
      )
      .bind(
        scope.resource_id,
        submission.intent,
        account,
        environment,
        target,
        scope.scope_key,
        scope.revision,
        scope.configuration_revision,
      );
  const previous = await receiptQuery().first<{ fingerprint: string }>();
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new EnquiryError(
        "This intent already belongs to another exact brief. Check its receipt before starting another.",
        409,
      );
    return { contract: 1, intent: submission.intent, received: true };
  }
  const id = crypto.randomUUID();
  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO guestbook_enquiries(id,resource_id,scope_key,configuration_revision,provenance_json,model_version,producer_source,values_json,consent_version,intent_id,fingerprint)
        SELECT ?,s.resource_id,s.scope_key,s.configuration_revision,s.provenance_json,1,?,?,1,?,? FROM guestbook_enquiry_scopes s JOIN guestbook_resources r ON r.id=s.resource_id
        JOIN guestbook_resource_configs c ON c.resource_id=r.id AND c.revision=s.configuration_revision
        WHERE r.id=? AND r.account_id=? AND r.environment=? AND r.target=? AND r.visible=1 AND r.paused=0
          AND s.scope_key=? AND s.revision=? AND s.configuration_revision=? AND s.enabled=1 AND c.activated_at IS NOT NULL AND ${resourceRestoreEligibleSQL("r")}
          AND (SELECT COUNT(*) FROM guestbook_enquiries e WHERE e.resource_id=r.id AND e.status='pending' AND e.expires_at>CURRENT_TIMESTAMP)<${enquiryQueueLimit}
          AND (SELECT COUNT(*) FROM guestbook_enquiries e WHERE e.resource_id=r.id AND e.created_at>=date('now'))<${enquiryDailyLimit}
          AND (SELECT COUNT(*) FROM guestbook_enquiries e WHERE e.resource_id=r.id AND e.values_json IS NOT NULL AND e.expires_at>CURRENT_TIMESTAMP)<${enquiryStoredLimit}`,
        )
        .bind(
          id,
          source,
          JSON.stringify(submission.values),
          submission.intent,
          fingerprint,
          scope.resource_id,
          account,
          environment,
          target,
          scope.scope_key,
          scope.revision,
          scope.configuration_revision,
        ),
      receiptQuery(),
    ]);
    const recorded = results[1]?.results?.[0] as
      { fingerprint: string } | undefined;
    if (!recorded)
      throw new EnquiryError(
        "This form is closed or its bounded review queue/daily limit is full. Keep your brief and try later.",
        409,
      );
    if (recorded.fingerprint !== fingerprint)
      throw new EnquiryError(
        "This intent already belongs to another exact brief.",
        409,
      );
    return { contract: 1, intent: submission.intent, received: true };
  } catch (error) {
    if (error instanceof EnquiryError) throw error;
    try {
      const recorded = await db
        .prepare(
          "SELECT fingerprint FROM guestbook_enquiries WHERE resource_id=? AND intent_id=?",
        )
        .bind(scope.resource_id, submission.intent)
        .first<{ fingerprint: string }>();
      if (recorded?.fingerprint === fingerprint)
        return { contract: 1, intent: submission.intent, received: true };
    } catch {
      /* Missing storage proof never establishes rollback. */
    }
    throw new EnquiryError(
      "This brief may already have been received. Keep its intent and check the bounded receipt before another delivery.",
      503,
    );
  }
}
