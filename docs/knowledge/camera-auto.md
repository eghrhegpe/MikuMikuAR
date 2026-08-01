---
tier: leaf
kind: camera_auto
name: 节拍驱动自动运镜（beatcut）
category: scene
scope:
  - frontend/src/scene/camera/camera-auto.ts
source_files:
  - frontend/src/scene/camera/camera-auto.ts
adr:
  - ADR-100
  - ADR-148
symbols:
  - setAutoCameraEnabled
  - isAutoCameraEnabled
  - setAutoCameraBeatsPerSwitch
  - getAutoCameraBeatsPerSwitch
  - restoreAutoCameraState
  - setSyncAxesCallback
invariants:
  - beatcut 是运行时叠加行为：仅当自动运镜开启、且基底行为为 none(orbit) 时生效
  - 集中订阅 beat 回调（_subscribeAutoCameraBeat），避免饥饿 bug
  - restoreAutoCameraState 内部幂等，重复调用安全
tests:
  - frontend/src/__tests__/camera.test.ts
use_when:
  - 节拍自动运镜
  - beatcut 行为
  - 镜头预设池
---

# 节拍驱动自动运镜（beatcut）

## 系统概览
**节拍驱动自动运镜（beatcut）模块**（ADR-148 阶段 3 续拆，2026-07-26）。从 camera.ts 抽出 beatcut 行为的实现：每 N 拍从 `AUTO_CAMERA_PRESETS` 池中切换一个镜头预设（alpha/beta/radius），叠加在 orbit 基底行为上。ADR-100 双轴派生时，beatcut 作为运行时叠加行为，与 concert/turntable/scripted 互斥。

## 核心职责
- `setAutoCameraEnabled(v, beatDetector?)` — 启用/禁用自动运镜；启用时订阅 beat 回调 + 派生 beatcut 行为轴；禁用时退订 + 派生基底行为
- `isAutoCameraEnabled()` — 查询自动运镜开关
- `setAutoCameraBeatsPerSwitch(n)` — 设置每多少拍切换一次镜头（1-16，clamp）
- `getAutoCameraBeatsPerSwitch()` — 查询切换间隔
- `restoreAutoCameraState()` — 从 `uiState` 恢复自动运镜状态（启动时调用，修复"饥饿"bug：旧实现 restore 时不订阅 beat 导致永不触发）
- `setSyncAxesCallback(cb)` — camera.ts 在 `initCameraSystem` 时注入 `_syncAxesFromMode` 回调，破除循环依赖
- `AUTO_CAMERA_PRESETS` — 8 个镜头预设池（正面标准 / 右前 45° / 左前 45° / 高角度俯拍 / 近距离正面 / 右侧 90° / 左侧 90° / 远景）

## 与其他子系统关系
- 依赖 `camera-state.ts`（`isAutoCameraEnabled as isAutoCameraEnabledFlag` / `setAutoCameraEnabledFlag` / `getAutoCameraBeatCount` / `setAutoCameraBeatCount` / `getAutoCameraPresetIdx` / `setAutoCameraPresetIdx` / `getCameraScene` / `getCurrentCamera` / `getCameraBehavior`）
- 依赖 `@/core/config`（`uiState`）+ `env-persist`（`schedulePersistUI`）+ `@/core/observer-handle`（`observe`）
- 依赖 `scene.ts`（`getProcBeatDetector`）作为 beat 缺省回退源
- 被 `camera.ts` 调用（`setCameraControl` / `setCameraBehavior` / `setCameraState` 在 beatcut 分支调用 `setAutoCameraEnabled` / `restoreAutoCameraState`）

## 不变量
- beatcut 是运行时叠加行为：仅当自动运镜开启、且基底行为为 `none`(orbit) 时由 `_resolveBehavior` 派生为 `beatcut`；与 `concert`/`turntable`/`scripted` 互斥（这些基底行为存在时 beatcut 被抑制）
- **集中订阅 beat 回调**（`_subscribeAutoCameraBeat`）：开关路径与 restore 路径共用此函数，避免饥饿 bug（旧实现 restore 时不订阅导致 beat 永不触发）
- `restoreAutoCameraState()` 内部幂等，重复调用安全（`setCameraState` 多次调用安全）
- beat 计数达到 `_autoCameraBeatsPerSwitch` 阈值时切换到下一个预设（环形索引）
- 切换预设时通过 `observe(scene.onBeforeRenderObservable, ...)` 做平滑过渡（非瞬切）
