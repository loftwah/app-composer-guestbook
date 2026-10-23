// Run after pnpm build. Exercise the actual bundled named entrypoint in workerd,
// with fictional app-owned D1/R2 and a separate caller Worker service binding.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare");
const ownedRoot = mkdtempSync(join(tmpdir(), "guestbook-member-runtime-"));
let runtime;
try {
  const source = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const target = "https://composer.example.test/guestbook",
    workspace = "fictional-workspace-0001";
  const account = "fictional-account",
    resource = "fictional-resource-0001";
  const actor = {
    issuer: "https://composer.example.test",
    accountId: "fictional-member-a",
  };
  const ownerToken = "fictional-owner-token",
    memberToken = "fictional-member-token";
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      defaultPersistRoot: ownedRoot,
      workers: [
        {
          name: "guestbook",
          modules: true,
          scriptPath: resolve("dist/worker.js"),
          compatibilityDate: "2026-10-13",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            OWNER_API_TOKEN: ownerToken,
            MEMBER_SERVICE_TOKEN: memberToken,
            MEMBER_ISSUER: actor.issuer,
            PUBLIC_ORIGIN: "https://guestbook.example.test",
            RESOURCE_ACCOUNT_ID: account,
            RESOURCE_ENVIRONMENT: "fictional-test",
          },
          d1Databases: { DB: "fictional-guestbook" },
          r2Buckets: { MEDIA: "fictional-media" },
        },
        {
          name: "caller",
          modules: true,
          compatibilityDate: "2026-10-13",
          script:
            "export default { fetch(request, env) { return env.GUESTBOOK_MEMBERS.fetch(request); } };",
          serviceBindings: {
            GUESTBOOK_MEMBERS: {
              name: "guestbook",
              entrypoint: "GuestbookMemberService",
            },
          },
        },
      ],
    }),
  );
  const db = await runtime.getD1Database("DB", "guestbook");
  for (const file of [
    "0001.sql",
    "0002_owned_resources.sql",
    "0003_portability_lineage.sql",
  ]) {
    // D1 exec accepts statements on separate lines; preserve statement grouping
    // by splitting SQL here, rather than relying on Node's SQLite adapter.
    for (const sql of readFileSync(resolve("migrations", file), "utf8")
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  }
  const direct = await runtime.getWorker("guestbook"),
    caller = await runtime.getWorker("caller");
  const headers = (token) => ({
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
    "X-Composer-Workspace": workspace,
    "X-Composer-Account": account,
    "X-Composer-Environment": "fictional-test",
    "X-Composer-Source": source,
    "X-Composer-Target": target,
  });
  let operation = 0;
  const owner = async (input) => {
    const response = await direct.fetch(target + "/api/resources/" + resource, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({
        operationId: "runtime-operation-" + ++operation,
        ...input,
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  await owner({ action: "create" });
  const staged = await owner({
    action: "stage",
    expectedVersion: 0,
    configuration: {
      title: "Fictional runtime book",
      intro: "Fictional only",
      theme: "daylight",
      layout: "grid",
      guestAccess: "postcards",
    },
  });
  await owner({
    action: "activate",
    expectedVersion: 1,
    configurationRevision: staged.configuration.revision,
    configurationDigest: staged.configuration.digest,
  });
  const envelope = {
    schema: "composer.member-operation/1",
    actor,
    workspace,
    resource,
    action: "moderate",
    input: { operation: "list" },
  };
  const invoke = (worker, token = memberToken, body = envelope) =>
    worker.fetch(target + "/__composer/member", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    });
  assert.equal(
    (await invoke(direct)).status,
    404,
    "member credential cannot reach named entrypoint on public transport",
  );
  assert.equal((await invoke(direct, ownerToken)).status, 404);
  assert.equal(
    (await invoke(caller, ownerToken)).status,
    401,
    "general owner credential cannot become member authority",
  );
  const permitted = await invoke(caller);
  assert.equal(permitted.status, 200, await permitted.clone().text());
  assert.deepEqual(await permitted.json(), {
    contract: 1,
    resource: { id: resource, version: 2 },
    items: [],
  });
  assert.equal(
    (
      await invoke(caller, memberToken, {
        ...envelope,
        resource: "other-resource-0001",
      })
    ).status,
    403,
  );
  assert.equal(
    (await invoke(caller, memberToken, { ...envelope, action: "export" }))
      .status,
    403,
  );
  console.log(
    JSON.stringify({
      source,
      runtime: "workerd via pinned Wrangler Miniflare",
      namedEntrypoint: "GuestbookMemberService",
      publicMemberRoute: 404,
      wrongOwnerCredential: 401,
      boundMemberReview: 200,
      foreignResource: 403,
      export: 403,
      fictionalOnly: true,
    }),
  );
} finally {
  try {
    await runtime?.dispose();
  } finally {
    rmSync(ownedRoot, { recursive: true, force: true });
  }
}
