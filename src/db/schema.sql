-- ============================================================================
-- 统一上传服务 建表脚本（SQLite；可移植到 MySQL/PG，字段类型语义一致）
-- 5+ 张表：files / upload_chunks / business_links / access_logs / blacklist
--          + users（测试账号）/ processed_images（图片处理结果缓存）
-- ============================================================================

-- journal_mode 由 src/db/index.ts 按 DB_JOURNAL_MODE 配置设置（默认 WAL）
PRAGMA foreign_keys = ON;

-- 1. 文件主表
CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  object_key    TEXT NOT NULL UNIQUE,        -- 存储后端中的对象键
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size          INTEGER NOT NULL,
  checksum      TEXT,                        -- 整文件 sha256
  storage       TEXT NOT NULL DEFAULT 'local',
  bucket        TEXT,
  status        TEXT NOT NULL DEFAULT 'uploading', -- uploading|available|deleted
  upload_type   TEXT NOT NULL,               -- direct|small|multipart
  owner_id      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

-- 2. 分片表（分片上传 / 断点续传）
CREATE TABLE IF NOT EXISTS upload_chunks (
  id          TEXT PRIMARY KEY,
  upload_id   TEXT NOT NULL,                 -- 一次分片上传会话 id
  file_id     TEXT NOT NULL,                 -- 关联 files.id
  chunk_index INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  checksum    TEXT,
  object_key  TEXT NOT NULL,                 -- 分片存储位置
  status      TEXT NOT NULL DEFAULT 'uploaded',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  UNIQUE (upload_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_upload ON upload_chunks(upload_id, chunk_index);

-- 分片上传会话表（记录期望总数、已合并状态，支撑断点续传查询）
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

-- 3. 业务关联表（文件与业务实体多对多关联）
CREATE TABLE IF NOT EXISTS business_links (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL,
  biz_type    TEXT NOT NULL,                 -- 如 avatar / order / report
  biz_id      TEXT NOT NULL,
  metadata    TEXT,                          -- JSON 扩展
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  UNIQUE (file_id, biz_type, biz_id)
);
CREATE INDEX IF NOT EXISTS idx_links_biz ON business_links(biz_type, biz_id);

-- 4. 访问记录表（私有桶签名访问审计）
CREATE TABLE IF NOT EXISTS access_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     TEXT,
  user_id     TEXT,
  action      TEXT NOT NULL,                 -- sign|access|deny|delete
  ip          TEXT,
  user_agent  TEXT,
  success     INTEGER NOT NULL DEFAULT 1,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_access_file ON access_logs(file_id, created_at);

-- 5. 黑名单表（恶意文件 / 哈希 / 用户）
CREATE TABLE IF NOT EXISTS blacklist (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                 -- checksum|mime|extension|user
  value       TEXT NOT NULL,
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, value)
);

-- 6. 用户表（2 个测试账号）
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,               -- scrypt 盐+哈希
  role         TEXT NOT NULL DEFAULT 'user',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. 图片处理结果缓存表
CREATE TABLE IF NOT EXISTS processed_images (
  id            TEXT PRIMARY KEY,
  source_file_id TEXT NOT NULL,
  params_hash   TEXT NOT NULL,               -- 处理参数摘要
  object_key    TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size          INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_file_id) REFERENCES files(id) ON DELETE CASCADE,
  UNIQUE (source_file_id, params_hash)
);
