import type { RequestHandler } from 'express';
import { verifyToken, type JwtPayload } from '../security/jwt.js';
import { fail } from '../utils/index.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Bearer JWT 鉴权（所有业务接口使用） */
export const auth: RequestHandler = (req, res, next) => {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const payload = verifyToken(token);
  if (!payload) {
    fail(res, 401, '无效或过期的访问令牌', 'UNAUTHORIZED');
    return;
  }
  req.user = payload;
  next();
};

/** 可选鉴权：有 token 就解析，没有也放行（用于公开签名访问） */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') || '';
  if (header.startsWith('Bearer ')) {
    const payload = verifyToken(header.slice(7).trim());
    if (payload) req.user = payload;
  }
  next();
};
