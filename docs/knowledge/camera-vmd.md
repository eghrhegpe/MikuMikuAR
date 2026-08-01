---
tier: leaf
kind: camera_vmd
name: 相机 VMD 动画
category: scene
scope:
  - frontend/src/scene/camera/camera-vmd.ts
source_files:
  - frontend/src/scene/camera/camera-vmd.ts
adr:
  - ADR-035
  - ADR-148
symbols:
  - loadCameraVmd
  - clearCameraVmd
  - animateCameraVmd
  - createVmdCamera
  - hasCameraAnimationHandle
  - setSwitchCameraModeCallback
invariants:
  - VMD 相机使用 babylon-mmd 的 MmdCamera，独立于 orbit/freefly 行为轴
  - 清除 VMD 时若当前模式为 vmd，通过注入的 switchCameraMode 回调切回 orbit
  - VMD 动画句柄（_mmdCamera / _cameraAnimationHandle）在 clearCameraVmd 中显式释放
tests:
  - frontend/src/__tests__/camera.test.ts
use_when:
  - 相机 VMD 加载
  - VMD 相机动画
---

# 相机 VMD 动画

## 系统概览
**VMD 相机动画模块**（ADR-148 阶段 3 续拆，2026-07-26）。从 camera.ts 抽出 VMD 相机相关逻辑：加载 VMD 文件 → 创建 MmdCamera → 启动动画 → 清除（含 dispose 释放）。

## 核心职责
- `loadCameraVmd(path, scene, runtime)` — 加载 VMD 文件并切换到 vmd 模式
- `clearCameraVmd()` — 清除 VMD 相机（若当前模式为 vmd，通过注入的回调切回 orbit；显式释放 `_mmdCamera` 和 `_cameraAnimationHandle`）
- `animateCameraVmd(runtime, animation)` — 启动 VMD 相机动画
- `createVmdCamera(scene)` — 创建 MmdCamera 实例（Babylon + babylon-mmd 集成）
- `hasCameraAnimationHandle()` — 查询当前是否有 VMD 动画句柄（switchCameraMode 拒绝空 VMD 切换的前置检查）
- `setSwitchCameraModeCallback(cb)` — camera.ts 在 `initCameraSystem` 时注入 `switchCameraMode` 回调，破除循环依赖

## 与其他子系统关系
- 依赖 `camera-state.ts`（`getCameraScene` / `getCameraMode` / `setCameraVmdState` / `clearCameraVmdState` / `getCameraVmdName` / `getCameraVmdPath`）
- 被 `camera.ts` 调用（`switchCameraMode` 在 case 'vmd' 分支调用 `createVmdCamera` / `hasCameraAnimationHandle`）
- 被 `scene.ts` / `vmd-loader.ts` / `playback.ts` 间接调用（通过 camera.ts barrel re-export）

## 不变量
- VMD 相机使用 babylon-mmd 的 MmdCamera，独立于 orbit/freefly 行为轴
- 清除 VMD 时若当前模式为 vmd，通过注入的 switchCameraMode 回调切回 orbit（不能直接调用 camera.ts 的 switchCameraMode，否则循环依赖）
- VMD 动画句柄（`_mmdCamera` / `_cameraAnimationHandle`）在 `clearCameraVmd` 中显式释放，避免卸载泄漏
