# 测试报告

> 本报告由实际运行 `npm test` / `npm run build` 的结果生成，可复现。

## 1. 概要

| 项目 | 结果 |
| --- | --- |
| 执行日期 | 2026-11-17 |
| 运行环境 | Node.js v22.23.4 / Linux aarch64 / npm 10.9.9 |
| 测试框架 | Vitest v2.1.9 + supertest + v8 coverage |
| 编译 | `npm run build` 通过（TypeScript 严格模式，0 错误） |
| 测试文件 | 1 个（`tests/api.test.ts`） |
| 测试用例 | **15 个，全部通过（15 passed / 0 failed）** |
| 总耗时 | 1.83s（测试本体 240ms） |
| 语句覆盖率 | **87.08%**（阈值 70%）✅ |
| 分支覆盖率 | 65.63%（阈值 65%）✅ |
| 函数覆盖率 | 81.94%（阈值 70%）✅ |
| 行覆盖率 | **87.08%**（阈值 70%）✅ |

## 2. 验收标准对照

| 验收项 | 对应测试用例 / 证据 | 结果 |
| --- | --- | --- |
| 接口 ≥7 个 | 测试中覆盖直传凭证、小文件、分片 init/片/状态/合并、删除、图片处理、签名访问、日志等 | ✅ |
| 大文件分片 + 断点续传 | `init -> 上传分片 -> 查询状态 -> 合并`、`重复合并幂等` | ✅ |
| 安全：类型白名单/大小/恶意文件 | `拦截可执行文件伪装（MZ 头）`、`拦截不在白名单的扩展名`、`拦截魔数与声明类型不符`、`拒绝超限大小` | ✅ |
| 安全：私有桶签名访问 | `签名 URL 有效访问、错误 token 被拒绝` | ✅ |
| 图片处理：压缩/水印/缓存 | `压缩+水印，第二次命中缓存`（含 cached=true、durationMs=0、hit_count 校验） | ✅ |
| 性能：单测覆盖率 ≥70% | 87.08%（见第 4 节） | ✅ |

## 3. 测试用例明细（15 个，全部通过）

### 健康检查与鉴权（3）
1. `GET /api/health 返回 ok` — 健康接口返回 200、status=ok。
2. `无令牌访问受保护接口返回 401` — 未带 Bearer token 访问 `/api/upload/files` 返回 401 / UNAUTHORIZED。
3. `错误密码登录失败` — 正确用户名 + 错误密码返回 401。

### 小文件上传与安全校验（4）
4. `上传合法 PNG 成功` — 201，状态 available，checksum 为 64 位 sha256。
5. `拦截可执行文件伪装（MZ 头）` — .png 扩展名但内容 MZ 头，返回 400 / MALICIOUS_FILE。
6. `拦截不在白名单的扩展名` — .exe 返回 400 / EXT_NOT_ALLOWED。
7. `拦截魔数与声明类型不符` — 非 PNG 内容声明 image/png，返回 400 / MAGIC_MISMATCH。

### 直传凭证（2）
8. `签发直传凭证` — 返回 uploadUrl、fileId、objectKey。
9. `拒绝超限大小` — size=3GB 超过 2GB 上限，返回 400。

### 分片上传与断点续传（2）
10. `init -> 上传分片 -> 查询状态 -> 合并` — 2 片文件，先传第 0 片，status 返回 uploadedChunks=[0]，未齐时合并返回 409，补齐后合并成功、checksum 一致。
11. `重复合并幂等` — 二次 merge 返回相同 checksum，不重复拼接。

### 图片处理与缓存（2）
12. `压缩+水印，第二次命中缓存` — 首次 cached=false、处理后体积小于原图；二次 cached=true、durationMs=0；缓存表 hit_count=1。
13. `非图片文件处理返回 400` — 二进制文件走图片处理返回 400 / NOT_AN_IMAGE。

### 私有桶签名访问与审计（1）
14. `签名 URL 有效访问、错误 token 被拒绝` — 合法签名返回 200 且 Content-Type 正确；伪造 token 返回 403；日志表记录 deny 动作。

### 业务关联与删除（1）
15. `关联业务并删除文件` — 关联 avatar/u1 成功，删除后文件列表不再包含该文件。

## 4. 覆盖率明细（v8）

| 模块 | 语句 | 分支 | 函数 | 行 |
| --- | --- | --- | --- | --- |
| 全部 | 87.08 | 65.63 | 81.94 | 87.08 |
| app.ts | 84 | 50 | 100 | 84 |
| config/index.ts | 76.31 | 58.33 | 100 | 76.31 |
| db/index.ts | 57.69 | 100 | 33.33 | 57.69 |
| db/migrate.ts | 77.77 | 50 | 100 | 77.77 |
| image/process.ts | 88.54 | 23.8 | 83.33 | 88.54 |
| middleware/auth.ts | 85 | 87.5 | 100 | 85 |
| routes/index.ts | 92.59 | 59.09 | 100 | 92.59 |
| routes/upload.ts | 77.46 | 56 | 33.33 | 77.46 |
| security/fileguard.ts | 85.18 | 80 | 50 | 85.18 |
| security/jwt.ts | 93.44 | 66.66 | 100 | 93.44 |
| security/password.ts | 88.88 | 50 | 100 | 88.88 |
| services/fileService.ts | 95.41 | 67.5 | 92.3 | 95.41 |
| services/imageService.ts | 100 | 87.5 | 100 | 100 |
| storage/index.ts | 80 | 80 | 50 | 80 |
| storage/local.ts | 86.56 | 75 | 83.33 | 86.56 |
| utils/index.ts | 100 | 100 | 100 | 100 |

说明：`src/storage/s3.ts`（需真实 S3 环境）与 `src/index.ts`（服务启动入口）按配置排除出覆盖率统计；`interface.ts` 为纯类型定义无可执行语句。

## 5. 复现命令

```bash
cd /Users/liuqiang/claudeProjects/intematrix/unified-upload-service
npm install
npm test          # 15 个测试 + 覆盖率
npm run build     # 编译验证
```

> 提示：覆盖率报告输出到 `/tmp/intematrix-coverage`（避开部分文件系统对临时文件删除的限制），HTML 报告可用浏览器打开 `/tmp/intematrix-coverage/index.html` 查看逐行覆盖情况。
