import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import worker from "../src/worker.ts";

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

async function approved(f, caption = "Fictional portable postcard") {
  const resource = await f.create(resourceA, "Fictional source book");
  const response = await f.request(
    `/r/${resourceA}/api/guest-postcard`,
    postcard(caption),
    { owner: false },
  );
  assert.equal(response.status, 201);
  const pending = await response.json();
  const changed = await f.command(resourceA, "moderate", {
    expectedVersion: resource.resource.version,
    item: pending.id,
    itemRevision: 1,
    status: "approved",
  });
  assert.equal(changed.status, 200);
  const exported = await f.request(`/api/resources/${resourceA}/portable`);
  assert.equal(exported.status, 200, await exported.clone().text());
  return {
    resource: changed.body,
    item: pending.id,
    manifest: await exported.json(),
  };
}
const restore = (f, manifest, options = {}) =>
  f.request(
    `/api/resources/${resourceB}/restore`,
    {
      operationId: "fictional-restore-operation",
      confirmRights: true,
      manifest,
    },
    options,
  );
async function makePublic(f, restored) {
  const active = await f.command(resourceB, "activate", {
    expectedVersion: 1,
    configurationRevision: 1,
    configurationDigest: restored.configuration.digest,
  });
  assert.equal(active.status, 200, JSON.stringify(active.body));
  const visible = await f.command(resourceB, "control", {
    expectedVersion: 2,
    visible: true,
    paused: true,
  });
  assert.equal(visible.status, 200);
  const published = await f.command(resourceB, "moderate", {
    expectedVersion: 3,
    item: restored.items[0].id,
    itemRevision: 1,
    status: "approved",
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
}

for (const base of ["", "/guestbook"])
  test(
    "approved PNG portability uses fresh private identities and retains current source authority: " +
      (base || "standalone"),
    async () => {
      const f = fixture(base);
      try {
        const { resource, item, manifest } = await approved(f);
        assert.equal(manifest.format, "guestbook.approved-portable/v1");
        assert.deepEqual(manifest.coverage, {
          approvedOriginals: 1,
          included: 1,
          complete: true,
          maximumItems: 8,
          privateContent: false,
          credentials: false,
          restoredCopies: false,
        });
        assert.equal(manifest.items[0].media.base64, png());
        const restoredResponse = await restore(f, manifest);
        assert.equal(
          restoredResponse.status,
          200,
          await restoredResponse.clone().text(),
        );
        const restored = await restoredResponse.json(),
          copy = restored.items[0].id;
        assert.notEqual(copy, item);
        assert.equal(restored.publication, "private");
        assert.equal(restored.resource.visible, false);
        assert.equal(restored.resource.activeRevision, null);
        assert.equal(
          (
            await f.request(`/r/${resourceB}/media/${copy}`, null, {
              owner: false,
            })
          ).status,
          404,
        );
        assert.equal(
          (await f.request(`/api/resources/${resourceB}/media/${copy}`)).status,
          200,
          "authorized private preview before source revocation",
        );
        assert.deepEqual(
          await (await restore(f, manifest)).json(),
          restored,
          "operation replay returns exact receipt",
        );
        assert.equal(
          f.sqlite
            .prepare(
              "SELECT COUNT(*) AS n FROM guestbook_resource_items WHERE resource_id=?",
            )
            .get(resourceB).n,
          1,
        );
        await makePublic(f, restored);
        assert.equal(
          (
            await f.request(`/r/${resourceB}/media/${copy}`, null, {
              owner: false,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await f.request(`/r/${resourceB}/c/1/api/items/${copy}`, null, {
              owner: false,
            })
          ).status,
          200,
        );
        assert.equal(
          (await f.request(`/api/resources/${resourceB}/portable`)).status,
          409,
          "copies cannot launder configuration lineage into standalone originals",
        );
        const hidden = await f.command(resourceA, "moderate", {
          expectedVersion: resource.resource.version,
          item,
          itemRevision: 2,
          status: "hidden",
        });
        assert.equal(hidden.status, 200);
        for (const path of [
          `/r/${resourceA}/media/${item}`,
          `/r/${resourceB}/media/${copy}`,
          `/r/${resourceB}/c/1/media/${copy}`,
          `/api/resources/${resourceB}/media/${copy}`,
          `/r/${resourceB}/c/1/api/items/${copy}`,
          `/r/${resourceB}/c/1/item/${copy}`,
        ]) {
          assert.equal(
            (await f.request(path, null, { owner: path.startsWith("/api/") }))
              .status,
            404,
            path,
          );
        }
        assert.equal(
          (
            await f.request(`/r/${resourceB}/c/1/api/items`, null, {
              owner: false,
            })
          ).status,
          404,
        );
        assert.doesNotMatch(
          await (
            await f.request(`/r/${resourceB}/c/1/`, null, { owner: false })
          ).text(),
          /Fictional portable postcard/,
        );
        assert.equal(
          (
            await f.command(resourceB, "moderate", {
              expectedVersion: 4,
              item: copy,
              itemRevision: 2,
              status: "approved",
            })
          ).status,
          409,
        );
        const deleted = await f.command(resourceA, "moderate", {
          expectedVersion: 4,
          item,
          itemRevision: 3,
          status: "deleted",
        });
        assert.equal(deleted.status, 200);
        assert.equal(
          (
            await restore(f, manifest, {
              headers: {
                "X-Composer-Workspace": "fictional-workspace-foreign",
              },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await f.request(`/api/resources/fictional-fresh-restore/restore`, {
              operationId: "fictional-new-operation",
              confirmRights: true,
              manifest,
            })
          ).status,
          409,
        );
        assert.equal(
          f.sqlite
            .prepare("SELECT id FROM guestbook_resources WHERE id=?")
            .get("fictional-fresh-restore"),
          undefined,
        );
        assert.equal(
          (
            await f.request(`/r/${resourceB}/media/${copy}`, null, {
              owner: false,
            })
          ).status,
          404,
        );
        assert.equal(
          (await f.request(`/api/resources/${resourceB}/media/${copy}`)).status,
          404,
        );
        assert.equal(
          f.sqlite.prepare("PRAGMA foreign_keys").get().foreign_keys,
          1,
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

test("export then hide or delete before isolated restore cannot revive source content", async () => {
  for (const status of ["hidden", "deleted"]) {
    const f = fixture();
    try {
      const { resource, item, manifest } = await approved(f);
      assert.equal(
        (
          await f.command(resourceA, "moderate", {
            expectedVersion: resource.resource.version,
            item,
            itemRevision: 2,
            status,
          })
        ).status,
        200,
      );
      assert.equal((await restore(f, manifest)).status, 409);
      assert.equal(
        f.sqlite
          .prepare("SELECT id FROM guestbook_resources WHERE id=?")
          .get(resourceB),
        undefined,
      );
      assert.equal(
        [...f.objects.keys()].filter((key) =>
          key.startsWith("resources/" + resourceB + "/"),
        ).length,
        0,
      );
      assert.equal(
        (
          await f.request(`/r/${resourceA}/media/${item}`, null, {
            owner: false,
          })
        ).status,
        404,
      );
    } finally {
      f.close();
    }
  }
});

test("source revocation during R2 copying is refused at the final SQL boundary and cleans definitive unused copies", async () => {
  const f = fixture();
  try {
    const { item, manifest } = await approved(f);
    const originalPut = f.env.MEDIA.put;
    f.env.MEDIA.put = async (key, bytes) => {
      await originalPut(key, bytes);
      if (key.startsWith(`resources/${resourceB}/`)) {
        f.sqlite
          .prepare(
            "UPDATE guestbook_resource_items SET status='hidden',revision=revision+1 WHERE id=?",
          )
          .run(item);
        f.sqlite
          .prepare(
            "UPDATE guestbook_resources SET version=version+1 WHERE id=?",
          )
          .run(resourceA);
      }
    };
    assert.equal((await restore(f, manifest)).status, 409);
    assert.equal(
      f.sqlite
        .prepare("SELECT id FROM guestbook_resources WHERE id=?")
        .get(resourceB),
      undefined,
    );
    assert.equal(
      [...f.objects.keys()].filter((key) =>
        key.startsWith(`resources/${resourceB}/`),
      ).length,
      0,
    );
  } finally {
    f.close();
  }
});

for (const unavailable of [false, true])
  test(
    "lost restore acknowledgement keeps committed private PNGs and reconciles before retry: " +
      unavailable,
    async () => {
      const f = fixture();
      try {
        const { manifest } = await approved(f);
        const prepare = f.env.DB.prepare;
        f.hooks(null, (statements) => {
          if (statements.some((s) => s.sql.includes("'restore'")))
            throw Error("lost committed acknowledgement");
        });
        if (unavailable)
          f.env.DB.prepare = (sql) => {
            if (sql.startsWith("SELECT fingerprint,status,result_json")) {
              const statement = prepare(sql),
                originalBind = statement.bind;
              statement.bind = (...values) => {
                const bound = originalBind(...values);
                if (
                  f.sqlite
                    .prepare("SELECT id FROM guestbook_resources WHERE id=?")
                    .get(resourceB)
                )
                  bound.first = async () => {
                    throw Error("reconciliation unavailable");
                  };
                return bound;
              };
              return statement;
            }
            return prepare(sql);
          };
        const response = await restore(f, manifest);
        assert.equal(response.status, unavailable ? 503 : 200);
        const outcome = await response.json();
        assert.equal(outcome.outcome, unavailable ? "unknown" : "applied");
        assert.equal(
          f.sqlite
            .prepare(
              "SELECT COUNT(*) AS n FROM guestbook_resource_items WHERE resource_id=?",
            )
            .get(resourceB).n,
          1,
        );
        const copy = f.sqlite
          .prepare(
            "SELECT id FROM guestbook_resource_items WHERE resource_id=?",
          )
          .get(resourceB).id;
        assert.equal(
          f.objects.has(`resources/${resourceB}/photos/${copy}.png`),
          true,
        );
        f.env.DB.prepare = prepare;
        f.hooks();
        const receipt = await (
          await f.request(
            `/api/resources/${resourceB}?operation=fictional-restore-operation`,
          )
        ).json();
        assert.equal(receipt.recorded, true);
        assert.equal(receipt.result.publication, "private");
        const replay = await restore(f, manifest);
        assert.equal(replay.status, 200);
        assert.equal((await replay.json()).items[0].id, copy);
        assert.equal(
          f.sqlite
            .prepare(
              "SELECT COUNT(*) AS n FROM guestbook_resource_items WHERE resource_id=?",
            )
            .get(resourceB).n,
          1,
        );
      } finally {
        f.close();
      }
    },
  );

test("malformed provenance, wrong scope/source, changed metadata/media and existing destination fail closed", async () => {
  const f = fixture();
  try {
    const { manifest } = await approved(f);
    for (const headers of [
      { "X-Composer-Source": "b".repeat(40) },
      { "X-Composer-Environment": "preview" },
      { "X-Composer-Account": "wrong-account" },
      { "X-Composer-Target": "https://attacker.example.test" },
      { "X-Composer-Workspace": "fictional-other-workspace" },
    ]) {
      assert.equal((await restore(f, manifest, { headers })).status, 403);
    }
    for (const edit of [
      (value) => (value.items[0].caption = "Forged copied caption"),
      (value) => (value.items[0].media.sha256 = "0".repeat(64)),
      (value) => (value.configuration.values.title = "Forged settings"),
      (value) => (value.source.build = "b".repeat(40)),
      (value) => (value.items[0].credential = "untrusted input"),
    ]) {
      const altered = structuredClone(manifest);
      edit(altered);
      assert.ok([400, 403, 409].includes((await restore(f, altered)).status));
    }
    assert.equal(
      f.sqlite
        .prepare("SELECT id FROM guestbook_resources WHERE id=?")
        .get(resourceB),
      undefined,
    );
    await f.create(resourceB, "Existing independent book");
    assert.equal((await restore(f, manifest)).status, 409);
    assert.equal(
      f.sqlite
        .prepare("SELECT COUNT(*) AS n FROM guestbook_resource_lineage")
        .get().n,
      0,
    );
  } finally {
    f.close();
  }
});

test("partial export is explicit and excludes pending, hidden, deleted and missing media", async () => {
  const f = fixture();
  try {
    const { manifest, item } = await approved(f);
    for (const status of ["pending", "hidden", "deleted"])
      f.sqlite
        .prepare(
          "INSERT INTO guestbook_resource_items(id,resource_id,caption,status) VALUES(?,?,?,?)",
        )
        .run(
          "fictional-" + status + "-item",
          resourceA,
          "Never export " + status,
          status,
        );
    f.objects.delete(`resources/${resourceA}/photos/${item}.png`);
    const partial = await (
      await f.request(`/api/resources/${resourceA}/portable`)
    ).json();
    assert.equal(partial.coverage.approvedOriginals, 1);
    assert.equal(partial.coverage.included, 0);
    assert.equal(partial.coverage.complete, false);
    assert.equal(partial.items.length, 0);
    assert.doesNotMatch(
      JSON.stringify(partial),
      /Never export|OWNER_API_TOKEN/,
    );
    assert.equal(
      (await restore(f, manifest)).status,
      409,
      "a portable PNG cannot replace missing current source media",
    );
  } finally {
    f.close();
  }
});

test("a concurrent identical restore cannot lose its committed PNG when another R2 acknowledgement fails", async () => {
  const f = fixture();
  try {
    const { manifest } = await approved(f);
    const put = f.env.MEDIA.put;
    let concurrent;
    f.env.MEDIA.put = async (key, bytes) => {
      await put(key, bytes);
      f.env.MEDIA.put = put;
      concurrent = await restore(f, manifest);
      assert.equal(concurrent.status, 200);
      throw Error("first upload acknowledgement lost after concurrent commit");
    };
    const first = await restore(f, manifest);
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.equal(
      f.objects.has(`resources/${resourceB}/photos/${result.items[0].id}.png`),
      true,
    );
    assert.equal(
      (
        await f.request(
          `/api/resources/${resourceB}/media/${result.items[0].id}`,
        )
      ).status,
      200,
    );
    assert.equal(
      f.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM guestbook_resource_items WHERE resource_id=?",
        )
        .get(resourceB).n,
      1,
    );
  } finally {
    f.close();
  }
});

test("source hide then reapproval cannot authorize an older restored copy", async () => {
  const f = fixture();
  try {
    const { manifest, item } = await approved(f);
    const copy = await (await restore(f, manifest)).json();
    await makePublic(f, copy);
    assert.equal(
      (
        await f.command(resourceA, "moderate", {
          expectedVersion: 3,
          item,
          itemRevision: 2,
          status: "hidden",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.command(resourceA, "moderate", {
          expectedVersion: 4,
          item,
          itemRevision: 3,
          status: "approved",
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.request(`/r/${resourceA}/media/${item}`, null, { owner: false }))
        .status,
      200,
    );
    assert.equal(
      (
        await f.request(`/r/${resourceB}/media/${copy.items[0].id}`, null, {
          owner: false,
        })
      ).status,
      404,
    );
    assert.equal(
      (await f.request(`/api/resources/${resourceB}/media/${copy.items[0].id}`))
        .status,
      404,
    );
  } finally {
    f.close();
  }
});

test("revocation while the copied R2 object is loading still denies public and owner media", async () => {
  for (const owner of [false, true]) {
    const f = fixture();
    try {
      const { manifest, item } = await approved(f);
      const copied = await (await restore(f, manifest)).json();
      await makePublic(f, copied);
      const copy = copied.items[0].id,
        get = f.env.MEDIA.get;
      f.env.MEDIA.get = async (key) => {
        const object = await get(key);
        if (key === `resources/${resourceB}/photos/${copy}.png`)
          f.sqlite
            .prepare(
              "UPDATE guestbook_resource_items SET status='hidden',revision=revision+1 WHERE id=?",
            )
            .run(item);
        return object;
      };
      const path = owner
        ? `/api/resources/${resourceB}/media/${copy}`
        : `/r/${resourceB}/media/${copy}`;
      assert.equal((await f.request(path, null, { owner })).status, 404);
    } finally {
      f.close();
    }
  }
});

test("configuration-only restore retains source privacy and cannot launder its provenance through another export", async () => {
  const f = fixture();
  try {
    const original = await f.create(resourceA, "Fictional configuration only");
    const exported = await (
      await f.request(`/api/resources/${resourceA}/portable`)
    ).json();
    assert.equal(exported.items.length, 0);
    const copiedResponse = await restore(f, exported);
    assert.equal(copiedResponse.status, 200);
    const copied = await copiedResponse.json();
    assert.equal(
      (
        await f.command(resourceB, "activate", {
          expectedVersion: 1,
          configurationRevision: 1,
          configurationDigest: copied.configuration.digest,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.command(resourceB, "control", {
          expectedVersion: 2,
          visible: true,
          paused: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.request(`/r/${resourceB}/c/1/`, null, { owner: false })).status,
      200,
    );

    assert.equal(
      (
        await f.command(resourceA, "control", {
          expectedVersion: original.resource.version,
          visible: false,
          paused: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.request(`/r/${resourceB}/c/1/`, null, { owner: false })).status,
      404,
      "source privacy applies even with no copied item rows",
    );
    assert.equal(
      (
        await f.command(resourceB, "control", {
          expectedVersion: 3,
          visible: true,
          paused: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.request(`/api/resources/${resourceB}/portable`)).status,
      409,
      "configuration copies retain their source instead of becoming original authority",
    );
    assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    f.close();
  }
});
