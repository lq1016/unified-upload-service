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

function svgWatermark(text: string, opacity: number, width: number, height: number): { buffer: Buffer; width: number; height: number } {
  const escaped = text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
  const fontSize = Math.max(14, Math.round(Math.min(width, height) / 18));
  // 只生成文字本身大小的小画布：合成时按位置显式计算 left/top，水印才会真正落在指定角落。
  // 文字带 -20° 旋转，画布需按旋转后的外接矩形放大，否则两端会被裁掉。
  const textW = Math.max(1, escaped.length * fontSize * 0.62);
  const rad = (20 * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const canvasW = Math.min(width, Math.ceil(textW * cos + fontSize * sin + fontSize * 0.4));
  const canvasH = Math.min(height, Math.ceil(textW * sin + fontSize * cos + fontSize * 0.4));
  const buffer = Buffer.from(
    `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="50%" y="50%" font-family="Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="bold" ` +
      `stroke="#000000" stroke-opacity="${Math.min(0.55, opacity + 0.2)}" stroke-width="${Math.max(1, fontSize / 14)}" ` +
      `paint-order="stroke" fill="#ffffff" fill-opacity="${opacity}" ` +
      `text-anchor="middle" dominant-baseline="middle" transform="rotate(-20 ${canvasW / 2} ${canvasH / 2})">${escaped}</text></svg>`,
  );
  return { buffer, width: canvasW, height: canvasH };
}

/** 计算水印小画布在目标图上的左上角坐标（带内边距） */
function watermarkOffset(
  pos: WatermarkPosition,
  wmW: number,
  wmH: number,
  outW: number,
  outH: number,
  pad: number,
): { left: number; top: number } {
  const maxLeft = Math.max(0, outW - wmW);
  const maxTop = Math.max(0, outH - wmH);
  switch (pos) {
    case 'top-left':
      return { left: pad, top: pad };
    case 'top-right':
      return { left: maxLeft - pad, top: pad };
    case 'bottom-left':
      return { left: pad, top: maxTop - pad };
    case 'bottom-right':
      return { left: maxLeft - pad, top: maxTop - pad };
    case 'center':
    default:
      return { left: Math.round((outW - wmW) / 2), top: Math.round((outH - wmH) / 2) };
  }
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
    // 水印画布只包含文字本身，按位置显式计算 left/top 贴到指定角落（保留内边距，避免贴边被裁）
    const pos = opts.watermarkPosition ?? config.image.watermarkPosition;
    const pad = Math.max(6, Math.round(Math.min(outW, outH) * 0.04));
    const { left, top } = watermarkOffset(pos, wm.width, wm.height, outW, outH, pad);
    base = await sharp(base)
      .composite([{ input: wm.buffer, left, top }])
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
