import fs from 'node:fs';
import path from 'node:path';
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { getStorage } from '../storage/index.js';
import { HttpError, newId, sha256, sha256File } from '../utils/index.js';

export type UploadType = 'direct' | 'small' | 'multipart';

export interface CreateFileInput {
  originalName: string;
  mimeType: string;
  size: number;
  uploadType: UploadType;
  ownerId?: string;
  objectKey?: string;
  checksum?: string;
}

export function createFile(input: CreateFileInput): any {
  const db = getDb();
  const id = newId('f_');
  const objectKey = input.objectKey ?? newId('obj_');
  db.prepare(
    `INSERT INTO files (id, object_key, original_name, mime_type, size, checksum, storage, bucket, status, upload_type, owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`,
  ).run(
    id,
    objectKey,
    input.originalName,
    input.mimeType,
    input.size,
    input.checksum ?? null,
    getStorage().name,
    config.storage.driver === 's3' ? config.storage.s3.bucket : 'local',
    input.uploadType,
    input.ownerId ?? null,
  );
  return getFile(id);
}

export function getFile(id: string): any {
  const row = getDb().prepare('SELECT * FROM files WHERE id = ? AND status != ?').get(id, 'deleted');
  if (!row) throw new HttpError(404, '文件不存在', 'FILE_NOT_FOUND');
  return row;
}

export function getFileByObjectKey(key: string): any {
  const row = getDb().prepare('SELECT * FROM files WHERE object_key = ? AND status != ?').get(key, 'deleted');
  if (!row) throw new HttpError(404, '文件不存在', 'FILE_NOT_FOUND');
  return row;
}

export function markAvailable(id: string, checksum?: string): any {
  const db = getDb();
  db.prepare("UPDATE files SET status = 'available', checksum = COALESCE(?, checksum), updated_at = datetime('now') WHERE id = ?").run(
    checksum ?? null,
    id,
  );
  return getFile(id);
}

export function linkBusiness(fileId: string, bizType: string, bizId: string, metadata?: object): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO business_links (id, file_id, biz_type, biz_id, metadata) VALUES (?, ?, ?, ?, ?)')
    .run(newId('bl_'), fileId, bizType, bizId, metadata ? JSON.stringify(metadata) : null);
}

export function logAccess(entry: {
  fileId?: string;
  userId?: string;
  action: string;
  ip?: string;
  userAgent?: string;
  success?: boolean;
  detail?: string;
}): void {
  getDb()
    .prepare('INSERT INTO access_logs (file_id, user_id, action, ip, user_agent, success, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      entry.fileId ?? null,
      entry.userId ?? null,
      entry.action,
      entry.ip ?? null,
      entry.userAgent ?? null,
      entry.success === false ? 0 : 1,
      entry.detail ?? null,
    );
}

export function deleteFile(id: string, userId?: string): void {
  const db = getDb();
  const file = getFile(id);
  // 删除物理对象（忽略不存在）
  getStorage()
    .delete(file.object_key)
    .catch(() => undefined);
  db.prepare("UPDATE files SET status = 'deleted', updated_at = datetime('now') WHERE id = ?").run(id);
  db.prepare("UPDATE processed_images SET hit_count = hit_count WHERE source_file_id = ?").run(id);
  logAccess({ fileId: id, userId, action: 'delete', detail: file.object_key });
}

/** 创建分片上传会话 */
export function createUploadSession(input: {
  fileId: string;
  totalChunks: number;
  chunkSize: number;
  totalSize: number;
}): any {
  const id = newId('up_');
  getDb()
    .prepare(
      'INSERT INTO upload_sessions (upload_id, file_id, total_chunks, chunk_size, total_size) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, input.fileId, input.totalChunks, input.chunkSize, input.totalSize);
  return getUploadSession(id);
}

export function getUploadSession(uploadId: string): any {
  const row = getDb().prepare('SELECT * FROM upload_sessions WHERE upload_id = ?').get(uploadId);
  if (!row) throw new HttpError(404, '上传会话不存在', 'UPLOAD_SESSION_NOT_FOUND');
  return row;
}

/** 断点续传：返回已上传的分片索引 */
export function uploadedChunkIndexes(uploadId: string): number[] {
  const rows = getDb()
    .prepare('SELECT chunk_index FROM upload_chunks WHERE upload_id = ? AND status = ? ORDER BY chunk_index')
    .all(uploadId, 'uploaded') as Array<{ chunk_index: number }>;
  return rows.map((r) => r.chunk_index);
}

export function saveChunk(uploadId: string, index: number, objectKey: string, size: number, checksum?: string): void {
  const db = getDb();
  const session = getUploadSession(uploadId);
  if (index < 0 || index >= session.total_chunks) throw new HttpError(400, '分片序号越界', 'CHUNK_INDEX_INVALID');
  db.prepare(
    `INSERT INTO upload_chunks (id, upload_id, file_id, chunk_index, size, checksum, object_key, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded')
     ON CONFLICT(upload_id, chunk_index) DO UPDATE SET size = excluded.size, checksum = excluded.checksum, object_key = excluded.object_key, status = 'uploaded'`,
  ).run(newId('c_'), uploadId, session.file_id, index, size, checksum ?? null, objectKey);
}

/** 合并分片：校验完整性 -> 顺序拼接 -> 更新文件状态；返回 sha256 */
export async function mergeChunks(uploadId: string): Promise<{ file: any; checksum: string }> {
  const db = getDb();
  const session = getUploadSession(uploadId);
  if (session.merged) {
    const file = getFile(session.file_id);
    return { file, checksum: file.checksum };
  }
  const indexes = uploadedChunkIndexes(uploadId);
  if (indexes.length !== session.total_chunks) {
    throw new HttpError(409, `分片不完整：已上传 ${indexes.length}/${session.total_chunks}`, 'CHUNKS_INCOMPLETE');
  }
  const rows = db
    .prepare('SELECT object_key FROM upload_chunks WHERE upload_id = ? ORDER BY chunk_index')
    .all(uploadId) as Array<{ object_key: string }>;
  const file = getFile(session.file_id);
  await getStorage().concat(rows.map((r) => r.object_key), file.object_key);

  const local = file.storage === 'local' ? path.join(config.storage.localDir, file.object_key) : null;
  const checksum = local && fs.existsSync(local) ? await sha256File(local) : sha256(Buffer.from(uploadId));
  db.transaction(() => {
    db.prepare("UPDATE upload_sessions SET merged = 1, updated_at = datetime('now') WHERE upload_id = ?").run(uploadId);
    db.prepare("UPDATE files SET status = 'available', checksum = ?, updated_at = datetime('now') WHERE id = ?").run(checksum, file.id);
    db.prepare('UPDATE upload_chunks SET status = ? WHERE upload_id = ?').run('merged', uploadId);
  })();
  return { file: getFile(file.id), checksum };
}

export function listFiles(ownerId?: string, limit = 50): any[] {
  const db = getDb();
  if (ownerId) {
    return db
      .prepare("SELECT * FROM files WHERE owner_id = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT ?")
      .all(ownerId, limit) as any[];
  }
  return db.prepare("SELECT * FROM files WHERE status != 'deleted' ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
}
