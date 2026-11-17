import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll } from 'vitest';

/** 测试使用 /tmp 下的独立目录，避免把测试产物写进源码目录 */
export const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-svc-test-'));
process.env.DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.LOCAL_STORAGE_DIR = TEST_DIR;
process.env.STORAGE_DRIVER = 'local';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

export function samplePng(): Buffer {
  // 1x1 红色 PNG（合法魔数）
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
}

export async function writeSamplePng(): Promise<string> {
  const p = path.join(TEST_DIR, 'sample.png');
  fs.writeFileSync(p, samplePng());
  return p;
}

beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});
