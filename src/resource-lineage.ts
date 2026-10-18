import type { ResourceEnv } from "./resources.ts";

// Alias is authored SQL, never a request parameter. Legacy/non-restored items
// have no lineage. A changed source revision permanently invalidates an older
// copy, even if the source is subsequently approved again.
export function lineageEligibleSQL(alias: string): string {
  return `NOT EXISTS(SELECT 1 FROM guestbook_resource_lineage l WHERE l.item_id=${alias}.id AND NOT EXISTS(
    SELECT 1 FROM guestbook_resource_items s
    JOIN guestbook_resources r ON r.id=s.resource_id
    JOIN guestbook_resources d ON d.id=${alias}.resource_id
    JOIN guestbook_resource_configs c ON c.resource_id=r.id AND c.revision=r.active_revision
    WHERE s.id=l.source_item AND s.resource_id=l.source_resource AND s.status='approved'
      AND s.revision=l.source_revision AND r.visible=1 AND r.active_revision=l.source_configuration
      AND c.digest=l.source_digest AND r.workspace_id=d.workspace_id AND r.account_id=d.account_id
      AND r.environment=d.environment AND r.target=d.target
      AND NOT EXISTS(SELECT 1 FROM guestbook_resource_lineage nested WHERE nested.item_id=s.id)))`;
}

export async function mediaDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function readMediaBytes(
  env: ResourceEnv,
  key: string,
): Promise<Uint8Array | null> {
  const object = await env.MEDIA.get(key);
  if (!object) return null;
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 100000) {
      await reader.cancel();
      throw Error("The source image exceeds the supported portability limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function lineageMediaAllowed(
  env: ResourceEnv,
  resource: string,
  item: string,
  publicRead = false,
): Promise<boolean> {
  const current = publicRead
    ? "i.status='approved' AND EXISTS(SELECT 1 FROM guestbook_resources own WHERE own.id=i.resource_id AND own.visible=1 AND own.active_revision IS NOT NULL)"
    : "i.status!='deleted'";
  const selected = await env.DB.prepare(
    `SELECT i.id,l.source_resource,l.source_item,l.media_digest
    FROM guestbook_resource_items i LEFT JOIN guestbook_resource_lineage l ON l.item_id=i.id
    WHERE i.resource_id=? AND i.id=? AND ${current} AND ${lineageEligibleSQL("i")}`,
  )
    .bind(resource, item)
    .first<{
      id: string;
      source_resource: string | null;
      source_item: string | null;
      media_digest: string | null;
    }>();
  if (!selected) return false;
  if (!selected.source_item) return true;
  const bytes = await readMediaBytes(
    env,
    `resources/${selected.source_resource}/photos/${selected.source_item}.png`,
  );
  if (!bytes || (await mediaDigest(bytes)) !== selected.media_digest)
    return false;
  // The R2 await cannot grant authority after a concurrent source revocation.
  return Boolean(
    await env.DB.prepare(
      `SELECT id FROM guestbook_resource_items i WHERE resource_id=? AND id=? AND ${current} AND ${lineageEligibleSQL("i")}`,
    )
      .bind(resource, item)
      .first(),
  );
}
