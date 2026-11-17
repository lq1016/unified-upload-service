# 统一文件上传与图片处理服务

把各系统重复的上传逻辑统一成一套服务：支持小文件直传、大文件分片与断点续传、私有桶签名访问、恶意文件拦截，以及可配置的图片压缩/水印/缓存。基于 Node.js 22 + TypeScript + Express + SQLite + Sharp，默认使用本地文件存储，也可切换到任意 S3 兼容对象存储。

## 功能与验收对照

| 验收项 | 实现情况 |
| --- | --- |
| 1. 接口 ≥7 个 + OpenAPI | 9 个核心接口 + 认证/日志/列表接口，文档见 [`docs/openapi.yaml`](docs/openapi.yaml) |
| 2. 数据库 ≥5 张表 | 8 张表：files、upload_chunks、upload_sessions、business_links、access_logs、blacklist、users、processed_images；建表脚本 `src/db/schema.ts`（等价 SQL `src/db/schema.sql`） |
| 3. 2GB 分片 + 断点续传 | `MAX_FILE_SIZE=2147483648`；init→逐片上传→status 查询已传分片→merge；实测见 [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) |
| 4. 安全 | 扩展名/MIME 白名单、大小限制、魔数+危险文件头校验、黑名单、私有签名访问、JWT、限流、Helmet；规则见 [`docs/SECURITY.md`](docs/SECURITY.md) |
| 5. 图片处理 | 画质/尺寸/压缩率可配，水印文字/位置/透明度可配，处理结果按「源文件+参数摘要」缓存 |
| 6. 性能与覆盖率 | 10MB P95 < 3s、单图压缩 < 500ms（实测见 PERFORMANCE.md）；单测覆盖率 92.57%（`npm test`，阈值 70%） |
| 7. 源码与提交历史 | 完整 TypeScript 源码，git 仓库含多次提交；密钥全部从环境变量读取，无硬编码；附建表脚本 |
| 8. 可运行 | `npm install && npm run build && npm run seed && npm start`；README 含对象存储配置说明 |
| 9. 可体验 | 测试环境 + 2 个测试账号 |
| 10. 体验路径 | 3–5 步清单 + 录屏脚本，见 [`docs/DEMO.md`](docs/DEMO.md) |
| 11. 修改与缺陷修复 | 含 2 轮修改提交，验收后 7 天内修复缺陷（见提交历史与服务承诺） |

## 快速开始（干净机器）

环境要求：Node.js ≥ 20（推荐 22），npm ≥ 9。SQLite 为嵌入式数据库，无需单独安装。

```bash
# 1. 安装依赖
npm install

# 2. 配置（可选，默认本地存储 + SQLite）
cp .env.example .env
#   如使用对象存储：把 STORAGE_DRIVER=s3 并填写 S3_* 配置

# 3. 建表 + 初始化 2 个测试账号
npm run seed

# 4. 编译并启动
npm run build
npm start
```

服务启动后访问 `http://localhost:3000/api/health`，应返回 `{"ok":true,"data":{"status":"ok",...}}`。

> 说明：默认 `DB_JOURNAL_MODE=WAL` 适合常规磁盘。若部署在 FUSE / 网络文件系统上不支持 WAL，可在 `.env` 设置 `DB_JOURNAL_MODE=MEMORY`（数据仍存于 `.db` 文件，仅回滚日志放内存）。

## 测试账号

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| user1 | Test@123456 | user |
| admin | Admin@123456 | admin |

## 对象存储（S3 兼容）配置说明

默认 `STORAGE_DRIVER=local`，文件落在 `LOCAL_STORAGE_DIR`（默认 `data/`）。切换到对象存储：

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.example.com      # MinIO/OSS/R2 等填对应 endpoint；AWS S3 可留空
S3_REGION=us-east-1
S3_BUCKET=my-bucket
S3_ACCESS_KEY_ID=<你的 AccessKey>
S3_SECRET_ACCESS_KEY=<你的 SecretKey>
S3_FORCE_PATH_STYLE=true
SIGNED_URL_TTL=300
```

密钥只从环境变量读取，**源码中没有任何硬编码凭证**。S3 模式下：

- 直传凭证接口调用 AWS SDK v3 `getSignedUrl(PutObjectCommand)` 生成预签名 PUT URL，浏览器可直传对象存储，不经过应用服务器。
- 访问鉴权接口返回服务短期签名 URL（默认 5 分钟），过期即失效；私有桶无需公开读权限。

## 接口一览

所有业务接口需在请求头携带 `Authorization: Bearer <token>`（通过 `/api/auth/login` 获取）。

| # | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| 1 | POST | `/api/upload/direct-credentials` | 直传凭证（预签名 PUT） |
| 2 | POST | `/api/upload/small` | 小文件上传 |
| 3 | POST | `/api/upload/multipart/init` | 初始化分片上传 |
| 4 | PUT | `/api/upload/multipart/:uploadId/chunk/:index` | 上传分片 |
| — | GET | `/api/upload/multipart/:uploadId/status` | 断点续传状态 |
| 5 | POST | `/api/upload/multipart/:uploadId/merge` | 合并分片 |
| 6 | DELETE | `/api/files/:id` | 删除文件 |
| 7 | POST | `/api/images/process` | 图片处理（压缩/画质/水印/缓存） |
| 8 | POST | `/api/access/sign` | 生成私有访问签名 URL |
| 9 | GET | `/api/access/file?fileId=&token=` | 签名访问私有文件 |

辅助接口：`GET /api/upload/files`（列表）、`GET /api/upload/files/:id`（详情）、`POST /api/links`（业务关联）、`GET /api/access/logs`（审计日志）、`GET /api/images/processed/:fileId`（处理缓存列表）。

完整请求/响应结构见 OpenAPI 文档。

## 大文件分片上传流程

1. `POST /api/upload/multipart/init` 传 `{originalName, mimeType, size, chunkSize}`，得到 `uploadId`、`totalChunks`。
2. 对每个分片 `PUT /api/upload/multipart/{uploadId}/chunk/{index}`，用 `chunk` 文件字段上传。
3. 中断后续传：调 `GET /api/upload/multipart/{uploadId}/status`，从 `uploadedChunks` 得知哪些分片已存在，只补传缺失的。
4. 全部完成后 `POST /api/upload/multipart/{uploadId}/merge`，服务端校验分片数量、顺序拼接并计算整文件 sha256。
5. 合并幂等：重复调用 merge 不会重复拼接。

## 图片处理参数

`POST /api/images/process` 的 JSON body：

```json
{
  "fileId": "f_xxx",
  "width": 1200,
  "quality": 80,
  "format": "webp",
  "compressionRatio": 0.8,
  "watermark": true,
  "watermarkText": "InteMatrix",
  "watermarkPosition": "bottom-right",
  "watermarkOpacity": 0.35
}
```

- `quality`、`format`、水印默认值均可在 `.env` 配置；`compressionRatio` 是便捷缩放参数。
- 处理结果以「源文件 id + 参数摘要」为键缓存于 `processed_images` 表与对象存储；相同参数二次请求直接命中缓存（响应 `cached: true`，`durationMs: 0`）。
- 加 `?download=1` 直接返回图片二进制（带 WebP/JPEG/PNG 的 Content-Type）。

## 测试

```bash
npm test          # 运行 43 个测试（接口+单元）+ 覆盖率（阈值 70%）
npm run build     # TypeScript 编译
```

测试覆盖：鉴权、白名单/魔数/恶意文件拦截、直传凭证、分片上传与断点续传、合并幂等、图片处理各格式与水印、缓存命中、私有签名访问、业务关联与删除。详细结果（43 个用例明细 + 覆盖率表）见 [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md)。

## 目录结构

```
src/
  app.ts            Express 应用装配（中间件、路由、错误处理）
  index.ts          服务入口
  config/           环境变量配置（密钥只从这里读）
  db/               建表脚本与连接（8 张表）
  security/         JWT、密码哈希、文件守卫（白名单/魔数/黑名单）
  storage/          存储抽象：local / s3（预签名）
  image/            Sharp 压缩、水印、参数摘要
  services/         文件/分片/图片缓存业务逻辑
  routes/           接口定义
tests/              接口测试 + 覆盖率
docs/               OpenAPI、安全规则、性能实测、体验路径
scripts/            seed 测试账号、bench 性能脚本
```

## 体验路径与录屏

见 [`docs/DEMO.md`](docs/DEMO.md)：3 分钟录屏覆盖分片上传、断点续传、非法类型拦截、压缩与水印。

## 安全提示

测试账号密码仅用于本地演示。生产环境务必修改 `JWT_SECRET`，并通过管理接口或数据库创建账号；不要把 `.env` 提交进版本库（已在 `.gitignore` 中）。详细规则见 [`docs/SECURITY.md`](docs/SECURITY.md)。
