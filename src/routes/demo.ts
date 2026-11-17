import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT } from '../config/index.js';

export const demoRouter = Router();

/** 单页 UI demo：npm start 后浏览器访问 /demo */
demoRouter.get('/', (_req, res) => {
  const file = path.join(ROOT, 'public', 'demo.html');
  if (!fs.existsSync(file)) {
    res.status(404).type('text').send('demo.html 不存在');
    return;
  }
  res.sendFile(file);
});
