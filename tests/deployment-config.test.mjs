import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.ts";

const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);
const source = "d".repeat(40);

test("production resource identity is explicit; preview has no production resources", () => {
  assert.match(config.vars.RESOURCE_ACCOUNT_ID, /^[a-f0-9]{32}$/);
  assert.equal(config.vars.RESOURCE_ACCOUNT_ID, config.account_id);
  assert.equal(config.vars.RESOURCE_ENVIRONMENT, "production");
  const preview = config.env.preview;
  assert.equal(preview.vars.RESOURCE_ACCOUNT_ID, "");
  assert.equal(preview.vars.RESOURCE_ENVIRONMENT, "");
  assert.equal(preview.vars.PUBLIC_ORIGIN, "");
  assert.equal(preview.vars.OWNER_STUDIO_URL, "");
  for (const binding of ["d1_databases", "r2_buckets", "services", "routes"])
    assert.deepEqual(preview[binding], []);
  assert.equal(preview.workers_dev, false);
  assert.equal(preview.preview_urls, false);
});

test("actual Worker metadata reflects selected resource settings without granting storage access", async () => {
  globalThis.BUILD_SHA = source;
  globalThis.MANIFEST = { id: "guestbook", contract: 1 };
  let storageAccesses = 0;
  const env = {
    ...config.vars,
    OWNER_API_TOKEN: "fictional-release-credential",
    DB: {
      prepare() {
        storageAccesses++;
        throw Error("The metadata/auth boundary must not access storage");
      },
    },
  };
  const request = (path, settings, headers = {}) =>
    worker.fetch(
      new Request("https://guestbook.example.test" + path, { headers }),
      settings,
    );
  const metadata = await (await request("/build.json", env)).json();
  assert.equal(metadata.revision, source);
  assert.equal(metadata.resourcesEnabled, true);
  assert.equal(metadata.resourceAccount, config.account_id);
  assert.equal(metadata.resourceEnvironment, "production");

  const route = "/api/resources/fictional-resource-0001";
  assert.equal((await request(route, env)).status, 401);
  const headers = {
    Authorization: "Bearer " + env.OWNER_API_TOKEN,
    "X-Composer-Workspace": "fictional-workspace-0001",
    "X-Composer-Account": config.account_id,
    "X-Composer-Environment": "production",
    "X-Composer-Source": "e".repeat(40),
    "X-Composer-Target": "https://guestbook.example.test",
  };
  assert.equal((await request(route, env, headers)).status, 403);
  for (const settings of [
    { ...env, RESOURCE_ACCOUNT_ID: undefined, RESOURCE_ENVIRONMENT: undefined },
    { ...env, ...config.env.preview.vars },
  ]) {
    const metadata = await (await request("/build.json", settings)).json();
    assert.equal(metadata.resourcesEnabled, false);
    assert.equal((await request(route, settings, headers)).status, 503);
  }
  assert.equal(storageAccesses, 0);
});

test("forward migrations are repeatable and preserve an existing legacy collection", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const migrations = ["0001.sql", "0002_owned_resources.sql"].map((file) =>
      readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
    db.exec(migrations[0]);
    db.prepare(
      "INSERT INTO photos(id,caption,author,status,synthetic) VALUES(?,?,?,?,?)",
    ).run(
      "fictional-legacy-photo",
      "Fictional earlier moment",
      "Fictional Mira",
      "hidden",
      1,
    );
    db.prepare("INSERT INTO settings(id,value) VALUES(?,?)").run(
      "config",
      '{"title":"Fictional owner title","guestAccess":"closed"}',
    );
    const photos = db.prepare("SELECT * FROM photos").all();
    const settings = db.prepare("SELECT * FROM settings").all();
    for (let attempt = 0; attempt < 2; attempt++)
      for (const migration of migrations) db.exec(migration);
    assert.deepEqual(db.prepare("SELECT * FROM photos").all(), photos);
    assert.deepEqual(db.prepare("SELECT * FROM settings").all(), settings);
    for (const table of [
      "guestbook_resources",
      "guestbook_resource_configs",
      "guestbook_resource_operations",
      "guestbook_resource_items",
    ])
      assert.equal(db.prepare("SELECT count(*) AS n FROM " + table).get().n, 0);
  } finally {
    db.close();
  }
});
