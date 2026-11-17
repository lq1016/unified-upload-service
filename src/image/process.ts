import crypto from 'node:crypto';
import sharp from 'sharp';
import config, { type WatermarkPosition } from '../config/index.js';
import { HttpError, newId, sha256 } from '../utils/index.js';

export type { WatermarkPosition } from '../config/index.js';

export interface ProcessOptions {
  width?: number;
  height?: number;
  quality?: number; // 1-100
  format?: 'webp' | 'jpeg' | 'png';
  watermark?: boolean;
  watermarkText?: string;
  watermarkPosition?: WatermarkPosition;
  watermarkOpacity?: number;
  compressionRatio?: number; // 0.1-1.0，进一步缩放的便捷参数
}

/** 计算处理参数的稳定摘要，用作缓存键 */
export function paramsHash(opts: ProcessOptions): string {
  const canonical = JSON.stringify({
    width: opts.width ?? null,
    height: opts.height ?? null,
    quality: opts.quality ?? config.image.quality,
    format: opts.format ?? config.image.format,
    watermark: opts.watermark ?? false,
    watermarkText: opts.watermarkText ?? config.image.watermarkText,
    watermarkPosition: opts.watermarkPosition ?? config.image.watermarkPosition,
    watermarkOpacity: opts.watermarkOpacity ?? config.image.watermarkOpacity,
    compressionRatio: opts.compressionRatio ?? null,
  });
  return sha256(canonical);
}

function svgWatermark(text: string, opacity: number, width: number, height: number): Buffer {
  const escaped = text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
  const fontSize = Math.max(14, Math.round(Math.min(width, height) / 18));
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="50%" y="50%" font-family="sans-serif" font-size="${fontSize}" fill="#ffffff" fill-opacity="${opacity}" ` +
      `text-anchor="middle" dominant-baseline="middle" transform="rotate(-20 ${width / 2} ${height / 2})">${escaped}</text></svg>`,
  );
}

function gravity(pos: WatermarkPosition): string {
  const map: Record<WatermarkPosition, string> = {
    'top-left': 'northwest',
    'top-right': 'northeast',
    'bottom-left': 'southwest',
    'bottom-right': 'southeast',
    center: 'center',
  };
  return map[pos] ?? 'southeast';
}

export interface ProcessedImage {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  format: string;
  originalSize: number;
  processedSize: number;
  durationMs: number;
}

/** 使用 sharp 压缩（可配质量/尺寸），可选叠加水印 */
export async function processImage(source: Buffer, opts: ProcessOptions = {}): Promise<ProcessedImage> {
  const started = performance.now();
  const format = opts.format ?? config.image.format;
  const quality = Math.min(100, Math.max(1, opts.quality ?? config.image.quality));

  let img = sharp(source, { failOn: 'error' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new HttpError(400, '无法解析图片尺寸', 'INVALID_IMAGE');

  let width = opts.width ?? config.image.maxWidth;
  let height = opts.height ?? config.image.maxHeight;
  if (opts.compressionRatio) {
    const r = Math.min(1, Math.max(0.1, opts.compressionRatio));
    width = Math.round(meta.width * r);
    height = Math.round(meta.height * r);
  }
  let resized = img.resize({ width, height, fit: 'inside', withoutEnlargement: true });
  // 先物化 resize 结果，拿到精确尺寸；水印 SVG 必须 <= 实际图像尺寸，否则 sharp 合成失败
  let base: Buffer = await resized.png().toBuffer();
  const baseMeta = await sharp(base).metadata();
  const outW = baseMeta.width ?? width;
  const outH = baseMeta.height ?? height;

  if (opts.watermark) {
    const wm = svgWatermark(
      opts.watermarkText ?? config.image.watermarkText,
      opts.watermarkOpacity ?? config.image.watermarkOpacity,
      outW,
      outH,
    );
    base = await sharp(base)
      .composite([{ input: wm, gravity: gravity(opts.watermarkPosition ?? config.image.watermarkPosition) as any }])
      .png()
      .toBuffer();
  }

  let output: Buffer;
  let mimeType: string;
  if (format === 'jpeg') {
    output = await sharp(base).jpeg({ quality, mozjpeg: true }).toBuffer();
    mimeType = 'image/jpeg';
  } else if (format === 'png') {
    output = await sharp(base).png({ quality, compressionLevel: 9 }).toBuffer();
    mimeType = 'image/png';
  } else {
    output = await sharp(base).webp({ quality }).toBuffer();
    mimeType = 'image/webp';
  }
  return {
    data: output,
    mimeType,
    width: outW,
    height: outH,
    format,
    originalSize: source.length,
    processedSize: output.length,
    durationMs: Math.round(performance.now() - started),
  };
}

export function newProcessedKey(ext: string): string {
  const yyyy = new Date().toISOString().slice(0, 7);
  return `${yyyy}/processed/${newId('img_')}.${ext}`;
}

export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// 保持 crypto import 被使用（供扩展）
void crypto;
