# 测试报告

> 本报告由实际运行 `npm test` / `npm run build` 的结果生成，可复现。

## 1. 概要

| 项目 | 结果 |
| --- | --- |
| 执行日期 | 2026-11-17 |
| 运行环境 | Node.js v22.23.4 / Linux aarch64 / npm 10.9.9 |
| 测试框架 | Vitest v2.1.9 + supertest + v8 coverage |
| 编译 | `npm run build` 通过（TypeScript 严格模式，0 错误） |
| 测试文件 | 3 个（`tests/api.test.ts` 接口测试、`tests/unit.test.ts` 单元/分支测试、`tests/demo-route.test.ts` UI demo 路由测试） |
| 测试用例 | **46 个，全部通过（46 passed / 0 failed）** |
| 总耗时 | 2.01s |
| 语句覆盖率 | **91.60%**（阈值 70%）✅ |
| 分支覆盖率 | **80.41%**（阈值 65%）✅ |
| 函数覆盖率 | **94.52%**（阈值 70%）✅ |
| 行覆盖率 | **91.60%**（阈值 70%）✅ |

> 新增 UI demo 后重跑：新增 3 个路由测试（/demo 返回页面、7 个功能区齐全、/ 重定向），因 demo 路由与 HTML 为展示层，汇总覆盖率较补测峰值略降，仍高于阈值。

## 2. 覆盖率提升（第二轮补测）

| 指标 | 补测前 | 补测后 | 变化 |
| --- | --- | --- | --- |
| 语句/行 | 87.08% | **92.57%** | +5.49 |
| 分支 | 65.63%（刚过阈值） | **79.85%** | +14.22 |
| 函数 | 81.94% | **95.83%** | +13.89 |
| 用例数 | 15 | **43** | +28 |

补测重点：图片处理全格式（webp/jpeg/png）、5 种水印位置、压缩比 clamp 边界、所有魔数类型与危险文件头、JWT/签名 token 篡改与过期、LocalStorage 全方法、直传凭证回调闭环、参数校验异常分支。

**过程中发现并修复真实缺陷**：本地直传回调 URL 缺少 `/upload` 路由前缀（`/api/internal/direct-put` → `/api/upload/internal/direct-put`），补测前直传落地功能不可用；已修复并加入回归测试。

## 3. 验收标准对照

| 验收项 | 对应测试用例 / 证据 | 结果 |
| --- | --- | --- |
| 接口 ≥7 个 | 测试覆盖直传凭证、小文件、分片 init/片/状态/合并、删除、图片处理、签名访问、日志等全部接口 | ✅ |
| 大文件分片 + 断点续传 | `init -> 上传分片 -> 查询状态 -> 合并`、`重复合并幂等`、`分片越界`、`会话不存在` | ✅ |
| 安全：类型白名单/大小/恶意文件 | 各魔数类型、`拦截可执行文件伪装`、`拦截非法扩展名`、`魔数不符`、`ELF/shebang/PHP/HTML/script 危险头`、`黑名单`、`空文件`、`超限` | ✅ |
| 安全：私有桶签名访问 | `签名 URL 有效访问、错误 token 被拒绝`、`token 绑定 fileId/篡改/过期` | ✅ |
| 图片处理：压缩/水印/缓存 | `压缩+水印，第二次命中缓存`、`全格式`、`全水印位置`、`压缩比边界`、`非图片处理 400` | ✅ |
| 性能：单测覆盖率 ≥70% | 92.57%（见第 5 节） | ✅ |

## 4. 测试用例分组

### tests/api.test.ts — 接口测试（15 个）
健康检查与鉴权（3）、小文件上传与安全校验（4）、直传凭证（2）、分片上传与断点续传（2）、图片处理与缓存（2）、私有桶签名访问与审计（1）、业务关联与删除（1）。

### tests/unit.test.ts — 单元/分支测试（28 个）
- 图片处理：jpeg/png/webp 全格式、缺省格式、compressionRatio 缩放与 clamp、5 种水印位置与特殊字符转义、无效图片抛错、paramsHash/newProcessedKey/contentDisposition（8）
- 文件守卫：jpeg/webp/gif/pdf 魔数、ELF/shebang/PHP/HTML/script 危险头、非法 MIME、空文件、黑名单、safeObjectKey（6）
- JWT/密码/签名边界：token 篡改、过期、签名访问绑定 fileId、密码错误格式（4）
- 存储与工具：LocalStorage 全方法、路径穿越拒绝、setStorage 注入、HttpError/ok/fail/sha256（5）
- 直传回调与接口分支：token 一次性/过期、无效 token 400、直传凭证闭环落地、文件不存在 404、参数校验异常、分片越界、会话不存在（7）

## 5. 覆盖率明细（v8，补测后）

| 模块 | 语句 | 分支 | 函数 | 行 |
| --- | --- | --- | --- | --- |
| 全部 | 92.57 | 79.85 | 95.83 | 92.57 |
| app.ts | 84 | 50 | 100 | 84 |
| config/index.ts | 76.31 | 58.33 | 100 | 76.31 |
| db/index.ts | 57.69 | 100 | 33.33 | 57.69 |
| db/migrate.ts | 77.77 | 50 | 100 | 77.77 |
| image/process.ts | 100 | 76.47 | 100 | 100 |
| middleware/auth.ts | 85 | 87.5 | 100 | 85 |
| routes/index.ts | 92.59 | 75 | 100 | 92.59 |
| routes/upload.ts | 95.77 | 68.42 | 100 | 95.77 |
| security/fileguard.ts | 96.29 | 93.1 | 100 | 96.29 |
| security/jwt.ts | 93.44 | 85.71 | 100 | 93.44 |
| security/password.ts | 88.88 | 85.71 | 100 | 88.88 |
| services/fileService.ts | 95.41 | 76.74 | 92.3 | 95.41 |
| services/imageService.ts | 100 | 87.5 | 100 | 100 |
| storage/index.ts | 100 | 85.71 | 100 | 100 |
| storage/local.ts | 95.52 | 90 | 100 | 95.52 |
| utils/index.ts | 100 | 100 | 100 | 100 |

说明：`src/storage/s3.ts`（需真实 S3 环境）与 `src/index.ts`（服务启动入口）按配置排除出覆盖率统计；`interface.ts` 为纯类型定义无可执行语句。

## 6. 复现命令

```bash
cd /Users/liuqiang/claudeProjects/intematrix/unified-upload-service
npm install
npm test          # 43 个测试 + 覆盖率
npm run build     # 编译验证
```

> 覆盖率报告输出到 `/tmp/intematrix-coverage`，HTML 报告可用浏览器打开 `/tmp/intematrix-coverage/index.html` 查看逐行覆盖情况。
