import { Router } from 'express';
import multer from 'multer';
import config from '../config/index.js';
import { auth, optionalAuth } from '../middleware/auth.js';
import { asyncHandler, fail, ok } from '../utils/index.js';
import { signToken } from '../security/jwt.js';
import { verifyPassword } from '../security/password.js';
import { getDb } from '../db/index.js';
import { getStorage } from '../storage/index.js';
import { deleteFile, getFile, linkBusiness, listFiles, logAccess } from '../services/fileService.js';
import { listProcessed, processAndCache } from '../services/imageService.js';
import { contentDisposition, type ProcessOptions, type WatermarkPosition } from '../image/process.js';
import { signAccess, verifyAccess } from '../security/jwt.js';
import { uploadRouter } from './upload.js';
import { z } from 'zod';

export const apiRouter = Router();

// ---------------------------- 认证：登录（2 个测试账号） ----------------------------
const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
apiRouter.post('/auth/login', asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, '参数错误', 'INVALID_PARAMS');
  const user = getDb().prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(parsed.data.username) as any;
  if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
    return fail(res, 401, '账号或密码错误', 'BAD_CREDENTIALS');
  }
  ok(res, { token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
}));

apiRouter.get('/auth/me', auth, asyncHandler(async (req, res) => {
  ok(res, req.user);
}));

// 上传相关接口（挂在 /api/upload）
apiRouter.use('/upload', uploadRouter);

// ---------------------------- 接口 7：删除文件 ----------------------------
apiRouter.delete('/files/:id', auth, asyncHandler(async (req, res) => {
  deleteFile(req.params.id, req.user!.sub);
  ok(res, { deleted: true });
}));

// ---------------------------- 接口 8：图片处理（压缩/画质/水印/缓存） ----------------------------
apiRouter.post('/images/process', auth, asyncHandler(async (req, res) => {
  const schema = z.object({
    fileId: z.string().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    quality: z.number().int().min(1).max(100).optional(),
    format: z.enum(['webp', 'jpeg', 'png']).optional(),
    watermark: z.boolean().optional(),
    watermarkText: z.string().max(100).optional(),
    watermarkPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']).optional(),
    watermarkOpacity: z.number().min(0).max(1).optional(),
    compressionRatio: z.number().min(0.1).max(1).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, '参数错误', 'INVALID_PARAMS');
  const { fileId, ...rest } = parsed.data;
  const opts: ProcessOptions = {
    ...rest,
    watermarkPosition: rest.watermarkPosition as WatermarkPosition | undefined,
  };
  const result = await processAndCache(fileId, opts, req.user!.sub);
  // 以 JSON base64 返回（同时支持 ?download=1 下载）
  if (req.query.download === '1') {
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(`processed-${fileId}.${result.format}`));
    res.setHeader('X-Cache', result.cached ? 'HIT' : 'MISS');
    res.setHeader('X-Duration-Ms', String(result.durationMs));
    res.send(result.data);
    return;
  }
  ok(res, {
    fileId,
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
    format: result.format,
    originalSize: result.originalSize,
    processedSize: result.processedSize,
    compressionRate: +(1 - result.processedSize / result.originalSize).toFixed(4),
    durationMs: result.durationMs,
    cached: result.cached,
    objectKey: result.objectKey,
    base64: result.data.toString('base64'),
  });
}));

apiRouter.get('/images/processed/:fileId', auth, asyncHandler(async (req, res) => {
  ok(res, listProcessed(req.params.fileId));
}));

// ---------------------------- 业务关联 ----------------------------
const linkSchema = z.object({ fileId: z.string().min(1), bizType: z.string().min(1), bizId: z.string().min(1), metadata: z.record(z.any()).optional() });
apiRouter.post('/links', auth, asyncHandler(async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, '参数错误', 'INVALID_PARAMS');
  const { fileId, bizType, bizId, metadata } = parsed.data;
  getFile(fileId);
  linkBusiness(fileId, bizType, bizId, metadata);
  ok(res, { linked: true }, 201);
}));

// ---------------------------- 接口 9：访问鉴权（私有桶签名访问） ----------------------------
apiRouter.post('/access/sign', auth, asyncHandler(async (req, res) => {
  const schema = z.object({ fileId: z.string().min(1), ttl: z.number().int().min(1).max(3600).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, '参数错误', 'INVALID_PARAMS');
  const file = getFile(parsed.data.fileId);
  const { token, expiresAt } = signAccess(file.id, parsed.data.ttl);
  const url = `/api/access/file?fileId=${encodeURIComponent(file.id)}&token=${encodeURIComponent(token)}`;
  logAccess({ fileId: file.id, userId: req.user!.sub, action: 'sign', detail: url });
  ok(res, { url, token, expiresAt, expiresIn: expiresAt - Math.floor(Date.now() / 1000) });
}));

// 私有访问：校验短期签名 token（或走 S3 预签名 URL）
apiRouter.get('/access/file', optionalAuth, asyncHandler(async (req, res) => {
  const fileId = String(req.query.fileId ?? '');
  const token = String(req.query.token ?? '');
  if (!verifyAccess(token, fileId)) {
    logAccess({ fileId, userId: req.user?.sub, action: 'deny', ip: req.ip, userAgent: req.get('user-agent'), success: false, detail: 'invalid token' });
    return fail(res, 403, '访问签名无效或已过期', 'ACCESS_DENIED');
  }
  const file = getFile(fileId);
  const data = await getStorage().get(file.object_key);
  logAccess({ fileId, userId: req.user?.sub, action: 'access', ip: req.ip, userAgent: req.get('user-agent') });
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', contentDisposition(file.original_name));
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.send(data);
}));

// ---------------------------- 访问记录查询（审计） ----------------------------
apiRouter.get('/access/logs', auth, asyncHandler(async (req, res) => {
  const rows = getDb().prepare('SELECT * FROM access_logs ORDER BY id DESC LIMIT 100').all();
  ok(res, rows);
}));

// ---------------------------- 健康检查 ----------------------------
apiRouter.get('/health', (_req, res) => {
  ok(res, { status: 'ok', uptime: process.uptime(), storage: getStorage().name });
});
