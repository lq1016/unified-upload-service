import type { Readable } from 'node:stream';

export interface PutResult {
  key: string;
  size: number;
  etag?: string;
}

export interface PresignedPut {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
  objectKey: string;
}

export interface PresignedGet {
  url: string;
  method: 'GET';
  expiresIn: number;
  objectKey: string;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, data: Buffer | Uint8Array | Readable, contentType?: string): Promise<PutResult>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Readable;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  concat(chunks: string[], targetKey: string): Promise<PutResult>;
  presignPut(key: string, contentType: string, expiresIn: number): Promise<PresignedPut>;
  presignGet(key: string, expiresIn: number): Promise<PresignedGet>;
}
