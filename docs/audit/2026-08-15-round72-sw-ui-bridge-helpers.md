# Round 72 审核报告 — sw-register / ui-action-bridge / ui-helpers

> 日期：2026-08-15
> 模式：继续队列第十六批，3 个子代理并行审计。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/sw-register.test.ts`、`frontend/src/__tests__/ui-action-bridge.test.ts`、`frontend/src/__tests__/ui-helpers.test.ts`）。
- 发现总数：20（P0×0 / P1×0 / P2×5 / P3×10 / P4×5）。
- 实际修改文件：6 个（3 个测试 + 3 个源码）。
- 验证：`npm run check` ✅；定向 7 文件 / 161 用例 ✅；全量前端 Vitest 253 文件 / 5961 用例 ✅；`git diff --check` ✅。

## 修复

### sw-register（子代理）
1. **P2 源码：`navigator.serviceWorker` 缺失判定不完整** — 补 `== null` 与 `register` 函数存在性守卫。
2. **P3 源码：重复调用会重复挂监听** — 模块级 `registrationScheduled` 防重入。
3. **P3 测试：共享状态污染（spy/global/location 未恢复）** — 统一 `afterEach` 恢复。
4. **P3 测试：serviceWorker 不支持/register reject/重复调用缺覆盖** — 补齐。
5. **P4 源码：load 监听未声明 once** — 改为 `{ once: true }`。
6. **P4 测试：URL 断言过弱、crossOriginIsolated 未定义分支缺失** — 补精确断言与用例。

### ui-action-bridge（子代理）
7. **P2 源码：`getUiActions()` 返回 Map 而非普通对象，破坏旧调用点语义** — 改 `Object.fromEntries(_uiActions)` 返回普通对象视图。
8. **P3 测试：`getUiActions()` 无覆盖** — 补 null 语义与属性访问用例。
9. **P3 测试：使用生产键 `getMotionMenu` 存在污染风险** — 改用测试专用键并前后清理。
10. **P3 测试：token 幂等/未注册 key 幂等缺覆盖** — 补齐。
11. **P4 源码/测试：注释陈旧与命名误导** — 更新注释与用例名。

### ui-helpers（子代理）
12. **P2 源码：`addColorSliderRow` 未将颜色通道钳到 [0,1]** — 初始与自更新统一 `clamp01`，swatch 使用钳制后值。
13. **P2 源码：`addVector3SliderRow` 未钳轴值且 `min===max` 产生 NaN%** — 增加 `hasRange` 守卫并统一钳到 `[min,max]`。
14. **P3 源码：`addModeSlider` 零宽元素点击得 Infinity** — `rect.width || 1` + `clamp01`。
15. **P3 源码：`addModeSlider` 外部非法值只 return 不更新显示** — 非法值回落第一个选项并仍返回 true。
16. **P3 测试：sliderRow 弱断言** — 补精确拖拽/quarter-click 值。
17. **P4 测试：高级滑块/模式滑块边界覆盖** — 新增越界/bind/NaN/min==max/icon fallback/onDragEnd/testId 用例。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 定向单测 | `npx vitest run src/__tests__/sw-register.test.ts src/__tests__/ui-action-bridge.test.ts src/__tests__/ui-helpers.test.ts src/__tests__/main.boot-anchor.test.ts src/__tests__/shortcut-app.test.ts src/__tests__/menu-schema.test.ts src/__tests__/model-detail-ui.test.ts --no-color` | ✅ 7 files / 161 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5961 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- `getUiActions()` 当前无前端消费者，属兼容层/潜在死代码；建议确认后删除或保留。
- `ui-rows.ts`（锁外）存在同类边界缺陷：`addSliderRow` 未钳到 `[min,max]`、`min===max` 渲染 NaN%；`addToggleRow` 点击后未同步 `initControl.cached`。建议后续分配。
- `DragSliderController.bind()` 返回的 Disposable 被多处丢弃，若未来支持动态移除菜单行会泄漏；需统一 dispose 生命周期。
- `registerUiAction` 同一 fn 引用重复注册时 token 按 identity 删除，若需“每次注册独立 token”需与 `scene-action-bridge` 对齐重构。
