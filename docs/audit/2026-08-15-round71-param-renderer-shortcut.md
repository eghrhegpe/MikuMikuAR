# Round 71 审核报告 — registry.param / renderer-transition / shortcut-app

> 日期：2026-08-15
> 模式：继续队列第十五批，3 个子代理并行审计。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/scene/motion-modules-registry.param.test.ts`、`frontend/src/__tests__/scene/renderer-transition.test.ts`、`frontend/src/__tests__/shortcut-app.test.ts`）。
- 发现总数：16（P0×0 / P1×1 / P2×6 / P3×8 / P4×1）。
- 实际修改文件：8 个（3 个测试 + 5 个源码/共享 mock）。
- 验证：`npm run check` ✅；定向 13 文件 / 190 用例 ✅；全量前端 Vitest 253 文件 / 5944 用例 ✅；`git diff --check` ✅。

## 修复

### motion-modules-registry.param（子代理）
1. **P2 源码：`setModuleParam`/旧状态/proc 应用路径未防 NaN/Infinity** — 新增 `_sanitizeParamValue`，非有限数值回退模块默认值或 0，并在 `_seedDefaultParams`/`applyProcMotionModulesToModel` 统一归一化。
2. **P3 源码：`unregisterModule` 未清理 `procMotionModules` 残留状态** — 注销时从每个模型的 proc 持久化数组中移除该模块。
3. **P3 测试：`applyProcMotionModulesToModel` 用例缺运行时清理** — 补 disable 收尾，并新增禁用清理/重复应用幂等/旧存档 NaN 不写回测试。
4. **P3 测试：帧钩子 spy 未纳入 `shared`** — 提升到共享，param 文件自行清空避免用例间误读。

### renderer-transition（子代理）
5. **P1 源码：`duration` NaN/Infinity/负数导致动画永不收尾** — 回退安全默认时长并 `clamp01` 进度。
6. **P2 源码：非有限数值/颜色/枚举目标污染管线** — 数值/枚举/颜色通道逐项 `Number.isFinite` 过滤。
7. **P2 源码：`onComplete` 启动新过渡时被旧帧 `finally` 误杀** — 仅当 observer 仍是当前帧持有者才取消。
8. **P2 源码：中间帧 `_applyRenderState` 抛错导致 observer 泄漏** — catch 中先取消 observer 再抛。
9. **P3 测试：原测试未真正触发动画帧/observer 生命周期** — 用带回调集合的 Observable mock + fake timers 扩到 15 用例。
10. **P4 观察项：`initRenderer` 直接重入未加固** — 当前调用路径总是先 dispose，本轮不改但补 dispose→re-init 回归。

### shortcut-app（子代理）
11. **P2 源码：motion:undo 幽灵路径先 pop 再检查 restore，吞掉快照** — 先取 restore，缺失时在 pop 前 return 并告警。
12. **P3 源码：`global:close`/`screenshot:current` 共用 `getUiActions()` 互相拖垮** — 改为分别 `getUiAction`。
13. **P3 源码：shortcut-registry handler 抛错/rejected promise 未隔离** — dispatcher 内 try/catch + `Promise.resolve().catch()` 统一 logWarn。
14. **P3 测试：seek reject 未断言错误记录** — 补 console.error spy。
15. **P3 测试：`safeDispose` mock 不符合真实契约** — 改为返回 null。
16. **P4 测试：重复注册/reset 幂等/依赖降级/handler 隔离缺覆盖** — 补齐。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 定向单测 | `npx vitest run src/__tests__/scene/motion-modules-registry.*.test.ts src/__tests__/scene/renderer-transition.test.ts src/__tests__/render-postprocess.test.ts src/__tests__/shortcut-app.test.ts src/__tests__/shortcut-registry.test.ts src/core/__tests__/shortcut-registry.test.ts --no-color` | ✅ 13 files / 190 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5944 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- `initRenderer` 直接重入加固（P4）未改；当前唯一调用路径总是先 `disposeScene()`。
- `getUiActions()` 可能因本次改为 `getUiAction` 而成为死代码，需确认无其他消费者后再清理。
- `applyProcMotionModulesToModel` 的 procRole 切换清理职责归属（registry 还是调用方）尚未闭环，建议确认设计。
- `shared.reset()` 未清空帧钩子 spy，因 `side-hooks.test.ts` 依赖跨用例累积快照；彻底治理需同步调整 `side-hooks.test.ts` 或模块级帧钩子生命周期。
