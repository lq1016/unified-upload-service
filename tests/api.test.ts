import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import './setup.js';
import { TEST_DIR } from './setup.js';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { hashPassword } from '../src/security/password.js';
import { getDb } from '../src/db/index.js';
import { newId } from '../src/utils/index.js';

const app = createApp();
let token = '';

beforeAll(async () => {
  migrate();
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(
    newId('u_'), 'tester', hashPassword('Pass@123'), 'user',
  );
  const res = await request(app).post('/api/auth/login').send({ username: 'tester', password: 'Pass@123' });
  expect(res.status).toBe(200);
  token = res.body.data.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function makePng(w = 200, h = 200): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 220, g: 80, b: 40 } } }).png().toBuffer();
}

describe('健康检查与鉴权', () => {
  it('GET /api/health 返回 ok', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('ok');
  });

  it('无令牌访问受保护接口返回 401', async () => {
    const r = await request(app).get('/api/upload/files');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('错误密码登录失败', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: 'tester', password: 'wrong' });
    expect(r.status).toBe(401);
  });
});

describe('小文件上传与安全校验', () => {
  it('上传合法 PNG 成功', async () => {
    const png = await makePng();
    const r = await request(app).post('/api/upload/small').set(auth()).attach('file', png, 'pic.png');
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('available');
    expect(r.body.data.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('拦截可执行文件伪装（MZ 头）', async () => {
    const r = await request(app)
      .post('/api/upload/small')
      .set(auth())
      .attach('file', Buffer.from('MZ\x90\x00malware'), 'evil.png');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MALICIOUS_FILE');
  });

  it('拦截不在白名单的扩展名', async () => {
    const png = await makePng();
    const r = await request(app).post('/api/upload/small').set(auth()).attach('file', png, 'script.exe');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('EXT_NOT_ALLOWED');
  });

  it('拦截魔数与声明类型不符', async () => {
    const r = await request(app)
      .post('/api/upload/small')
      .set(auth())
      .attach('file', Buffer.from('this is definitely not a real png file content'), 'fake.png');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MAGIC_MISMATCH');
  });
});

describe('直传凭证', () => {
  it('签发直传凭证', async () => {
    const r = await request(app)
      .post('/api/upload/direct-credentials')
      .set(auth())
      .send({ originalName: 'direct.png', mimeType: 'image/png', size: 1234 });
    expect(r.status).toBe(200);
    expect(r.body.data.uploadUrl.url).toContain('direct-put');
    expect(r.body.data.fileId).toBeTruthy();
  });

  it('拒绝超限大小', async () => {
    const r = await request(app)
      .post('/api/upload/direct-credentials')
      .set(auth())
      .send({ originalName: 'huge.png', mimeType: 'image/png', size: 3 * 1024 * 1024 * 1024 });
    expect(r.status).toBe(400);
  });
});

describe('分片上传与断点续传', () => {
  it('init -> 上传分片 -> 查询状态 -> 合并', async () => {
    const init = await request(app)
      .post('/api/upload/multipart/init')
      .set(auth())
      .send({ originalName: 'big.bin', mimeType: 'application/octet-stream', size: 1024, chunkSize: 512 });
    expect(init.status).toBe(200);
    const { uploadId, fileId, totalChunks } = init.body.data;
    expect(totalChunks).toBe(2);

    const c0 = Buffer.alloc(512, 65);
    const c1 = Buffer.alloc(512, 66);
    await request(app).put(`/api/upload/multipart/${uploadId}/chunk/0`).set(auth()).attach('chunk', c0, '0.part').expect(200);

    // 断点续传：此时只有分片 0
    const status = await request(app).get(`/api/upload/multipart/${uploadId}/status`).set(auth());
    expect(status.body.data.uploadedChunks).toEqual([0]);
    expect(status.body.data.merged).toBe(false);

    // 未齐时合并应失败
    const early = await request(app).post(`/api/upload/multipart/${uploadId}/merge`).set(auth());
    expect(early.status).toBe(409);

    await request(app).put(`/api/upload/multipart/${uploadId}/chunk/1`).set(auth()).attach('chunk', c1, '1.part').expect(200);
    const merged = await request(app).post(`/api/upload/multipart/${uploadId}/merge`).set(auth());
    expect(merged.status).toBe(200);
    expect(merged.body.data.file.status).toBe('available');
    expect(merged.body.data.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(fileId).toBe(merged.body.data.file.id);
  });

  it('重复合并幂等', async () => {
    const init = await request(app)
      .post('/api/upload/multipart/init')
      .set(auth())
      .send({ originalName: 'idem.bin', mimeType: 'application/octet-stream', size: 10, chunkSize: 10 });
    const { uploadId } = init.body.data;
    await request(app).put(`/api/upload/multipart/${uploadId}/chunk/0`).set(auth()).attach('chunk', Buffer.alloc(10, 1), '0.part').expect(200);
    const m1 = await request(app).post(`/api/upload/multipart/${uploadId}/merge`).set(auth());
    const m2 = await request(app).post(`/api/upload/multipart/${uploadId}/merge`).set(auth());
    expect(m2.status).toBe(200);
    expect(m2.body.data.checksum).toBe(m1.body.data.checksum);
  });
});

describe('图片处理与缓存', () => {
  it('压缩+水印，第二次命中缓存', async () => {
    const png = await makePng(300, 200);
    const up = await request(app).post('/api/upload/small').set(auth()).attach('file', png, 'photo.png');
    const fileId = up.body.data.id;
    const payload = { fileId, width: 120, quality: 75, watermark: true, watermarkText: 'TEST', format: 'webp' };
    const r1 = await request(app).post('/api/images/process').set(auth()).send(payload);
    expect(r1.status).toBe(200);
    expect(r1.body.data.cached).toBe(false);
    expect(r1.body.data.processedSize).toBeLessThan(r1.body.data.originalSize);
    expect(r1.body.data.mimeType).toBe('image/webp');

    const r2 = await request(app).post('/api/images/process').set(auth()).send(payload);
    expect(r2.body.data.cached).toBe(true);
    expect(r2.body.data.durationMs).toBe(0);

    const list = await request(app).get(`/api/images/processed/${fileId}`).set(auth());
    expect(list.body.data.length).toBe(1);
    expect(list.body.data[0].hit_count).toBe(1);
  });

  it('非图片文件处理返回 400', async () => {
    const init = await request(app)
      .post('/api/upload/multipart/init')
      .set(auth())
      .send({ originalName: 'x.bin', mimeType: 'application/octet-stream', size: 5, chunkSize: 5 });
    const { fileId } = init.body.data;
    const r = await request(app).post('/api/images/process').set(auth()).send({ fileId });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('NOT_AN_IMAGE');
  });
});

describe('私有桶签名访问与审计', () => {
  it('签名 URL 有效访问、错误 token 被拒绝', async () => {
    const png = await makePng(50, 50);
    const up = await request(app).post('/api/upload/small').set(auth()).attach('file', png, 'secret.png');
    const fileId = up.body.data.id;

    const signed = await request(app).post('/api/access/sign').set(auth()).send({ fileId });
    expect(signed.status).toBe(200);
    const url = signed.body.data.url as string;

    const ok = await request(app).get(url);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('image/png');

    const bad = await request(app).get(`/api/access/file?fileId=${fileId}&token=invalid`);
    expect(bad.status).toBe(403);

    const logs = await request(app).get('/api/access/logs').set(auth());
    expect(logs.body.data.some((l: any) => l.action === 'deny')).toBe(true);
  });
});

describe('业务关联与删除', () => {
  it('关联业务并删除文件', async () => {
    const png = await makePng(20, 20);
    const up = await request(app).post('/api/upload/small').set(auth()).attach('file', png, 'link.png');
    const fileId = up.body.data.id;

    const link = await request(app).post('/api/links').set(auth()).send({ fileId, bizType: 'avatar', bizId: 'u1' });
    expect(link.status).toBe(201);

    const del = await request(app).delete(`/api/files/${fileId}`).set(auth());
    expect(del.status).toBe(200);
    const files = await request(app).get('/api/upload/files').set(auth());
    expect(files.body.data.some((f: any) => f.id === fileId)).toBe(false);
  });
});
