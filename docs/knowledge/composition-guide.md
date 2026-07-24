---
kind: composition_guide
name: 构图指南
category: scene
scope:
  - frontend/src/scene/pose/composition-guide.ts
source_files:
  - frontend/src/scene/pose/composition-guide.ts
adr: []
symbols:
  - CompositionGuide
  - applyCompositionGuide
invariants:
  - 构图规则基于三分法则
tests: []
use_when:
  - 构图指南
  - 画面构图
  - 三分法则
  - 姿势构图
---

## 系统概览
**构图指南模块**。基于摄影构图原理（三分法则等），为姿势拍摄提供构图建议和优化。

## 核心职责
- `composition-guide.ts` — 构图规则应用、画面优化建议。

## 对外 API（节选）
- `interface CompositionGuide` — 构图指南配置。
- `applyCompositionGuide(camera, subject)` — 应用构图优化。

## 与其他子系统关系
- 被 `camera-angle.ts` 调用。
- 相机控制：`../camera/camera.ts`。

## 不变量
- 构图优化不破坏用户手动调整的相机位置。
