import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT } from '../config/index.js';

export const demoRouter = Router();

const PUBLIC_DIR = path.join(ROOT, 'public');

/** 单页 UI demo：npm start 后浏览器访问 /demo */
demoRouter.get('/', (_req, res) => {
  const file = path.join(PUBLIC_DIR, 'demo.html');
  if (!fs.existsSync(file)) {
    res.status(404).type('text').send('demo.html 不存在');
    return;
  }
  res.sendFile(file);
});

/**
 * demo 页面的脚本必须以外部文件引入：
 * 服务端启用了 helmet 默认 CSP（script-src 'self' / script-src-attr 'none'），
 * 内联 <script> 与 onclick= 属性会被浏览器直接拦截，页面会「看起来正常但毫无响应」。
 */
demoRouter.get('/demo.js', (_req, res) => {
  const file = path.join(PUBLIC_DIR, 'demo.js');
  if (!fs.existsSync(file)) {
    res.status(404).type('text').send('demo.js 不存在');
    return;
  }
  res.type('application/javascript').sendFile(file);
});
