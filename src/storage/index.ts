import config from '../config/index.js';
import type { StorageDriver } from './interface.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  driver = config.storage.driver === 's3' ? new S3Storage() : new LocalStorage();
  return driver;
}

/** 测试用注入 */
export function setStorage(d: StorageDriver): void {
  driver = d;
}

export * from './interface.js';
