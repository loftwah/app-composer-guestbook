// Run after pnpm build. Exercise the actual bundled named entrypoint in workerd,
// with fictional app-owned D1/R2 and a separate caller Worker service binding.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare");
const ownedRoot = mkdtempSync(join(tmpdir(), "guestbook-member-runtime-"));
function fictionalPNG() {
  const crc = (bytes) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++)
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, bytes) => {
    const data = Buffer.concat([Buffer.from(type), bytes]),
      size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE(crc(data));
    return Buffer.concat([size, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 255, 255, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
let runtime, qualificationReceipt;
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
  const memberStage = await owner({
    action: "stage",
    expectedVersion: 2,
    configuration: {
      title: "Fictional member-only runtime book",
      intro: "Synthetic only",
      theme: "daylight",
      layout: "grid",
      guestAccess: "members",
    },
  });
  const activeMembers = await owner({
    action: "activate",
    expectedVersion: 3,
    configurationRevision: memberStage.configuration.revision,
    configurationDigest: memberStage.configuration.digest,
  });
  const v2 = {
    schema: "composer.member-operation/2",
    actor,
    workspace,
    resource,
    configuration: {
      revision: activeMembers.configuration.revision,
      digest: activeMembers.configuration.digest,
      source,
    },
    context: { dataClass: "synthetic" },
    action: "contribute",
    input: {
      operationId: "fictional-runtime-submission-001",
      caption: "Fictional runtime postcard",
      author: "Synthetic member",
      consent: true,
      png: fictionalPNG(),
    },
  };
  const submitted = await invoke(caller, memberToken, v2);
  assert.equal(submitted.status, 201, await submitted.clone().text());
  const receipt = await submitted.json();
  const replay = await invoke(caller, memberToken, v2);
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).id, receipt.id);
  const status = await invoke(caller, memberToken, {
    ...v2,
    action: "contribution-status",
    input: { operationId: v2.input.operationId },
  });
  const observed = await status.json();
  assert.equal(status.status, 200);
  assert.equal(observed.outcome, "completed");
  assert.equal(observed.receipt.id, receipt.id);
  assert.equal(
    (
      await invoke(caller, memberToken, {
        ...v2,
        input: { ...v2.input, caption: "Different bytes" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await invoke(caller, memberToken, {
        ...v2,
        configuration: { ...v2.configuration, revision: 999 },
      })
    ).status,
    409,
  );
  assert.equal(
    (await invoke(caller, memberToken, envelope)).status,
    409,
    "old bridges cannot enter members mode",
  );
  assert.equal((await invoke(direct, memberToken, v2)).status, 404);
  assert.equal(
    (
      await direct.fetch(target + "/r/" + resource + "/api/guest-postcard", {
        method: "POST",
        headers: {
          Origin: new URL(target).origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: "hunter2",
          caption: "Public bypass attempt",
          author: "Synthetic visitor",
          consent: true,
          png: fictionalPNG(),
        }),
      })
    ).status,
    403,
  );
  const media = target + "/r/" + resource + "/media/" + receipt.id;
  assert.equal((await direct.fetch(media)).status, 404);
  const approved = await invoke(caller, memberToken, {
    ...v2,
    action: "moderate",
    input: {
      operation: "moderate",
      operationId: "fictional-runtime-review-001",
      expectedVersion: activeMembers.resource.version,
      item: receipt.id,
      itemRevision: 1,
      status: "approved",
    },
  });
  const approvedBody = await approved.json();
  assert.equal(approved.status, 200, JSON.stringify(approvedBody));
  assert.equal(approvedBody.contract, 2);
  assert.equal((await direct.fetch(media)).status, 200);
  const hidden = await invoke(caller, memberToken, {
    ...v2,
    action: "moderate",
    input: {
      operation: "moderate",
      operationId: "fictional-runtime-review-002",
      expectedVersion: approvedBody.resource.version,
      item: receipt.id,
      itemRevision: 2,
      status: "hidden",
    },
  });
  assert.equal(hidden.status, 200);
  assert.equal((await direct.fetch(media)).status, 404);
  const build = await (await direct.fetch(target + "/build.json")).json();
  assert.deepEqual(build.memberService, {
    version: 2,
    entrypoint: "GuestbookMemberService",
    transport: "service-binding",
    path: "/__composer/member",
  });
  qualificationReceipt = {
    source,
    runtime: "workerd via pinned Wrangler Miniflare",
    namedEntrypoint: "GuestbookMemberService",
    publicMemberRoute: 404,
    wrongOwnerCredential: 401,
    boundMemberReview: 200,
    foreignResource: 403,
    export: 403,
    memberContract: 2,
    syntheticMemberSubmission: 201,
    duplicateReceipt: receipt.id,
    publicGuestSubmission: 403,
    staleConfiguration: 409,
    changedPayload: 409,
    moderatedMedia: [404, 200, 404],
    fictionalOnly: true,
  };
} finally {
  try {
    await runtime?.dispose();
  } finally {
    rmSync(ownedRoot, { recursive: true, force: true });
    assert.equal(
      existsSync(ownedRoot),
      false,
      "The owned member runtime root was not removed.",
    );
  }
}

if (qualificationReceipt)
  console.log(
    JSON.stringify({
      ...qualificationReceipt,
      ownedTemporaryRootRemoved: true,
    }),
  );
