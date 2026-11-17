import crypto from 'node:crypto';
import config from '../config/index.js';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  return crypto.createHmac('sha256', config.security.jwtSecret).update(data).digest('base64url');
}

/** 生成 HS256 JWT（不引入 jsonwebtoken 依赖，便于审计） */
export function signToken(user: { id: string; username: string; role: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      username: user.username,
      role: user.role,
      iat: now,
      exp: now + config.security.jwtTtl,
    }),
  );
  const body = `${header}.${payload}`;
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): JwtPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = sign(`${header}.${payload}`);
  // 恒定时间比较，防 timing attack
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JwtPayload;
    if (typeof decoded.exp !== 'number' || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** 私有桶签名 URL 用短期 token（绑定 fileId + 过期时间） */
export function signAccess(fileId: string, ttl = config.storage.s3.signedUrlTtl): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const body = b64url(JSON.stringify({ f: fileId, exp: expiresAt }));
  const sig = sign(`access.${body}`);
  return { token: `${body}.${sig}`, expiresAt };
}

export function verifyAccess(token: string, fileId: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  const expected = sign(`access.${body}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { f: string; exp: number };
    return decoded.f === fileId && decoded.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
