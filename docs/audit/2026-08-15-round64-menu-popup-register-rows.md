# Round 64 审核报告 — menu popup-overlay / register-popup / rows

> 日期：2026-08-15
> 模式：继续队列第八批，同模块 3 个测试文件由一个子代理串行处理。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/menu/popup-overlay.test.ts`、`frontend/src/__tests__/menu/register-popup.test.ts`、`frontend/src/__tests__/menu/rows.test.ts`）。
- 发现总数：17（P0×0 / P1×3 / P2×5 / P3×9）。
- 实际修复文件：3 个测试 + 1 个源码（`frontend/src/menus/menu.ts`）。
- 验证：`npm run check` ✅；`src/__tests__/menu` 18 文件 / 1652 用例 ✅；全量前端 Vitest 253 文件 / 5852 用例 ✅；`git diff --check` ✅。

## 修复

### 源码（menu.ts）
1. **P1：`resetToRoot` 在过渡中未取消动画** — 可能把已出栈子层渲染回来；先 `_cancelAnim()`。
2. **P1：`push/pop` 的 `onFadeOut` 可被 transitionend 与兜底定时器双触发** — 加 `fadeOutStarted` 幂等守卫。
3. **P1：`transitionend` Disposable 未纳入 `dispose/_cancelAnim` 清理** — 新增 `_transitionDisposables[]` 统一释放。
4. **P2：`_cancelAnim` 未真正取消 pending reRender RAF** — 保存 `_reRenderRaf` 并 `cancelAnimationFrame`。
5. **P2：异步 finalize 无过期守卫** — 用 `_buildSeq` 跳过 dispose/新 build 后的旧 `.then`。
6. **P3：action 行点击未用可选链调用 `onItemClick`** — 改为 `onItemClick?.`。

### 测试
- **P2：popup-overlay 泄漏 SlideMenu/wrapper 注册表** — 补 `storedMenu.dispose()` + `disposeMenuWrapper`。
- **P2：popup-overlay 手造 wrapper 与真实 `getMenuWrapper` 不一致** — 删除死 fixture。
- **P2：register-popup afterEach 未释放菜单与 wrapper** — 补 `getOpenMenus().forEach(dispose)` + `disposeMenuWrapper`。
- **P3：多处弱断言补强** — refreshRoot DOM、dispose 引用清空、onShow 实例、action/toggle/headerToggle 交互。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 菜单相关单测 | `npx vitest run src/__tests__/menu --no-color` | ✅ 18 files / 1652 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5852 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- 无阻塞项。
- `register-popup.test.ts` 的 afterEach 使用 `getOpenMenus()` 统一释放；当前 `isolate=true` 下安全，若未来切 `isolate=false` 需改为显式句柄级清理。
