# 体验路径与录屏脚本

## 准备

```bash
npm install && npm run seed && npm run build && npm start
```

测试账号：`user1 / Test@123456`。下面的 `curl` 用 shell 变量保存 token：

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"user1","password":"Test@123456"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.token))")
B=http://localhost:3000/api
```

## 3 分钟录屏分步脚本

### 第 1 步：小文件上传（约 20 秒）

准备一张测试图 `test.png`，然后：

```bash
curl -s -X POST $B/upload/small -H "Authorization: Bearer $TOKEN" \
  -F "file=@test.png;type=image/png"
```

录屏要点：展示返回的 `status: available` 与 `checksum`。

### 第 2 步：分片上传 + 断点续传（约 60 秒）

```bash
# init：1KB 文件，512 字节一片，共 2 片
INIT=$(curl -s -X POST $B/upload/multipart/init -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"originalName":"big.bin","mimeType":"application/octet-stream","size":1024,"chunkSize":512}')
UPID=$(echo "$INIT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.uploadId))")

# 只上传第 0 片（模拟中途中断）
head -c 512 /dev/zero > c0.part
curl -s -X PUT "$B/upload/multipart/$UPID/chunk/0" -H "Authorization: Bearer $TOKEN" -F "chunk=@c0.part"

# 查询断点状态：uploadedChunks 显示 [0]
curl -s "$B/upload/multipart/$UPID/status" -H "Authorization: Bearer $TOKEN"

# 补传第 1 片并合并
head -c 512 /dev/zero > c1.part
curl -s -X PUT "$B/upload/multipart/$UPID/chunk/1" -H "Authorization: Bearer $TOKEN" -F "chunk=@c1.part"
curl -s -X POST "$B/upload/multipart/$UPID/merge" -H "Authorization: Bearer $TOKEN"
```

录屏要点：先展示 status 的 `uploadedChunks:[0]`（体现断点续传），再展示 merge 成功后的 `status: available`。

### 第 3 步：非法类型拦截（约 20 秒）

```bash
printf 'MZ\x90\x00malware' > evil.png
curl -s -X POST $B/upload/small -H "Authorization: Bearer $TOKEN" \
  -F "file=@evil.png;type=image/png"
```

录屏要点：返回 `MALICIOUS_FILE`，证明文件头伪装被拦截。

### 第 4 步：图片压缩 + 水印（约 40 秒）

```bash
FID=$(# 用第 1 步上传返回的 fileId)
# 第一次处理
curl -s -X POST $B/images/process -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"fileId\":\"$FID\",\"width\":120,\"quality\":70,\"watermark\":true,\"watermarkText\":\"InteMatrix\",\"watermarkPosition\":\"bottom-right\",\"format\":\"webp\"}"
# 同样参数第二次：cached=true, durationMs=0
```

录屏要点：展示 `compressionRate`（压缩率）、第一次 `cached:false` 与第二次 `cached:true` 的对比。可加 `?download=1` 打开处理后的带水印图片。

### 第 5 步：私有签名访问（约 20 秒）

```bash
SIGN=$(curl -s -X POST $B/access/sign -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"fileId\":\"$FID\"}")
URL=$(echo "$SIGN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.url))")
curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000$URL"   # 200
curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/api/access/file?fileId=$FID&token=bad"  # 403
```

录屏要点：合法签名 200、伪造 token 403 的对比。

---

说明：以上 5 步覆盖验收标准 #10 要求的分片上传、断点续传、非法类型拦截、压缩与水印。

## 已录制的验收演示视频

[`docs/demo.mp4`](demo.mp4) —— 1920×1080，**3 分 09 秒**，基于 `/demo` 交互页面录制，带步骤标注（顶部步骤条 + 接口说明）、聚光灯提示与底部解说字幕。7 个步骤依次为：

| 步骤 | 演示内容 | 画面中的关键证据 |
| --- | --- | --- |
| 1 登录鉴权 | `POST /api/auth/login` | HTTP 200 + 完整 JWT + 「已登录：user1」 |
| 2 小文件上传 | `POST /api/upload/small` | HTTP 201 + fileId / object_key / sha256 |
| 3 分片 + 断点续传 | init → 第 0 片 → status → 合并 → 补第 1 片 → 合并 | `uploadedChunks:[0]` → 合并 **HTTP 409 CHUNKS_INCOMPLETE** → 合并 **HTTP 200 `status:"available"` + sha256** |
| 4 非法类型拦截 | `POST /api/upload/small`（MZ 头伪装 .png） | **HTTP 400 MALICIOUS_FILE** + 拦截横幅 |
| 5 压缩 + 水印 + 缓存 | `POST /api/images/process`（width=600 / quality=70 / webp / InteMatrix / bottom-right） | `originalSize 186724 → processedSize 7980`、`compressionRate 0.9573`、首次 `cached:false` → 再请求 **`cached:true`、`durationMs:0`**，预览图右下角可见水印 |
| 6 私有签名访问 | `POST /api/access/sign` → `GET /api/access/file` | 合法签名 **HTTP 200** → 伪造 token **HTTP 403 ACCESS_DENIED** |
| 7 审计日志 | `GET /api/access/logs` | sign / access / deny 全部记录 |

录像脚本见 `scripts/demo.sh`（终端 curl 版）；页面版录制时用 ego-browser 等工具驱动 `/demo` 页面并截帧合成即可。
