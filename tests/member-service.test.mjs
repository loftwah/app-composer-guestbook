import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import worker from "../src/app.ts";
import { memberServiceRequest } from "../src/member-service.ts";

const source = "a".repeat(40),
  account = "1003dc1d93af0ebea56b2f1252f89627";
const workspace = "fictional-workspace-0001";
const resourceA = "fictional-resource-0001",
  resourceB = "fictional-resource-0002";
const config = (title, patch = {}) => ({
  title,
  intro: "Fictional demonstration",
  theme: "midnight",
  layout: "grid",
  guestAccess: "postcards",
  ...patch,
});

function png() {
  const crc = (data) => {
    let c = 0xffffffff;
    for (const b of data) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]),
      size = Buffer.alloc(4),
      check = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([size, body, check]);
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
const postcard = (caption) => ({
  code: "hunter2",
  caption,
  author: "Fictional visitor",
  consent: true,
  png: png(),
});

function fixture(base = "") {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of [
    "0001.sql",
    "0002_owned_resources.sql",
    "0003_portability_lineage.sql",
  ])
    sqlite.exec(
      readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
  const objects = new Map(),
    origin = "https://guestbook.example.test";
  let beforeBatch, afterBatch;
  const statement = (sql, params = []) => ({
    sql,
    params,
    bind(...values) {
      return statement(sql, values);
    },
    async first() {
      return sqlite.prepare(sql).get(...params) ?? null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...params) };
    },
    async run() {
      const result = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  });
  const env = {
    DB: {
      prepare: statement,
      async batch(statements) {
        if (beforeBatch) await beforeBatch(statements);
        sqlite.exec("BEGIN IMMEDIATE");
        let results;
        try {
          results = statements.map(({ sql, params }) => ({
            success: true,
            results: sqlite.prepare(sql).all(...params),
          }));
          sqlite.exec("COMMIT");
        } catch (failure) {
          sqlite.exec("ROLLBACK");
          throw failure;
        }
        if (afterBatch) await afterBatch(statements);
        return results;
      },
    },
    OWNER_API_TOKEN: "fictional-owner-token",
    MEMBER_SERVICE_TOKEN: "fictional-member-only-token",
    MEMBER_ISSUER: "https://composer.example.test",
    PUBLIC_ORIGIN: origin,
    RESOURCE_ACCOUNT_ID: account,
    RESOURCE_ENVIRONMENT: "production",
    MEDIA: {
      async put(key, bytes) {
        objects.set(key, bytes);
      },
      async delete(key) {
        objects.delete(key);
      },
      async get(key) {
        return objects.has(key)
          ? { body: new Blob([objects.get(key)]).stream() }
          : null;
      },
    },
  };
  globalThis.BUILD_SHA = source;
  globalThis.MANIFEST = { contract: 1, id: "guestbook" };
  const request = (path, body, options = {}) =>
    worker.fetch(
      new Request(origin + base + path, {
        method: options.method ?? (body ? "POST" : "GET"),
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "CF-Connecting-IP": options.ip ?? "192.0.2.1",
          ...(options.owner === false
            ? {}
            : { Authorization: "Bearer " + env.OWNER_API_TOKEN }),
          "X-Composer-Workspace": workspace,
          "X-Composer-Account": account,
          "X-Composer-Environment": "production",
          "X-Composer-Source": source,
          "X-Composer-Target": origin + base,
          ...options.headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      { waitUntil() {} },
    );
  let next = 0;
  const command = async (id, action, fields = {}, options = {}) => {
    const response = await request(
      "/api/resources/" + id,
      { action, operationId: "fixture-operation-" + ++next, ...fields },
      options,
    );
    return { status: response.status, body: await response.json() };
  };
  const create = async (id, title, patch = {}) => {
    const created = await command(id, "create");
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const staged = await command(id, "stage", {
      expectedVersion: created.body.resource.version,
      configuration: config(title, patch),
    });
    assert.equal(staged.status, 200, JSON.stringify(staged.body));
    const active = await command(id, "activate", {
      expectedVersion: staged.body.resource.version,
      configurationRevision: staged.body.configuration.revision,
      configurationDigest: staged.body.configuration.digest,
    });
    assert.equal(active.status, 200, JSON.stringify(active.body));
    return active.body;
  };
  return {
    sqlite,
    env,
    objects,
    request,
    command,
    create,
    hooks(before, after) {
      beforeBatch = before;
      afterBatch = after;
    },
    close() {
      sqlite.close();
    },
  };
}

const actor = {
  issuer: "https://composer.example.test",
  accountId: "member-a-immutable-id",
};
function member(f, resource, action, input, options = {}) {
  const target = f.env.PUBLIC_ORIGIN + (options.base ?? "");
  return memberServiceRequest(
    new Request(target + "/__composer/member", {
      method: options.method ?? "POST",
      headers: {
        Authorization: "Bearer " + f.env.MEMBER_SERVICE_TOKEN,
        "X-Composer-Workspace": workspace,
        "X-Composer-Account": account,
        "X-Composer-Environment": "production",
        "X-Composer-Source": source,
        "X-Composer-Target": target,
        ...options.headers,
      },
      ...(options.method === "GET"
        ? {}
        : {
            body: JSON.stringify({
              schema: "composer.member-operation/1",
              actor,
              workspace,
              resource,
              action,
              input,
              ...options.body,
            }),
          }),
    }),
    f.env,
    source,
  );
}
for (const base of ["", "/guestbook"])
  test(
    "member service contribution, review and revocation-owned visibility: " +
      (base || "standalone"),
    async () => {
      const f = fixture(base);
      try {
        const a = await f.create(resourceA, "Selected fictional book");
        await f.create(resourceB, "Other fictional book");
        const input = {
          caption: "Member A postcard",
          author: "A fictional visitor",
          consent: true,
          png: png(),
        };
        const contributed = await member(f, resourceA, "contribute", input, {
          base,
        });
        assert.equal(contributed.status, 201, await contributed.clone().text());
        const item = await contributed.json();
        const key = `resources/${resourceA}/photos/${item.id}.png`;
        assert.equal(f.objects.has(key), true);
        assert.equal(
          (
            await f.request(`/r/${resourceA}/media/${item.id}`, null, {
              owner: false,
            })
          ).status,
          404,
        );
        const list = await member(
          f,
          resourceA,
          "moderate",
          { operation: "list" },
          {
            base,
            body: { actor: { ...actor, accountId: "member-b-immutable-id" } },
          },
        );
        assert.equal(list.status, 200);
        const queued = await list.json();
        assert.deepEqual(queued.resource, {
          id: resourceA,
          version: a.resource.version,
        });
        assert.equal(queued.items[0].id, item.id);
        assert.doesNotMatch(
          JSON.stringify(queued),
          /workspace|account|token|config_json|media|target/,
        );
        assert.deepEqual(
          (
            await (
              await member(
                f,
                resourceB,
                "moderate",
                { operation: "list" },
                { base },
              )
            ).json()
          ).items,
          [],
        );
        const review = {
          operation: "moderate",
          operationId: "fictional-review-001",
          expectedVersion: queued.resource.version,
          item: item.id,
          itemRevision: 1,
          status: "approved",
        };
        const approved = await member(f, resourceA, "moderate", review, {
          base,
        });
        assert.equal(approved.status, 200, await approved.clone().text());
        assert.equal(
          (
            await f.request(`/r/${resourceA}/media/${item.id}`, null, {
              owner: false,
            })
          ).status,
          200,
        );
        const wrongBook = await member(
          f,
          resourceB,
          "moderate",
          { ...review, operationId: "fictional-review-002" },
          { base },
        );
        assert.equal(wrongBook.status, 409);
        const stale = await member(
          f,
          resourceA,
          "moderate",
          { ...review, operationId: "fictional-review-003" },
          { base },
        );
        assert.equal(stale.status, 409);
        const replay = await member(f, resourceA, "moderate", review, { base });
        assert.equal(
          replay.status,
          200,
          "same actor and exact operation can reconcile its acknowledgement",
        );
        assert.equal(
          f.sqlite
            .prepare("SELECT revision FROM guestbook_resource_items WHERE id=?")
            .get(item.id).revision,
          2,
        );
        const hidden = await member(
          f,
          resourceA,
          "moderate",
          {
            ...review,
            operationId: "fictional-review-004",
            expectedVersion: queued.resource.version + 1,
            itemRevision: 2,
            status: "hidden",
          },
          { base },
        );
        assert.equal(hidden.status, 200);
        assert.equal(
          (
            await f.request(`/r/${resourceA}/media/${item.id}`, null, {
              owner: false,
            })
          ).status,
          404,
        );
        assert.equal(
          f.objects.has(key),
          true,
          "hiding and access revocation preserve app-owned content",
        );
        f.sqlite
          .prepare("UPDATE guestbook_resources SET paused=1 WHERE id=?")
          .run(resourceA);
        assert.equal(
          (await member(f, resourceA, "contribute", input, { base })).status,
          403,
        );
        assert.equal(
          f.sqlite.prepare("SELECT COUNT(*) AS n FROM photos").get().n,
          0,
        );
        assert.deepEqual(
          f.sqlite.prepare("PRAGMA foreign_key_check").all(),
          [],
        );
      } finally {
        f.close();
      }
    },
  );

test("member endpoint fails closed for runtime proof, actor substitution, unrelated operations and public direct requests", async () => {
  const f = fixture();
  try {
    await f.create(resourceA, "Selected fictional book");
    const list = { operation: "list" };
    for (const headers of [
      { Authorization: "Bearer " + f.env.OWNER_API_TOKEN },
      { Authorization: "" },
      { "X-Composer-Workspace": "foreign-workspace-0001" },
      { "X-Composer-Account": "foreign-account" },
      { "X-Composer-Environment": "preview" },
      { "X-Composer-Source": "b".repeat(40) },
      { "X-Composer-Target": "https://other.example.test" },
      { Origin: "https://hostile.example.test" },
    ])
      assert.ok(
        [401, 403].includes(
          (await member(f, resourceA, "moderate", list, { headers })).status,
        ),
        JSON.stringify(headers),
      );
    for (const body of [
      { actor: { ...actor, issuer: "https://other.example.test" } },
      { actor: { ...actor, accountId: "forged/account" } },
      { actor: { ...actor, profile: "profile-a" } },
      { workspace: "forged-workspace-0001" },
      { resource: "../../api/export" },
      { action: "export" },
    ])
      assert.equal(
        (await member(f, resourceA, "moderate", list, { body })).status,
        403,
      );
    for (const input of [
      { operation: "export" },
      { operation: "list", target: resourceB },
      { operation: "control", visible: true },
      { operation: "moderate", status: "deleted" },
    ])
      assert.equal((await member(f, resourceA, "moderate", input)).status, 400);
    assert.equal(
      (await member(f, resourceA, "moderate", list, { method: "GET" })).status,
      405,
    );
    for (const token of [
      f.env.MEMBER_SERVICE_TOKEN,
      f.env.OWNER_API_TOKEN,
      "",
    ]) {
      const direct = await f.request(
        "/__composer/member",
        {
          schema: "composer.member-operation/1",
          actor,
          workspace,
          resource: resourceA,
          action: "moderate",
          input: list,
        },
        { headers: { Authorization: "Bearer " + token } },
      );
      assert.equal(
        direct.status,
        404,
        "public transport never invokes the named service handler",
      );
    }
    for (const route of [
      "/api/resources/" + resourceA,
      "/api/resources/" + resourceA + "/export",
      "/api/export",
      "/api/settings",
      "/api/moderate",
    ]) {
      const direct = await f.request(
        route,
        route === "/api/moderate"
          ? { id: "anything", status: "approved" }
          : null,
        { headers: { Authorization: "Bearer " + f.env.MEMBER_SERVICE_TOKEN } },
      );
      assert.ok(direct.status >= 400, route);
    }
    f.env.MEMBER_SERVICE_TOKEN = f.env.OWNER_API_TOKEN;
    assert.equal(
      (await member(f, resourceA, "moderate", list)).status,
      503,
      "member and general owner credentials must be independent",
    );
    delete f.env.MEMBER_SERVICE_TOKEN;
    assert.equal((await member(f, resourceA, "moderate", list)).status, 503);
  } finally {
    f.close();
  }
});

test("manifest explicitly opts into the narrow named service contract", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../app.manifest.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(manifest.memberService, {
    version: 2,
    entrypoint: "GuestbookMemberService",
    transport: "service-binding",
    path: "/__composer/member",
  });
  assert.equal(manifest.configuration.guestAccess.default, "closed");
  assert.deepEqual(manifest.configuration.guestAccess.options, [
    "closed",
    "postcards",
    "members",
  ]);
});

test("public build identity advertises the same reviewed v2 member descriptor", async () => {
  const f = fixture();
  try {
    const build = await (
      await f.request("/build.json", null, { owner: false })
    ).json();
    const manifest = JSON.parse(
      readFileSync(new URL("../app.manifest.json", import.meta.url), "utf8"),
    );
    assert.deepEqual(build.memberService, manifest.memberService);
    assert.equal(build.revision, source);
  } finally {
    f.close();
  }
});

const contribution = (operationId = "fictional-submission-001") => ({
  operationId,
  caption: "A fictional member postcard",
  author: "Fictional member",
  consent: true,
  png: png(),
});
const configurationProof = (created) => ({
  revision: created.configuration.revision,
  digest: created.configuration.digest,
  source,
});
function memberV2(f, created, action, input, options = {}) {
  return member(f, resourceA, action, input, {
    ...options,
    body: {
      schema: "composer.member-operation/2",
      configuration: configurationProof(created),
      context: { dataClass: "synthetic" },
      ...options.body,
    },
  });
}

for (const base of ["", "/guestbook"])
  test(
    "explicit members mode keeps public admission closed and exact member submissions private: " +
      (base || "standalone"),
    async () => {
      const f = fixture(base);
      try {
        const created = await f.create(
          resourceA,
          "Fictional member-only book",
          { guestAccess: "members" },
        );
        const invitation = await (
          await f.request(`/r/${resourceA}/api/invitation`, null, {
            owner: false,
          })
        ).json();
        assert.equal(invitation.invitation.state, "closed");
        assert.equal(invitation.invitation.accepts, false);
        assert.equal(
          (
            await f.request(
              `/r/${resourceA}/api/guest-postcard`,
              postcard("Public attempt"),
              { owner: false },
            )
          ).status,
          403,
        );
        assert.equal(
          (await member(f, resourceA, "contribute", contribution(), { base }))
            .status,
          409,
        );
        assert.equal(
          (
            await member(
              f,
              resourceA,
              "moderate",
              { operation: "list" },
              { base },
            )
          ).status,
          409,
        );
        const input = contribution();
        const submitted = await memberV2(f, created, "contribute", input, {
          base,
        });
        assert.equal(submitted.status, 201, await submitted.clone().text());
        const receipt = await submitted.json();
        const row = f.sqlite
          .prepare("SELECT * FROM guestbook_resource_items WHERE id=?")
          .get(receipt.id);
        assert.equal(row.status, "pending");
        assert.equal(row.synthetic, 1);
        assert.equal(
          (
            await f.request(`/r/${resourceA}/media/${receipt.id}`, null, {
              owner: false,
            })
          ).status,
          404,
        );
        const publicPage = await (
          await f.request(
            `/r/${resourceA}/c/${created.configuration.revision}/`,
            null,
            { owner: false },
          )
        ).text();
        assert.doesNotMatch(publicPage, /A fictional member postcard/);
        assert.equal(
          (
            await memberV2(
              f,
              created,
              "contribute",
              { ...input, caption: "Different data" },
              { base },
            )
          ).status,
          409,
        );
        const replay = await memberV2(f, created, "contribute", input, {
          base,
        });
        assert.equal(replay.status, 201);
        assert.equal((await replay.json()).id, receipt.id);
        assert.equal(f.objects.size, 1);
        assert.equal(
          f.sqlite
            .prepare("SELECT COUNT(*) AS n FROM guestbook_resource_items")
            .get().n,
          1,
        );
        const status = await (
          await memberV2(
            f,
            created,
            "contribution-status",
            { operationId: input.operationId },
            { base },
          )
        ).json();
        assert.equal(status.outcome, "completed");
        assert.equal(status.receipt.id, receipt.id);
        assert.deepEqual(
          status.identity.configuration,
          configurationProof(created),
        );
        assert.match(status.identity.bodyDigest, /^[a-f0-9]{64}$/);
        const stranger = await (
          await memberV2(
            f,
            created,
            "contribution-status",
            { operationId: input.operationId },
            { base, body: { actor: { ...actor, accountId: "other-member" } } },
          )
        ).json();
        assert.equal(stranger.outcome, "not-recorded");
        const approved = await memberV2(
          f,
          created,
          "moderate",
          {
            operation: "moderate",
            operationId: "fictional-review-020",
            expectedVersion: created.resource.version,
            item: receipt.id,
            itemRevision: 1,
            status: "approved",
          },
          { base },
        );
        assert.equal(approved.status, 200, await approved.clone().text());
        assert.equal(
          (
            await f.request(`/r/${resourceA}/media/${receipt.id}`, null, {
              owner: false,
            })
          ).status,
          200,
        );
        const hidden = await memberV2(
          f,
          created,
          "moderate",
          {
            operation: "moderate",
            operationId: "fictional-review-021",
            expectedVersion: created.resource.version + 1,
            item: receipt.id,
            itemRevision: 2,
            status: "hidden",
          },
          { base },
        );
        assert.equal(hidden.status, 200);
        assert.equal(
          (
            await f.request(`/r/${resourceA}/media/${receipt.id}`, null, {
              owner: false,
            })
          ).status,
          404,
        );
        assert.equal(f.objects.size, 1, "hiding preserves source-owned media");
      } finally {
        f.close();
      }
    },
  );

test("v2 rejects missing synthetic context, stale configuration, body fields and runtime proof without writes", async () => {
  const f = fixture();
  try {
    const created = await f.create(resourceA, "Fictional member-only book", {
      guestAccess: "members",
    });
    for (const body of [
      { context: { dataClass: "internal" } },
      { context: { dataClass: "synthetic", operator: true } },
      {
        configuration: {
          ...configurationProof(created),
          revision: created.configuration.revision + 1,
        },
      },
      {
        configuration: {
          ...configurationProof(created),
          digest: "b".repeat(64),
        },
      },
      {
        configuration: {
          ...configurationProof(created),
          source: "b".repeat(40),
        },
      },
      { configuration: { ...configurationProof(created), allow: true } },
      { context: undefined },
    ])
      assert.ok(
        (await memberV2(f, created, "contribute", contribution(), { body }))
          .status >= 400,
      );
    for (const input of [
      { ...contribution(), synthetic: false },
      { ...contribution(), code: "hunter2" },
      { ...contribution(), operationId: "" },
      { ...contribution(), consent: false },
      { ...contribution(), png: "broken" },
    ])
      assert.ok(
        (await memberV2(f, created, "contribute", input)).status >= 400,
      );
    for (const headers of [
      { Authorization: "Bearer " + f.env.OWNER_API_TOKEN },
      { "X-Composer-Workspace": "foreign-workspace-0001" },
      { "X-Composer-Source": "b".repeat(40) },
    ])
      assert.ok(
        (await memberV2(f, created, "contribute", contribution(), { headers }))
          .status >= 400,
      );
    assert.equal(f.objects.size, 0);
    assert.equal(
      f.sqlite
        .prepare("SELECT COUNT(*) AS n FROM guestbook_resource_items")
        .get().n,
      0,
    );
  } finally {
    f.close();
  }
});

test("closed and postcards resources do not implicitly opt into v2 member-only admission", async () => {
  for (const mode of ["closed", "postcards"]) {
    const f = fixture();
    try {
      const created = await f.create(resourceA, "Fictional prior mode", {
        guestAccess: mode,
      });
      assert.equal(
        (await memberV2(f, created, "contribute", contribution())).status,
        409,
      );
      assert.equal(f.objects.size, 0);
    } finally {
      f.close();
    }
  }
});

test("ambiguous media and committed database acknowledgements reconcile one actor-scoped item without another media write", async () => {
  for (const failure of ["media", "database"]) {
    const f = fixture();
    try {
      const created = await f.create(resourceA, "Fictional uncertain book", {
        guestAccess: "members",
      });
      const input = contribution();
      let mediaWrites = 0,
        failRead = false;
      const originalPut = f.env.MEDIA.put,
        originalPrepare = f.env.DB.prepare;
      f.env.MEDIA.put = async (...args) => {
        mediaWrites++;
        await originalPut(...args);
        if (failure === "media" && mediaWrites === 1)
          throw Error("lost media acknowledgement");
      };
      if (failure === "database") {
        f.env.DB.prepare = (sql) => {
          const statement = originalPrepare(sql);
          if (!sql.startsWith("SELECT fingerprint,status,result_json"))
            return statement;
          const bind = statement.bind;
          statement.bind = (...params) => {
            const result = bind(...params);
            const first = result.first;
            result.first = async () => {
              if (failRead) throw Error("unavailable reconciliation");
              return first();
            };
            return result;
          };
          return statement;
        };
        f.hooks(null, () => {
          failRead = true;
          throw Error("lost database acknowledgement after commit");
        });
      }
      const unknown = await memberV2(f, created, "contribute", input);
      assert.equal(unknown.status, 503, await unknown.clone().text());
      const uncertain = await unknown.json();
      assert.equal(uncertain.outcome, "unknown");
      f.hooks(null, null);
      failRead = false;
      const status = await (
        await memberV2(f, created, "contribution-status", {
          operationId: input.operationId,
        })
      ).json();
      assert.equal(
        status.outcome,
        failure === "media" ? "pending" : "completed",
      );
      const resumed = await memberV2(f, created, "contribute", input);
      assert.equal(resumed.status, 201, await resumed.clone().text());
      assert.equal((await resumed.json()).id, uncertain.id);
      assert.equal(mediaWrites, 1);
      assert.equal(f.objects.size, 1);
      assert.equal(
        f.sqlite
          .prepare("SELECT COUNT(*) AS n FROM guestbook_resource_items")
          .get().n,
        1,
      );
    } finally {
      f.close();
    }
  }
});

test("state changes during asynchronous PNG decompression stop before media reservation", async () => {
  const NativeDecompression = globalThis.DecompressionStream;
  for (const change of ["paused", "visible", "configuration"]) {
    const f = fixture();
    try {
      const created = await f.create(resourceA, "Fictional interrupted book", {
        guestAccess: "members",
      });
      let interrupted = false;
      Object.defineProperty(globalThis, "DecompressionStream", {
        configurable: true,
        value: class {
          constructor(format) {
            const native = new NativeDecompression(format);
            return {
              writable: native.writable,
              readable: native.readable.pipeThrough(
                new TransformStream({
                  async transform(chunk, controller) {
                    if (!interrupted) {
                      interrupted = true;
                      if (change === "configuration")
                        f.sqlite
                          .prepare(
                            "UPDATE guestbook_resources SET active_revision=NULL WHERE id=?",
                          )
                          .run(resourceA);
                      else
                        f.sqlite
                          .prepare(
                            `UPDATE guestbook_resources SET ${change}=? WHERE id=?`,
                          )
                          .run(change === "paused" ? 1 : 0, resourceA);
                    }
                    await Promise.resolve();
                    controller.enqueue(chunk);
                  },
                }),
              ),
            };
          }
        },
      });
      assert.equal(
        (await memberV2(f, created, "contribute", contribution())).status,
        409,
      );
      assert.equal(interrupted, true);
      assert.equal(f.objects.size, 0);
      assert.equal(
        f.sqlite
          .prepare("SELECT COUNT(*) AS n FROM guestbook_resource_items")
          .get().n,
        0,
      );
      assert.equal(
        f.sqlite
          .prepare(
            "SELECT COUNT(*) AS n FROM guestbook_resource_operations WHERE action='member-contribute'",
          )
          .get().n,
        0,
      );
    } finally {
      Object.defineProperty(globalThis, "DecompressionStream", {
        configurable: true,
        value: NativeDecompression,
      });
      f.close();
    }
  }
});

test("state changes during R2 put are rechecked atomically; stale retry cannot create another submission or delete staged data", async () => {
  const f = fixture();
  try {
    const created = await f.create(resourceA, "Fictional R2 interruption", {
      guestAccess: "members",
    });
    const originalPut = f.env.MEDIA.put;
    f.env.MEDIA.put = async (...args) => {
      await originalPut(...args);
      f.sqlite
        .prepare("UPDATE guestbook_resources SET paused=1 WHERE id=?")
        .run(resourceA);
    };
    const input = contribution();
    assert.equal((await memberV2(f, created, "contribute", input)).status, 409);
    assert.equal(
      f.sqlite
        .prepare("SELECT COUNT(*) AS n FROM guestbook_resource_items")
        .get().n,
      0,
    );
    assert.equal(
      f.objects.size,
      1,
      "staged private media is retained rather than deleting a potential concurrent winner",
    );
    assert.equal((await memberV2(f, created, "contribute", input)).status, 409);
    assert.equal(
      f.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM guestbook_resource_operations WHERE action='member-contribute'",
        )
        .get().n,
      1,
    );
    assert.equal(
      (
        await f.request(`/r/${resourceA}/media/anything-0001`, null, {
          owner: false,
        })
      ).status,
      404,
    );
  } finally {
    f.close();
  }
});

test("configuration drift never turns an old operation into a new submission; current proof can inspect its original receipt", async () => {
  const f = fixture();
  try {
    const created = await f.create(resourceA, "Fictional changing book", {
      guestAccess: "members",
    });
    const input = contribution();
    const originalPut = f.env.MEDIA.put;
    let puts = 0;
    f.env.MEDIA.put = async (...args) => {
      puts++;
      await originalPut(...args);
      throw Error("lost media acknowledgement");
    };
    assert.equal((await memberV2(f, created, "contribute", input)).status, 503);
    const staged = await f.command(resourceA, "stage", {
      expectedVersion: created.resource.version,
      configuration: config("Fictional changed book", {
        guestAccess: "closed",
      }),
    });
    const active = await f.command(resourceA, "activate", {
      expectedVersion: staged.body.resource.version,
      configurationRevision: staged.body.configuration.revision,
      configurationDigest: staged.body.configuration.digest,
    });
    assert.equal(active.status, 200);
    assert.equal((await memberV2(f, created, "contribute", input)).status, 409);
    const status = await (
      await memberV2(f, active.body, "contribution-status", {
        operationId: input.operationId,
      })
    ).json();
    assert.equal(status.outcome, "pending");
    assert.deepEqual(
      status.identity.configuration,
      configurationProof(created),
    );
    assert.equal(
      (await memberV2(f, active.body, "contribute", input)).status,
      409,
    );
    assert.equal(puts, 1);
    assert.equal(f.objects.size, 1);
    assert.equal(
      f.sqlite
        .prepare("SELECT COUNT(*) AS n FROM guestbook_resource_items")
        .get().n,
      0,
    );
  } finally {
    f.close();
  }
});

test("concurrent exact submissions share one item; a retained different PNG is never overwritten", async () => {
  const f = fixture();
  try {
    const created = await f.create(resourceA, "Fictional concurrency book", {
      guestAccess: "members",
    });
    const input = contribution();
    const replies = await Promise.all([
      memberV2(f, created, "contribute", input),
      memberV2(f, created, "contribute", input),
    ]);
    const receipts = await Promise.all(
      replies.map(async (response) => {
        assert.equal(response.status, 201, await response.clone().text());
        return response.json();
      }),
    );
    assert.equal(receipts[0].id, receipts[1].id);
    assert.equal(f.objects.size, 1);
    assert.equal(
      f.sqlite
        .prepare("SELECT COUNT(*) AS n FROM guestbook_resource_items")
        .get().n,
      1,
    );
    const originalPut = f.env.MEDIA.put;
    f.env.MEDIA.put = async (...args) => {
      await originalPut(...args);
      throw Error("lost image acknowledgement");
    };
    const pending = await memberV2(
      f,
      created,
      "contribute",
      contribution("fictional-submission-002"),
    );
    const unknown = await pending.json();
    assert.equal(pending.status, 503);
    const key = `resources/${resourceA}/photos/${unknown.id}.png`,
      replacement = new Uint8Array([1, 2, 3]);
    f.objects.set(key, replacement);
    assert.equal(
      (
        await memberV2(
          f,
          created,
          "contribute",
          contribution("fictional-submission-002"),
        )
      ).status,
      409,
    );
    assert.deepEqual(f.objects.get(key), replacement);
    assert.equal(
      f.sqlite
        .prepare("SELECT COUNT(*) AS n FROM guestbook_resource_items")
        .get().n,
      1,
    );
  } finally {
    f.close();
  }
});
