---
kind: ui_action_bridge
name: UI 行为注入桥
tier: leaf
category: core
scope:
  - frontend/src/core/ui-action-bridge.ts
source_files:
  - frontend/src/core/ui-action-bridge.ts
adr:
  - ADR-238
symbols:
  - registerUiAction
  - getUiAction
  - getUiActions
  - UiActions
invariants:
  - core 持注入点，menus 侧注册，方向单向（与 e2e-state-bridge / scene-action-bridge 同模式）
  - 未注册调用一次性告警后静默返回 undefined
  - getUiActions 需 closeAllOverlays + screenshotCurrent 均注册才返回全集（旧调用点兼容）
tests: []
use_when:
  - UI 行为
  - 导航按钮
  - toggleOverlayMode
  - handleAndroidBack
  - 快捷键分发
  - closeAllOverlays
---

# UI 行为注入桥

## 系统概览
**UI 行为注入桥**（ui-action-bridge）。ADR-238 切断 `core（shortcut-app / events / init）→ menus/*` 反向依赖的注入桥：menus 侧注册 UI 行为，core 快捷键层与事件层经本桥调用，不 import menus。

## 核心职责
- `ui-action-bridge.ts` — 定义 `UiActions` 接口（导航/遮罩/截图/设置等行为）+ 分字段注册/读取。

## 对外 API（节选）
- `registerUiAction(key, fn)` — menus 侧各模块启动时注册（可重复覆盖）。
- `getUiAction(key)` — core 侧读取；未注册返回 `undefined` 并一次性告警（`'${key}' 未注册——调用将静默跳过`）。
- `getUiActions()` — 旧调用点兼容（shortcut-app 的 closeAllOverlays/screenshotCurrent）：两 key 均注册才返回全集，否则 `null`。
- 关键注册项：`navAction`（数字→弹窗分发）、`navLabel`（数字→标签）、`toggleOverlayMode`（画布点击沉浸切换）、`handleAndroidBack`（Android 返回键）、`closeAllOverlays`、`screenshotCurrent`、`preloadAutoImportState` 等。

## 与其他子系统关系
- 注册方：`menus/nav-actions.ts`（navAction/toggleOverlayMode/navLabel/handleAndroidBack）、`menus/settings-shared.ts`（preloadAutoImportState）、`menus/scene-menu.ts`（screenshotBatch/saveScene）、`menus/motion-*`（动作菜单行为）。
- 消费方：`core/shortcut-app.ts`（快捷键分发）、`core/events.ts`（画布点击沉浸切换、Android 返回）、`core/init.ts`（预加载状态）。

## 不变量
- **方向单向**：menus 注册、core 消费，禁止 core 反向静态 import menus。
- **未注册容错**：`getUiAction` 对缺失 key 告警一次后静默返回 `undefined`，调用方 `?.()` 兜底——v1.9.1 按钮修复前 `toggleOverlayMode` 即因此告警。
- **加载锚点**：注册在模块顶层执行，模块必须被 import 才注册（`nav-actions` 由 `menus/library-setup` 显式调用 `initNavActions()` 拉起）。
