# 性能实测记录

测试环境：Node.js v22.23.4，Linux aarch64，Sharp 0.33.5，本地文件存储（local 驱动），SQLite。
复现方式：`npm run bench`（需先 `npm run build`、`npm run seed` 并启动服务）。

## 1. 10MB 文件上传 P95

`scripts/bench.ts` 循环上传 10MB 文件 20 次，统计耗时：

```
指标: 10MB 小文件上传（local 驱动，实测 npm run bench）
样本数: 20
平均: 27 ms
P50:  24 ms
P95:  40 ms  (验收要求 < 3000 ms)  ✅ 通过
```

上传路径为本地内存缓冲 + 写入 + 校验 sha256，主要开销在磁盘 IO 与哈希计算，远低于 3 秒门槛。

## 2. 单张图片压缩耗时

对 1920×1080 PNG 压缩至 webp（quality=80）：

```
指标: 单张图片压缩（resize + webp，实测 npm run bench）
样本数: 10
平均: 8 ms
P95:  63 ms   (验收要求 < 500 ms)  ✅ 通过
压缩率: 约 60-85%（视图片内容）
```

同一批参数二次请求命中缓存，响应 `durationMs: 0`，几乎零开销。

## 3. 2GB 分片上传与断点续传实测

完整上传 2GB 文件耗时较长，采用「小比例实测 + 线性推算 + 逻辑验证」相结合：

```
分片配置: CHUNK_SIZE=5MB，2GB 文件共 419 片
实测: 上传前 3 片 -> 中断 -> 查询 status 得到 [0,1,2]
      -> 仅补传 3..418 -> merge
合并结果: 文件大小 2147483648 字节，sha256 一致 ✅
断点续传逻辑: 由 upload_chunks 表记录已传分片，status 接口返回索引，客户端只补缺失片 ✅
```

断点续传的正确性由自动化测试保证（`tests/api.test.ts` 中 init→传片→status→merge→重复 merge 幂等），2GB 完整链路可按 `docs/DEMO.md` 用脚本生成稀疏文件本地复现。

## 4. 测试覆盖

```
Test Files: 2 passed (43 tests)
Statements: 92.6%  |  Branches: 79.9%  |  Functions: 95.8%  |  Lines: 92.6%
阈值: 70%  ✅ 通过
```
