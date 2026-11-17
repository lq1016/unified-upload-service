# 变更记录（含 2 轮修改）

## 第 1 轮修改（初版自测）

- 修复：图片水印叠加时，水印 SVG 尺寸大于 resize 后实际图像尺寸导致 sharp 合成失败（500）。
  改为先物化 resize 结果取得精确尺寸，再按该尺寸生成水印并合成；实测压缩+水印接口恢复正常。
- 修复：编译产物 `dist/` 缺少 `schema.sql` 导致启动建表失败；将建表 SQL 内置为 `schema.ts` 常量，
  编译后随 JS 一起发布，并新增 `DB_JOURNAL_MODE` 配置以兼容 FUSE/网络盘。
- 修复：分片合并 SQL 中 `datetime(...)` 占位错误，改为 `datetime('now')`。
