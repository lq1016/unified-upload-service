import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import config from '../config/index.js';
import type { PresignedGet, PresignedPut, PutResult, StorageDriver } from './interface.js';

/** 本地文件系统存储驱动（开发与测试默认）。私有访问通过服务层签名 token 控制。 */
export class LocalStorage implements StorageDriver {
  readonly name = 'local' as const;
  private root: string;

  constructor(root = config.storage.localDir) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
  }

  private full(key: string): string {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep) && p !== this.root) {
      throw new Error('非法对象键（路径穿越）');
    }
    return p;
  }

  async put(key: string, data: Buffer | Uint8Array | Readable, _contentType?: string): Promise<PutResult> {
    const dest = this.full(key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      fs.writeFileSync(dest, data);
      return { key, size: (data as Uint8Array).byteLength };
    }
    await pipeline(data as Readable, fs.createWriteStream(dest));
    const size = fs.statSync(dest).size;
    return { key, size };
  }

  async get(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.full(key));
  }

  getStream(key: string): Readable {
    return fs.createReadStream(this.full(key));
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.full(key));
  }

  async delete(key: string): Promise<void> {
    const p = this.full(key);
    if (fs.existsSync(p)) await fs.promises.unlink(p);
  }

  /** 顺序拼接分片到目标文件（流式，避免占用大内存） */
  async concat(chunks: string[], targetKey: string): Promise<PutResult> {
    const dest = this.full(targetKey);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const out = fs.createWriteStream(dest);
    for (const chunkKey of chunks) {
      const data = fs.createReadStream(this.full(chunkKey));
      await pipeline(data, out, { end: false });
    }
    out.end();
    await new Promise<void>((resolve, reject) => {
      out.on('finish', () => resolve());
      out.on('error', reject);
    });
    return { key: targetKey, size: fs.statSync(dest).size };
  }

  /** 本地驱动用回调式上传 URL：返回 /api/upload/internal/direct-put?token=...（路由挂载于 /api/upload） */
  async presignPut(key: string, contentType: string, expiresIn: number): Promise<PresignedPut> {
    // 使用短期签名 token（在 routes 中由 issueDirectToken 生成并注入 url）
    return {
      url: `/api/upload/internal/direct-put?key=${encodeURIComponent(key)}&expiresIn=${expiresIn}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresIn,
      objectKey: key,
    };
  }

  async presignGet(key: string, expiresIn: number): Promise<PresignedGet> {
    return { url: `/api/internal/direct-get?key=${encodeURIComponent(key)}`, method: 'GET', expiresIn, objectKey: key };
  }
}
