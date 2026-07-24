---
kind: thumbnail_key
name: 缩略图缓存 key 推导
category: core
scope:
  - frontend/src/scene/manager/**
source_files:
  - frontend/src/scene/manager/thumbnail-key.ts
adr:
  - ADR-119
---

## 系统概览
缩略图缓存 key 的唯一推导源（P0 治理：消除双源拼接反弹）。历史：写侧（model-loader / props）与读侧（library-core）各自用字符串拼接构造 key，任何一侧微调即导致缓存 miss → 缩略图「消失/重生」，形成 12 轮修改反弹。本模块将拼接收敛为唯一纯函数，两侧必须经由它构造 key。

key 格式：`<baseKey>::<resolution>::<aspect>`。

## 核心职责
- `thumbnail-key.ts` — 缩略图缓存 key 的纯函数构造。

## 对外 API（节选）
- `ThumbnailBaseKeyInput` — baseKey 输入接口（libraryPath / filePath / innerPath）。
- `thumbnailBaseKey(input)` — 由库引用路径 + 内部路径推导 baseKey（libraryPath 优先，ZIP 内模型追加 `::<zipInner>`）。
- `libraryModelBaseKey(m)` — 由 LibraryModel 推导 baseKey（读侧专用适配器）。
- `buildThumbnailKey(input)` — 唯一缓存 key 构造：`<baseKey>::<resolution>::<aspect>`。
- `thumbnailKeyForKind(input)` — 便捷：由 kind/type 字符串直接构造完整 key。

## 与其他子系统关系
- 被 [`thumbnail-capture`](./thumbnail-capture.md)（写侧）与 `library-core`（读侧）共同引用，确保 key 一致。