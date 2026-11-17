import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');

/** 极简 .env 读取（不引入 dotenv 依赖，避免额外包袱）。已存在的进程环境变量优先。 */
function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // 去掉行内注释（仅当 # 前有空格）
    value = value.replace(/\s+#.*$/, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, '.env'));

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function str(name: string, fallback: string): string {
  return process.env[name] !== undefined && process.env[name] !== '' ? process.env[name]! : fallback;
}

function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export type StorageDriver = 'local' | 's3';
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export const config = {
  port: int('PORT', 3000),
  host: str('HOST', '0.0.0.0'),
  nodeEnv: str('NODE_ENV', 'development'),
  dbPath: path.resolve(ROOT, str('DB_PATH', './data/upload.db')),
  // WAL 适合常规磁盘；FUSE/网络盘不支持时可用 MEMORY（数据仍在 .db 文件，仅 journal 在内存）
  dbJournalMode: str('DB_JOURNAL_MODE', 'WAL') as 'WAL' | 'MEMORY' | 'DELETE',
  storage: {
    driver: str('STORAGE_DRIVER', 'local') as StorageDriver,
    localDir: path.resolve(ROOT, str('LOCAL_STORAGE_DIR', './data')),
    s3: {
      endpoint: str('S3_ENDPOINT', ''),
      region: str('S3_REGION', 'us-east-1'),
      bucket: str('S3_BUCKET', ''),
      accessKeyId: str('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
      forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
      signedUrlTtl: int('SIGNED_URL_TTL', 300),
    },
  },
  upload: {
    maxFileSize: int('MAX_FILE_SIZE', 2 * 1024 * 1024 * 1024),
    chunkSize: int('CHUNK_SIZE', 5 * 1024 * 1024),
    allowedMime: list('ALLOWED_MIME', ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/octet-stream']),
    allowedExt: list('ALLOWED_EXT', ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'bin']),
    smallFileThreshold: int('SMALL_FILE_THRESHOLD', 10 * 1024 * 1024),
  },
  image: {
    quality: int('IMAGE_QUALITY', 80),
    maxWidth: int('IMAGE_MAX_WIDTH', 1920),
    maxHeight: int('IMAGE_MAX_HEIGHT', 1920),
    format: str('IMAGE_FORMAT', 'webp') as 'webp' | 'jpeg' | 'png',
    watermarkText: str('WATERMARK_TEXT', 'InteMatrix'),
    watermarkPosition: str('WATERMARK_POSITION', 'bottom-right') as WatermarkPosition,
    watermarkOpacity: Number(str('WATERMARK_OPACITY', '0.35')),
  },
  security: {
    jwtSecret: str('JWT_SECRET', 'change-me-in-production'),
    jwtTtl: int('JWT_TTL', 3600),
  },
};

export default config;
