-- App-owned private enquiry records; no legacy photo, setting or media changes.
-- 0003 is the independent portability/lineage migration. Apply forward only.
CREATE TABLE IF NOT EXISTS guestbook_enquiry_scopes (
 resource_id TEXT NOT NULL REFERENCES guestbook_resources(id),
 scope_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('standalone','composer.publication')),
 configuration_revision INTEGER NOT NULL CHECK(configuration_revision>0),
 provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(resource_id,scope_key),
 FOREIGN KEY(resource_id,configuration_revision) REFERENCES guestbook_resource_configs(resource_id,revision)
);
CREATE TABLE IF NOT EXISTS guestbook_enquiries (
 id TEXT PRIMARY KEY,
 resource_id TEXT NOT NULL REFERENCES guestbook_resources(id),
 scope_key TEXT NOT NULL,
 configuration_revision INTEGER NOT NULL CHECK(configuration_revision>0),
 provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
 model_version INTEGER NOT NULL CHECK(model_version=1),
 producer_source TEXT NOT NULL,
 values_json TEXT CHECK(values_json IS NULL OR json_valid(values_json)),
 consent_version INTEGER NOT NULL CHECK(consent_version=1),
 consent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','rejected','deleted','expired')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 intent_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TEXT NOT NULL DEFAULT (datetime('now','+30 days')),
 UNIQUE(resource_id,intent_id),
 FOREIGN KEY(resource_id,scope_key) REFERENCES guestbook_enquiry_scopes(resource_id,scope_key),
 FOREIGN KEY(resource_id,configuration_revision) REFERENCES guestbook_resource_configs(resource_id,revision)
);
CREATE TABLE IF NOT EXISTS guestbook_enquiry_operations (
 resource_id TEXT NOT NULL REFERENCES guestbook_resources(id),
 id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('configure','review','reject','delete')),
 status TEXT NOT NULL CHECK(status IN ('pending','completed')),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(resource_id,id)
);
CREATE INDEX IF NOT EXISTS guestbook_enquiries_inbox ON guestbook_enquiries(resource_id,status,created_at,id);
CREATE INDEX IF NOT EXISTS guestbook_enquiries_expiry ON guestbook_enquiries(expires_at);
CREATE INDEX IF NOT EXISTS guestbook_enquiry_operations_expiry ON guestbook_enquiry_operations(created_at);
