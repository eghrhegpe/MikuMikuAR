# Round 61 审核报告 — fullscreen-overlay / lighting-headless / menu-controls

> 日期：2026-08-15
> 模式：继续队列第五批，3 个子代理并行审计。
> 说明：本批大部分改动已由外部提交 `ceb99f84` 先收口；本报告对应最终完整状态，并包含后续补交的 fullscreen-overlay 增量（真实 `.slide-menu` 选择器 + 多实例冻结恢复）。

## 摘要

- 子代理：3 个，分别审计 1 个测试文件。
- 发现总数：19（P0×0 / P1×4 / P2×7 / P3×7 / P4×1）。
- 涉及文件：3 个测试 + 4 个源码（其中大部分已在 `ceb99f84` 提交，剩余 fullscreen 增量本次提交）。
- 验证：`npm run check` ✅；受影响单测 21 文件 / 1662 用例 ✅；全量前端 Vitest 253 文件 / 5847 用例 ✅。

## 一、fullscreen-overlay.test.ts

### 修复
1. **P1 源码：全屏关闭路径漏触发 `onBack`** — `createFocusTrap` 的 Escape 只调 `closeFullscreen()`，旧实现不触发 `onBack`；已把 `onBack` 收口到 `closeFullscreen()`，所有 UI 关闭入口统一单次触发（已在 `ceb99f84` 收口）。
2. **P1 源码：SlideMenu 冻结选择器陈旧** — 原查 `.slide-menu-container`，生产根类是 `.slide-menu`；改为查询 `.slide-menu`（本次增量）。
3. **P2 源码：只保存单个 SlideMenu，多菜单恢复不完整** — 改为 `frozenSlideMenuElements: HTMLElement[]` 逐个保存/恢复（本次增量）。
4. **P2 测试：覆盖不足** — 扩展为 8 个用例，覆盖所有关闭入口的 `onBack` 单次触发、no-op handle 隔离、DOM 身份、SlideMenu 单/多实例恢复。
5. **P3 测试：i18n 噪音** — `beforeAll` 预填 `zh-CN`。
6. **P3 源码：状态机注释过时 + 死变量** — 更新注释、删除 `_slideMenuFrozen`（已在 `ceb99f84` 完成）。

### 未收口
- 契约确认：`onBack` 统一为“所有关闭入口单次触发”；若产品希望 `handle.close()` / `closeFullscreen()` 作为底层 API 不触发 `onBack`，需重新决策。
- 兼容性确认：`freezeSlideMenu` 从 `.slide-menu-container` 改为 `.slide-menu`；若存在未纳入源码搜索的运行时包装层，需确认是否兼容旧类名。

## 二、lighting-headless.test.ts

### 修复
1. **P2 测试：未调用 `disposeLighting`，模块状态残留** — 重写为 4 个真实 NullEngine 生命周期用例，覆盖未初始化、初始化、可写+自动保存、释放复位。
2. **P2 源码：`disposeLighting` 未将 `envSysShadow` 置空** — 释放 generator 后显式 `lightingState.envSysShadow = null`。

### 未收口
- **`isLightingReady`/守卫不感知已 dispose light**（P3）：建议统一加 `isDisposed()` 检查，但会涉及 `env-lighting.test.ts` 注入的普通对象 mock 形状，需主模型决策。
- **`disposeLighting` 与 transform-gizmo 生命周期不对称**（P3）：建议在 `disposeLighting` 调 `detachGizmo()`，但会破坏现有 transform-gizmo mock 形状，需主模型重新分配/授权。

## 三、menu/controls.test.ts

### 修复
1. **P1 源码（锁外未修）：`scheduleRefresh` 同帧 changedKeys 丢失** — `core/reactivity.ts` 在首次调度时快照并清空 `_changedKeys`，同帧后到的 key 会丢失；建议把快照/清空移到 RAF 回调内。该文件超出授权范围，未改。
2. **P2 源码：`patchPanel` 空列表静默保留旧 DOM** — 改为回退 `buildPanel`，与 `_doReRender` 空 items 路径一致。
3. **P2 测试：未 dispose/未移除 DOM** — 补 `afterEach`。
4. **P2 测试：pathHint 使用完整路径** — 改为真实 reactivity 叶名契约，并在 `menu.ts` 注释明确。
5. **P2 测试：itemBuilder patch 未验证增量 patch** — 改为同 key 只改 label、await RAF、断言同一元素原地刷新。
6. **P3 测试：补旧控件注册表清空、空 itemBuilder、i18n 预填**。

### 未收口
- **`core/reactivity.ts` 的 P1**：同帧连续 set 会漏更新部分 `pathHint` 控件；建议单独派任务修复并补 reactivity 层/集成测试。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 受影响单测 | `npx vitest run src/__tests__/fullscreen-overlay.test.ts src/__tests__/menu/controls.test.ts src/__tests__/lighting-headless.test.ts src/__tests__/library-core.grid-dispose.test.ts src/__tests__/menu` | ✅ 21 files / 1662 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5847 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策汇总

1. `core/reactivity.ts` 的 `scheduleRefresh` 同帧 changedKeys 丢失（P1，锁外文件）。
2. `isLightingReady`/守卫对 disposed light 的感知。
3. `disposeLighting` 与 transform-gizmo 生命周期对称性。
4. fullscreen `onBack` 统一触发契约与 `.slide-menu` 兼容性确认。
