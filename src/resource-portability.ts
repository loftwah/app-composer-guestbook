import { json, type BaseEnv } from "./common.ts";
import {
  object,
  resourceConfiguration,
  type ResourceConfiguration,
} from "./resource-config.ts";
import { sanitisePNG } from "./png.ts";
import {
  digest,
  resourceMediaKey,
  type ResourceEnv,
  type ResourceIdentity,
  type ResourceRow,
} from "./resources.ts";
import { mediaDigest, readMediaBytes } from "./resource-lineage.ts";

const MAX_ITEMS = 8;
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9-]{6,64}$/.test(value);
const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const exact = (
  value: unknown,
  keys: string[],
): value is Record<string, unknown> =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const ordinary = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
const rights =
  "No new licence is granted. Retain contributor consent and confirm your permission to copy.";
const limitation =
  "Requires this live source authority. Restores are private, fresh copies; not offline or cross-account disaster recovery.";

interface PortableItem {
  id: string;
  revision: number;
  caption: string;
  author: string;
  synthetic: 0 | 1;
  createdAt: string;
  media: { type: "image/png"; sha256: string; base64: string };
}
export interface PortableGuestbook {
  format: "guestbook.approved-portable/v1";
  contract: 1;
  exportedAt: string;
  source: {
    app: "guestbook";
    build: string;
    resource: string;
    workspace: string;
    account: string;
    environment: string;
    target: string;
    version: number;
  };
  configuration: {
    revision: number;
    digest: string;
    source: string;
    values: ResourceConfiguration;
  };
  items: PortableItem[];
  coverage: {
    approvedOriginals: number;
    included: number;
    complete: boolean;
    maximumItems: 8;
    privateContent: false;
    credentials: false;
    restoredCopies: false;
  };
  rights: string;
  limitation: string;
}
interface SourceItem {
  id: string;
  revision: number;
  caption: string;
  author: string;
  synthetic: 0 | 1;
  created_at: string;
}
interface ConfigurationRow {
  revision: number;
  config_json: string;
  digest: string;
  source_revision: string;
}
interface ReceiptRow {
  fingerprint: string;
  result_json: string | null;
  status: string;
}
export class PortabilityError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function portableManifest(raw: unknown): PortableGuestbook {
  if (
    !exact(raw, [
      "format",
      "contract",
      "exportedAt",
      "source",
      "configuration",
      "items",
      "coverage",
      "rights",
      "limitation",
    ]) ||
    raw.format !== "guestbook.approved-portable/v1" ||
    raw.contract !== 1 ||
    typeof raw.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.exportedAt)) ||
    raw.rights !== rights ||
    raw.limitation !== limitation
  )
    throw new PortabilityError("Use a supported approved-content export.");
  const source = raw.source,
    config = raw.configuration,
    coverage = raw.coverage;
  if (
    !exact(source, [
      "app",
      "build",
      "resource",
      "workspace",
      "account",
      "environment",
      "target",
      "version",
    ]) ||
    source.app !== "guestbook" ||
    !sha(source.build) ||
    !id(source.resource) ||
    !id(source.workspace) ||
    !ordinary(source.account, 80) ||
    !source.account ||
    !ordinary(source.environment, 40) ||
    !source.environment ||
    typeof source.target !== "string" ||
    source.target.length > 256 ||
    !revision(source.version) ||
    !exact(config, ["revision", "digest", "source", "values"]) ||
    !revision(config.revision) ||
    !hash(config.digest) ||
    !sha(config.source)
  ) {
    throw new PortabilityError(
      "The source and configuration identities are invalid.",
    );
  }
  let values: ResourceConfiguration;
  try {
    values = resourceConfiguration(config.values);
  } catch {
    throw new PortabilityError("The file contains unsupported configuration.");
  }
  if (JSON.stringify(values) !== JSON.stringify(config.values))
    throw new PortabilityError("Use canonical declared settings.");
  if (
    !Array.isArray(raw.items) ||
    raw.items.length > MAX_ITEMS ||
    !exact(coverage, [
      "approvedOriginals",
      "included",
      "complete",
      "maximumItems",
      "privateContent",
      "credentials",
      "restoredCopies",
    ]) ||
    !Number.isSafeInteger(coverage.approvedOriginals) ||
    Number(coverage.approvedOriginals) < raw.items.length ||
    coverage.included !== raw.items.length ||
    coverage.complete !== (coverage.approvedOriginals === raw.items.length) ||
    coverage.maximumItems !== MAX_ITEMS ||
    coverage.privateContent !== false ||
    coverage.credentials !== false ||
    coverage.restoredCopies !== false
  ) {
    throw new PortabilityError("The bounded export coverage is invalid.");
  }
  const items: PortableItem[] = raw.items.map((item: unknown) => {
    if (
      !exact(item, [
        "id",
        "revision",
        "caption",
        "author",
        "synthetic",
        "createdAt",
        "media",
      ]) ||
      !id(item.id) ||
      !revision(item.revision) ||
      !ordinary(item.caption, 160) ||
      !ordinary(item.author, 60) ||
      ![0, 1].includes(Number(item.synthetic)) ||
      typeof item.synthetic !== "number" ||
      !ordinary(item.createdAt, 40) ||
      !exact(item.media, ["type", "sha256", "base64"]) ||
      item.media.type !== "image/png" ||
      !hash(item.media.sha256) ||
      typeof item.media.base64 !== "string" ||
      item.media.base64.length > 133336 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(item.media.base64)
    ) {
      throw new PortabilityError(
        "The export contains an unsupported contribution or image.",
      );
    }
    return {
      id: item.id,
      revision: item.revision,
      caption: item.caption,
      author: item.author,
      synthetic: item.synthetic as 0 | 1,
      createdAt: item.createdAt,
      media: {
        type: "image/png",
        sha256: item.media.sha256,
        base64: item.media.base64,
      },
    };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new PortabilityError("A contribution appears more than once.");
  return {
    format: "guestbook.approved-portable/v1",
    contract: 1,
    exportedAt: raw.exportedAt,
    source: {
      app: "guestbook",
      build: source.build,
      resource: source.resource,
      workspace: source.workspace,
      account: source.account,
      environment: source.environment,
      target: source.target,
      version: source.version,
    },
    configuration: {
      revision: config.revision,
      digest: config.digest,
      source: config.source,
      values,
    },
    items,
    coverage: {
      approvedOriginals: Number(coverage.approvedOriginals),
      included: items.length,
      complete: coverage.complete as boolean,
      maximumItems: MAX_ITEMS,
      privateContent: false,
      credentials: false,
      restoredCopies: false,
    },
    rights,
    limitation,
  };
}

export async function exportPortable(
  env: ResourceEnv,
  selected: ResourceRow,
  proof: ResourceIdentity,
): Promise<PortableGuestbook> {
  const snapshots = await env.DB.batch([
    env.DB.prepare(
      "SELECT * FROM guestbook_resources WHERE id=? AND version=? AND visible=1",
    ).bind(selected.id, selected.version),
    env.DB.prepare(
      "SELECT c.* FROM guestbook_resource_configs c JOIN guestbook_resources r ON r.id=c.resource_id AND r.active_revision=c.revision WHERE r.id=?",
    ).bind(selected.id),
    env.DB.prepare(
      `SELECT i.* FROM guestbook_resource_items i WHERE i.resource_id=? AND i.status='approved'
      AND NOT EXISTS(SELECT 1 FROM guestbook_resource_lineage l WHERE l.item_id=i.id) ORDER BY i.created_at,i.id LIMIT ?`,
    ).bind(selected.id, MAX_ITEMS),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM guestbook_resource_items i WHERE i.resource_id=? AND i.status='approved'
      AND NOT EXISTS(SELECT 1 FROM guestbook_resource_lineage l WHERE l.item_id=i.id)`,
    ).bind(selected.id),
  ]);
  const resource = snapshots[0]?.results[0] as unknown as
    ResourceRow | undefined;
  const configuration = snapshots[1]?.results[0] as unknown as
    ConfigurationRow | undefined;
  if (!resource || !configuration)
    throw new PortabilityError(
      "Export needs a current visible resource with an active configuration.",
      409,
    );
  const total = Number(
    (snapshots[3]?.results[0] as { n: number } | undefined)?.n ?? 0,
  );
  const items: PortableItem[] = [];
  for (const item of snapshots[2]?.results as unknown as SourceItem[]) {
    const bytes = await readMediaBytes(
      env,
      resourceMediaKey(selected.id, item.id),
    );
    if (!bytes) continue;
    const cleaned = await sanitisePNG(bytes);
    if (
      cleaned.width > 1200 ||
      cleaned.height > 900 ||
      cleaned.bytes.length !== bytes.length ||
      (await mediaDigest(cleaned.bytes)) !== (await mediaDigest(bytes))
    )
      throw new PortabilityError(
        "A source image is incompatible; no complete recovery claim can be made.",
        409,
      );
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    items.push({
      id: item.id,
      revision: item.revision,
      caption: item.caption,
      author: item.author,
      synthetic: item.synthetic,
      createdAt: item.created_at,
      media: {
        type: "image/png",
        sha256: await mediaDigest(bytes),
        base64: btoa(binary),
      },
    });
  }
  const current = await env.DB.prepare(
    "SELECT id FROM guestbook_resources WHERE id=? AND version=? AND active_revision=? AND visible=1",
  )
    .bind(selected.id, selected.version, configuration.revision)
    .first();
  if (!current)
    throw new PortabilityError(
      "The source changed during export. Check it again.",
      409,
    );
  return {
    format: "guestbook.approved-portable/v1",
    contract: 1,
    exportedAt: new Date().toISOString(),
    source: {
      app: "guestbook",
      build: proof.source,
      resource: selected.id,
      workspace: proof.workspace,
      account: proof.account,
      environment: proof.environment,
      target: proof.target,
      version: selected.version,
    },
    configuration: {
      revision: configuration.revision,
      digest: configuration.digest,
      source: configuration.source_revision,
      values: resourceConfiguration(
        JSON.parse(configuration.config_json) as unknown,
      ),
    },
    items,
    coverage: {
      approvedOriginals: total,
      included: items.length,
      complete: items.length === total,
      maximumItems: MAX_ITEMS,
      privateContent: false,
      credentials: false,
      restoredCopies: false,
    },
    rights,
    limitation,
  };
}

function receipt(row: ReceiptRow, fingerprint: string): unknown {
  if (row.fingerprint !== fingerprint)
    throw new PortabilityError(
      "This operation already identifies another restore.",
      409,
    );
  if (row.status !== "completed" || !row.result_json)
    throw new PortabilityError(
      "This restore is unresolved. Check its operation before retrying.",
      503,
    );
  return JSON.parse(row.result_json) as unknown;
}
const operationRow = (
  db: BaseEnv["DB"],
  destination: string,
  operation: string,
) =>
  db
    .prepare(
      "SELECT fingerprint,status,result_json FROM guestbook_resource_operations WHERE resource_id=? AND id=?",
    )
    .bind(destination, operation)
    .first<ReceiptRow>();

export async function restorePortable(
  env: ResourceEnv,
  destination: string,
  proof: ResourceIdentity,
  raw: unknown,
): Promise<Response> {
  if (
    !exact(raw, ["operationId", "confirmRights", "manifest"]) ||
    typeof raw.operationId !== "string" ||
    !/^[a-zA-Z0-9-]{8,80}$/.test(raw.operationId) ||
    raw.confirmRights !== true
  ) {
    throw new PortabilityError(
      "Choose an operation identity and explicitly confirm permission to copy these contributions.",
    );
  }
  const manifest = portableManifest(raw.manifest),
    source = manifest.source,
    config = manifest.configuration;
  if (
    source.build !== proof.source ||
    source.resource === destination ||
    source.workspace !== proof.workspace ||
    source.account !== proof.account ||
    source.environment !== proof.environment ||
    source.target !== proof.target
  ) {
    throw new PortabilityError(
      "Restore requires fresh identities in this exact authorized workspace and source environment.",
      403,
    );
  }
  if (config.digest !== (await digest(JSON.stringify(config.values))))
    throw new PortabilityError(
      "The exported configuration digest does not match.",
    );
  const operation = raw.operationId;
  const fingerprint = await digest(
    JSON.stringify({ proof, destination, operation, manifest }),
  );
  const previous = await operationRow(env.DB, destination, operation);
  if (previous) return json(receipt(previous, fingerprint));
  if (
    await env.DB.prepare("SELECT id FROM guestbook_resources WHERE id=?")
      .bind(destination)
      .first()
  )
    throw new PortabilityError(
      "Restore never overwrites an existing resource.",
      409,
    );

  const sourceGuard = `EXISTS(SELECT 1 FROM guestbook_resources s JOIN guestbook_resource_configs c ON c.resource_id=s.id AND c.revision=s.active_revision
    WHERE s.id=? AND s.workspace_id=? AND s.account_id=? AND s.environment=? AND s.target=? AND s.version=? AND s.visible=1
      AND c.revision=? AND c.digest=? AND c.config_json=? AND c.source_revision=?)`;
  const sourceValues = [
    source.resource,
    proof.workspace,
    proof.account,
    proof.environment,
    proof.target,
    source.version,
    config.revision,
    config.digest,
    JSON.stringify(config.values),
    config.source,
  ];
  const itemGuard =
    () => `EXISTS(SELECT 1 FROM guestbook_resource_items s WHERE s.resource_id=? AND s.id=? AND s.revision=? AND s.status='approved'
    AND s.caption=? AND s.author=? AND s.synthetic=? AND s.created_at=? AND NOT EXISTS(SELECT 1 FROM guestbook_resource_lineage l WHERE l.item_id=s.id))`;
  const itemValues = (item: PortableItem) => [
    source.resource,
    item.id,
    item.revision,
    item.caption,
    item.author,
    item.synthetic,
    item.createdAt,
  ];
  const allGuards = [
    sourceGuard,
    ...manifest.items.map(() => itemGuard()),
  ].join(" AND ");
  const allValues = [...sourceValues, ...manifest.items.flatMap(itemValues)];
  if (
    !(await env.DB.prepare("SELECT 1 AS eligible WHERE " + allGuards)
      .bind(...allValues)
      .first())
  )
    throw new PortabilityError(
      "The current source no longer authorizes this export. Nothing was restored.",
      409,
    );

  const copies: { source: PortableItem; item: string; bytes: Uint8Array }[] =
    [];
  for (const item of manifest.items) {
    const supplied = Uint8Array.from(atob(item.media.base64), (char) =>
      char.charCodeAt(0),
    );
    const cleaned = await sanitisePNG(supplied);
    const original = await readMediaBytes(
      env,
      resourceMediaKey(source.resource, item.id),
    );
    if (
      !original ||
      cleaned.width > 1200 ||
      cleaned.height > 900 ||
      supplied.length > 100000 ||
      (await mediaDigest(cleaned.bytes)) !== item.media.sha256 ||
      (await mediaDigest(supplied)) !== item.media.sha256 ||
      (await mediaDigest(original)) !== item.media.sha256
    )
      throw new PortabilityError(
        "The current source media is unavailable or differs from this export.",
        409,
      );
    const identity = await digest(
      destination + ":" + operation + ":" + item.id,
    );
    copies.push({
      source: item,
      item:
        identity.slice(0, 8) +
        "-" +
        identity.slice(8, 12) +
        "-" +
        identity.slice(12, 16) +
        "-" +
        identity.slice(16, 20) +
        "-" +
        identity.slice(20, 32),
      bytes: cleaned.bytes,
    });
  }
  const result = {
    contract: 1,
    outcome: "applied",
    format: "guestbook.private-restore/v1",
    operationId: operation,
    resource: {
      id: destination,
      workspace: proof.workspace,
      account: proof.account,
      environment: proof.environment,
      target: proof.target,
      version: 1,
      visible: false,
      paused: true,
      activeRevision: null,
    },
    configuration: {
      revision: 1,
      digest: config.digest,
      source: proof.source,
      values: config.values,
    },
    items: copies.map((copy) => ({
      id: copy.item,
      source: copy.source.id,
      status: "pending",
      revision: 1,
    })),
    publication: "private",
    limitation,
  };
  const pending = `EXISTS(SELECT 1 FROM guestbook_resource_operations WHERE resource_id=? AND id=? AND fingerprint=? AND status='pending')`;
  const pendingValues = [destination, operation, fingerprint];
  const keys: string[] = [];
  let dispatched = false;
  try {
    for (const copy of copies) {
      const key = resourceMediaKey(destination, copy.item);
      keys.push(key);
      await env.MEDIA.put(key, copy.bytes, {
        httpMetadata: { contentType: "image/png" },
      });
    }
    const statements = [
      env.DB.prepare(
        `INSERT OR IGNORE INTO guestbook_resources(id,workspace_id,account_id,environment,target,creation_operation,visible,paused)
        SELECT ?,?,?,?,?,?,0,1 WHERE ${allGuards} AND (SELECT COUNT(*) FROM guestbook_resources WHERE workspace_id=?)<32`,
      ).bind(
        destination,
        proof.workspace,
        proof.account,
        proof.environment,
        proof.target,
        operation,
        ...allValues,
        proof.workspace,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO guestbook_resource_operations(resource_id,id,action,fingerprint,status)
        SELECT id,?,'restore',?,'pending' FROM guestbook_resources WHERE id=? AND creation_operation=? AND version=0 AND ${allGuards}`,
      ).bind(operation, fingerprint, destination, operation, ...allValues),
      env.DB.prepare(
        `INSERT OR IGNORE INTO guestbook_resource_configs(resource_id,revision,config_json,digest,source_revision)
        SELECT ?,1,?,?,? WHERE ${pending}`,
      ).bind(
        destination,
        JSON.stringify(config.values),
        config.digest,
        proof.source,
        ...pendingValues,
      ),
    ];
    for (const copy of copies) {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO guestbook_resource_items(id,resource_id,caption,author,status,synthetic)
        SELECT ?,?,?,?,'pending',? WHERE ${pending}`,
        ).bind(
          copy.item,
          destination,
          copy.source.caption,
          copy.source.author,
          copy.source.synthetic,
          ...pendingValues,
        ),
      );
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO guestbook_resource_lineage(item_id,source_item,source_resource,source_revision,source_configuration,source_digest,media_digest)
        SELECT ?,?,?,?,?,?,? WHERE ${pending}`,
        ).bind(
          copy.item,
          copy.source.id,
          source.resource,
          copy.source.revision,
          config.revision,
          config.digest,
          copy.source.media.sha256,
          ...pendingValues,
        ),
      );
    }
    statements.push(
      env.DB.prepare(
        `UPDATE guestbook_resources SET version=1 WHERE id=? AND version=0 AND ${pending}`,
      ).bind(destination, ...pendingValues),
    );
    statements.push(
      env.DB.prepare(
        `UPDATE guestbook_resource_operations SET status='completed',result_json=? WHERE resource_id=? AND id=? AND fingerprint=? AND status='pending'`,
      ).bind(JSON.stringify(result), ...pendingValues),
    );
    statements.push(
      env.DB.prepare(
        "SELECT fingerprint,status,result_json FROM guestbook_resource_operations WHERE resource_id=? AND id=?",
      ).bind(destination, operation),
    );
    dispatched = true;
    const outcome = await env.DB.batch(statements);
    const recorded = outcome.at(-1)?.results[0] as unknown as
      ReceiptRow | undefined;
    if (recorded) return json(receipt(recorded, fingerprint));
    throw new PortabilityError(
      "The source changed before restore committed, or this destination is no longer empty.",
      409,
    );
  } catch (failure) {
    if (dispatched || keys.length) {
      try {
        const committed = await operationRow(env.DB, destination, operation);
        if (committed) return json(receipt(committed, fingerprint));
        if (!(failure instanceof PortabilityError))
          return json(
            {
              contract: 1,
              outcome: "unknown",
              operationId: operation,
              resource: destination,
              error:
                "The restore may have committed. Keep this operation identity and check it before retrying.",
            },
            503,
          );
      } catch {
        return json(
          {
            contract: 1,
            outcome: "unknown",
            operationId: operation,
            resource: destination,
            error:
              "The restore may have committed. Its private media is retained; check this operation before retrying.",
          },
          503,
        );
      }
    }
    if (!dispatched && keys.length)
      return json(
        {
          contract: 1,
          outcome: "unknown",
          operationId: operation,
          resource: destination,
          error:
            "Private image storage was interrupted. Keep this operation identity and check it before retrying; a concurrent identical restore may have committed.",
        },
        503,
      );
    for (const key of keys) {
      try {
        await env.MEDIA.delete(key);
      } catch {
        /* No item grants access to an uncommitted object. */
      }
    }
    if (failure instanceof PortabilityError) throw failure;
    return json(
      {
        contract: 1,
        outcome: "refused",
        operationId: operation,
        error:
          "Private image storage failed before the restore was dispatched.",
      },
      503,
    );
  }
}
