# Round 66 审核报告 — perception-lipsync / perf-tier / physics-bridge

> 日期：2026-08-15
> 模式：继续队列第十批，3 个子代理并行审计 + 主模型收口跨文件 P2。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/perception-lipsync.test.ts`、`frontend/src/__tests__/perception/perf-tier.int.test.ts`、`frontend/src/__tests__/physics-bridge.test.ts`）。
- 发现总数：22（P0×0 / P1×2 / P2×8 / P3×9 / P4×3）。
- 实际修改文件：9 个（3 个测试 + 6 个源码/共享 mock）。
- 验证：`npm run check` ✅；定向 47 用例 ✅；perception+physics 相关 199 用例 ✅；全量前端 Vitest 253 文件 / 5872 用例 ✅；`git diff --check` ✅。

## 修复

### perception-lipsync（子代理 + 主模型收口）
1. **P2 源码：BeatDetector 能量 NaN/Infinity 污染低通平滑** — 新增 `_finiteLevel()`，非有限/负数按 0。
2. **P2 源码：tier=low / disableAll / 焦点切换时口型 morph 可能冻结**（子代理指出，主模型收口）：
   - `perception-lipsync.ts` low 守卫改为 `low && enabled` 才跳过，允许 `enabled=false` 走复位路径。
   - `perception-observer.ts` low 档补 `_applyLipSync(..., false, ...)` 复位调用。
   - `perception.ts` 新增 `_resetLipSyncForModel()`，在 `disableAllPerception`、`deactivatePerception`、焦点切换旧模型停用时统一复位口型。
3. **P3 测试：per-model 缓存用例无法证明隔离** — 改用不同 morph 表并同时 spy A/B。
4. **P3 测试：`_disposeLipSyncRuntime` 无直接回归** — 新增 dispose 后重建缓存用例。
5. **P3 测试：NaN/Infinity beat level 无覆盖** — 新增异常输入回归用例。

### perception/perf-tier（子代理）
6. **P1 源码：`enableAllPerception` 未同步感知焦点，low/medium 可能空转** — 末尾同步 `_focusedContextId = focusedModelId`。
7. **P1 源码：全员模式下切换/移除焦点会误停其他活跃模型** — `activatePerception()` 区分 UI 焦点切换与非焦点激活；`deactivatePerception` 在仍有其他活跃 context 时保留 observer。
8. **P2 源码：`PerceptionPerfMonitor` 手动档从不采样 fps，低帧率 warn 永不触发** — 手动档也按采样周期刷新 `fps`。
9. **P2 源码：observer 自动注销时未移除 release listener** — 与 `deactivatePerception` 对称清理。
10. **P2 测试：共享 `modelRegistry` 未在 setup 中清理** — `setupPerceptionTest` 补 `clear()`。
11. **P2 测试：持有 reset 前旧 `feetDebug`/`PerceptionPerfMonitor` 单例引用** — `beforeEach` setup 后重新抓取 fresh 引用，`afterEach` 统一 restore。
12. **P3 测试：stale mock 路径 `../../ar/ar-camera`** — 本文件改为 `../../scene/ar/ar-camera`；兄弟测试文件待后续统一。

### physics-bridge（子代理）
13. **P2 源码：`autoFitAttachment` 对缺失/非有限模型高度无防御** — 非有限/非正数回退 `1e-3`。
14. **P2 源码：回调内 `dispose()` 后仍继续执行本帧剩余回调** — 增加 `_disposed` 状态并在快照循环中 break。
15. **P2 源码：dispose 后重新 register 不重建 onDispose 绑定** — 复用注册表时重置 `_disposed` 并重新 `_bindDisposeHandle()`。
16. **P3 源码：`getBoneWorldPosition` 注释误导** — 修正为「历史命名遗留，实际 rootMesh 局部系」。
17. **P3 测试：autoFit 断言偏弱** — 改为精确期望值并补退化输入矩阵。
18. **P3 测试：`PerFrameUpdateRegistry` 生命周期边界缺覆盖** — 补重复注册/未知 key 注销/dispose 幂等/重入 dispose/dispose 后重注册。
19. **P4 测试：`findRuntimeBone` 缺空数组退化输入** — 补断言。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 定向单测 | `npx vitest run src/__tests__/perception/perf-tier.int.test.ts src/__tests__/perception-lipsync.test.ts src/__tests__/physics-bridge.test.ts --no-color` | ✅ 3 files / 47 tests |
| 相关回归 | `npx vitest run src/__tests__/perception src/__tests__/perception-lipsync.test.ts src/__tests__/physics-bridge.test.ts src/__tests__/virtual-skirt.test.ts --no-color` | ✅ 10 files / 199 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5872 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- `getBoneWorldPosition` 函数名仍是历史误导名；改名需同步 `virtual-skirt.ts` 与知识卡，另行立项。
- `PerFrameUpdateRegistry` 采用「dispose 后允许重新 register」语义；若产品希望 dispose 后永久失效，可再收紧。
- perception 系兄弟测试文件仍使用旧 `../../ar/ar-camera` mock 路径，建议后续统一改为 `../../scene/ar/ar-camera`。
- perf-tier 的 low 跳过项/medium 降采样仍为弱断言，完整断言需对 gaze/balance/lipsync 做可观测注入，后续增强。
- perception-observer 热路径 catch 内 logWarn 未做 feetDebug 门控/节流（ADR-248），需统一策略后处理。
