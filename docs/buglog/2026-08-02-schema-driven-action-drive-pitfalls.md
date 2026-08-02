# schema-driven E2E action 交互自动化：三类控件驱动/断言链路坑

> **状态**: 🟢 已修复

**日期**: 2026-08-02
**严重程度**: 🟡 P3
**影响范围**: `frontend/e2e/schema-driven.spec.ts`、`frontend/src/__tests__/schema-snapshot.test.ts`、`frontend/src/core/dev-hooks.ts`
**发现方式**: 测试发现（Playwright 全量跑 13 个 action 断言失败）
**修复提交**: `8e8a2985`（Phase 2 action 交互自动化）

---

## 问题描述

给 schema-driven E2E 加「交互行为断言」（拖滑块/点开关/选 chip 后验证 state 生效）时，全量 30 个测试出现 13 个失败，失败集中在三类控件：

1. `env:iblIntensity`、`env:windDirection` 等带 `get/set` 值域变换的 slider：期望精确值（0.5/180）与实际 state（1.5/向量 `[0,0,1]`）不符。
2. `light.shadowType`（modeSlider）：dispatch 键盘事件后 state 不变。
3. `render.outlineEnabled`（toggle）：点击后 checkbox 翻转但 state 不变。

## 根因分析

**坑一：headless 下 Playwright `focus()+keyboard.press()` 焦点落不到自定义控件**

`DragSliderController`（ADR-140）把键盘监听绑在 `div[role="slider"]` 上，但 headless Chromium 中 `page.keyboard.press()` 发给 `document.activeElement`，实测 focus 后 activeElement 为空 → 事件链路断裂。改为**页面内 `dispatchEvent(new KeyboardEvent('keydown', { key, bubbles, cancelable }))`** 直命中监听器（`schema-driven.spec.ts` 的 `dispatchKeys`）。

**坑二：`control.get/set` 值域变换使 state ≠ 显示值**

- `env.iblIntensity`：`get: v/3, set: v*3` → 显示 0.5 时 state 存 1.5。
- `env.windDirection`：角度 ↔ 向量变换 → state 存 `[0,0,1]`，`Number()` 得 NaN。
- 快照 `cleanNode` 只序列化 `bind/min/max/step/options`，**丢弃了 get/set 函数**，e2e 无法预知变换 → 快照新增 `control.transformed: !!get || !!set` 标记，spec 对 transformed 控件退化「值发生变化」断言。

**坑三：light./render. 域 setState 有初始化守卫，@dom 下写入被拦截**

- `setLightState`（lighting.ts:282）：`if (!hemiLight || !dirLight || !triggerAutoSave) return`。
- `setRenderState`（renderer.ts:631）：`if (!pipeline || !_scene ...) return`。
- @dom（纯 Vite，无 Wails）下灯光/管线未初始化 → state 写入被守卫吞掉，但 **DOM 层已生效**（aria-valuenow/checked 变化）。修复：state 未变化时退化「DOM 层 aria/checked 变化」断言。

**坑四：modeSlider `cycleIdx` 是 clamp 语义非循环 wrap**

`addModeSlider`（ui-advanced-rows.ts:392）`Math.max(0, Math.min(total-1, currentIndex + dir))`——目标 index 小于当前 index 时，一直 ArrowRight 会停在末尾不变。selectChip 须按目标方向选择 ArrowLeft/ArrowRight。

## 修复方案

（`8e8a2985`）按 ADR-229 §2.2 落地「断言强度分级」：

| 情形 | 断言 |
|------|------|
| 无变换 + state 数值有限 | 精确断言（±step 容差） |
| `control.transformed`（get/set 变换） | 「值发生变化」 |
| state 未变（light./render. 守卫域） | 「DOM 层 aria-valuenow / checked 变化」 |

另：vitePage 每 test 全新浏览器实例（无跨 test 持久化污染）+ Phase 3 基线「先基线后交互」顺序约束，故**不做 bind 回滚**。

## 教训

1. **headless 下自定义控件的键盘驱动不要用 `page.keyboard.press()`**：焦点语义与真实浏览器不同，用页面内 `dispatchEvent(KeyboardEvent)` 直命中监听器，并在代码注释记录实证依据（activeElement 为空）。
2. **快照序列化丢函数是隐性契约缺口**：`get/set` 变换无法进 JSON，凡是「state 显示值 ≠ state 存储值」的控件，快照必须显式打 `transformed` 标记，否则 e2e 只能猜。
3. **state 写入有守卫的域（light/render）在 @dom 下不可作精确断言**：先查 setter 的初始化守卫，@dom 无 Wails 时这些域天然「DOM 生效、state 不写」，断言要退化到 DOM 层，避免误报。
