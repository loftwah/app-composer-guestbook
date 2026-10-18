import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  configureEnquiryScope,
  moderateEnquiry,
  enquiryOperation,
  publicEnquiryScope,
  admitEnquiry,
  purgeEnquiries,
} from "../src/enquiry-store.ts";
import { enquiryScope, enquirySubmission } from "../src/enquiry-contract.ts";
const source = "a".repeat(40),
  target = "https://fictional.example.test/guestbook";
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of [
    "0001.sql",
    "0002_owned_resources.sql",
    "0003_portability_lineage.sql",
    "0004_private_enquiries.sql",
  ])
    sqlite.exec(
      readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  const faults = { lost: false, rollback: false };
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
      return {
        success: true,
        meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) },
      };
    },
  });
  const db = {
    prepare: statement,
    async batch(items) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const values = items.map((s) => ({
          success: true,
          results: sqlite.prepare(s.sql).all(...s.params),
        }));
        if (faults.rollback) {
          faults.rollback = false;
          throw Error("Fictional failure before commit");
        }
        sqlite.exec("COMMIT");
        if (faults.lost) {
          faults.lost = false;
          throw Error("Fictional committed acknowledgement lost");
        }
        return values;
      } catch (error) {
        try {
          sqlite.exec("ROLLBACK");
        } catch {
          /* A deliberately lost ACK follows COMMIT. */
        }
        throw error;
      }
    },
  };
  const proof = {
    workspace: "fictional-workspace",
    account: "fictional-account",
    environment: "proof",
    source,
    target,
  };
  sqlite
    .prepare(
      "INSERT INTO guestbook_resources(id,workspace_id,account_id,environment,target,version,active_revision,creation_operation) VALUES(?,?,?,?,?,1,NULL,'fictional-created')",
    )
    .run(
      "fictional-resource",
      proof.workspace,
      proof.account,
      proof.environment,
      target,
    );
  sqlite
    .prepare(
      "INSERT INTO guestbook_resource_configs(resource_id,revision,config_json,digest,source_revision,activated_at) VALUES('fictional-resource',1,'{}','fictional-digest',?,CURRENT_TIMESTAMP)",
    )
    .run(source);
  sqlite.exec("UPDATE guestbook_resources SET active_revision=1");
  const context = () => ({
    proof,
    resource: sqlite
      .prepare(
        "SELECT * FROM guestbook_resources WHERE id='fictional-resource'",
      )
      .get(),
  });
  const selected = enquiryScope(
    { kind: "standalone", configuration: 1 },
    "fictional-resource",
  );
  const live = () =>
    publicEnquiryScope(
      db,
      "fictional-resource",
      "standalone",
      1,
      proof.account,
      proof.environment,
      target,
    );
  return {
    db,
    sqlite,
    faults,
    proof,
    context,
    selected,
    live,
    close() {
      assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
      sqlite.close();
    },
  };
}
const submission = (intent = crypto.randomUUID()) =>
  enquirySubmission({
    contract: 1,
    intent,
    values: {
      title: "Fictional timetable",
      goal: "Private invented brief",
      starting_point: "New idea",
      deliverables: [],
    },
    consent: true,
  });
test("owner scope CAS journals exact receipts, separates identity, and never changes legacy data", async () => {
  const f = fixture();
  try {
    const op = crypto.randomUUID(),
      context = f.context();
    const result = await configureEnquiryScope(
      f.db,
      context,
      f.selected,
      true,
      0,
      1,
      op,
    );
    assert.equal(result.resource.version, 2);
    assert.equal(result.scope.revision, 1);
    assert.equal(result.scope.enabled, true);
    assert.deepEqual(
      await configureEnquiryScope(f.db, context, f.selected, true, 0, 1, op),
      result,
    );
    await assert.rejects(
      () => configureEnquiryScope(f.db, context, f.selected, false, 0, 1, op),
      /another exact request/,
    );
    await assert.rejects(
      () =>
        configureEnquiryScope(
          f.db,
          context,
          f.selected,
          true,
          0,
          1,
          crypto.randomUUID(),
        ),
      /changed/,
    );
    const foreign = {
      ...f.context(),
      proof: { ...f.proof, workspace: "different-workspace" },
    };
    await assert.rejects(
      () =>
        configureEnquiryScope(
          f.db,
          foreign,
          f.selected,
          false,
          1,
          2,
          crypto.randomUUID(),
        ),
      /changed/,
    );
    assert.equal(
      f.sqlite
        .prepare("SELECT COUNT(*) n FROM guestbook_enquiry_operations")
        .get().n,
      1,
    );
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM photos").get().n, 0);
  } finally {
    f.close();
  }
});
test("public admission is private and idempotent, rejects changed intent and rechecks closure/identity at INSERT", async () => {
  const f = fixture();
  try {
    await configureEnquiryScope(
      f.db,
      f.context(),
      f.selected,
      true,
      0,
      1,
      crypto.randomUUID(),
    );
    const scope = await f.live(),
      entry = submission();
    assert(scope);
    assert.deepEqual(
      await admitEnquiry(
        f.db,
        scope,
        entry,
        f.proof.account,
        f.proof.environment,
        target,
        source,
      ),
      { contract: 1, intent: entry.intent, received: true },
    );
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM guestbook_enquiries").get().n,
      1,
    );
    assert.deepEqual(
      await admitEnquiry(
        f.db,
        scope,
        entry,
        f.proof.account,
        f.proof.environment,
        target,
        source,
      ),
      { contract: 1, intent: entry.intent, received: true },
    );
    await assert.rejects(
      () =>
        admitEnquiry(
          f.db,
          scope,
          { ...entry, values: { ...entry.values, title: "Other brief" } },
          f.proof.account,
          f.proof.environment,
          target,
          source,
        ),
      /another exact brief/,
    );
    for (const field of ["visible", "paused"]) {
      f.sqlite
        .prepare("UPDATE guestbook_resources SET " + field + "=?")
        .run(field === "visible" ? 0 : 1);
      assert.equal(await f.live(), null);
      await assert.rejects(
        () =>
          admitEnquiry(
            f.db,
            scope,
            submission(),
            f.proof.account,
            f.proof.environment,
            target,
            source,
          ),
        /closed/,
      );
      f.sqlite
        .prepare("UPDATE guestbook_resources SET " + field + "=?")
        .run(field === "visible" ? 1 : 0);
    }
    await assert.rejects(
      () =>
        admitEnquiry(
          f.db,
          scope,
          submission(),
          f.proof.account,
          "wrong",
          target,
          source,
        ),
      /closed/,
    );
    const row = f.sqlite.prepare("SELECT * FROM guestbook_enquiries").get();
    assert.equal(row.status, "pending");
    assert.equal(row.producer_source, source);
    assert.equal(row.consent_version, 1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM photos").get().n, 0);
  } finally {
    f.close();
  }
});
test("committed lost ACK reconciles once; review/delete require exact resource and item revisions and leave minimal tombstone only", async () => {
  const f = fixture();
  try {
    const op = crypto.randomUUID();
    f.faults.lost = true;
    await assert.rejects(
      () =>
        configureEnquiryScope(f.db, f.context(), f.selected, true, 0, 1, op),
      /acknowledgement lost/,
    );
    const receipt = await enquiryOperation(f.db, "fictional-resource", op);
    assert.equal(receipt.recorded, true);
    assert.equal(receipt.result.source, source);
    const scope = await f.live(),
      entry = submission();
    f.faults.lost = true;
    assert.equal(
      (
        await admitEnquiry(
          f.db,
          scope,
          entry,
          f.proof.account,
          f.proof.environment,
          target,
          source,
        )
      ).received,
      true,
    );
    const item = f.sqlite.prepare("SELECT * FROM guestbook_enquiries").get();
    await assert.rejects(
      () =>
        moderateEnquiry(
          f.db,
          f.context(),
          "review",
          item.id,
          2,
          2,
          crypto.randomUUID(),
        ),
      /changed/,
    );
    const reviewed = await moderateEnquiry(
      f.db,
      f.context(),
      "review",
      item.id,
      1,
      2,
      crypto.randomUUID(),
    );
    assert.equal(reviewed.item.status, "reviewed");
    assert.equal(reviewed.item.revision, 2);
    assert.equal(reviewed.resource.version, 3);
    const deleted = await moderateEnquiry(
      f.db,
      f.context(),
      "delete",
      item.id,
      2,
      3,
      crypto.randomUUID(),
    );
    assert.equal(deleted.item.status, "deleted");
    const gone = f.sqlite.prepare("SELECT * FROM guestbook_enquiries").get();
    assert.equal(gone.values_json, null);
    assert.equal(gone.intent_id, entry.intent);
    assert.equal(
      (
        await admitEnquiry(
          f.db,
          scope,
          entry,
          f.proof.account,
          f.proof.environment,
          target,
          source,
        )
      ).received,
      true,
      "same historic receipt remains bounded, never creates another brief",
    );
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM guestbook_enquiries").get().n,
      1,
    );
  } finally {
    f.close();
  }
});
test("retention removes bodies at30 days and receipt metadata at35 days, preserving independent app records", async () => {
  const f = fixture();
  try {
    await configureEnquiryScope(
      f.db,
      f.context(),
      f.selected,
      true,
      0,
      1,
      crypto.randomUUID(),
    );
    const scope = await f.live();
    await admitEnquiry(
      f.db,
      scope,
      submission(),
      f.proof.account,
      f.proof.environment,
      target,
      source,
    );
    f.sqlite.exec(
      "UPDATE guestbook_enquiries SET created_at=datetime('now','-31 days'),expires_at=datetime('now','-1 day')",
    );
    await purgeEnquiries(f.db);
    let row = f.sqlite.prepare("SELECT * FROM guestbook_enquiries").get();
    assert.equal(row.status, "expired");
    assert.equal(row.values_json, null);
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM guestbook_resources").get().n,
      1,
    );
    f.sqlite.exec(
      "UPDATE guestbook_enquiries SET created_at=datetime('now','-36 days'); UPDATE guestbook_enquiry_operations SET created_at=datetime('now','-36 days')",
    );
    await purgeEnquiries(f.db);
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM guestbook_enquiries").get().n,
      0,
    );
    assert.equal(
      f.sqlite
        .prepare("SELECT COUNT(*) n FROM guestbook_enquiry_operations")
        .get().n,
      0,
    );
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM guestbook_enquiry_scopes").get()
        .n,
      1,
    );
  } finally {
    f.close();
  }
});
test("restored configuration-only books cannot bypass later source closure through enquiry rendering, admission or re-enable", async () => {
  const f = fixture();
  try {
    f.sqlite
      .prepare(
        "INSERT INTO guestbook_resources(id,workspace_id,account_id,environment,target,creation_operation) VALUES('original-resource',?,?,?,?,'fictional-original')",
      )
      .run(f.proof.workspace, f.proof.account, f.proof.environment, target);
    f.sqlite
      .prepare(
        "INSERT INTO guestbook_resource_configs(resource_id,revision,config_json,digest,source_revision,activated_at) VALUES('original-resource',1,'{}','source-digest',?,CURRENT_TIMESTAMP)",
      )
      .run(source);
    f.sqlite.exec(
      "UPDATE guestbook_resources SET active_revision=1 WHERE id='original-resource'; INSERT INTO guestbook_resource_restores(resource_id,source_resource,source_configuration,source_digest) VALUES('fictional-resource','original-resource',1,'source-digest')",
    );
    await configureEnquiryScope(
      f.db,
      f.context(),
      f.selected,
      true,
      0,
      1,
      crypto.randomUUID(),
    );
    const scope = await f.live();
    assert(scope);
    await admitEnquiry(
      f.db,
      scope,
      submission(),
      f.proof.account,
      f.proof.environment,
      target,
      source,
    );
    f.sqlite.exec(
      "UPDATE guestbook_resources SET visible=0 WHERE id='original-resource'",
    );
    assert.equal(await f.live(), null);
    await assert.rejects(
      () =>
        admitEnquiry(
          f.db,
          scope,
          submission(),
          f.proof.account,
          f.proof.environment,
          target,
          source,
        ),
      /closed/,
    );
    await assert.rejects(
      () =>
        configureEnquiryScope(
          f.db,
          f.context(),
          f.selected,
          true,
          1,
          2,
          crypto.randomUUID(),
        ),
      /changed/,
    );
    const closed = await configureEnquiryScope(
      f.db,
      f.context(),
      f.selected,
      false,
      1,
      2,
      crypto.randomUUID(),
    );
    assert.equal(
      closed.scope.enabled,
      false,
      "owner cannot close an ineligible scope",
    );
  } finally {
    f.close();
  }
});
test("public per-resource queue and day bounds are atomic and replays never consume another slot", async () => {
  const f = fixture();
  try {
    await configureEnquiryScope(
      f.db,
      f.context(),
      f.selected,
      true,
      0,
      1,
      crypto.randomUUID(),
    );
    const scope = await f.live(),
      original = submission();
    await admitEnquiry(
      f.db,
      scope,
      original,
      f.proof.account,
      f.proof.environment,
      target,
      source,
    );
    for (let i = 1; i < 16; i++)
      await admitEnquiry(
        f.db,
        scope,
        submission(),
        f.proof.account,
        f.proof.environment,
        target,
        source,
      );
    await assert.rejects(
      () =>
        admitEnquiry(
          f.db,
          scope,
          submission(),
          f.proof.account,
          f.proof.environment,
          target,
          source,
        ),
      /queue/,
    );
    assert.equal(
      (
        await admitEnquiry(
          f.db,
          scope,
          original,
          f.proof.account,
          f.proof.environment,
          target,
          source,
        )
      ).received,
      true,
    );
    f.sqlite.exec("UPDATE guestbook_enquiries SET status='reviewed'");
    for (let i = 16; i < 20; i++)
      await admitEnquiry(
        f.db,
        scope,
        submission(),
        f.proof.account,
        f.proof.environment,
        target,
        source,
      );
    await assert.rejects(
      () =>
        admitEnquiry(
          f.db,
          scope,
          submission(),
          f.proof.account,
          f.proof.environment,
          target,
          source,
        ),
      /daily/,
    );
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM guestbook_enquiries").get().n,
      20,
    );
  } finally {
    f.close();
  }
});
test("a failed admission transaction rolls back and racing exact intents produce one private row", async () => {
  const f = fixture();
  try {
    await configureEnquiryScope(
      f.db,
      f.context(),
      f.selected,
      true,
      0,
      1,
      crypto.randomUUID(),
    );
    const scope = await f.live(),
      entry = submission();
    f.faults.rollback = true;
    await assert.rejects(
      () =>
        admitEnquiry(
          f.db,
          scope,
          entry,
          f.proof.account,
          f.proof.environment,
          target,
          source,
        ),
      /may already/,
    );
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM guestbook_enquiries").get().n,
      0,
    );
    const outcomes = await Promise.all([
      admitEnquiry(
        f.db,
        scope,
        entry,
        f.proof.account,
        f.proof.environment,
        target,
        source,
      ),
      admitEnquiry(
        f.db,
        scope,
        entry,
        f.proof.account,
        f.proof.environment,
        target,
        source,
      ),
    ]);
    assert(outcomes.every((row) => row.received));
    assert.equal(
      f.sqlite.prepare("SELECT COUNT(*) n FROM guestbook_enquiries").get().n,
      1,
    );
  } finally {
    f.close();
  }
});
