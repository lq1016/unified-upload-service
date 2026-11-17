import { Router } from 'express';
import multer from 'multer';
import config from '../config/index.js';
import { auth } from '../middleware/auth.js';
import { asyncHandler, fail, HttpError, newId, ok, sha256 } from '../utils/index.js';
import { safeObjectKey, validateCandidate } from '../security/fileguard.js';
import { getStorage } from '../storage/index.js';
import { getDb } from '../db/index.js';
import {
  createFile,
  createUploadSession,
  getFile,
  getUploadSession,
  listFiles,
  markAvailable,
  mergeChunks,
  saveChunk,
  uploadedChunkIndexes,
} from '../services/fileService.js';
import { z } from 'zod';

export const uploadRouter = Router();

// multer 内存存储（便于魔数校验）；大文件分片逐片上传，单片受 CHUNK_SIZE 限制
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(config.upload.chunkSize, config.upload.maxFileSize) },
});

/** 供 local 驱动的直传凭证回调签名（临时 token 存入内存表，TTL 校验） */
const directTokens = new Map<string, { key: string; mime: string; expires: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of directTokens) if (v.expires < now) directTokens.delete(k);
}, 60_000).unref?.();
export function issueDirectToken(key: string, mime: string, ttl = 300): string {
  const token = newId('dt_');
  directTokens.set(token, { key, mime, expires: Date.now() + ttl * 1000 });
  return token;
}
export function consumeDirectToken(token: string): { key: string; mime: string } | null {
  const v = directTokens.get(token);
  if (!v || v.expires < Date.now()) return null;
  directTokens.delete(token);
  return { key: v.key, mime: v.mime };
}

// ---------------------------- 接口 1：直传凭证 ----------------------------
const directSchema = z.object({
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  size: z.number().int().positive().max(config.upload.maxFileSize),
});
uploadRouter.post('/direct-credentials', auth, asyncHandler(async (req, res) => {
  const parsed = directSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, '参数错误', 'INVALID_PARAMS');
  const { originalName, mimeType, size } = parsed.data;
  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
  if (!config.upload.allowedMime.includes(mimeType.toLowerCase()) || !config.upload.allowedExt.includes(ext)) {
    return fail(res, 400, '不允许的文件类型', 'TYPE_NOT_ALLOWED');
  }
  if (size > config.upload.maxFileSize) return fail(res, 413, '文件超过大小限制', 'FILE_TOO_LARGE');

  const objectKey = safeObjectKey(originalName);
  const presign = await getStorage().presignPut(objectKey, mimeType, 300);
  if (getStorage().name === 'local') {
    const token = issueDirectToken(objectKey, mimeType);
    presign.url = `/api/internal/direct-put?token=${token}`;
  }
  // 预建 file 记录（等待客户端回调确认）
  const file = createFile({ originalName, mimeType, size, uploadType: 'direct', ownerId: req.user!.sub, objectKey });
  ok(res, { uploadUrl: presign, fileId: file.id, objectKey, expiresIn: presign.expiresIn });
}));

// local 直传落地（供直传凭证返回的 URL 使用）
uploadRouter.put('/internal/direct-put', asyncHandler(async (req, res) => {
  const token = String(req.query.token ?? '');
  const info = consumeDirectToken(token);
  if (!info) return fail(res, 400, '直传凭证无效或已过期', 'INVALID_DIRECT_TOKEN');
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(Buffer.from(c)));
  await new Promise<void>((resolve, reject) => {
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  const body = Buffer.concat(chunks);
  const file = getFileByKey(info.key);
  if (file) {
    const checksum = sha256(body);
    await getStorage().put(info.key, body, info.mime);
    markAvailable(file.id, checksum);
  }
  ok(res, { received: body.length });
}));

function getFileByKey(key: string): any {
  return getDb().prepare("SELECT * FROM files WHERE object_key = ? AND status != 'deleted'").get(key);
}

// ---------------------------- 接口 2：小文件上传 ----------------------------
uploadRouter.post('/small', auth, upload.single('file'), asyncHandler(async (req, res) => {
  const f = req.file;
  if (!f) return fail(res, 400, '缺少 file 文件字段', 'MISSING_FILE');
  // 头部 n 字节用于魔数校验
  validateCandidate({ originalName: f.originalname, mimeType: f.mimetype, size: f.size, head: f.buffer.subarray(0, 512) });
  const objectKey = safeObjectKey(f.originalname);
  const checksum = sha256(f.buffer);
  await getStorage().put(objectKey, f.buffer, f.mimetype);
  const file = createFile({
    originalName: f.originalname,
    mimeType: f.mimetype,
    size: f.size,
    uploadType: 'small',
    ownerId: req.user!.sub,
    objectKey,
    checksum,
  });
  const available = markAvailable(file.id, checksum);
  ok(res, available, 201);
}));

// ---------------------------- 接口 3：初始化分片上传 ----------------------------
const initMultipartSchema = z.object({
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  size: z.number().int().positive().max(config.upload.maxFileSize),
  chunkSize: z.number().int().positive().optional(),
});
uploadRouter.post('/multipart/init', auth, asyncHandler(async (req, res) => {
  const parsed = initMultipartSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, '参数错误', 'INVALID_PARAMS');
  const { originalName, mimeType, size } = parsed.data;
  const chunkSize = Math.min(parsed.data.chunkSize ?? config.upload.chunkSize, config.upload.maxFileSize);
  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
  if (!config.upload.allowedMime.includes(mimeType.toLowerCase()) || !config.upload.allowedExt.includes(ext)) {
    return fail(res, 400, '不允许的文件类型', 'TYPE_NOT_ALLOWED');
  }
  const objectKey = safeObjectKey(originalName);
  const file = createFile({ originalName, mimeType, size, uploadType: 'multipart', ownerId: req.user!.sub, objectKey });
  const totalChunks = Math.ceil(size / chunkSize);
  const session = createUploadSession({ fileId: file.id, totalChunks, chunkSize, totalSize: size });
  ok(res, { uploadId: session.upload_id, fileId: file.id, chunkSize, totalChunks, objectKey });
}));

// ---------------------------- 接口 4：上传分片 ----------------------------
uploadRouter.put('/multipart/:uploadId/chunk/:index', auth, upload.single('chunk'), asyncHandler(async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) return fail(res, 400, '分片序号错误', 'CHUNK_INDEX_INVALID');
  const f = req.file;
  if (!f) return fail(res, 400, '缺少 chunk 文件字段', 'MISSING_FILE');
  const session = getUploadSession(req.params.uploadId);
  if (f.size > session.chunk_size) return fail(res, 413, '分片超过约定大小', 'CHUNK_TOO_LARGE');
  const checksum = sha256(f.buffer);
  const chunkKey = `${session.file_id}/chunks/${index}.part`;
  await getStorage().put(chunkKey, f.buffer, 'application/octet-stream');
  saveChunk(session.upload_id, index, chunkKey, f.size, checksum);
  ok(res, { index, size: f.size, checksum, uploaded: uploadedChunkIndexes(session.upload_id) });
}));

// ---------------------------- 断点续传状态查询 ----------------------------
uploadRouter.get('/multipart/:uploadId/status', auth, asyncHandler(async (req, res) => {
  const session = getUploadSession(req.params.uploadId);
  ok(res, {
    uploadId: session.upload_id,
    fileId: session.file_id,
    totalChunks: session.total_chunks,
    chunkSize: session.chunk_size,
    totalSize: session.total_size,
    uploadedChunks: uploadedChunkIndexes(session.upload_id),
    merged: !!session.merged,
  });
}));

// ---------------------------- 接口 5：合并分片 ----------------------------
uploadRouter.post('/multipart/:uploadId/merge', auth, asyncHandler(async (req, res) => {
  const result = await mergeChunks(req.params.uploadId);
  ok(res, { file: result.file, checksum: result.checksum });
}));

// ---------------------------- 接口 6：文件列表/详情 ----------------------------
uploadRouter.get('/files', auth, asyncHandler(async (req, res) => {
  ok(res, listFiles(req.user!.sub, 100));
}));
uploadRouter.get('/files/:id', auth, asyncHandler(async (req, res) => {
  ok(res, getFile(req.params.id));
}));
