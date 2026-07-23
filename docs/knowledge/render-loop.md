---
kind: render_loop
name: 渲染循环与 FPS 时钟
category: core
scope:
  - frontend/src/core/render-loop.ts
source_files:
  - frontend/src/core/render-loop.ts
adr:
  - ADR-102
---

## 系统概览
渲染主循环 + FPS 时钟（ADR-102，从 main.ts 拆分）。负责驱动 `scene.render()`、`applyFrameControl()`、按 DPR + renderScale 计算并钳位 `hardwareScalingLevel`、以及每 60 帧采样的 DEV-only 性能日志。所有模块级句柄支持**幂等 stop**，防止 Vite HMR 重复运行 bootstrap 时泄漏 `setInterval` / render-loop。

## 核心职责
- `startRenderLoop()` — 先 `stopRenderLoop()` 幂等清理旧实例，再 `applyFrameControl()` + `applyScaling()` + 注册 before/after observer + 启动 FPS `setInterval`
- `stopRenderLoop()` — 移除 observer 句柄、清 FPS 时钟、解绑 resize 处理器（幂等）
- `calcHardwareScaling(dpr, renderScale)` — 反推帧缓冲尺寸并钳位不超过 `GL_MAX_TEXTURE_SIZE`（防 DPR×renderScale 越界 OOM）
- `applyScaling()` — 用户 renderScale × 降级乘数（`getPerfRenderScaleMul`，Level 2/3 时自动降至 0.7）应用 `hardwareScalingLevel`

## 对外 API（节选）
- `startRenderLoop()` / `stopRenderLoop()` — 幂等启停
- `calcHardwareScaling(dpr, renderScale): number` — 含 DPR + GL 钳位 + 降级乘数

## 关键约定
- 模块级 `_fpsClockId` / `_beforeObs` / `_afterObs` / `_resizeHandler` 在 stop 时全部释放
- 性能日志 DEV-only + 每 60 帧采样（P4 降噪，见代码审核报告）

## 与其他子系统关系
- 依赖 `scene/scene.ts`（`engine` / `scene` / `applyFrameControl`）
- 依赖 `scene/render/performance.ts`（`updatePerformance` / `getPerfRenderScaleMul` / `recalcPerformanceReference`）
- 依赖 `observer-handle.ts`（`observe` 订阅 before/after observer，支持 HMR 幂等销毁）
