#!/usr/bin/env node
/**
 * 生成演示用的 1200x900 原始 PNG（渐变 + 几何图形）。
 * 目的是让「压缩前后体积变化」和「右下角水印」在录屏画面里都肉眼可见。
 */
import sharp from 'sharp';
import fs from 'node:fs';

const W = 1200;
const H = 900;

const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1b2a6b"/>
      <stop offset="45%" stop-color="#4a3fb5"/>
      <stop offset="100%" stop-color="#d85b6b"/>
    </linearGradient>
    <radialGradient id="glow" cx="30%" cy="25%" r="60%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <circle cx="980" cy="210" r="170" fill="#ffd166" fill-opacity="0.55"/>
  <circle cx="190" cy="700" r="120" fill="#06d6a0" fill-opacity="0.45"/>
  <polygon points="600,150 760,470 440,470" fill="#ef476f" fill-opacity="0.6"/>
  <rect x="120" y="120" width="330" height="18" rx="9" fill="#ffffff" fill-opacity="0.8"/>
  <rect x="120" y="170" width="210" height="12" rx="6" fill="#ffffff" fill-opacity="0.55"/>
  <rect x="120" y="210" width="260" height="12" rx="6" fill="#ffffff" fill-opacity="0.4"/>
  <path d="M 120 780 Q 300 620 480 780 T 840 780 T 1200 760" stroke="#ffffff" stroke-opacity="0.55" stroke-width="6" fill="none"/>
  <path d="M 120 830 Q 300 690 480 830 T 840 830 T 1200 810" stroke="#06d6a0" stroke-opacity="0.7" stroke-width="5" fill="none"/>
  <g fill="#ffffff" fill-opacity="0.75">
    <rect x="120" y="300" width="26" height="26" rx="6"/>
    <rect x="166" y="300" width="26" height="26" rx="6"/>
    <rect x="212" y="300" width="26" height="26" rx="6"/>
    <rect x="258" y="300" width="26" height="26" rx="6"/>
  </g>
</svg>`;

const out = process.argv[2] || 'demo-photo.png';
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
const { size } = fs.statSync(out);
console.log(`已生成 ${out} (${W}x${H}, ${size} bytes)`);
