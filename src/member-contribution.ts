import { error, json, limited, text } from "./common.ts";
import { object } from "./resource-config.ts";
import { sanitisePNG } from "./png.ts";
import {
  lineageEligibleSQL,
  resourceRestoreEligibleSQL,
  mediaDigest,
  readMediaBytes,
} from "./resource-lineage.ts";
import {
  digest,
  resourceMediaKey,
  ResourceError,
  type ResourceEnv,
  type ResourceIdentity,
} from "./resources.ts";

export interface MemberConfiguration {
  revision: number;
  digest: string;
  source: string;
}
interface SubmissionOperation {
  fingerprint: string;
  status: "pending" | "completed";
  result_json: string | null;
}
const operationFor = async (
  actor: { issuer: string; accountId: string },
  resource: string,
  operationId: string,
) =>
  "member-" +
  (await digest(JSON.stringify({ actor, resource, operation: operationId })));
export async function memberContributionStatus(
  env: ResourceEnv,
  resource: string,
  actor: { issuer: string; accountId: string },
  input: Record<string, unknown>,
) {
  if (
    Object.keys(input).length !== 1 ||
    typeof input.operationId !== "string" ||
    !/^[a-zA-Z0-9-]{8,80}$/.test(input.operationId)
  )
    return error("Choose the original submission identity.");
  const operation = await operationFor(actor, resource, input.operationId);
  const record = await env.DB.prepare(
    "SELECT status,result_json FROM guestbook_resource_operations WHERE resource_id=? AND id=? AND action='member-contribute'",
  )
    .bind(resource, operation)
    .first<SubmissionOperation>();
  const stored = record?.result_json
    ? (JSON.parse(record.result_json) as {
        configuration: MemberConfiguration;
        bodyDigest: string;
        dataClass: "synthetic";
        receipt: Record<string, unknown>;
      })
    : null;
  return json({
    contract: 2,
    resource,
    operationId: input.operationId,
    outcome: !record
      ? "not-recorded"
      : record.status === "completed"
        ? "completed"
        : "pending",
    ...(stored
      ? {
          identity: {
            configuration: stored.configuration,
            bodyDigest: stored.bodyDigest,
            dataClass: stored.dataClass,
          },
        }
      : {}),
    ...(stored && record?.status === "completed"
      ? { receipt: stored.receipt }
      : {}),
  });
}

// These assertions come only from the authenticated named service envelope.
// Neither a public header nor a guest code selects this admission path.
const activeSQL = (
  contributing: boolean,
) => `SELECT r.id FROM guestbook_resources r
  JOIN guestbook_resource_configs c ON c.resource_id=r.id AND c.revision=r.active_revision
  WHERE r.id=? AND r.workspace_id=? AND r.account_id=? AND r.environment=? AND r.target=?
    AND r.active_revision=? AND c.digest=? AND c.source_revision=? AND c.activated_at IS NOT NULL
    ${contributing ? "AND r.visible=1 AND r.paused=0 AND json_extract(c.config_json,'$.guestAccess')='members'" : ""}
    AND ${resourceRestoreEligibleSQL("r")}
    AND NOT EXISTS(SELECT 1 FROM guestbook_resource_items restored WHERE restored.resource_id=r.id
      AND restored.status!='deleted' AND NOT (${lineageEligibleSQL("restored")}))`;
const identityValues = (
  resource: string,
  proof: ResourceIdentity,
  configuration: MemberConfiguration,
) => [
  resource,
  proof.workspace,
  proof.account,
  proof.environment,
  proof.target,
  configuration.revision,
  configuration.digest,
  configuration.source,
];

export async function requireMemberConfiguration(
  env: ResourceEnv,
  resource: string,
  proof: ResourceIdentity,
  value: unknown,
  contributing = false,
): Promise<MemberConfiguration> {
  if (
    !object(value) ||
    Object.keys(value).length !== 3 ||
    !Object.keys(value).every((key) =>
      ["revision", "digest", "source"].includes(key),
    ) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    typeof value.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.digest) ||
    value.source !== proof.source
  ) {
    throw new ResourceError(
      "Select the exact current resource configuration and source.",
      409,
    );
  }
  const configuration = value as unknown as MemberConfiguration;
  if (
    !(await env.DB.prepare(activeSQL(contributing))
      .bind(...identityValues(resource, proof, configuration))
      .first())
  )
    throw new ResourceError(
      contributing
        ? "Member contributions are closed or the resource configuration changed."
        : "The active resource configuration changed.",
      409,
    );
  return configuration;
}

export async function submitMemberPostcard(
  req: Request,
  env: ResourceEnv,
  resource: string,
  proof: ResourceIdentity,
  configuration: MemberConfiguration,
  actor: { issuer: string; accountId: string },
  input: Record<string, unknown>,
): Promise<Response> {
  if (
    Object.keys(input).length !== 5 ||
    !Object.keys(input).every((key) =>
      ["operationId", "caption", "author", "consent", "png"].includes(key),
    ) ||
    typeof input.operationId !== "string" ||
    !/^[a-zA-Z0-9-]{8,80}$/.test(input.operationId)
  )
    return error(
      "Send a stable submission identity, message, alias, consent and PNG.",
    );
  if (input.consent !== true)
    return error(
      "Confirm this fictional postcard may be submitted for possible publication.",
    );
  const caption = text(input.caption, 160),
    author = text(input.author, 60);
  if (
    !caption ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(caption + author)
  )
    return error("Write a short fictional message using ordinary text.");
  if (
    typeof input.png !== "string" ||
    input.png.length > 140000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.png)
  )
    return error("The postcard image is too large or invalid.");

  const operation = await operationFor(actor, resource, input.operationId);
  const bodyDigest = await digest(
    JSON.stringify({
      operationId: input.operationId,
      caption: input.caption,
      author: input.author,
      consent: input.consent,
      png: input.png,
    }),
  );
  const fingerprint = await digest(
    JSON.stringify({
      proof,
      configuration,
      actor,
      bodyDigest,
      dataClass: "synthetic",
    }),
  );
  const id = await digest("postcard:" + resource + ":" + operation),
    key = resourceMediaKey(resource, id);
  const receipt = {
    id,
    resource,
    operationId: input.operationId,
    status: "pending",
    message:
      "Your fictional postcard is with its reviewers. It stays private unless they approve it.",
  };
  const readOperation = () =>
    env.DB.prepare(
      "SELECT fingerprint,status,result_json FROM guestbook_resource_operations WHERE resource_id=? AND id=?",
    )
      .bind(resource, operation)
      .first<SubmissionOperation>();
  const unknown = () =>
    json(
      {
        id,
        resource,
        operationId: input.operationId,
        outcome: "unknown",
        message:
          "This postcard may already be waiting for review. Keep this submission identity and check before retrying.",
      },
      503,
    );
  let record = await readOperation();
  if (record && record.fingerprint !== fingerprint)
    return error(
      "This submission identity belongs to different postcard data.",
      409,
    );
  if (record?.status === "completed") return json(receipt, 201);

  let cleaned: Awaited<ReturnType<typeof sanitisePNG>>;
  try {
    cleaned = await sanitisePNG(
      Uint8Array.from(atob(input.png), (char) => char.charCodeAt(0)),
    );
  } catch {
    return error("Use a complete, valid PNG postcard.");
  }
  if (
    cleaned.bytes.length > 100000 ||
    cleaned.width > 1200 ||
    cleaned.height > 900
  )
    return error("Use a postcard image up to 1200 × 900 pixels and 100 KB.");
  const imageDigest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", cleaned.bytes)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  const operationRecord = JSON.stringify({
    schema: "guestbook.member-contribution-receipt/2",
    actor,
    proof,
    configuration,
    bodyDigest,
    imageDigest,
    dataClass: "synthetic",
    receipt,
  });
  // PNG decompression is asynchronous. Recheck the exact active state before
  // reserving an operation or touching its private media.
  await requireMemberConfiguration(env, resource, proof, configuration, true);
  if (!record) {
    const bucket = await digest(JSON.stringify(actor));
    const limitedRequest = new Request(req.url, {
      headers: { "CF-Connecting-IP": "member:" + bucket },
    });
    if (
      await limited(
        limitedRequest,
        env,
        `resource:${resource}:member-attempt`,
        6,
      )
    )
      return error("Too many attempts. Keep this postcard and try later.", 429);
    const day = Math.floor(Date.now() / 86400000);
    const admitted = await env.DB.prepare(
      "INSERT INTO rate_limits(id,n,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET n=n+1 WHERE n<8 RETURNING n",
    )
      .bind(`resource:${resource}:member-day:${day}`, (day + 1) * 86400000)
      .first();
    if (!admitted)
      return error(
        "Today’s member postcard limit is reached. Keep this postcard and try tomorrow.",
        429,
      );
    await env.DB.prepare(
      `INSERT OR IGNORE INTO guestbook_resource_operations(resource_id,id,action,fingerprint,status,result_json)
      SELECT ?,?,'member-contribute',?,'pending',? WHERE EXISTS(${activeSQL(true)})`,
    )
      .bind(
        resource,
        operation,
        fingerprint,
        operationRecord,
        ...identityValues(resource, proof, configuration),
      )
      .run();
    record = await readOperation();
    if (!record)
      return error(
        "Member contributions closed before this submission was reserved.",
        409,
      );
    if (record.fingerprint !== fingerprint)
      return error(
        "This submission identity belongs to different postcard data.",
        409,
      );
    if (record.status === "completed") return json(receipt, 201);
  }

  try {
    // A retry of this actor/resource/operation can write only these exact bytes.
    // Keep staged private bytes on uncertain outcomes: another identical request
    // may have committed, so deleting its deterministic key would destroy data.
    const existing = await readMediaBytes(env, key);
    if (existing) {
      if ((await mediaDigest(existing)) !== imageDigest)
        return error(
          "The retained private image does not match this submission.",
          409,
        );
    } else
      await env.MEDIA.put(key, cleaned.bytes, {
        httpMetadata: { contentType: "image/png" },
      });
    const eligible = `EXISTS(${activeSQL(true)}) AND EXISTS(SELECT 1 FROM guestbook_resource_operations WHERE resource_id=? AND id=? AND fingerprint=? AND status='pending')`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO guestbook_resource_items(id,resource_id,caption,author,status,synthetic)
        SELECT ?,?,?,?,'pending',1 WHERE ${eligible}
          AND (SELECT COUNT(*) FROM guestbook_resource_items WHERE resource_id=? AND status='pending')<16
          AND (SELECT COUNT(*) FROM guestbook_resource_items WHERE resource_id=? AND status!='deleted')<200`,
      ).bind(
        id,
        resource,
        caption,
        author,
        ...identityValues(resource, proof, configuration),
        resource,
        operation,
        fingerprint,
        resource,
        resource,
      ),
      env.DB.prepare(
        `UPDATE guestbook_resource_operations SET status='completed',result_json=?
        WHERE resource_id=? AND id=? AND fingerprint=? AND status='pending'
          AND EXISTS(SELECT 1 FROM guestbook_resource_items WHERE resource_id=? AND id=? AND caption=? AND author=? AND synthetic=1)`,
      ).bind(
        operationRecord,
        resource,
        operation,
        fingerprint,
        resource,
        id,
        caption,
        author,
      ),
    ]);
    const confirmed = await readOperation();
    if (
      confirmed?.fingerprint === fingerprint &&
      confirmed.status === "completed"
    )
      return json(receipt, 201);
    return error(
      "The resource changed or its review queue is full. The private submission identity is retained; check before retrying.",
      409,
    );
  } catch {
    try {
      const confirmed = await readOperation();
      if (
        confirmed?.fingerprint === fingerprint &&
        confirmed.status === "completed"
      )
        return json(receipt, 201);
    } catch {
      /* A failed read cannot prove that the item did not commit. */
    }
    return unknown();
  }
}
