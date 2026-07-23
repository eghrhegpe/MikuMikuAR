---
kind: thumbnail_capture
name: 缩略图渲染
category: rendering
scope:
  - frontend/src/scene/manager/**
source_files:
  - frontend/src/scene/manager/thumbnail-capture.ts
adr: []
---

## 系统概览
缩略图渲染模块：用独立场景（FreeCamera + RenderTargetTexture）为模型或道具渲染缩略图，保存为 base64 并缓存。支持 PNG 与 JPEG 格式，分辨率和质量由 `uiState` 控制。

## 核心职责
- `thumbnail-capture.ts` — 缩略图渲染、编码、缓存。

## 对外 API（节选）
- `ThumbnailSource` — 缩略图源描述（mesh / 渲染设置）。
- `thumbDataUrl(base64)` — 将 base64 字符串转为 data URL。
- `renderInstanceThumbnail(inst, scene)` — 渲染模型实例的缩略图。
- `renderPropThumbnail(prop, scene)` — 渲染道具的缩略图。

## 内部协作
- `_renderThumbnailImpl(mesh, scene, opts)` — 缩略图渲染核心实现（180 行）：创建独立渲染场景 → 设置相机 → 渲染 RT → 读取像素 → toDataURL → 缓存。
- `canvasToBase64(canvas, fmt, q)` — canvas 转 base64 的 Promise 封装。

## 与其他子系统关系
- 依赖 `wails-bindings` 的 `SaveThumbnail` 保存缩略图。
- 依赖 `thumbnail-key` 构建缓存 key。
- 依赖 `core/config` 的 `thumbnailCache` 缓存管理。