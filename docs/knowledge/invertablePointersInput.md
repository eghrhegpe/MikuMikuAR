---
kind: invertable_pointers_input
name: 反 Y 轴指针输入
category: rendering
scope:
  - frontend/src/scene/camera/**
source_files:
  - frontend/src/scene/camera/invertablePointersInput.ts
adr:
  - ADR-035
---

## 系统概览
继承 babylon-mmd 使用的 `ArcRotateCameraPointersInput`，覆写垂直拖拽方向以支持反转 Y 轴（invertY）。Babylon 的 `ArcRotateCamera` 原生无 invertY flag，故在此覆写 `onTouch` 与 `_computeMultiTouchPanning` 两个 Y 偏移入口。通过 `invertY` 标志切换，不破坏默认行为（默认 false）。

## 核心职责
- `invertablePointersInput.ts` — 可反转 Y 轴的 ArcRotateCamera 指针输入。

## 对外 API（节选）
- `InvertableArcRotateCameraPointersInput` — 继承 `ArcRotateCameraPointersInput`，新增 `invertY` 属性（默认 false）。
  - `onTouch(point, offsetX, offsetY)` — 覆写单指拖拽 Y 偏移。
  - `_computeMultiTouchPanning(...)` — 覆写双指平移 Y 方向。

## 与其他子系统关系
- 被 `camera.ts` 在创建 ArcRotateCamera 时使用，替代原生 PointersInput。
- `invertY` 值由设置面板的「反转 Y 轴」开关控制。