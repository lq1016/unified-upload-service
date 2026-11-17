# 安全规则（逐条）

## 1. 类型白名单

- 扩展名白名单：`ALLOWED_EXT`（默认 jpg/jpeg/png/webp/gif/pdf/bin）。
- MIME 白名单：`ALLOWED_MIME`（默认 image/jpeg、image/png、image/webp、image/gif、application/pdf、application/octet-stream）。
- 小文件上传时同时校验扩展名与声明的 Content-Type，任一不在白名单即拒绝（400 / `EXT_NOT_ALLOWED`、`MIME_NOT_ALLOWED`）。

## 2. 大小限制

- 全局 `MAX_FILE_SIZE` 默认 2GB；`direct-credentials` 与 `multipart/init` 在入口即校验声明大小。
- multer 使用内存存储并设置 `LIMIT_FILE_SIZE`，超限返回 413 / `FILE_TOO_LARGE`。
- 分片上传单片不得超过会话约定的 `chunkSize`，否则 413 / `CHUNK_TOO_LARGE`。

## 3. 恶意文件校验

- 危险文件头检测：MZ（PE/EXE）、ELF（0x7F ELF）、`#!`（脚本）、`<?ph`（PHP）、`<html`、`<script`（XSS）。命中即 400 / `MALICIOUS_FILE`，即使扩展名伪装成图片也会被拦截。
- 魔数一致性：PNG/JPEG/WebP/GIF/PDF 按文件头魔数校验与声明类型一致，不一致返回 400 / `MAGIC_MISMATCH`，防止「改扩展名绕过」。
- 黑名单表 `blacklist`：支持 checksum / mime / extension / user 四种维度；命中返回 403 / `BLACKLISTED`。
- 对象键由 `safeObjectKey` 生成：按日期隔离目录、去除危险字符、追加随机前缀，避免路径穿越与同名覆盖；本地存储 `full()` 再校验解析路径必须位于根目录内。

## 4. 私有桶签名访问

- 所有文件默认私有；对外访问须经 `POST /api/access/sign` 生成短期 token（默认 5 分钟，可配 `TTL ≤ 3600`）。
- token 为 HMAC-SHA256 签名，绑定 fileId 与过期时间，使用恒定时间比较防时序攻击；过期或篡改返回 403 / `ACCESS_DENIED`。
- S3 模式下直接使用对象存储原生预签名 URL（AWS SDK v3），私有桶无需公开读。
- 每次签发/访问/拒绝都写入 `access_logs`（含 IP、User-Agent、结果）。

## 5. 认证与接口防护

- 业务接口一律 Bearer JWT（HS256，密钥来自 `JWT_SECRET`），过期返回 401。
- 密码用 scrypt + 随机盐存储，验证用恒定时间比较。
- 登录接口限流 10 次/分钟（express-rate-limit），防暴力破解。
- Helmet 设置安全响应头；关闭 X-Powered-By。
- 配置敏感项（云密钥、JWT 密钥）全部从环境变量读取，源码无硬编码。
