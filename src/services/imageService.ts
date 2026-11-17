import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { getStorage } from '../storage/index.js';
import { newId, sha256 } from '../utils/index.js';
import {
  paramsHash,
  processImage,
  type ProcessOptions,
  type ProcessedImage,
} from '../image/process.js';
import { getFile, logAccess } from './fileService.js';

export interface ProcessResult extends ProcessedImage {
  cached: boolean;
  processedFileId?: string;
  objectKey?: string;
}

/** 图片处理：先查缓存（source_file_id + 参数摘要），命中直接返回，未命中处理后落库+落存储 */
export async function processAndCache(
  fileId: string,
  opts: ProcessOptions,
  userId?: string,
): Promise<ProcessResult> {
  const db = getDb();
  const source = getFile(fileId);
  if (!source.mime_type.startsWith('image/')) {
    const { HttpError } = await import('../utils/index.js');
    throw new HttpError(400, '仅支持图片文件处理', 'NOT_AN_IMAGE');
  }
  const hash = paramsHash(opts);
  const cached = db.prepare('SELECT * FROM processed_images WHERE source_file_id = ? AND params_hash = ?').get(fileId, hash) as any;
  if (cached && (await getStorage().exists(cached.object_key))) {
    db.prepare('UPDATE processed_images SET hit_count = hit_count + 1 WHERE id = ?').run(cached.id);
    const data = await getStorage().get(cached.object_key);
    logAccess({ fileId, userId, action: 'access', detail: `processed cache hit ${cached.id}` });
    return {
      data,
      mimeType: cached.mime_type,
      width: cached.width,
      height: cached.height,
      format: cached.mime_type.split('/')[1],
      originalSize: source.size,
      processedSize: cached.size,
      durationMs: 0,
      cached: true,
      processedFileId: cached.id,
      objectKey: cached.object_key,
    };
  }

  const sourceBytes = await getStorage().get(source.object_key);
  const result = await processImage(sourceBytes, opts);
  const ext = result.format === 'jpeg' ? 'jpg' : result.format;
  const yyyy = new Date().toISOString().slice(0, 7);
  const objectKey = `${yyyy}/processed/${newId('img_')}.${ext}`;
  await getStorage().put(objectKey, result.data, result.mimeType);

  const id = newId('pi_');
  db.prepare(
    `INSERT INTO processed_images (id, source_file_id, params_hash, object_key, mime_type, size, width, height)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_file_id, params_hash) DO UPDATE SET object_key = excluded.object_key, size = excluded.size, width = excluded.width, height = excluded.height`,
  ).run(id, fileId, hash, objectKey, result.mimeType, result.processedSize, result.width, result.height);

  logAccess({ fileId, userId, action: 'access', detail: `processed ${id}` });
  return { ...result, cached: false, processedFileId: id, objectKey };
}

export function listProcessed(fileId: string): any[] {
  return getDb()
    .prepare('SELECT id, params_hash, object_key, mime_type, size, width, height, hit_count, created_at FROM processed_images WHERE source_file_id = ? ORDER BY created_at DESC')
    .all(fileId) as any[];
}

// 供未来扩展
void sha256;
void config;
