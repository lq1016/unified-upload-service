import path from 'node:path';
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { HttpError, sha256 } from '../utils/index.js';

/** 文件头魔数签名（用于校验「扩展名/Content-Type」与实际内容一致，防木马伪装） */
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  'image/gif': (b) => b.length >= 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a'),
  'application/pdf': (b) => b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-',
};

/** 可执行的危险文件头（即使扩展名伪装成图片也要拦截） */
const DANGEROUS: Array<(b: Buffer) => boolean> = [
  (b) => b.subarray(0, 2).toString('ascii') === 'MZ', // PE/EXE
  (b) => b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), // ELF
  (b) => b.subarray(0, 2).toString('ascii') === '#!', // shebang 脚本
  (b) => b.subarray(0, 4).toString('ascii') === '<?ph', // PHP
  (b) => b.subarray(0, 5).toString('ascii').toLowerCase() === '<html', // HTML（可能 XSS）
  (b) => b.subarray(0, 9).toString('ascii').toLowerCase() === '<script>', // JS
];

export interface FileCandidate {
  originalName: string;
  mimeType: string;
  size: number;
  head: Buffer;
}

/** 校验扩展名 + MIME 白名单 + 大小限制 + 魔数一致性 + 恶意头 + 黑名单 */
export function validateCandidate(c: FileCandidate): void {
  const ext = path.extname(c.originalName).replace('.', '').toLowerCase();
  if (!config.upload.allowedExt.includes(ext)) {
    throw new HttpError(400, `不允许的文件扩展名: .${ext}`, 'EXT_NOT_ALLOWED');
  }
  if (!config.upload.allowedMime.includes(c.mimeType.toLowerCase())) {
    throw new HttpError(400, `不允许的 MIME 类型: ${c.mimeType}`, 'MIME_NOT_ALLOWED');
  }
  if (c.size > config.upload.maxFileSize) {
    throw new HttpError(413, `文件超过大小限制 (${config.upload.maxFileSize} 字节)`, 'FILE_TOO_LARGE');
  }
  if (c.size <= 0) {
    throw new HttpError(400, '文件不能为空', 'EMPTY_FILE');
  }

  for (const isDanger of DANGEROUS) {
    if (isDanger(c.head)) {
      throw new HttpError(400, '检测到可疑/可执行文件头，已拒绝', 'MALICIOUS_FILE');
    }
  }

  const verifier = MAGIC[c.mimeType.toLowerCase()];
  if (verifier && c.head.length >= 4 && !verifier(c.head)) {
    throw new HttpError(400, '文件内容与声明类型不符（魔数校验失败）', 'MAGIC_MISMATCH');
  }

  const db = getDb();
  const checksum = sha256(c.head);
  const blocked = db.prepare('SELECT 1 FROM blacklist WHERE (kind = ? AND value = ?) OR (kind = ? AND value = ?)').get(
    'checksum', checksum,
    'extension', ext,
  );
  if (blocked) {
    throw new HttpError(403, '文件命中黑名单，已拒绝', 'BLACKLISTED');
  }
}

/** 从原始文件名派生安全的对象键：隔离目录 + 去危险字符 + 随机前缀 */
export function safeObjectKey(originalName: string, suffix = ''): string {
  const base = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
  const yyyy = new Date().toISOString().slice(0, 7); // YYYY-MM
  return `${yyyy}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${base}${suffix}`;
}
