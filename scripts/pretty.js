#!/usr/bin/env node
/**
 * 把接口返回的 JSON 美化打印到终端，长字符串自动折行，保证录屏画面里文字清晰可读。
 *
 * 用法：node scripts/pretty.js < json
 * 也可作为模块被 demo.sh 以 stdin 方式调用。
 *
 * 规则：
 *  - 2 空格缩进，与 JSON.stringify(x, null, 2) 一致
 *  - 长度超过 MAX 的字符串按 CHUNK 拆成多行，视觉上仍是一个字符串
 *  - key 为 base64 的字段替换为摘要提示，避免刷屏
 */
const MAX = 68; // 单个字符串不折行的最大长度
const CHUNK = 60; // 折行时每块长度

function esc(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function render(v, ind, key) {
  const pad = ' '.repeat(ind);
  const pad2 = ' '.repeat(ind + 2);

  if (key === 'base64' && typeof v === 'string') {
    return JSON.stringify(`<base64 数据 ${v.length} 字符，已省略以保持画面清晰>`);
  }
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const items = v.map(x => pad2 + render(x, ind + 2, ''));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }
  if (typeof v === 'object') {
    const ks = Object.keys(v);
    if (ks.length === 0) return '{}';
    const items = ks.map(k => pad2 + JSON.stringify(k) + ': ' + render(v[k], ind + 2, k));
    return '{\n' + items.join(',\n') + '\n' + pad + '}';
  }
  if (typeof v === 'string') {
    if (v.length <= MAX) return JSON.stringify(v);
    const parts = [];
    for (let i = 0; i < v.length; i += CHUNK) parts.push(v.slice(i, i + CHUNK));
    return parts.map((p, i) => (i === 0 ? '"' : pad + '  "') + esc(p)).join('\n') + '"';
  }
  return JSON.stringify(v);
}

let s = '';
process.stdin.on('data', d => (s += d)).on('end', () => {
  let o;
  try {
    o = JSON.parse(s);
  } catch (e) {
    process.stdout.write(s);
    return;
  }
  process.stdout.write(render(o, 0, '') + '\n');
});
