---
kind: camera_angle
name: 姿势多角度预设系统
category: scene
scope:
  - frontend/src/scene/pose/camera-angle.ts
source_files:
  - frontend/src/scene/pose/camera-angle.ts
---

## 系统概览
Pose Studio 多角度预设系统：定义预设相机角 + 切换逻辑，用于批量截图。`CAMERA_PRESETS` 提供正面/左右45°/侧面/俯视/特写等标准角度。

## 核心职责
- `CameraAnglePreset` — `{ name, azimuth, elevation, distance, description }`
- `CAMERA_PRESETS` — 6 个预设角度列表
- 预设方位角相对模型朝向（`FRONT_BASE_RAD = -π/2`，角色正面在世界 -Z 对应 ArcRotateCamera alpha=-π/2；原代码锚在 alpha=0 拍到侧面，已修正）叠加，再减去模型当前偏航，使全部预设以角色朝向为参考
- 切换经 `setOrbitParams`（`camera/camera`）驱动相机

## 对外 API（节选）
- `CAMERA_PRESETS` — 预设数组
- `applyCameraPreset(preset)` / 切换逻辑 — 计算实际 alpha/beta/radius 并写回 orbit 相机
- `getFocusedModelYaw()` — 取聚焦模型绕 Y 轴偏航，使预设随角色朝向旋转

## 关键约定
- 预设角度以「角色朝向」为参考系，而非固定世界角，避免模型转身后拍到背面

## 与其他子系统关系
- 依赖 `camera/camera`（`setOrbitParams`）、`scene`（scene 引用）、`core/config`（`modelRegistry` / `focusedModelId`）
- 服务于 Pose Studio 批量截图流程
