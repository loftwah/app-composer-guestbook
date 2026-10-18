import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  enquiryModel,
  enquiryValues,
  enquiryRowLimits,
} from "../src/enquiry-model.ts";

const brief = () => ({
  title: "Fictional timetable",
  goal: "Explain a fictional class listing",
  starting_point: "New idea",
  deliverables: [],
});
test("fixed private enquiry model uses supported groups/conditions/rows and never accepts a submitted schema or arbitrary field", () => {
  const model = enquiryModel();
  assert.equal(model.schema, "app-composer.content-model");
  assert.deepEqual(model.groups, ["The brief", "What is needed"]);
  model.fields[0].required = false;
  assert.equal(
    enquiryModel().fields[0].required,
    true,
    "consumer changed authoritative model",
  );
  assert.deepEqual(enquiryValues(brief()), brief());
  for (const field of [
    "email",
    "workspace",
    "resource",
    "source",
    "model",
    "token",
  ])
    assert.throws(
      () => enquiryValues({ ...brief(), [field]: "untrusted" }),
      /unknown field/,
    );
  const hidden = enquiryValues({
    ...brief(),
    existing_site: "javascript:alert(1)",
  });
  assert.equal(hidden.existing_site, undefined);
  assert.throws(
    () =>
      enquiryValues({
        ...brief(),
        starting_point: "Existing site",
        existing_site: "javascript:alert(1)",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      enquiryValues({
        ...brief(),
        starting_point: "Existing site",
        existing_site: "https://user:secret@example.test/",
      }),
    /credentials/,
  );
  assert.equal(
    enquiryValues({
      ...brief(),
      starting_point: "Existing site",
      existing_site: "https://example.test/fictional",
    }).existing_site,
    "https://example.test/fictional",
  );
});
test("finite admission limits reject oversized/unsafe text and row data before storage", () => {
  assert.throws(
    () => enquiryValues({ ...brief(), title: "x".repeat(121) }),
    /120/,
  );
  assert.throws(
    () => enquiryValues({ ...brief(), goal: "x".repeat(2001) }),
    /2000/,
  );
  assert.throws(
    () => enquiryValues({ ...brief(), goal: "bad\u0000text" }),
    /unsupported/,
  );
  assert.throws(
    () => enquiryValues({ ...brief(), starting_point: "other" }),
    /Choose an option/,
  );
  assert.throws(
    () =>
      enquiryValues({
        ...brief(),
        deliverables: Array.from({ length: 9 }, () => ({
          item: "Fictional item",
        })),
      }),
    /row count/,
  );
  assert.throws(
    () =>
      enquiryValues({
        ...brief(),
        deliverables: [{ item: "x".repeat(enquiryRowLimits.item + 1) }],
      }),
    /120/,
  );
  assert.throws(
    () =>
      enquiryValues({
        ...brief(),
        deliverables: [
          { item: "One", detail: "x".repeat(enquiryRowLimits.detail + 1) },
        ],
      }),
    /300/,
  );
  assert.throws(
    () =>
      enquiryValues({
        ...brief(),
        deliverables: [{ item: "One", email: "not accepted" }],
      }),
    /unknown field/,
  );
  const inert = "<img src=x onerror=alert(1)>";
  assert.equal(
    enquiryValues({ ...brief(), goal: inert }).goal,
    inert,
    "plain untrusted text was treated as executable markup",
  );
});
test("forward enquiry tables preserve existing records and enforce exact resource/configuration identity with foreign keys", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    for (const file of [
      "0001.sql",
      "0002_owned_resources.sql",
      "0003_portability_lineage.sql",
      "0004_private_enquiries.sql",
    ])
      db.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
    db.prepare(
      "INSERT INTO photos(id,caption,author,status) VALUES('fictional-legacy','Keep this old photo','Fictional owner','hidden')",
    ).run();
    db.prepare("INSERT INTO settings(id,value) VALUES('config','{}')").run();
    const before = db.prepare("SELECT * FROM photos").all();
    db.prepare(
      "INSERT INTO guestbook_resources(id,workspace_id,account_id,environment,target,creation_operation) VALUES('fictional-resource','fictional-workspace','fictional-account','proof','https://fictional.example.test/guestbook','fictional-create')",
    ).run();
    db.prepare(
      "INSERT INTO guestbook_resource_configs(resource_id,revision,config_json,digest,source_revision,activated_at) VALUES('fictional-resource',1,'{}','fictional-digest',?,CURRENT_TIMESTAMP)",
    ).run("a".repeat(40));
    db.prepare(
      "INSERT INTO guestbook_enquiry_scopes(resource_id,scope_key,kind,configuration_revision,provenance_json) VALUES('fictional-resource','standalone','standalone',1,'{}')",
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO guestbook_enquiry_scopes(resource_id,scope_key,kind,configuration_revision,provenance_json) VALUES('fictional-resource','other','standalone',99,'{}')",
          )
          .run(),
      /FOREIGN KEY/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO guestbook_enquiry_scopes(resource_id,scope_key,kind,configuration_revision,provenance_json) VALUES('foreign-resource','standalone','standalone',1,'{}')",
          )
          .run(),
      /FOREIGN KEY/,
    );
    assert.deepEqual(db.prepare("SELECT * FROM photos").all(), before);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM guestbook_enquiries").get().n,
      0,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("submission and provenance contracts refuse browser authority and cannot confuse standalone with another publication", async () => {
  const { enquirySubmission, enquiryScope, enquiryScopeKey } =
    await import("../src/enquiry-contract.ts");
  const intent = crypto.randomUUID(),
    payload = { contract: 1, intent, values: brief(), consent: true };
  assert.equal(enquirySubmission(payload).intent, intent);
  for (const patch of [
    { consent: false },
    { contract: 2 },
    { intent: "not-an-intent" },
    { workspace: "forged" },
    { source: "forged" },
    { resource: "forged" },
    { email: "not accepted" },
  ])
    assert.throws(() => enquirySubmission({ ...payload, ...patch }));
  const a = enquiryScope(
    {
      kind: "composer.publication",
      configuration: 1,
      stack: "fictional-stack",
      publication: 2,
      instance: "fictional-instance",
    },
    "fictional-resource",
  );
  const b = { ...a, publication: 3 },
    c = { ...a, resource: "different-resource" };
  assert.notEqual(await enquiryScopeKey(a), await enquiryScopeKey(b));
  assert.notEqual(await enquiryScopeKey(a), await enquiryScopeKey(c));
  assert.equal(
    await enquiryScopeKey(
      enquiryScope(
        { kind: "standalone", configuration: 1 },
        "fictional-resource",
      ),
    ),
    "standalone",
  );
  assert.throws(() =>
    enquiryScope(
      { kind: "standalone", configuration: 1, stack: "forged" },
      "fictional-resource",
    ),
  );
  assert.throws(() =>
    enquiryScope(
      {
        kind: "composer.publication",
        configuration: 1,
        stack: "fictional-stack",
        publication: 2,
        instance: "fictional-instance",
        resource: "forged",
      },
      "fictional-resource",
    ),
  );
});
