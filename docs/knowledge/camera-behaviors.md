---
kind: camera_behaviors
name: 相机行为循环（freefly/surround/concert）
category: scene
scope:
  - frontend/src/scene/camera/camera-behaviors.ts
source_files:
  - frontend/src/scene/camera/camera-behaviors.ts
adr:
  - ADR-148
symbols:
  - initFreeflyUpdate
  - initFreeflyTouch
  - stopFreefly
  - startSurround
  - stopSurround
  - startConcert
  - stopConcert
  - initOrbitUpdate
  - stopOrbit
invariants:
  - 行为循环通过 observe(scene.onBeforeRenderObservable, ...) 注册，返回 ObserverHandle
  - stop* 函数显式 dispose ObserverHandle，避免回调残留
  - 行为仅在对应模式下生效（switchCameraMode 负责启动/停止配对）
tests:
  - frontend/src/__tests__/camera.test.ts
use_when:
  - freefly 自由飞行
  - surround 环绕/转台
  - concert 粉丝机位
  - 触摸输入
---

## 系统概览
**相机行为循环模块**（ADR-148 阶段 3 续拆，2026-07-26）。从 camera.ts 抽出 freefly / surround / concert 三种相机的"每帧更新"逻辑：注册 `onBeforeRenderObservable` 回调，停止时显式 dispose observer 句柄。

## 核心职责
- `initFreeflyUpdate(scene)` — freefly 模式每帧更新（键盘输入 → 相机位移）
- `initFreeflyTouch(canvas)` — freefly 模式触摸输入（移动端指针控制）
- `stopFreefly()` — 停止 freefly 行为循环（dispose observer）
- `startSurround(scene)` — 启动 surround（环绕/转台）行为：相机绕目标自动旋转
- `stopSurround()` — 停止 surround 行为循环
- `startConcert(scene)` — 启动 concert（粉丝机位）行为：限定水平扫动 + 正弦垂直摆动
- `stopConcert()` — 停止 concert 行为循环

## 与其他子系统关系
- 依赖 `camera-state.ts`（`getCurrentCamera` / `getCameraPreset` / `getConcertPaused` / `getSurroundPaused`）
- 依赖 `@/core/observer-handle`（`observe` 注册 observable + 返回 ObserverHandle）
- 被 `camera.ts` 调用（`switchCameraMode` 在 case 'freefly'/'surround'/'concert' 分支调用对应 start/stop）

## 不变量
- 行为循环通过 `observe(scene.onBeforeRenderObservable, ...)` 注册，返回 `ObserverHandle`
- `stop*` 函数显式 `dispose` ObserverHandle，避免回调残留（即使 cam.dispose 也会清理，但 stop* 提供精确控制）
- 行为仅在对应模式下生效（`switchCameraMode` 负责 start/stop 配对：进入模式 → start，离开模式 → stop）
- 行为内部读取 `getCurrentCamera()` 并做 instanceof ArcRotateCamera 守卫，非预期相机类型时回调变 no-op
