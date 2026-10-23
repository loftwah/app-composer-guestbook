import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/app.ts";
const source = "a".repeat(40),
  account = "fictional-account",
  resource = "fictional-resource",
  workspace = "fictional-workspace",
  origin = "https://fictional.example.test";
function fixture(base = "") {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of [
    "0001.sql",
    "0002_owned_resources.sql",
    "0003_portability_lineage.sql",
    "0004_private_enquiries.sql",
  ])
    sqlite.exec(
      readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
  const faults = { lost: false, receipt: false, before: null };
  const statement = (sql, params = []) => ({
    sql,
    params,
    bind(...values) {
      return statement(sql, values);
    },
    async first() {
      if (
        faults.receipt &&
        sql.includes("SELECT fingerprint FROM guestbook_enquiries")
      )
        throw Error("Fictional unavailable proof");
      return sqlite.prepare(sql).get(...params) ?? null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...params) };
    },
    async run() {
      return {
        success: true,
        meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) },
      };
    },
  });
  const env = {
    DB: {
      prepare: statement,
      async batch(items) {
        if (faults.before) {
          const fn = faults.before;
          faults.before = null;
          await fn(items);
        }
        sqlite.exec("BEGIN IMMEDIATE");
        let results;
        try {
          results = items.map((s) => ({
            success: true,
            results: sqlite.prepare(s.sql).all(...s.params),
          }));
          sqlite.exec("COMMIT");
        } catch (e) {
          sqlite.exec("ROLLBACK");
          throw e;
        }
        if (
          faults.lost &&
          items.some((s) =>
            s.sql.includes("INSERT OR IGNORE INTO guestbook_enquiries("),
          )
        ) {
          faults.lost = false;
          faults.receipt = true;
          throw Error("Fictional committed ACK lost");
        }
        return results;
      },
    },
    MEDIA: {},
    OWNER_API_TOKEN: "fictional-owner",
    PUBLIC_ORIGIN: origin,
    RESOURCE_ACCOUNT_ID: account,
    RESOURCE_ENVIRONMENT: "proof",
  };
  globalThis.BUILD_SHA = source;
  globalThis.MANIFEST = { id: "guestbook", contract: 1 };
  const request = (path, body, options = {}) =>
    worker.fetch(
      new Request(origin + base + path, {
        method: options.method ?? (body ? "POST" : "GET"),
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "CF-Connecting-IP": options.ip ?? "192.0.2.10",
          ...(options.public
            ? {}
            : { Authorization: "Bearer " + env.OWNER_API_TOKEN }),
          "X-Composer-Workspace": workspace,
          "X-Composer-Account": account,
          "X-Composer-Environment": "proof",
          "X-Composer-Source": source,
          "X-Composer-Target": origin + base,
          "X-Guestbook-Enquiry-Source": source,
          "X-Guestbook-Enquiry-Target": origin + base,
          ...options.headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      { waitUntil() {} },
    );
  const command = async (body, options) => {
    const response = await request(
      "/api/resources/" + resource + "/enquiries",
      body,
      options,
    );
    return { status: response.status, body: await response.json() };
  };
  const book = async (action, fields = {}) => {
    const response = await request("/api/resources/" + resource, {
      action,
      operationId: crypto.randomUUID(),
      ...fields,
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const start = async () => {
    let result = await book("create");
    result = await book("stage", {
      expectedVersion: result.resource.version,
      configuration: {
        title: "Fictional enquiries",
        intro: "Invented fixture only",
        theme: "midnight",
        layout: "grid",
        guestAccess: "closed",
      },
    });
    result = await book("activate", {
      expectedVersion: result.resource.version,
      configurationRevision: result.configuration.revision,
      configurationDigest: result.configuration.digest,
    });
    return result;
  };
  const current = () =>
    sqlite
      .prepare("SELECT version FROM guestbook_resources WHERE id=?")
      .get(resource).version;
  const configure = (scope, enabled = true, revision = 0) =>
    command({
      contract: 1,
      action: "configure",
      scope,
      enabled,
      expectedScopeRevision: revision,
      expectedVersion: current(),
      operation: crypto.randomUUID(),
    });
  return {
    sqlite,
    env,
    faults,
    request,
    command,
    start,
    current,
    configure,
    base,
    close() {
      assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
      sqlite.close();
    },
  };
}
const brief = (intent = crypto.randomUUID()) => ({
  contract: 1,
  intent,
  values: {
    title: "Fictional private brief",
    goal: "Inert <img src=x onerror=alert(1)> text",
    starting_point: "New idea",
    deliverables: [{ item: "A timetable", detail: "Invented details" }],
  },
  consent: true,
});
for (const base of ["", "/guestbook"])
  test(
    "actual Worker enquiry route stays private, source/target bound and independently usable: " +
      (base || "standalone"),
    async () => {
      const f = fixture(base);
      try {
        const active = await f.start(),
          configuration = active.configuration.revision,
          scope = { kind: "standalone", configuration },
          path = `/r/${resource}/c/${configuration}/enquiry`;
        assert.equal(
          (await f.request(path, null, { public: true })).status,
          404,
        );
        assert.equal((await f.command({}, { public: true })).status, 401);
        assert.equal((await f.configure(scope)).status, 200);
        const page = await f.request(path, null, { public: true });
        assert.equal(page.status, 200);
        assert.equal(page.headers.get("X-Robots-Tag"), "noindex, nofollow");
        const markup = await page.text();
        assert(markup.includes(`action="${base + path}/submit"`));
        assert(!markup.includes("fictional-owner"));
        assert(markup.includes("No email address"));
        assert.equal(
          (
            await f.request(path + "/submit", brief(), {
              public: true,
              headers: { "X-Guestbook-Enquiry-Source": "b".repeat(40) },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await f.request(
              path + "/submit",
              { ...brief(), workspace: "other-workspace" },
              { public: true },
            )
          ).status,
          400,
        );
        const body = brief(),
          received = await f.request(path + "/submit", body, { public: true });
        assert.equal(received.status, 201);
        assert.deepEqual(await received.json(), {
          contract: 1,
          intent: body.intent,
          received: true,
        });
        const replay = await f.request(path + "/submit", body, {
          public: true,
        });
        assert.deepEqual(await replay.json(), {
          contract: 1,
          intent: body.intent,
          received: true,
        });
        assert.equal(
          f.sqlite.prepare("SELECT COUNT(*) n FROM guestbook_enquiries").get()
            .n,
          1,
        );
        const receipt = await f.request(
          path + "/receipt",
          { contract: 1, intent: body.intent },
          { public: true },
        );
        assert.deepEqual(await receipt.json(), {
          contract: 1,
          intent: body.intent,
          received: true,
        });
        const inbox = await (
          await f.request("/api/resources/" + resource + "/enquiries")
        ).json();
        assert.equal(inbox.items.length, 1);
        assert.equal(inbox.items[0].values.goal, body.values.goal);
        assert.equal(inbox.notifications, false);
        assert.equal(
          (
            await f.request("/api/resources/" + resource + "/enquiries", null, {
              headers: { "X-Composer-Workspace": "other-workspace" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await f.request(
              "/api/resources/" + resource + "/enquiries?status=unknown",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await f.request(
              "/api/resources/" + resource + "/enquiries?page=100000",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await f.request(
              "/api/resources/" +
                resource +
                "/enquiries?status=all&status=pending",
            )
          ).status,
          400,
        );
        assert.equal(
          (await (await f.request("/api/items", null, { public: true })).json())
            .items.length,
          0,
        );
        assert.equal(
          f.sqlite.prepare("SELECT COUNT(*) n FROM photos").get().n,
          0,
        );
        const exportData = await (
          await f.request("/api/resources/" + resource + "/enquiries/export")
        ).json();
        assert.equal(exportData.items.length, 1);
        assert.equal(exportData.covers.credentials, false);
        assert(!JSON.stringify(exportData).includes("fictional-owner"));
      } finally {
        f.close();
      }
    },
  );
test("app-owned Composer publication scopes cannot fall back to standalone and new publication atomically retires its old scope", async () => {
  const f = fixture();
  try {
    const active = await f.start(),
      configuration = active.configuration.revision,
      standalone = { kind: "standalone", configuration };
    await f.configure(standalone);
    const first = {
      kind: "composer.publication",
      configuration,
      stack: "fictional-stack",
      publication: 1,
      instance: "fictional-instance",
    };
    assert.equal((await f.configure(first)).status, 200);
    const old = await f.command({
      contract: 1,
      action: "submit",
      scope: first,
      submission: brief(),
    });
    assert.equal(old.status, 201);
    const other = { ...first, stack: "another-stack" };
    assert.equal((await f.configure(other)).status, 200);
    const next = { ...first, publication: 2 };
    assert.equal((await f.configure(next)).status, 200);
    assert.equal(
      (
        await f.command({
          contract: 1,
          action: "submit",
          scope: first,
          submission: brief(),
        })
      ).status,
      404,
    );
    assert.equal(
      (await f.command({ contract: 1, action: "form", scope: next })).body.open,
      true,
    );
    assert.equal(
      (await f.command({ contract: 1, action: "form", scope: other })).body
        .open,
      true,
    );
    assert.equal(
      (await f.command({ contract: 1, action: "form", scope: standalone })).body
        .open,
      true,
    );
    assert.equal(
      f.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM guestbook_enquiries WHERE values_json IS NOT NULL",
        )
        .get().n,
      1,
    );
    assert.equal(
      f.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM guestbook_enquiry_scopes WHERE enabled=1",
        )
        .get().n,
      3,
    );
  } finally {
    f.close();
  }
});
test("committed lost ACK exposes bounded receipt only and review is private CAS with immutable journal", async () => {
  const f = fixture();
  try {
    const active = await f.start(),
      configuration = active.configuration.revision,
      scope = { kind: "standalone", configuration },
      path = `/r/${resource}/c/${configuration}/enquiry`;
    await f.configure(scope);
    f.faults.lost = true;
    const sent = brief(),
      unknown = await f.request(path + "/submit", sent, { public: true });
    assert.equal(unknown.status, 503);
    const outcome = await unknown.json();
    assert.equal(outcome.outcome, "unknown");
    assert(!JSON.stringify(outcome).includes(sent.values.goal));
    f.faults.receipt = false;
    const confirmed = await f.request(
      path + "/receipt",
      { contract: 1, intent: sent.intent },
      { public: true },
    );
    assert.deepEqual(await confirmed.json(), {
      contract: 1,
      intent: sent.intent,
      received: true,
    });
    const inbox = await (
        await f.request("/api/resources/" + resource + "/enquiries")
      ).json(),
      entry = inbox.items[0],
      operation = crypto.randomUUID();
    const review = {
      contract: 1,
      action: "review",
      item: entry.id,
      expectedRevision: entry.revision,
      expectedVersion: inbox.resource.version,
      operation,
    };
    const reviewed = await f.command(review);
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.item.status, "reviewed");
    assert(!JSON.stringify(reviewed.body).includes(sent.values.goal));
    assert.deepEqual((await f.command(review)).body, reviewed.body);
    assert.equal(
      (await f.command({ ...review, operation: crypto.randomUUID() })).status,
      409,
    );
    const recorded = await (
      await f.request(
        `/api/resources/${resource}/enquiries/receipt?operation=${operation}`,
      )
    ).json();
    assert.deepEqual(recorded.result, reviewed.body);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM photos").get().n, 0);
  } finally {
    f.close();
  }
});
test("write-time closure after the scope read denies delivery and logical expiry hides bodies even when cleanup fails", async () => {
  const f = fixture();
  try {
    const active = await f.start(),
      configuration = active.configuration.revision,
      scope = { kind: "standalone", configuration },
      path = `/r/${resource}/c/${configuration}/enquiry`;
    await f.configure(scope);
    // The explicit hook below runs only at admission, not opportunistic cleanup.
    const original = f.env.DB.batch;
    f.env.DB.batch = async (items) => {
      if (
        items.some((s) =>
          s.sql.includes("INSERT OR IGNORE INTO guestbook_enquiries("),
        )
      )
        f.sqlite.exec("UPDATE guestbook_resources SET visible=0");
      return original(items);
    };
    f.faults.before = null;
    assert.equal(
      (await f.request(path + "/submit", brief(), { public: true })).status,
      409,
    );
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM guestbook_enquiries").get().n,
      0,
    );
    f.env.DB.batch = original;
    f.sqlite.exec("UPDATE guestbook_resources SET visible=1");
    await f.request(path + "/submit", brief(), {
      public: true,
      ip: "192.0.2.20",
    });
    f.sqlite.exec(
      "UPDATE guestbook_enquiries SET expires_at=datetime('now','-1 day')",
    );
    f.env.DB.batch = async () => {
      throw Error("Fictional cleanup outage");
    };
    const inbox = await (
      await f.request(`/api/resources/${resource}/enquiries?status=all`)
    ).json();
    assert.equal(inbox.items.length, 0);
    const exported = await (
      await f.request(`/api/resources/${resource}/enquiries/export`)
    ).json();
    assert.equal(exported.items.length, 0);
  } finally {
    f.close();
  }
});
test("the actual scheduled handler clears logically expired bodies and preview schedules remain empty", async () => {
  const f = fixture();
  try {
    const active = await f.start(),
      configuration = active.configuration.revision,
      path = `/r/${resource}/c/${configuration}/enquiry`;
    await f.configure({ kind: "standalone", configuration });
    await f.request(path + "/submit", brief(), { public: true });
    f.sqlite.exec(
      "UPDATE guestbook_enquiries SET expires_at=datetime('now','-1 day')",
    );
    const tasks = [];
    await worker.scheduled({}, f.env, {
      waitUntil(task) {
        tasks.push(task);
      },
    });
    await Promise.all(tasks);
    assert.equal(
      f.sqlite.prepare("SELECT values_json FROM guestbook_enquiries").get()
        .values_json,
      null,
    );
    const config = JSON.parse(
      readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    );
    assert.deepEqual(config.triggers.crons, ["17 3 * * *"]);
    assert.deepEqual(config.env.preview.triggers.crons, []);
  } finally {
    f.close();
  }
});
