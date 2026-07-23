---
kind: performance_monitor
name: 性能监控与自动降级
category: rendering
scope:
  - frontend/src/scene/render/performance.ts
source_files:
  - frontend/src/scene/render/performance.ts
adr:
  - ADR-159
---

## 系统概览
Performance Monitor：FPS 监控 + 自动降级。在渲染循环中调用，根据帧率自动调整渲染质量。模块级状态假定单例场景（不适用于多渲染上下文）。

## 核心职责
- `PerformanceMode = 'auto' | 'quality' | 'balanced' | 'performance' | 'custom'`
- `registerRenderBridge(bridge)` — ADR-159 P3-A：延迟绑定渲染桥接，由 `scene.ts` 在 `initScene()` 注入（单向依赖 scene → performance），未注册时安全默认
- `RenderBridge` — `{ engine.getFps, setLightState, setRenderState, getLightState, getRenderState }`
- 自动降级：低帧率时经 bridge 调 `setRenderState` / `setLightState` 降档；`getPerfRenderScaleMul()`（Level 2/3 时降至 0.7）被 `render-loop` 用于 `applyScaling`
- `updatePerformance(...)` / `recalcPerformanceReference(...)`

## 对外 API（节选）
- `registerRenderBridge(bridge)`
- `updatePerformance()` / `getPerfRenderScaleMul()` / `recalcPerformanceReference()`
- `setPerformanceMode(mode)` / `getPerformanceMode()`

## 关键约定
- bridge 未就绪时各成员为安全默认，避免调用崩溃
- 性能快照重置 `resetPerformanceSnapshot` / `isSnapshotResetSuppressed`（被 renderer/lighting 引用）

## 与其他子系统关系
- 被 `core/render-loop.ts`（`calcHardwareScaling`/`applyScaling`）消费降级乘数
- 依赖 `performance-env-bridge.ts`（反射劣化）、`quality-profile.ts`（档位解析）
- 经 `RenderBridge` 写回 `renderer.ts` / `lighting.ts`
