import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import crypto from 'node:crypto';
import request from 'supertest';
import './setup.js';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { getDb } from '../src/db/index.js';
import { hashPassword, verifyPassword } from '../src/security/password.js';
import { signToken, verifyToken, signAccess, verifyAccess } from '../src/security/jwt.js';
import { validateCandidate, safeObjectKey } from '../src/security/fileguard.js';
import {
  processImage,
  paramsHash,
  newProcessedKey,
  contentDisposition,
  type ProcessOptions,
} from '../src/image/process.js';
import { getStorage, setStorage } from '../src/storage/index.js';
import { LocalStorage } from '../src/storage/local.js';
import { issueDirectToken, consumeDirectToken } from '../src/routes/upload.js';
import { HttpError, newId, sha256, ok, fail } from '../src/utils/index.js';

const app = createApp();
let token = '';

beforeAll(async () => {
  migrate();
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(
    newId('u_'), 'unit', hashPassword('Pass@123'), 'admin',
  );
  const res = await request(app).post('/api/auth/login').send({ username: 'unit', password: 'Pass@123' });
  token = res.body.data.token;
});
const auth = () => ({ Authorization: `Bearer ${token}` });

describe('图片处理：所有格式 / 水印位置 / 参数分支', () => {
  async function src(): Promise<Buffer> {
    return sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
  }

  it('format=jpeg 返回 image/jpeg', async () => {
    const r = await processImage(await src(), { format: 'jpeg', quality: 60, width: 100 });
    expect(r.mimeType).toBe('image/jpeg');
    expect(r.format).toBe('jpeg');
    expect(r.width).toBeLessThanOrEqual(100);
  });

  it('format=png 返回 image/png', async () => {
    const r = await processImage(await src(), { format: 'png', width: 100 });
    expect(r.mimeType).toBe('image/png');
  });

  it('format 缺省走默认 webp', async () => {
    const r = await processImage(await src(), {});
    expect(r.mimeType).toBe('image/webp');
  });

  it('compressionRatio 缩放分支', async () => {
    const r = await processImage(await src(), { compressionRatio: 0.5, format: 'webp' });
    expect(r.width).toBe(150);
    expect(r.height).toBe(100);
  });

  it('compressionRatio 被 clamp 到 [0.1,1]', async () => {
    const big = await processImage(await src(), { compressionRatio: 5, format: 'webp' });
    expect(big.width).toBe(300);
    const small = await processImage(await src(), { compressionRatio: 0.001, format: 'webp' });
    expect(small.width).toBe(30);
  });

  it('水印各位置均可合成', async () => {
    for (const pos of ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const) {
      const r = await processImage(await src(), {
        width: 120, watermark: true, watermarkText: `<A&B"'>` , watermarkOpacity: 0.5,
        watermarkPosition: pos, format: 'webp',
      });
      expect(r.mimeType).toBe('image/webp');
    }
  });

  it('无效图片（无尺寸）抛错', async () => {
    await expect(processImage(Buffer.from('not an image data at all'))).rejects.toThrow();
  });

  it('paramsHash 稳定且随参数变化；newProcessedKey / contentDisposition', () => {
    const a: ProcessOptions = { width: 100, quality: 70, format: 'webp' };
    expect(paramsHash(a)).toBe(paramsHash(a));
    expect(paramsHash(a)).not.toBe(paramsHash({ ...a, width: 200 }));
    expect(newProcessedKey('webp')).toMatch(/\d{4}-\d{2}\/processed\/img_.*\.webp$/);
    expect(contentDisposition('中文名"x".png')).toContain('filename*=UTF-8');
  });
});

describe('文件守卫：所有魔数类型 / 危险头 / 黑名单 / 空文件', () => {
  it('合法 JPEG / WebP / GIF / PDF 头通过校验', () => {
    expect(() => validateCandidate({ originalName: 'a.jpg', mimeType: 'image/jpeg', size: 100, head: Buffer.from([0xff, 0xd8, 0xff, 0x00]) })).not.toThrow();
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
    expect(() => validateCandidate({ originalName: 'a.webp', mimeType: 'image/webp', size: 100, head: webp })).not.toThrow();
    expect(() => validateCandidate({ originalName: 'a.gif', mimeType: 'image/gif', size: 100, head: Buffer.from('GIF89a') })).not.toThrow();
    expect(() => validateCandidate({ originalName: 'a.pdf', mimeType: 'application/pdf', size: 100, head: Buffer.from('%PDF-1.7') })).not.toThrow();
  });

  it('ELF / shebang / PHP 危险头被拦截', () => {
    const mk = (head: Buffer, name: string, mime = 'image/png') =>
      ({ originalName: name, mimeType: mime, size: 100, head });
    expect(() => validateCandidate(mk(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'x.png'))).toThrow(HttpError);
    expect(() => validateCandidate(mk(Buffer.from('#!/bin/sh'), 'x.png'))).toThrow(HttpError);
    expect(() => validateCandidate(mk(Buffer.from('<?php system();'), 'x.png'))).toThrow(HttpError);
  });

  it('HTML / script 头被拦截', () => {
    expect(() => validateCandidate({ originalName: 'x.png', mimeType: 'image/png', size: 100, head: Buffer.from('<HTML>...') })).toThrow(HttpError);
    expect(() => validateCandidate({ originalName: 'x.png', mimeType: 'image/png', size: 100, head: Buffer.from('<script>alert(1)') })).toThrow(HttpError);
  });

  it('非法 MIME / 空文件被拦截', () => {
    expect(() => validateCandidate({ originalName: 'a.png', mimeType: 'text/html', size: 100, head: Buffer.alloc(8, 1) })).toThrow(HttpError);
    expect(() => validateCandidate({ originalName: 'a.png', mimeType: 'image/png', size: 0, head: Buffer.alloc(8) })).toThrow(HttpError);
  });

  it('黑名单命中被拦截；safeObjectKey 去危险字符', () => {
    const head = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    getDb().prepare('INSERT OR REPLACE INTO blacklist (id, kind, value) VALUES (?, ?, ?)').run('bl_test', 'extension', 'jpg');
    expect(() => validateCandidate({ originalName: 'a.jpg', mimeType: 'image/jpeg', size: 100, head })).toThrow(HttpError);
    getDb().prepare('DELETE FROM blacklist WHERE id = ?').run('bl_test');
    const key = safeObjectKey('../../evil name.png', '_x');
    expect(key).not.toContain('..');
    expect(key).toContain('evil_name.png_x');
  });
});

describe('JWT / 密码 / 签名访问边界', () => {
  it('篡改 token / 错误签名被拒', () => {
    const t = signToken({ id: 'u1', username: 'a', role: 'user' });
    expect(verifyToken(t)).toMatchObject({ sub: 'u1' });
    expect(verifyToken(t + 'x')).toBeNull();
    expect(verifyToken('a.b.c')).toBeNull();
    expect(verifyToken('')).toBeNull();
  });

  it('过期 token 被拒', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', username: 'a', role: 'user', iat: 1, exp: 2 })).toString('base64url');
    // 构造合法签名的过期 token，验证 exp 过期分支
    const secret = process.env.JWT_SECRET || 'test-secret';
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    expect(verifyToken(`${header}.${payload}.${sig}`)).toBeNull();
  });

  it('签名访问 token 绑定 fileId，篡改/错文件被拒', () => {
    const { token, expiresAt } = signAccess('f1', 60);
    expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(verifyAccess(token, 'f1')).toBe(true);
    expect(verifyAccess(token, 'f2')).toBe(false);
    expect(verifyAccess(token + 'x', 'f1')).toBe(false);
    expect(verifyAccess('bad', 'f1')).toBe(false);
  });

  it('密码哈希错误格式返回 false', () => {
    const h = hashPassword('secret');
    expect(verifyPassword('secret', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('存储与工具函数', () => {
  it('LocalStorage put/get/exists/delete/getStream/presignGet', async () => {
    const s = new LocalStorage();
    const key = `unit/${newId()}.bin`;
    await s.put(key, Buffer.from('hello'));
    expect(await s.exists(key)).toBe(true);
    expect((await s.get(key)).toString()).toBe('hello');
    // 消费 getStream，避免未消费的流在 delete 后异步报错
    const stream = s.getStream(key);
    let streamData = '';
    for await (const c of stream) streamData += c.toString();
    expect(streamData).toBe('hello');
    const pg = await s.presignGet(key, 60);
    expect(pg.method).toBe('GET');
    await s.delete(key);
    expect(await s.exists(key)).toBe(false);
  });

  it('local 存储路径穿越被拒', async () => {
    const s = new LocalStorage();
    await expect(s.put('../evil', Buffer.from('x'))).rejects.toThrow();
  });

  it('setStorage 可注入；getStorage 返回当前驱动', () => {
    const s = new LocalStorage();
    setStorage(s);
    expect(getStorage()).toBe(s);
    expect(getStorage().name).toBe('local');
  });

  it('工具函数 HttpError / ok / fail / sha256', () => {
    expect(new HttpError(400, 'x', 'C').code).toBe('C');
    expect(sha256('abc')).toMatch(/^[0-9a-f]{64}$/);
    let captured: any;
    const res = { status: () => ({ json: (o: any) => { captured = o; } }) } as any;
    ok(res, 1);
    expect(captured).toMatchObject({ ok: true, data: 1 });
    fail(res, 400, 'e');
    expect(captured).toMatchObject({ ok: false });
    expect(newId('p_')).toMatch(/^p_/);
  });

});

describe('直传回调与更多接口分支', () => {
  it('issueDirectToken / consumeDirectToken 一次性且过期失效', () => {
    const t = issueDirectToken('k', 'image/png', -1);
    expect(consumeDirectToken(t)).toBeNull(); // 已过期
    const t2 = issueDirectToken('k2', 'image/png');
    expect(consumeDirectToken(t2)).toMatchObject({ key: 'k2' });
    expect(consumeDirectToken(t2)).toBeNull(); // 一次性
  });

  it('无效直传 token 回调返回 400', async () => {
    const r = await request(app).put('/api/upload/internal/direct-put?token=bad').send('x');
    expect(r.status).toBe(400);
  });

  it('有效直传凭证 → 回调落地 → 文件 available', async () => {
    const cred = await request(app).post('/api/upload/direct-credentials').set(auth())
      .send({ originalName: 'direct.png', mimeType: 'image/png', size: 4 });
    expect(cred.status).toBe(200);
    const url = cred.body.data.uploadUrl.url;
    const r = await request(app).put(url).set('Content-Type', 'image/png').send(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(r.status).toBe(200);
    const detail = await request(app).get(`/api/upload/files/${cred.body.data.fileId}`).set(auth());
    expect(detail.body.data.status).toBe('available');
  });

  it('文件详情不存在返回 404', async () => {
    const r = await request(app).get('/api/upload/files/nonexistent').set(auth());
    expect(r.status).toBe(404);
  });

  it('非法参数：图片处理缺 fileId / 签名缺 fileId / 关联缺字段', async () => {
    expect((await request(app).post('/api/images/process').set(auth()).send({})).status).toBe(400);
    expect((await request(app).post('/api/access/sign').set(auth()).send({})).status).toBe(400);
    expect((await request(app).post('/api/links').set(auth()).send({})).status).toBe(400);
  });

  it('multipart 分片越界返回 400', async () => {
    const init = await request(app).post('/api/upload/multipart/init').set(auth())
      .send({ originalName: 'b.bin', mimeType: 'application/octet-stream', size: 10, chunkSize: 10 });
    const upId = init.body.data.uploadId;
    const r = await request(app).put(`/api/upload/multipart/${upId}/chunk/99`).set(auth())
      .attach('chunk', Buffer.alloc(10, 1), 'c.part');
    expect(r.status).toBe(400);
  });

  it('不存在的上传会话状态查询返回 404', async () => {
    const r = await request(app).get('/api/upload/multipart/nope/status').set(auth());
    expect(r.status).toBe(404);
  });
});
