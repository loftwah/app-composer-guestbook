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
  const create = async (id, title) => {
    const created = await command(id, "create");
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const staged = await command(id, "stage", {
      expectedVersion: created.body.resource.version,
      configuration: config(title),
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
    version: 1,
    entrypoint: "GuestbookMemberService",
    transport: "service-binding",
    path: "/__composer/member",
  });
});
