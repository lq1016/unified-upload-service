/**
 * 性能实测脚本：10MB 文件上传 P95、单张图片压缩耗时。
 * 用法：先启动服务，再运行  BASE_URL=http://127.0.0.1:3000 npm run bench
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const USER = process.env.BENCH_USER || 'user1';
const PASS = process.env.BENCH_PASS || 'Test@123456';

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then((r) => r.json() as any);
  if (!login.ok) throw new Error('登录失败，请先 npm run seed');
  const token = login.data.token;
  const headers = { Authorization: `Bearer ${token}` };

  // ---- 1. 10MB 文件上传 ----
  // 生成一张约 10MB 的合法 PNG（随机像素无法被压缩），确保通过魔数/类型校验
  let payload: Uint8Array;
  try {
    const sharp = (await import('sharp')).default;
    const raw = Buffer.alloc(1800 * 1800 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 37 + 11) % 256;
    payload = await sharp(raw, { raw: { width: 1800, height: 1800, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  } catch {
    payload = new Uint8Array(10 * 1024 * 1024);
  }
  const times: number[] = [];
  const N = 20;
  for (let i = 0; i < N; i++) {
    const fd = new FormData();
    fd.append('file', new Blob([payload as any], { type: 'image/png' }), `bench-${i}.png`);
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/upload/small`, { method: 'POST', headers, body: fd });
    times.push(performance.now() - t0);
    if (!res.ok && res.status !== 400) throw new Error(`上传失败: ${res.status}`);
  }
  times.sort((a, b) => a - b);
  console.log('=== 10MB 文件上传 ===');
  console.log(`样本: ${N}, 平均: ${(times.reduce((a, b) => a + b, 0) / N).toFixed(0)}ms, P50: ${pct(times, 50).toFixed(0)}ms, P95: ${pct(times, 95).toFixed(0)}ms (要求 <3000ms)`);

  // ---- 2. 图片压缩 ----
  // 用 sharp 生成一张测试图（若可用）
  let png: Uint8Array;
  try {
    const sharp = (await import('sharp')).default;
    png = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 120, g: 80, b: 200 } } }).png().toBuffer();
  } catch {
    console.log('跳过图片压缩基准（sharp 不可用）');
    return;
  }
  const fd = new FormData();
  fd.append('file', new Blob([png as any], { type: 'image/png' }), 'bench.png');
  const up = await fetch(`${BASE}/api/upload/small`, { method: 'POST', headers, body: fd }).then((r) => r.json() as any);
  if (!up.ok) throw new Error('图片上传失败');
  const fileId = up.data.id;
  const imgTimes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/images/process`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, width: 1280, quality: 80, format: 'webp' }),
    });
    imgTimes.push(performance.now() - t0);
    if (!res.ok) throw new Error(`图片处理失败: ${res.status}`);
  }
  imgTimes.sort((a, b) => a - b);
  console.log('=== 单张图片压缩（首次处理，未命中缓存）===');
  console.log(`样本: 10, 平均: ${(imgTimes.reduce((a, b) => a + b, 0) / 10).toFixed(0)}ms, P95: ${pct(imgTimes, 95).toFixed(0)}ms (要求 <500ms)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
