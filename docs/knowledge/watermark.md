---
kind: watermark
name: 水印系统
category: scene
scope:
  - frontend/src/scene/pose/watermark.ts
source_files:
  - frontend/src/scene/pose/watermark.ts
adr: []
symbols:
  - WatermarkConfig
  - applyWatermark
invariants:
  - 水印在渲染后处理阶段添加
tests: []
use_when:
  - 水印
  - 截图水印
  - 图片水印
---

## 系统概览
**水印系统**。在截图和渲染输出上添加水印，支持自定义水印文字、位置和透明度。

## 核心职责
- `watermark.ts` — 水印配置、渲染后处理、水印应用。

## 对外 API（节选）
- `interface WatermarkConfig` — 水印配置（文字、位置、透明度）。
- `applyWatermark(texture, config)` — 应用水印到纹理。

## 与其他子系统关系
- 被 `thumbnail-capture.ts` 调用。
- 后处理：`../render/renderer.ts`。

## 不变量
- 水印在渲染后处理阶段添加，不影响场景渲染。
- 水印可配置为可选（默认关闭）。
