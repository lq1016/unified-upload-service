import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import config from '../config/index.js';
import type { PresignedGet, PresignedPut, PutResult, StorageDriver } from './interface.js';

/** S3 兼容对象存储驱动（MinIO / AWS S3 / 阿里云 OSS S3 模式等） */
export class S3Storage implements StorageDriver {
  readonly name = 's3' as const;
  private client: S3Client;
  private bucket: string;

  constructor() {
    const s = config.storage.s3;
    this.bucket = s.bucket;
    this.client = new S3Client({
      endpoint: s.endpoint || undefined,
      region: s.region,
      forcePathStyle: s.forcePathStyle,
      credentials:
        s.accessKeyId && s.secretAccessKey
          ? { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey }
          : undefined, // 回退到 IAM role / 环境变量
    });
  }

  async put(key: string, data: Buffer | Uint8Array | Readable, contentType?: string): Promise<PutResult> {
    const res = await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data as any, ContentType: contentType }),
    );
    return { key, size: (data as Uint8Array)?.byteLength ?? 0, etag: res.ETag };
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const c of res.Body as Readable) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }

  getStream(key: string): Readable {
    let stream!: Readable;
    const promise = this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })).then((res) => {
      stream = res.Body as Readable;
      return stream;
    });
    // 惰性流：真正读取时才拉取对象（调用方主要用 get()）
    return Readable.from(async function* () {
      const s = await promise;
      for await (const c of s) yield c;
    }());
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async concat(chunks: string[], targetKey: string): Promise<PutResult> {
    // S3 原生 MultipartUpload 合并（每个分片作为 part 上传后 Complete）
    const mpu = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: targetKey }));
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      const buf = await this.get(chunks[i]);
      const res = await this.client.send(
        new UploadPartCommand({ Bucket: this.bucket, Key: targetKey, UploadId: mpu.UploadId, PartNumber: i + 1, Body: buf }),
      );
      parts.push({ PartNumber: i + 1, ETag: res.ETag });
    }
    const res = await this.client.send(
      new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: targetKey, UploadId: mpu.UploadId, MultipartUpload: { Parts: parts } }),
    );
    return { key: targetKey, size: 0, etag: res.ETag };
  }

  async presignPut(key: string, contentType: string, expiresIn: number): Promise<PresignedPut> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
    return { url, method: 'PUT', headers: { 'Content-Type': contentType }, expiresIn, objectKey: key };
  }

  async presignGet(key: string, expiresIn: number): Promise<PresignedGet> {
    const url = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
    return { url, method: 'GET', expiresIn, objectKey: key };
  }
}
