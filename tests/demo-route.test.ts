import { describe, it, expect } from 'vitest';
import request from 'supertest';
import './setup.js';
import { createApp } from '../src/app.js';

describe('UI demo 路由', () => {
  const app = createApp();
  it('GET /demo 返回单页 HTML', async () => {
    const r = await request(app).get('/demo');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/html/);
    expect(r.text).toContain('交互演示');
    expect(r.text).toContain('分片上传');
  });
  it('GET /demo 含全部 7 个功能区', async () => {
    const r = await request(app).get('/demo');
    for (const s of ['登录鉴权','小文件上传','分片上传','恶意文件拦截','图片压缩','私有签名访问','访问审计日志']) {
      expect(r.text).toContain(s);
    }
  });
  it('GET / 重定向到 /demo', async () => {
    const r = await request(app).get('/');
    expect(r.status).toBe(302);
    expect(r.headers['location']).toBe('/demo');
  });
});
