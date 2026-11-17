# 投稿填写材料（可直接复制）

任务：文件上传与图片处理服务（8b99630d-dcb5-4eb1-be02-fe2a319e4cc0）

## 基本信息

- 作品名称：统一文件上传与图片处理服务
- 源码仓库：https://github.com/lq1016/unified-upload-service （私有仓库，投稿时可将发布者加为协作者或改为公开）
- 交付类型：代码（完整可编译源码 + git 提交历史）

## 一句话简介（复制）

一套统一的文件上传与图片处理服务，提供直传凭证、小文件上传、2GB 分片上传与断点续传、恶意文件拦截、私有签名访问，以及可配置压缩质量与水印的图片处理，附完整 OpenAPI 文档与自动化测试（43 例通过，覆盖率 92.57%）。

## 技术方案（复制）

后端 Node.js 22 + TypeScript + Express + SQLite（better-sqlite3）+ Sharp 图片处理 + AWS SDK v3（S3 兼容对象存储）。存储层抽象为 local / s3 两种驱动，密钥全部从环境变量读取，无硬编码。数据库 8 张表：files、upload_chunks、upload_sessions、business_links、access_logs、blacklist、users、processed_images。JWT 鉴权 + scrypt 密码哈希 + 登录限流 + Helmet 安全响应头。图片处理以「源文件 + 参数摘要」为键缓存处理结果。

## 功能与验收对照（复制）

1. 接口 9 个以上（直传凭证、小文件、分片、合并、删除、图片处理、签名访问等），附 docs/openapi.yaml。
2. 数据库 8 张表（要求 5 张），建表脚本内置于 src/db/schema.ts。
3. 支持 2GB 分片上传与断点续传，status 查询已传分片，合并校验完整性且幂等。
4. 安全：扩展名/MIME 白名单、2GB 大小限制、魔数与危险文件头校验、黑名单、私有桶短期签名访问，规则见 docs/SECURITY.md。
5. 图片压缩率/画质可配，水印文字/位置/透明度可配，处理结果缓存。
6. 实测 10MB 上传 P95 40ms（要求 <3s），单图压缩 P95 63ms（要求 <500ms），单测覆盖率 92.57%（要求 ≥70%）。
7. 完整可编译源码，git 含 5+ 次提交（含 2 轮修改），密钥从配置读取。
8. README 含对象存储配置与干净机器启动步骤。
9. 测试环境 + 2 个测试账号。
10. 3–5 步体验路径见 docs/DEMO.md；3 分钟录屏（见下方提醒）。
11. 验收通过后 7 天内修复缺陷。

## 测试环境 / 测试账号（复制）

- 本地启动：`npm install && npm run seed && npm run build && npm start`（默认 http://localhost:3000）
- 账号 1：user1 / Test@123456（普通用户）
- 账号 2：admin / Admin@123456（管理员）

## 体验路径（3–5 步，复制）

1. 登录拿 token：`POST /api/auth/login`（user1 / Test@123456）。
2. 分片上传：init → 上传分片 → 查 status（断点续传）→ merge。
3. 非法类型拦截：上传 MZ 头伪装成 .png 的文件，返回 400 / MALICIOUS_FILE。
4. 图片处理：POST /api/images/process 传 width/quality/watermark，第二次相同参数 cached=true。
5. 私有签名访问：POST /api/access/sign 拿 URL，合法 token 返回 200、伪造 token 返回 403。

## 提醒

- 验收标准 #10 要求「3 分钟录屏，覆盖分片上传、断点续传、非法类型拦截、压缩与水印」——这份材料尚未制作，投稿前需补录。docs/DEMO.md 里有逐步骤录制脚本，可用 QuickTime/OBS 录屏。
- 仓库目前是 Private，若发布者需要查看源码，需在 GitHub 里把发布者加为协作者，或临时改为 Public（交付后再改回）。
