# 第④轮审核 — 光照模块 tween 功能 BUG + 资源管理

**日期**: 2026-07-11
**发现方式**: 代码审核（第④轮）

---

## BUG-001: transitionLighting animLoop 未调度（🔴 P1）

`transitionLighting` 定义了 `animLoop` 函数但从未注册到渲染循环。调用后灯光不做任何过渡。

**根因**: L491 函数结束时缺少 `_scene.onBeforeRenderObservable.add(animLoop)` 注册。

**修复**: 在函数末尾注册 observer，动画结束时（t >= 1）自动移除自身。

## BUG-002: _tweenValue 单帧中断（🔴 P1）

`_tweenValue` 使用 `addOnce(tick)` 注册，`addOnce` 只触发一帧。`tick` 内部未重新调度自身，缓动在一帧后中断，目标参数仅到达 ~3%。

**影响链条**: `applyLightingPresetFromEnv` → `_tweenValue`/`_tweenColor3` → 舞台灯位置/颜色/强度过渡全部中断。

**修复**: `tick` 内 `t < 1` 时重新 `addOnce(tick)` 注册下一帧。

## 新增 disposeLighting()（🔴 P1）

此前光照模块无整体清理入口。新增 `disposeLighting()` 统一释放：
- 所有活跃 tween（`_cancelAllLightingTweens`）
- 舞台灯 + 指示器 + 方向线 + 阴影生成器
- 主灯光（hemiLight / dirLight）
- 太阳盘
- 场景灯光阴影生成器
- 重置所有模块级状态

## 其他修复

- **`_scene!` 注释**：为 `_createStageLight` / `_createIndicator` / `_createDirLine` 中 6 处 `_scene!` 添加安全论证注释（调用方 `addStageLight` 在 `_scene === null` 时 early return）
- **lighting-presets.ts 注释**：修正 "6 个预设" → "4 个预设"（实际只有 character-portrait / prop-product / stage-drama / dance-performance）
