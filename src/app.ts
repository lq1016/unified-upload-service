import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from './config/index.js';
import { apiRouter } from './routes/index.js';
import { demoRouter } from './routes/demo.js';
import { migrate } from './db/migrate.js';
import { HttpError, fail } from './utils/index.js';

export function createApp(): express.Express {
  // 启动时执行建表（幂等）
  migrate();

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 登录接口限流，防暴力破解
  const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: 'draft-7', legacyHeaders: false });
  app.use('/api/auth/login', loginLimiter);

  app.use('/api', apiRouter);

  // 单页 UI demo（浏览器访问 /demo）
  app.use('/demo', demoRouter);

  // 根路径重定向到 demo
  app.get('/', (_req, res) => res.redirect('/demo'));

  // 全局 404
  app.use((_req, res) => fail(res, 404, '接口不存在', 'NOT_FOUND'));

  // 全局错误处理
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) {
      return fail(res, err.status, err.message, err.code);
    }
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return fail(res, 413, '文件过大', 'FILE_TOO_LARGE');
    }
    console.error('[error]', err);
    return fail(res, 500, '服务器内部错误', 'INTERNAL_ERROR');
  });

  return app;
}

export default createApp;
