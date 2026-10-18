-- Portable copies never replace live items or tombstones. Their source remains
-- authoritative for every later approval, public read and private media read.
CREATE TABLE IF NOT EXISTS guestbook_resource_lineage (
  item_id TEXT PRIMARY KEY REFERENCES guestbook_resource_items(id),
  source_item TEXT NOT NULL REFERENCES guestbook_resource_items(id),
  source_resource TEXT NOT NULL REFERENCES guestbook_resources(id),
  source_revision INTEGER NOT NULL CHECK(source_revision > 0),
  source_configuration INTEGER NOT NULL CHECK(source_configuration > 0),
  source_digest TEXT NOT NULL,
  media_digest TEXT NOT NULL,
  restored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(item_id != source_item),
  FOREIGN KEY(source_resource, source_configuration)
    REFERENCES guestbook_resource_configs(resource_id, revision)
);
CREATE INDEX IF NOT EXISTS guestbook_lineage_source ON guestbook_resource_lineage(source_item);

-- Configuration-only copies also retain source authority. An empty portable
-- file is not permission to republish a source after it becomes private.
CREATE TABLE IF NOT EXISTS guestbook_resource_restores (
  resource_id TEXT PRIMARY KEY REFERENCES guestbook_resources(id),
  source_resource TEXT NOT NULL REFERENCES guestbook_resources(id),
  source_configuration INTEGER NOT NULL CHECK(source_configuration > 0),
  source_digest TEXT NOT NULL,
  restored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(resource_id != source_resource),
  FOREIGN KEY(source_resource, source_configuration)
    REFERENCES guestbook_resource_configs(resource_id, revision)
);
