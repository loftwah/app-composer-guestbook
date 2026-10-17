-- Independently owned Guestbooks. Legacy photos/settings and their media keys
-- remain untouched. Configuration snapshots and operation receipts belong to
-- this app; Composer stores only resource references.
CREATE TABLE IF NOT EXISTS guestbook_resources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  target TEXT NOT NULL,
  creation_operation TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  active_revision INTEGER,
  visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1)),
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(id, active_revision) REFERENCES guestbook_resource_configs(resource_id, revision)
);
CREATE TABLE IF NOT EXISTS guestbook_resource_configs (
  resource_id TEXT NOT NULL REFERENCES guestbook_resources(id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  digest TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  activated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(resource_id, revision)
);
CREATE TABLE IF NOT EXISTS guestbook_resource_operations (
  resource_id TEXT NOT NULL REFERENCES guestbook_resources(id),
  id TEXT NOT NULL,
  action TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','completed')),
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(resource_id, id)
);
CREATE TABLE IF NOT EXISTS guestbook_resource_items (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES guestbook_resources(id),
  caption TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pending','approved','hidden','rejected','deleted')),
  revision INTEGER NOT NULL DEFAULT 1,
  synthetic INTEGER NOT NULL DEFAULT 0 CHECK(synthetic IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS guestbook_resources_workspace ON guestbook_resources(workspace_id);
CREATE INDEX IF NOT EXISTS guestbook_resource_items_scope ON guestbook_resource_items(resource_id, status);
