import { basePath, error, json, readJSON } from "./common.ts";
import { object } from "./resource-config.ts";
import { resourcePublicRoute } from "./resource-public.ts";
import {
  requireMemberConfiguration,
  submitMemberPostcard,
  memberContributionStatus,
} from "./member-contribution.ts";
import {
  digest,
  mutateResource,
  ownedResource,
  resourceIdentity,
  ResourceError,
  type ResourceEnv,
} from "./resources.ts";

export interface MemberEnv extends ResourceEnv {
  MEMBER_SERVICE_TOKEN?: string;
  MEMBER_ISSUER?: string;
}
export const memberServiceContract = {
  version: 2,
  entrypoint: "GuestbookMemberService",
  transport: "service-binding",
  path: "/__composer/member",
} as const;

// Only the named Worker service entrypoint calls this function. The public
// Worker rejects this route even with a member token. Composer owns the current
// membership/grant lookup immediately before dispatch; no duplicate grant store
// or browser-supplied ownership assertion is introduced here.
export async function memberServiceRequest(
  req: Request,
  env: MemberEnv,
  source: string,
): Promise<Response> {
  const url = new URL(req.url),
    base = basePath(url, "guestbook");
  if (url.pathname !== base + "/__composer/member")
    return error("Page not found.", 404);
  if (req.method !== "POST")
    return error("Use POST for the selected member operation.", 405);
  if (
    !env.MEMBER_SERVICE_TOKEN ||
    !env.MEMBER_ISSUER ||
    env.MEMBER_SERVICE_TOKEN === env.OWNER_API_TOKEN
  )
    return error(
      "Member Guestbooks are not connected in this environment.",
      503,
    );
  try {
    // The independent member secret is never accepted by owner routes. Reuse
    // exact runtime/source/target proof validation with this narrow credential.
    const proof = await resourceIdentity(
      req,
      { ...env, OWNER_API_TOKEN: env.MEMBER_SERVICE_TOKEN },
      base,
      source,
    );
    const body: unknown = await readJSON(req, 150000);
    if (
      !object(body) ||
      Object.keys(body).some(
        (key) =>
          ![
            "schema",
            "actor",
            "workspace",
            "resource",
            "action",
            "input",
            "configuration",
            "context",
          ].includes(key),
      ) ||
      !["composer.member-operation/1", "composer.member-operation/2"].includes(
        String(body.schema),
      ) ||
      body.workspace !== proof.workspace ||
      typeof body.resource !== "string" ||
      !/^[a-z0-9-]{6,64}$/.test(body.resource) ||
      !object(body.actor) ||
      Object.keys(body.actor).some(
        (key) => !["issuer", "accountId"].includes(key),
      ) ||
      body.actor.issuer !== env.MEMBER_ISSUER ||
      typeof body.actor.accountId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(body.actor.accountId) ||
      !object(body.input) ||
      !["contribute", "moderate", "contribution-status"].includes(
        String(body.action),
      )
    ) {
      return error(
        "The selected member, resource or action does not match.",
        403,
      );
    }
    const resource = await ownedResource(env.DB, body.resource, proof);
    const version2 = body.schema === "composer.member-operation/2";
    if (Object.keys(body).length !== (version2 ? 8 : 6))
      return error(
        "Use the complete versioned member operation envelope.",
        403,
      );
    if (version2) {
      if (
        !object(body.context) ||
        Object.keys(body.context).length !== 1 ||
        body.context.dataClass !== "synthetic"
      )
        return error(
          "This member contract requires trusted synthetic-only context.",
          403,
        );
      const configuration = await requireMemberConfiguration(
        env,
        resource.id,
        proof,
        body.configuration,
        body.action === "contribute",
      );
      if (body.action === "contribute")
        return await submitMemberPostcard(
          req,
          env,
          resource.id,
          proof,
          configuration,
          {
            issuer: String(body.actor.issuer),
            accountId: body.actor.accountId,
          },
          body.input,
        );
      if (body.action === "contribution-status")
        return await memberContributionStatus(
          env,
          resource.id,
          {
            issuer: String(body.actor.issuer),
            accountId: body.actor.accountId,
          },
          body.input,
        );
    } else {
      if (body.action === "contribution-status")
        return error("Use the version 2 contribution receipt contract.", 400);
      // Old bridges cannot enter a newly opted-in member-only resource without
      // its exact configuration assertions and synthetic contract.
      const current = await env.DB.prepare(
        "SELECT config_json FROM guestbook_resource_configs WHERE resource_id=? AND revision=?",
      )
        .bind(resource.id, resource.active_revision)
        .first<{ config_json: string }>();
      if (
        current &&
        (JSON.parse(current.config_json) as { guestAccess?: unknown })
          .guestAccess === "members"
      )
        return error(
          "This resource requires the version 2 member contract.",
          409,
        );
    }
    if (body.action === "contribute") {
      if (
        Object.keys(body.input).some(
          (key) => !["caption", "author", "consent", "png"].includes(key),
        )
      )
        return error(
          "Send only the postcard message, alias, consent and image.",
        );
      // Reuse the app-owned public submission path, including live visibility,
      // closure, PNG sanitation, limits, atomic caps and uncertain-write handling.
      // Its public puzzle code conveys no account or moderation authority.
      const contributionURL = `${url.origin}${base}/r/${resource.id}/api/guest-postcard`;
      const connectionBucket = await digest(JSON.stringify(body.actor));
      return await resourcePublicRoute(
        new Request(contributionURL, {
          method: "POST",
          headers: {
            Origin: url.origin,
            "Content-Type": "application/json",
            "CF-Connecting-IP": "member:" + connectionBucket,
          },
          body: JSON.stringify({ code: "hunter2", ...body.input }),
        }),
        env,
        base,
        `/r/${resource.id}/api/guest-postcard`,
      );
    }
    const input = body.input;
    if (input.operation === "list" && Object.keys(input).length === 1) {
      const items = await env.DB.prepare(
        "SELECT id,caption,author,status,revision,synthetic FROM guestbook_resource_items WHERE resource_id=? AND status!='deleted' ORDER BY created_at DESC,id LIMIT 200",
      )
        .bind(resource.id)
        .all();
      return json({
        contract: version2 ? 2 : 1,
        resource: { id: resource.id, version: resource.version },
        items: items.results,
      });
    }
    if (
      input.operation !== "moderate" ||
      Object.keys(input).some(
        (key) =>
          ![
            "operation",
            "operationId",
            "expectedVersion",
            "item",
            "itemRevision",
            "status",
          ].includes(key),
      ) ||
      !["approved", "hidden", "rejected"].includes(String(input.status)) ||
      typeof input.operationId !== "string" ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(input.operationId)
    ) {
      return error("Choose a supported contribution review operation.");
    }
    // Namespace idempotency by stable actor, so an operation from a different
    // member cannot obtain or reuse a private acknowledgement by guessing its id.
    const operation =
      "member-" +
      (await digest(
        JSON.stringify({ actor: body.actor, operation: input.operationId }),
      ));
    const result = (await mutateResource(env, resource.id, proof, {
      action: "moderate",
      operationId: operation,
      expectedVersion: input.expectedVersion,
      item: input.item,
      itemRevision: input.itemRevision,
      status: input.status,
    })) as { resource: { version: number } };
    return json({
      contract: version2 ? 2 : 1,
      outcome: "applied",
      resource: { id: resource.id, version: result.resource.version },
      item: input.item,
      status: input.status,
    });
  } catch (failure) {
    if (failure instanceof ResourceError)
      return error(failure.message, failure.status);
    return json(
      {
        contract: 1,
        outcome: "unknown",
        error:
          "The member operation could not be confirmed. Keep its operation identity and check before retrying.",
      },
      503,
    );
  }
}
