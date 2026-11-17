/**
 * 建表 SQL（单一来源，编译后随 JS 一起发布，避免 .sql 文件复制问题）。
 * 5+ 张表：files / upload_chunks / upload_sessions / business_links / access_logs /
 *          blacklist / users / processed_images
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  object_key    TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size          INTEGER NOT NULL,
  checksum      TEXT,
  storage       TEXT NOT NULL DEFAULT 'local',
  bucket        TEXT,
  status        TEXT NOT NULL DEFAULT 'uploading',
  upload_type   TEXT NOT NULL,
  owner_id      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

CREATE TABLE IF NOT EXISTS upload_chunks (
  id          TEXT PRIMARY KEY,
  upload_id   TEXT NOT NULL,
  file_id     TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  checksum    TEXT,
  object_key  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'uploaded',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  UNIQUE (upload_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_upload ON upload_chunks(upload_id, chunk_index);

CREATE TABLE IF NOT EXISTS upload_sessions (
  upload_id     TEXT PRIMARY KEY,
  file_id       TEXT NOT NULL,
  total_chunks  INTEGER NOT NULL,
  chunk_size    INTEGER NOT NULL,
  total_size    INTEGER NOT NULL,
  merged        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS business_links (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL,
  biz_type    TEXT NOT NULL,
  biz_id      TEXT NOT NULL,
  metadata    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  UNIQUE (file_id, biz_type, biz_id)
);
CREATE INDEX IF NOT EXISTS idx_links_biz ON business_links(biz_type, biz_id);

CREATE TABLE IF NOT EXISTS access_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     TEXT,
  user_id     TEXT,
  action      TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  success     INTEGER NOT NULL DEFAULT 1,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_access_file ON access_logs(file_id, created_at);

CREATE TABLE IF NOT EXISTS blacklist (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  value       TEXT NOT NULL,
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, value)
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS processed_images (
  id             TEXT PRIMARY KEY,
  source_file_id TEXT NOT NULL,
  params_hash    TEXT NOT NULL,
  object_key     TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size           INTEGER NOT NULL,
  width          INTEGER,
  height         INTEGER,
  hit_count      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_file_id) REFERENCES files(id) ON DELETE CASCADE,
  UNIQUE (source_file_id, params_hash)
);
`;
