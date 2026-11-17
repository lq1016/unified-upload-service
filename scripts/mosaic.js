#!/usr/bin/env node
/**
 * 把图片渲染成终端 ANSI 真彩色马赛克，用于录屏时直观展示处理结果。
 * 用法： node scripts/mosaic.js <image> [宽度字符数] [高度行数]
 */
import sharp from 'sharp';

const [, , file, wArg, hArg] = process.argv;
if (!file) {
  console.error('用法: node scripts/mosaic.js <image> [w] [h]');
  process.exit(1);
}
const W = Number(wArg || 46);
const H = Number(hArg || 12);

const { data, info } = await sharp(file)
  .resize(W, H, { fit: 'fill' })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
const lines = [];
for (let y = 0; y < height; y++) {
  let row = '';
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    row += `\x1b[48;2;${data[i]};${data[i + 1]};${data[i + 2]}m `;
  }
  lines.push(row + '\x1b[0m');
}
console.log(lines.join('\n'));
