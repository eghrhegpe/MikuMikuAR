---
kind: motion_playback
name: 动作播放控制
category: motion
scope:
  - frontend/src/scene/motion/playback.ts
source_files:
  - frontend/src/scene/motion/playback.ts
adr: []
symbols:
  - initPlaybackObservables
  - disposePlayback
  - updatePlaybackUI
  - _loopPending
invariants:
  - _disposed 双清理防护：dispose 后不再执行任何回调
  - _manager 引用在 initPlaybackObservables 中注入，dispose 后清零
  - autoLoop 期间 _loopPending 为 true，防止 UI 闪烁
tests: []
use_when:
  - 播放进度 UI
  - seek 拖动
  - 自动循环播放
  - MMD runtime 回调
  - 时间格式
  - 播放控制栏
---

## 系统概览
动作播放的 **UI 控制与进度管理模块**。负责播放/暂停按钮、进度条拖动（seek）、时间显示格式、
自动循环（auto-loop）状态维护，以及 MMD runtime observable 回调的聚合。与 `vmd-loader.ts` 协作，
后者负责加载动作数据，本模块专注 UI 反馈。

## 核心职责
- `playback.ts` — 播放状态管理、进度 UI 更新、auto-loop 控制、runtime 回调注册/清理。

## 对外 API（节选）
- `initPlaybackObservables(runtime, manager, updatePlaybackUI)` — 注册 runtime 回调，返回清理函数。
- `updatePlaybackUI()` — 刷新播放进度 UI（时长、当前时间、进度条）。
- `_getDuration(runtime, manager)` — 取当前聚焦模型动画时长。
- `_loopPending` — 标记 auto-loop 进行中（防 UI 闪烁）。

## 与其他子系统关系
- 上游：`vmd-loader.ts` 加载动作后触发播放。
- 下游：`@/core/config` 的 `isPlaying` / `setIsPlaying` / `autoLoop` / `seekDragging`。
- 协作者：`@/outfit/audio`（音频同步）、`../camera/camera`（相机 VMD 动画）。
- 模块引用 `model-manager` 以参数形式注入（避免 ES module 循环依赖）。

## 不变量
- `_disposed` 双清理防护：`dispose()` 可多次调用但只执行一次清理。
- `_manager` 在 init 中注入、dispose 中清零，外部不直接修改。
