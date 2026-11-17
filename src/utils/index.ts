import crypto from 'node:crypto';
import fs from 'node:fs';
import type { RequestHandler } from 'express';

export function newId(prefix = ''): string {
  return prefix + crypto.randomUUID();
}

export function sha256(input: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** 包装 async 路由，把异常交给 express 错误处理中间件 */
export const asyncHandler =
  (fn: (...args: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'ERROR',
  ) {
    super(message);
  }
}

export function ok<T>(res: any, data: T, status = 200): void {
  res.status(status).json({ ok: true, data });
}

export function fail(res: any, status: number, message: string, code = 'ERROR'): void {
  res.status(status).json({ ok: false, error: { code, message } });
}
