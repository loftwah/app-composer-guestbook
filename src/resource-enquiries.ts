import { escape, html, json, limited, readJSON } from "./common.ts";
import type { ResourceEnv } from "./resources.ts";
import {
  EnquiryError,
  enquiryKeys,
  enquiryScope,
  enquiryScopeKey,
  enquirySubmission,
  enquiryIntent,
  enquiryRevision,
} from "./enquiry-contract.ts";
import { enquiryModel, enquiryBodyLimit } from "./enquiry-model.ts";
import {
  publicEnquiryScope,
  admitEnquiry,
  configureEnquiryScope,
  moderateEnquiry,
  enquiryOperation,
  purgeEnquiries,
  type EnquiryOwnerContext,
  type ScopeRow,
} from "./enquiry-store.ts";

const scopeKey = (value: string) =>
  value === "standalone" || /^[a-f0-9]{64}$/.test(value);
const enabled = (env: ResourceEnv) =>
  Boolean(
    env.RESOURCE_ACCOUNT_ID &&
    /^[a-z0-9-]{1,40}$/.test(env.RESOURCE_ENVIRONMENT ?? ""),
  );
function metadata(scope: ScopeRow | null, source: string) {
  return {
    contract: 1,
    format: "guestbook.enquiry-form/v1",
    source,
    open: Boolean(scope?.enabled),
    scope: scope
      ? {
          key: scope.scope_key,
          revision: scope.revision,
          provenance: JSON.parse(scope.provenance_json) as unknown,
        }
      : null,
    model: enquiryModel(),
    retentionDays: 30,
    receiptDays: 35,
    delivery: "private-workspace-only",
    notifications: false,
    contacts: false,
    uploads: false,
  };
}
async function body(req: Request, limit = enquiryBodyLimit): Promise<unknown> {
  if (
    !req.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new EnquiryError("Send the declared JSON form fields.", 415);
  try {
    return (await readJSON(req, limit)) as unknown;
  } catch {
    throw new EnquiryError(
      "The form body is invalid or exceeds its declared size.",
      400,
    );
  }
}
function failure(error: unknown) {
  if (error instanceof EnquiryError)
    return json(
      {
        contract: 1,
        error: error.message,
        ...(error.status === 503 ? { outcome: "unknown" } : {}),
      },
      error.status,
    );
  return json(
    {
      contract: 1,
      outcome: "unknown",
      error:
        "Storage could not confirm this enquiry operation. Keep its identity and check the receipt; do not resend automatically.",
    },
    503,
  );
}
async function cleanup(env: ResourceEnv) {
  try {
    await purgeEnquiries(env.DB);
  } catch {
    /* Reads filter expiry even when physical cleanup is unavailable. */
  }
}
async function receipt(env: ResourceEnv, scope: ScopeRow, intent: unknown) {
  if (!enquiryIntent(intent))
    throw new EnquiryError("Keep this form’s exact delivery intent.");
  const row = await env.DB.prepare(
    "SELECT intent_id FROM guestbook_enquiries WHERE resource_id=? AND scope_key=? AND configuration_revision=? AND intent_id=?",
  )
    .bind(
      scope.resource_id,
      scope.scope_key,
      scope.configuration_revision,
      intent,
    )
    .first();
  // A missing receipt is not evidence of rollback and never authorises a retry.
  return { contract: 1, intent, received: Boolean(row) };
}
async function send(
  req: Request,
  env: ResourceEnv,
  scope: ScopeRow,
  source: string,
  target: string,
  value: unknown,
) {
  const submission = enquirySubmission(value);
  if (await limited(req, env, `enquiry:${scope.resource_id}:delivery`, 2))
    throw new EnquiryError(
      "Two delivery attempts is enough for now. Keep your brief and check its receipt.",
      429,
    );
  return admitEnquiry(
    env.DB,
    scope,
    submission,
    env.RESOURCE_ACCOUNT_ID!,
    env.RESOURCE_ENVIRONMENT!,
    target,
    source,
  );
}

export async function publicEnquiryRoutes(
  req: Request,
  env: ResourceEnv,
  base: string,
  path: string,
  source: string,
): Promise<Response | null> {
  const match = path.match(
    /^\/r\/([a-z0-9-]{6,64})\/c\/([1-9][0-9]{0,9})\/enquiry(?:\/(submit|receipt))?$/,
  );
  if (!match) return null;
  try {
    if (!enabled(env))
      throw new EnquiryError("This private enquiry form is unavailable.", 404);
    const url = new URL(req.url),
      target = url.origin + base;
    if (url.search) throw new EnquiryError("Use this form’s exact route.", 400);
    if (match[3] ? req.method !== "POST" : req.method !== "GET")
      throw new EnquiryError("Use the declared form request method.", 405);
    if (
      match[3] &&
      (req.headers.get("Origin") !== url.origin ||
        req.headers.get("X-Guestbook-Enquiry-Source") !== source ||
        req.headers.get("X-Guestbook-Enquiry-Target") !== target)
    )
      throw new EnquiryError(
        "Open the current form at its verified app address before sending.",
        403,
      );
    const scope = await publicEnquiryScope(
      env.DB,
      match[1]!,
      "standalone",
      Number(match[2]),
      env.RESOURCE_ACCOUNT_ID!,
      env.RESOURCE_ENVIRONMENT!,
      target,
    );
    if (!scope)
      throw new EnquiryError(
        "This private enquiry form is closed or unavailable.",
        404,
      );
    await cleanup(env);
    if (!match[3]) {
      const row = await env.DB.prepare(
        "SELECT config_json FROM guestbook_resource_configs WHERE resource_id=? AND revision=?",
      )
        .bind(scope.resource_id, scope.configuration_revision)
        .first<{ config_json: string }>();
      const config = JSON.parse(row?.config_json ?? "{}") as Record<
        string,
        unknown
      >;
      const response = html(
        "Send a private brief",
        enquiryForm(
          base + path,
          base,
          source,
          target,
          String(config.title ?? "Here / there"),
        ),
        base,
        "guestbook",
        config.theme === "midnight" ? "midnight" : "daylight",
        "Send a private project brief. No contact details, notifications or publication.",
        env.PUBLIC_ORIGIN,
        path,
      );
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
      return response;
    }
    if (await limited(req, env, `enquiry:${scope.resource_id}:attempt`, 6))
      throw new EnquiryError(
        "Too many attempts. Keep your brief and check later.",
        429,
      );
    const raw = await body(req);
    if (match[3] === "receipt") {
      enquiryKeys(raw, ["contract", "intent"]);
      if (raw.contract !== 1)
        throw new EnquiryError("Use this form’s receipt contract.");
      return json(await receipt(env, scope, raw.intent));
    }
    return json(await send(req, env, scope, source, target, raw), 201);
  } catch (error) {
    return failure(error);
  }
}

export async function ownedEnquiryRoutes(
  req: Request,
  env: ResourceEnv,
  _base: string,
  tail: string,
  source: string,
  context: EnquiryOwnerContext,
): Promise<Response> {
  try {
    await cleanup(env);
    const id = context.resource.id,
      url = new URL(req.url);
    if (req.method === "GET") {
      if (tail === "receipt") {
        if (
          [...url.searchParams.keys()].some((key) => key !== "operation") ||
          url.searchParams.getAll("operation").length !== 1
        )
          throw new EnquiryError("Choose one exact operation receipt.");
        return json(
          await enquiryOperation(
            env.DB,
            id,
            url.searchParams.get("operation")!,
          ),
        );
      }
      if (tail === "export") {
        if (url.search)
          throw new EnquiryError("This export accepts no filters.");
        const rows = await env.DB.prepare(
          "SELECT id,scope_key,configuration_revision,provenance_json,model_version,producer_source,values_json,consent_version,consent_at,status,revision,created_at,expires_at FROM guestbook_enquiries WHERE resource_id=? AND values_json IS NOT NULL AND expires_at>CURRENT_TIMESTAMP ORDER BY created_at DESC,id LIMIT 200",
        )
          .bind(id)
          .all<Record<string, unknown>>();
        return json({
          contract: 1,
          format: "guestbook.private-enquiries/v1",
          source,
          resource: context.resource,
          retentionDays: 30,
          items: rows.results.map(itemView),
          covers: {
            privateBodies: true,
            consent: true,
            provenance: true,
            notifications: false,
            credentials: false,
          },
          scope: "current-resource-only",
        });
      }
      if (
        tail ||
        [...url.searchParams.keys()].some(
          (key) => !["status", "page"].includes(key),
        ) ||
        [...url.searchParams.keys()].some(
          (key) => url.searchParams.getAll(key).length !== 1,
        )
      )
        throw new EnquiryError("Choose a bounded enquiry inbox filter.");
      const status = url.searchParams.get("status") ?? "pending",
        page = url.searchParams.get("page") ?? "1";
      if (
        !["pending", "reviewed", "rejected", "all"].includes(status) ||
        !/^(?:[1-9]|10)$/.test(page)
      )
        throw new EnquiryError("Choose an inbox state and page from1 to10.");
      const rows = await env.DB.prepare(
        "SELECT id,scope_key,configuration_revision,provenance_json,model_version,producer_source,values_json,consent_version,consent_at,status,revision,created_at,expires_at FROM guestbook_enquiries WHERE resource_id=? AND values_json IS NOT NULL AND expires_at>CURRENT_TIMESTAMP AND (?='all' OR status=?) ORDER BY created_at DESC,id LIMIT 20 OFFSET ?",
      )
        .bind(id, status, status, (Number(page) - 1) * 20)
        .all<Record<string, unknown>>();
      const scopes = await env.DB.prepare(
        "SELECT scope_key,provenance_json,enabled,revision FROM guestbook_enquiry_scopes WHERE resource_id=? ORDER BY enabled DESC,updated_at DESC LIMIT 64",
      )
        .bind(id)
        .all<{
          scope_key: string;
          provenance_json: string;
          enabled: number;
          revision: number;
        }>();
      return json({
        contract: 1,
        format: "guestbook.enquiry-inbox/v1",
        source,
        resource: context.resource,
        status,
        page: Number(page),
        limit: 20,
        retentionDays: 30,
        notifications: false,
        items: rows.results.map(itemView),
        scopes: scopes.results.map((s) => ({
          key: s.scope_key,
          provenance: JSON.parse(s.provenance_json) as unknown,
          enabled: Boolean(s.enabled),
          revision: s.revision,
        })),
      });
    }
    if (req.method !== "POST" || tail || url.search)
      throw new EnquiryError("Use the declared enquiry operation route.", 405);
    const raw = await body(req);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new EnquiryError("Choose a declared enquiry operation.");
    const command = raw as Record<string, unknown>;
    if (command.action === "configure") {
      enquiryKeys(command, [
        "contract",
        "action",
        "scope",
        "enabled",
        "expectedScopeRevision",
        "expectedVersion",
        "operation",
      ]);
      if (
        command.contract !== 1 ||
        typeof command.enabled !== "boolean" ||
        !enquiryRevision(command.expectedScopeRevision, true) ||
        !enquiryRevision(command.expectedVersion, true) ||
        !enquiryIntent(command.operation)
      )
        throw new EnquiryError(
          "Choose exact current form/resource revisions and an operation identity.",
        );
      return json(
        await configureEnquiryScope(
          env.DB,
          context,
          enquiryScope(command.scope, id),
          command.enabled,
          command.expectedScopeRevision,
          command.expectedVersion,
          command.operation,
        ),
      );
    }
    if (["review", "reject", "delete"].includes(String(command.action))) {
      enquiryKeys(command, [
        "contract",
        "action",
        "item",
        "expectedRevision",
        "expectedVersion",
        "operation",
      ]);
      if (
        command.contract !== 1 ||
        typeof command.item !== "string" ||
        !enquiryRevision(command.expectedRevision) ||
        !enquiryRevision(command.expectedVersion, true) ||
        !enquiryIntent(command.operation)
      )
        throw new EnquiryError(
          "Choose the exact private entry and current revisions.",
        );
      return json(
        await moderateEnquiry(
          env.DB,
          context,
          command.action as "review" | "reject" | "delete",
          command.item,
          command.expectedRevision,
          command.expectedVersion,
          command.operation,
        ),
      );
    }
    if (
      ["form", "submit", "deliveryReceipt"].includes(String(command.action))
    ) {
      enquiryKeys(
        command,
        command.action === "form"
          ? ["contract", "action", "scope"]
          : [
              "contract",
              "action",
              "scope",
              command.action === "submit" ? "submission" : "intent",
            ],
      );
      if (command.contract !== 1)
        throw new EnquiryError("Use the private enquiry contract.");
      const selected = enquiryScope(command.scope, id),
        key = await enquiryScopeKey(selected);
      const scope = await publicEnquiryScope(
        env.DB,
        id,
        key,
        selected.configuration,
        context.proof.account,
        context.proof.environment,
        context.proof.target,
      );
      if (command.action === "form") return json(metadata(scope, source));
      if (!scope || !scopeKey(key))
        throw new EnquiryError(
          "This exact private enquiry form is closed.",
          404,
        );
      if (command.action === "deliveryReceipt")
        return json(await receipt(env, scope, command.intent));
      if (await limited(req, env, `enquiry:${id}:attempt`, 6))
        throw new EnquiryError(
          "Too many attempts. Keep the brief and check later.",
          429,
        );
      return json(
        await send(
          req,
          env,
          scope,
          source,
          context.proof.target,
          command.submission,
        ),
        201,
      );
    }
    throw new EnquiryError("Choose a supported private enquiry operation.");
  } catch (error) {
    return failure(error);
  }
}
function itemView(row: Record<string, unknown>) {
  const { provenance_json, values_json, ...metadata } = row;
  return {
    ...metadata,
    provenance: JSON.parse(String(provenance_json)) as unknown,
    values: values_json ? (JSON.parse(String(values_json)) as unknown) : null,
  };
}

export function enquiryForm(
  action: string,
  assetBase: string,
  source: string,
  target: string,
  title: string,
) {
  return `<section class="enquiry-intro"><p class="collection-kicker">PRIVATE BRIEF · ${escape(title)}</p><h1>What are you working on?</h1><p class="lede">A short brief for this workspace. No email address, phone number or account needed.</p><p>The owner can read, review or delete it privately for up to30 days. Nothing is published and no notification or reply is sent. Leave out personal details and secrets.</p></section>
  <link rel="stylesheet" href="${escape(assetBase)}/brand/enquiry-form.css">
  <form id="private-enquiry" action="${escape(action)}/submit" method="post" data-source="${escape(source)}" data-target="${escape(target)}" data-receipt="${escape(action)}/receipt">
  <fieldset><legend>The brief</legend><label>Project or enquiry name<input name="title" maxlength="120" autocomplete="off" required></label><label>What should this achieve?<textarea name="goal" maxlength="2000" rows="5" required></textarea></label><label>Starting point<select name="starting_point"><option>New idea</option><option>Existing site</option></select></label><label data-existing-site hidden>Existing website (optional, HTTPS)<input name="existing_site" type="url" maxlength="240" autocomplete="off" placeholder="https://"></label></fieldset>
  <fieldset><legend>What is needed</legend><p>Up to8 deliverables, if useful.</p><div data-deliverables></div><button type="button" class="secondary" data-add-deliverable>Add a deliverable</button></fieldset>
  <label class="postcard-consent"><input name="consent" type="checkbox" required> I agree to private delivery of this brief to this workspace for review. This does not permit publication or messages.</label>
  <button data-send disabled>Send private brief</button><noscript><p>JavaScript is needed to validate the declared fields and keep an exact delivery receipt. No brief has been sent.</p></noscript>
  <section data-receipt-panel hidden aria-label="Delivery receipt"><p data-intent></p><button type="button" class="secondary" data-check>Check delivery receipt</button><p class="small">A missing receipt cannot prove delivery failed. Your brief stays here; nothing is resent automatically.</p></section>
  <p data-status role="status" aria-live="polite" tabindex="-1"></p></form><script src="${escape(assetBase)}/brand/browser/enquiry-form.js" type="module"></script>`;
}
