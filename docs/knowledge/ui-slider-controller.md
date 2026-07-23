---
kind: ui_slider_controller
name: 滑块输入控制器
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/ui-slider-controller.ts
adr: []
---

## 系统概览
统一滑块输入控制器，封装 mousedown→mousemove→mouseup 拖拽、键盘方向键步进（支持 Ctrl/Shift 倍数加速）、游标点击跳转逻辑。供 `addSliderRow` / `addColorSliderRow` / `addVector3SliderRow` / `addModeSlider` 共用。

## 核心职责
- `ui-slider-controller.ts` — 滑块拖拽控制、键盘步进、值吸附。

## 对外 API（节选）
- `DragSliderOptions` — 配置接口（value / min / max / step / snap? / onChange? / onDragEnd?）。
- `DragSliderController` — 滑块控制器类。
  - `setValue(v)` — 动态更新当前值（builder 重建或外部重置时调用）。
  - `bind(el)` — 绑定 DOM 元素并注册事件，返回 Disposable 用于移除监听。
  - 支持键盘：ArrowLeft/Right/Up/Down 步进，Home/End 跳转边界，Ctrl×100 / Shift×10 倍数加速。
  - 支持 snap 吸附：值域对齐到指定粒度的整数倍。
  - 快速单击（非拖拽）跳转到点击位置。

## 与其他子系统关系
- 依赖 `dom.ts` 的 `addDisposableListener` 注册 document 级拖拽事件。
- 依赖 `utils.ts` 的 `clamp01` 值域裁剪。
- 被 `ui-rows.ts` / `ui-advanced-rows.ts` 等 UI builder 引用。