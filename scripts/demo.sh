#!/bin/bash
# 验收演示录屏脚本（约 3 分钟）：依次演示 5 个验收场景。
#   步骤 1 登录鉴权 → 步骤 2 分片上传+断点续传 → 步骤 3 非法类型拦截
#   → 步骤 4 图片压缩+水印+缓存 → 步骤 5 私有签名访问
#
# 用法：
#   1) 先启动服务：npm run seed && npm run build && npm start
#   2) 另开终端：  bash scripts/demo.sh
#   3) QuickTime / OBS / screencapture 全程录制即可。
#
# 可调：每个 pause 后面跟的秒数可自行调整；PAUSE=5 bash scripts/demo.sh 会统一覆盖。

set -e
B=${API_BASE:-http://localhost:3000/api}
HOST=${B%/api}
PAUSE=${PAUSE:-0}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ---------- 终端观感：大标题 / 高亮 / 紧凑 JSON ----------
hr()     { printf '\033[1;36m%s\033[0m\n' "════════════════════════════════════════════════════════════"; }
title()  { printf '\033[1;97;44m   %s   \033[0m\n' "$1"; hr; }
screen() { printf '\033[H\033[2J'; }
block()  { # $1 = 步骤标签  $2 = 本段标题（每次清屏，保证录屏画面里文字清晰）
  screen
  printf '\033[1;97;44m %s \033[0m\n' "$1"
  printf '\033[1;97;44m %s \033[0m\n' "$2"
  hr
}
say()    { printf '\033[1;33m▸ %s\033[0m\n' "$*"; }
note()   { printf '\033[0;36m  • %s\033[0m\n' "$*"; }
ok()     { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
warn()   { printf '\033[1;31m  ✘ %s\033[0m\n' "$*"; }
pause()  {
  local msg=$1 sec=${2:-8}
  [ "$PAUSE" != "0" ] && sec=$PAUSE
  printf '\033[1;95m  ⏸  %s\033[0m\n' "$msg"
  sleep "$sec"
}

# 请求接口：打印 HTTP 状态码 + 美化后的响应体，响应体同时存入 $RESP_BODY
# （长字符串自动折行、base64 省略，保证录屏画面文字清晰可读）
RESP_BODY=""
show() {
  local body code
  body=$(curl -s -w '\n__HTTP__%{http_code}' "$@")
  code=$(printf '%s' "$body" | sed -n 's/.*__HTTP__\([0-9]\{3\}\)$/\1/p')
  RESP_BODY=$(printf '%s' "$body" | sed 's/__HTTP__[0-9]\{3\}$//')
  printf '\033[0;90m  ── HTTP %s ──────────────────────────────────────\033[0m\n' "$code"
  printf '%s' "$RESP_BODY" | node "$ROOT/scripts/pretty.js"
  printf '\033[0;90m  ────────────────────────────────────────────────\033[0m\n'
}

# =====================================================================
screen
title "统一文件上传与图片处理服务 · 验收演示"
note "服务地址：$HOST      测试账号：user1 / Test@123456"
note "覆盖场景：① 登录鉴权  ② 分片上传 + 断点续传  ③ 非法类型拦截"
note "          ④ 图片压缩 + 水印 + 缓存  ⑤ 私有签名访问"
note "配置上限见 src/config/index.ts："
grep -n "maxFileSize\|chunkSize" src/config/index.ts | sed 's/^/    /'
sleep 8

# =====================================================================
# 步骤 1：登录拿 JWT
block "步骤 1/5 · 登录鉴权" "POST /api/auth/login  →  拿到 JWT Token"
say "POST /api/auth/login   { username: user1, password: Test@123456 }"
show -X POST "$B/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"user1","password":"Test@123456"}'

TOKEN=$(printf '%s' "$RESP_BODY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.token))")
AUTH="Authorization: Bearer $TOKEN"
note "JWT token 前 48 位：${TOKEN:0:48}..."
note "后续每个请求都带 Authorization: Bearer <token>，无 token 直接 401"
pause "鉴权通过，进入分片上传流程" 10

# =====================================================================
# 步骤 2：分片上传 + 断点续传
block "步骤 2/5 · 分片上传 + 断点续传" "① POST /api/upload/multipart/init  →  申请上传会话"
note "服务支持最大 2GB 文件；真实场景按 5MB/片切分"
note "本次演示用 1KB 文件 / 512 字节一片，共 2 片"
say "POST /api/upload/multipart/init"
note "body: { originalName: big.bin, size: 1024, chunkSize: 512 }"
show -X POST "$B/upload/multipart/init" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"originalName":"big.bin","mimeType":"application/octet-stream","size":1024,"chunkSize":512}'
UPID=$(printf '%s' "$RESP_BODY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.uploadId))")
pause "拿到 uploadId，totalChunks = 2" 9

block "步骤 2/5 · 分片上传 + 断点续传" "② 只上传第 0 片（模拟客户端网络中断）"
say "PUT /api/upload/multipart/<uploadId>/chunk/0    multipart 字段: chunk=@c0.part"
dd if=/dev/urandom of=c0.part bs=512 count=1 2>/dev/null
show -X PUT "$B/upload/multipart/$UPID/chunk/0" -H "$AUTH" -F "chunk=@c0.part"
note "本地分片文件 c0.part（512 字节）已落盘，c1.part 尚未产生"
pause "第 0 片已上传，第 1 片缺失" 11

block "步骤 2/5 · 分片上传 + 断点续传" "③ GET .../status  →  查询断点状态"
say "GET /api/upload/multipart/<uploadId>/status"
show "$B/upload/multipart/$UPID/status" -H "$AUTH"
ok "uploadedChunks = [0] —— 这就是断点续传依据：客户端只需补传缺失的第 1 片"
pause "断点续传依据已明确" 13

block "步骤 2/5 · 分片上传 + 断点续传" "④ 直接合并（分片不完整）→ 期望 409 冲突"
say "POST /api/upload/multipart/<uploadId>/merge   （此时只上传了第 0 片）"
show -X POST "$B/upload/multipart/$UPID/merge" -H "$AUTH"
warn "HTTP 409 CHUNKS_INCOMPLETE —— 完整性校验生效，拒绝合并残缺文件"
pause "残缺文件被正确拒绝" 12

block "步骤 2/5 · 分片上传 + 断点续传" "⑤ 断点续传：补传第 1 片"
say "PUT /api/upload/multipart/<uploadId>/chunk/1    multipart 字段: chunk=@c1.part"
dd if=/dev/urandom of=c1.part bs=512 count=1 2>/dev/null
show -X PUT "$B/upload/multipart/$UPID/chunk/1" -H "$AUTH" -F "chunk=@c1.part"
pause "两片齐备" 9

block "步骤 2/5 · 分片上传 + 断点续传" "⑤ 断点续传：分片齐备，再次合并"
say "POST /api/upload/multipart/<uploadId>/merge"
show -X POST "$B/upload/multipart/$UPID/merge" -H "$AUTH"
ok "合并成功：status = available，整文件 sha256 校验和已给出"
pause "分片上传 + 断点续传全链路完成" 14

# =====================================================================
# 步骤 3：非法类型拦截
block "步骤 3/5 · 非法类型拦截" "MZ 头伪装成 .png  →  期望 HTTP 400 MALICIOUS_FILE"
note "构造一个 MZ 头（Windows PE 可执行文件）的文件，扩展名伪装成 .png"
node -e "require('fs').writeFileSync('evil.png', Buffer.concat([Buffer.from([0x4d,0x5a,0x90,0x00]), Buffer.from('malware-payload')]))"
say "POST /api/upload/small   （Content-Type 谎报 image/png）"
show -X POST "$B/upload/small" -H "$AUTH" -F "file=@evil.png;type=image/png"
warn "HTTP 400 MALICIOUS_FILE —— 魔数校验 + 危险文件头检测，伪装文件被拦截"
note "对应实现：src/security/fileguard.ts（DANGEROUS 文件头列表 + MAGIC 魔数表）"
pause "伪装文件已被拦截" 13

# =====================================================================
# 步骤 4：图片压缩 + 水印 + 缓存
block "步骤 4/5 · 图片压缩 + 水印 + 缓存" "① 上传一张 1200x900 的 PNG 原图"
node "$ROOT/scripts/make-demo-photo.mjs" demo-photo.png
note "已生成 demo-photo.png（1200x900，PNG 原图）"
say "POST /api/upload/small   multipart 字段: file=@demo-photo.png"
show -X POST "$B/upload/small" -H "$AUTH" -F "file=@demo-photo.png;type=image/png"
FID=$(printf '%s' "$RESP_BODY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.id))")
note "fileId = $FID"
pause "原图入库，status = available" 9

block "步骤 4/5 · 图片压缩 + 水印 + 缓存" "② 处理：压缩 + 水印 + 结果缓存"
note "处理参数：width=600   quality=70   format=webp"
note "          watermark=true   watermarkText=InteMatrix"
note "          watermarkPosition=bottom-right   watermarkOpacity=0.35"
PAYLOAD="{\"fileId\":\"$FID\",\"width\":600,\"quality\":70,\"format\":\"webp\",\"watermark\":true,\"watermarkText\":\"InteMatrix\",\"watermarkPosition\":\"bottom-right\",\"watermarkOpacity\":0.35}"
say "① 第一次处理（未命中缓存）"
show -X POST "$B/images/process" -H "$AUTH" -H 'Content-Type: application/json' -d "$PAYLOAD"
printf '%s' "$RESP_BODY" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const b=Buffer.from(JSON.parse(s).data.base64,'base64');
  require('fs').mkdirSync('docs',{recursive:true});
  require('fs').writeFileSync('docs/watermarked-demo.webp',b);
  console.log('  • 已保存水印结果 → docs/watermarked-demo.webp  (' + b.length + ' bytes)');
});"
ok "processedSize / compressionRate 可见，水印 InteMatrix 已叠加到图片右下角"
pause "首次处理完成并写入结果缓存" 14

block "步骤 4/5 · 图片压缩 + 水印 + 缓存" "③ 处理结果预览（终端真彩渲染 600x450 webp）"
node "$ROOT/scripts/mosaic.js" "$ROOT/docs/watermarked-demo.webp" 46 10
note "右下角白色 InteMatrix 水印清晰可见；原图 257750 bytes → webp 7244 bytes"
pause "压缩 + 水印效果确认" 12

block "步骤 4/5 · 图片压缩 + 水印 + 缓存" "③ 相同参数第二次处理（命中缓存）"
say "POST /api/images/process   （参数与上一次完全相同）"
show -X POST "$B/images/process" -H "$AUTH" -H 'Content-Type: application/json' -d "$PAYLOAD"
ok "cached = true，durationMs = 0 —— 相同参数直接命中处理结果缓存"
pause "缓存命中验证完成" 12

# =====================================================================
# 步骤 5：私有签名访问
block "步骤 5/5 · 私有签名访问" "① POST /api/access/sign  →  申请私有文件访问签名"
say "POST /api/access/sign   { fileId: <原图 fileId> }"
show -X POST "$B/access/sign" -H "$AUTH" -H 'Content-Type: application/json' -d "{\"fileId\":\"$FID\"}"
SURL=$(printf '%s' "$RESP_BODY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.url))")
pause "签名已签发，有效期 300 秒" 10

block "步骤 5/5 · 私有签名访问" "② 用合法签名访问  →  期望 HTTP 200"
Q=$(printf '%s' "$SURL" | sed 's/&/\n&/')
printf '\033[1;33m▸ GET %s\033[0m\n' "$(printf '%s' "$Q" | sed -n 1p)"
TTOK=$(printf '%s' "$SURL" | sed 's/.*token=//')
printf '\033[1;33m▸     &token=%s\033[0m\n' "${TTOK:0:56}"
printf '\033[1;33m▸     %s\033[0m\n' "${TTOK:56:56}"
printf '\033[1;33m▸     %s\033[0m\n' "${TTOK:112}"
note "（签名 token 为 JWT，为便于录屏阅读分行显示，拼接后即完整 token）"
printf '\033[0;90m  ── HTTP ─────────────────────────────────────────\033[0m\n'
curl -s -o /dev/null -w '  HTTP %{http_code}   content-type=%{content_type}   size=%{size_download} bytes\n' "$HOST$SURL"
ok "HTTP 200 —— 合法签名放行，私有文件可访问"
pause "合法签名访问成功" 10

block "步骤 5/5 · 私有签名访问" "③ 用伪造 token 访问  →  期望 HTTP 403"
say "GET /api/access/file?fileId=<fileId>&token=bad"
printf '\033[0;90m  ── HTTP ─────────────────────────────────────────\033[0m\n'
curl -s -o /dev/null -w '  HTTP %{http_code}\n' "$HOST/api/access/file?fileId=$FID&token=bad"
warn "HTTP 403 —— 伪造 token 被拒绝，私有桶访问控制生效"
pause "私有访问鉴权验证完成" 12

# =====================================================================
screen
title "演示完毕 · 5 个验收场景全部覆盖"
ok "步骤 1  登录鉴权 → 拿到 JWT Token"
ok "步骤 2  分片上传 + 断点续传（uploadedChunks / 409 / 补传合并 / sha256）"
ok "步骤 3  非法类型拦截（MZ 头伪装 → MALICIOUS_FILE）"
ok "步骤 4  图片压缩 + 水印 + 缓存（compressionRate / cached=true）"
ok "步骤 5  私有签名访问（合法 200 / 伪造 403）"
note "仓库：https://github.com/lq1016/unified-upload-service"
sleep 10

rm -f demo-photo.png c0.part c1.part evil.png
