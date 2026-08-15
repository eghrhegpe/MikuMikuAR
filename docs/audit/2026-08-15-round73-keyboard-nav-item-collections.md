# Round 73 审核报告 — ui-keyboard-nav / ui-nav-item / utils.collections

> 日期：2026-08-15
> 模式：继续队列第十七批，3 个子代理并行审计。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/ui-keyboard-nav.test.ts`、`frontend/src/__tests__/ui-nav-item.test.ts`、`frontend/src/__tests__/utils.collections.test.ts`）。
- 发现总数：19（P0×0 / P1×0 / P2×6 / P3×9 / P4×4）。
- 实际修改文件：6 个（3 个测试 + 3 个源码）。
- 验证：`npm run check` ✅；定向 23 文件 / 1770 用例 ✅；全量前端 Vitest 253 文件 / 5980 用例 ✅；`git diff --check` ✅。

## 修复

### ui-keyboard-nav（子代理）
1. **P2 源码：`:focus` 反查在逗号选择器下误中未聚焦项** — 改为先 `container.querySelector(':focus')` 再确认在 items 中。
2. **P2 源码：无焦点项（idx=-1）时 ArrowUp/ArrowLeft wrap 位置偏一** — 改为 `idx <= 0 ? list.length - 1 : idx - 1`。
3. **P3 测试：roving tabIndex 测试缺 afterEach 清理** — 统一夹具管理。
4. **P3 测试：部分“不应移动”用例缺反向断言** — 补 `setActiveIndex` 未调用/精确目标断言。
5. **P3 测试：缺 idx=-1 环绕/逗号选择器/dispose 移除监听回归** — 补齐。

### ui-nav-item（子代理）
6. **P2 源码：`markNavItem` 重复调用残留旧标记** — 以最新 opts 为准，缺省/取消同步 removeAttribute。
7. **P2 源码：非法 CSS selector 使导航辅助抛异常** — 新增 `safeQueryAll`/`safeQuery` 兜底。
8. **P2 源码：`navGroupMove` 对已移除行仍返回 true** — 先查 `row.isConnected`。
9. **P3 源码：`navGroupMove` 非法 dir 无防御** — 仅接受 `-1`/`1`。
10. **P3 测试：共享 DOM 污染与弱断言/边界缺口** — 统一 afterEach，补重复调用/非法 selector/空组/单元素/已移除行/非法 dir 用例。

### utils.collections（子代理）
11. **P2 源码：`filterKeys` 的 `__proto__` 键触发原型 setter/原型污染** — 改用 `Object.defineProperty`。
12. **P3 源码：`filterKeys(null/undefined)` 抛 TypeError** — 增加 nullish 守卫返回 `{}`。
13. **P3 源码：`allSettledFilter` 类型签名过窄** — 放宽为 `ReadonlyArray<T | PromiseLike<T>>`。
14. **P3 未修：`jsonParse<T>` 无运行时结构校验** — 需主模型决策是否引入校验器/改返回 `unknown`。
15. **P4 测试：Set/arguments/类数组、undefined/NaN key、function/Symbol/BigInt/循环引用边界** — 补测试锁定现状。
16. **P4 未修：`docs/function-map.md` 行号过期** — 需后续同步。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 定向单测 | `npx vitest run src/__tests__/ui-keyboard-nav.test.ts src/__tests__/ui-nav-item.test.ts src/__tests__/utils.collections.test.ts src/__tests__/fullscreen-overlay.test.ts src/__tests__/menu src/__tests__/model-preset.test.ts --no-color` | ✅ 23 files / 1770 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5980 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- `jsonParse<T>` 无运行时结构校验：建议明确 API 决策（校验器 / 返回 `unknown` / 文档化现状）。
- `jsonStringify(BigInt)` 当前按原生抛错并已用测试锁定；若要求“安全序列化绝不抛错”需决策映射方式。
- `docs/function-map.md` 中 `allSettledFilter` 行号过期，后续运行生成脚本或手动同步。
- `ui-keyboard-nav.transitioningGuard` 命中时不 `preventDefault()`，若产品期望过渡期间吞键需确认。
