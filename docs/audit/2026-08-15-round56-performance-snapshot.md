# round56-performance-snapshot — 性能降级快照恢复路径审核

## 审核范围

| 项 | 内容 |
|----|------|
| **测试文件** | `frontend/src/__tests__/scene/performance-snapshot.test.ts`（168 行，全文件，4 用例，1 describe） |
| **被测源码** | `frontend/src/scene/render/performance.ts`（641 行，重点 L34-40 registerRenderBridge、L66-90 快照/抑制状态、L248-274 `_restoreSnapshot`、L281-407 applyDegrade、L590-616 setPerformanceMode、L630-635 resetPerformanceSnapshot） |
| **守卫消费方** | `frontend/src/scene/render/lighting.ts`（L356-358 / L418-420 `isSnapshotResetSuppressed` + `resetPerformanceSnapshot`）、`frontend/src/scene/render/renderer.ts`（L700-702） |
| **桥接注入点** | `frontend/src/scene/scene.ts`（L471 `registerRenderBridge`，initScene 末尾） |
| **ADR 依据** | ADR-159 P3-A（performance→scene 静态重 import → 桥接注入）；ADR-130 Phase 2.3（env 联动，经 `performance-env-bridge.ts`） |

**总体结论：✅ 通过**（4/4 用例实测全绿，14ms；无 P1/P2 风险，2 项 P3 覆盖缺口、3 项 P4 观察）

### 与历史轮次的关系（任务要求注明）

- **round-13**（`docs/audit/2026-08-06-round13-scene-render-core-ui.md`）：整体审过 performance.ts（⚠️ 有条件通过）。本测试覆盖的快照恢复核心即为 round-13 修复的两处债——**P1#3「快照回写覆盖用户改动」**（`resetPerformanceSnapshot()` 移入 setter 内部、patch 应用之前，见 lighting.ts:352-358 / renderer.ts:696-702 注释）与 **P3「bridge 空快照守卫」**（L310-321 快照捕获加 `_bridgeEngine !== null` 守卫，见 L304-309 审计注记）。本测试验证的是修复后的收口路径，非重复审核。
- **round-29**（`docs/audit/2026-08-15-round29-perception-perf.md`）：审的是 `perception.perf.test.ts`（感知层性能基准，ADR-164/165），与 performance.ts 仅名字相近，**无关联**。
- **round-47**（`docs/audit/2026-08-15-round47-performance-reflection.md`）：审 `performance-env-bridge.ts` + `quality-profile.ts`（ADR-130 联动），**与本测试互补**：round-47 测桥与注册表，本测试测 `_restoreSnapshot` 消费桥的恢复路径（含 env 快照回写与成对标志切换，performance.ts:260-267）。round-47 提出的「applyDegrade ADR-151 守卫分支无直接测试」P3 在本测试依然成立（见风险 R1）。

## 亮点

- **抑制守卫的真实性验证（测试最强用例）**：`performance-snapshot.test.ts:147-157` 通过 `vi.hoisted` spy 内嵌读取真实 `isSnapshotResetSuppressed()`（L85 wire），捕获 `_restoreSnapshot` 回写 `setLightState` 调用瞬间 `_suppressSnapshotReset === true`，并在 L149 显式重置 `box.suppressedDuringRestore = null` 以排除降级阶段（同样处于抑制块内）调用的污染——守卫验证不是「mock 自证」，而是锚定真实模块状态。
- **依赖注入的可测性收益兑现（ADR-159 P3-A）**：测试不再 mock 整个 scene 模块，直接 `registerRenderBridge({ engine, setLightState, ... })` 注入 mock bridge（`performance-snapshot.test.ts:89-95`），4 个 setter/getter 全由 hoisted spy 驱动——P3-A 设计意图（ADR-159 L75）在测试侧落地，且与 scene.ts:471 真实注入点形状一致。
- **`_restoreSnapshot` 双保险防反馈循环**：`performance.ts:248-274` —— (a) 先提取 + 清空 `_snapshot`（L255）再应用，即使 setter 内部触发 `resetPerformanceSnapshot` 也无快照可恢复（no-op）；(b) 全程 `_suppressSnapshotReset = true`（L256）+ try/finally 复位（L268-270），setter 直接跳过反向恢复（lighting.ts:356 / renderer.ts:700 守卫消费）。测试 3 验证 (b)，测试 4 验证无快照时 (a) 的 no-op 语义。
- **异常安全的标志成对切换**：`performance.ts:261-266` env 恢复分支以 `setAutoDegradingReflection(true)` → try/finally → `(false)` 包裹 `setEnvStateForPerformance`，中间件抛错不残留降级标志（测试 2 断言先 true 后 false 的调用序）。
- **mock 卫生符合 ADR-219 铁律**：`@/core/config` 与 `@/core/state` 均用 `async importOriginal` spread 保留活绑定（L45-70），spy 用 `vi.hoisted` 声明（L22-43）规避工厂提升期 TDZ——与 frontend/AGENTS.md §2.3 完全对齐。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | frontend/src/__tests__/scene/performance-snapshot.test.ts | L107-168（全 describe） | **applyDegrade(level=0) 入口分支无直接用例**：测试 1/2/3 全走 `resetPerformanceSnapshot()` 收口，`_restoreSnapshot` 共用体被覆盖，但 `applyDegrade` 的恢复分支（performance.ts:324-332 的 DEV 日志、`_lastRecoveryTime` 更新）与「恢复 0 但无快照」分支（L335-338）未触达。任务宣称「applyDegrade level=0 与 resetPerformanceSnapshot 共用」，共用体覆盖成立，但入口侧属半覆盖 | 补 1 例：`setPerformanceMode('quality')` 触发 `applyDegrade(0, true)`，断言 level 归零 + 回写原始值 + 抑制标志轨迹；可顺带覆盖 L335-338 无快照恢复分支 |
| 🟡 P3 | frontend/src/__tests__/scene/performance-snapshot.test.ts | L107-168（全 describe） | **bridge 未注册（registerRenderBridge 前）路径未覆盖**：round-13 修复的「bridge 空快照守卫」（performance.ts:304-313，`_bridgeEngine !== null` 条件捕获）是本测试血缘最近的修复，但 4 用例均在 beforeEach 注入 bridge，未回归「未注册时降级不捕获空快照、恢复不误写」场景 | 补 1 例：不调 registerRenderBridge 直接 `setPerformanceMode('performance')` → `resetPerformanceSnapshot()`，断言 light/render 回写为 no-op 且 level 归零（验证 L312-313 条件分支） |
| 🟢 P4 | frontend/src/scene/render/performance.ts | L255-272 | `_snapshot = null` 在 try 之前清空：若 `setLightState`（L258）抛错，env 恢复分支（L260-267）与 `_perfRenderScaleMul = 1.0`（L272，finally 之后）被跳过——恢复不完整且 renderScale 乘数滞留 0.7。当前 setter 为纯状态写入不抛错，属异常路径防御缺口 | 将 `_perfRenderScaleMul = 1.0` 移入 finally（或 env 分支之前）；如需强健可把 env 恢复放独立 try/catch |
| 🟢 P4 | frontend/src/__tests__/scene/performance-snapshot.test.ts | L45-74 | 与 `performance-refresh-rate.test.ts:30-65` 的 4 个 mock 块（performance-env-bridge / @/core/config / @/core/state / @/core/format-timestamp）跨文件高度重复；`stateMockSuperset` 共享工厂（`src/__tests__/mocks/state-superset.ts`）已存在但两文件均未复用（形状一致，非形状债，仅样板债） | 抽共享 `performance-mocks.ts` 工厂（同 scene-superset 范式），两测试文件复用；或至少 core/state 改走 stateMockSuperset |
| 🟢 P4 | frontend/src/scene/render/performance.ts | L30-31 | 默认 bridge getter `() => ({}) as LightState / RenderState` 空对象强转逃逸类型系统（round-13 已用 `_bridgeEngine !== null` 守卫缓解快照捕获路径，运行时安全，属类型卫生问题） | 改返回结构化空默认（如 `{ hemiIntensity: 1 }` 语义默认）或放宽为 `Partial` 显式类型，消除 `as` 强转 |

## 测试质量评价

- **断言有效性**：✅ 全部真实。测试 1（L108-123）用 mockClear 隔离「降级调用」与「恢复调用」，深度断言 `setLightState(ORIGINAL_LIGHT)` / `setRenderState(ORIGINAL_RENDER)` 与 level 归零；测试 2（L125-145）断言 env 快照 4 字段全量回写 + `skipAutoSave=true` + `setAutoDegradingReflection` 先 true 后 false 的成对调用序（mockClear 在降级后执行，保证只观察恢复）；测试 3（L147-157）锚定真实抑制标志（见亮点）；测试 4（L159-167）无快照时三路 setter 均未调用 + level 0。
- **mock 合理性**：✅ registerRenderBridge 依赖注入直接驱动被测单元，无需 mock scene 模块（P3-A 收益）；`@/core/config` / `@/core/state` 用 `importOriginal` spread 保留活绑定；`formatTimestamp` 桩化消除 DEV 日志副作用；`performance-env-bridge` 仅覆两个被 spy 的函数、其余走真实实现（不破坏 ADR-130 联动语义）。
- **边界覆盖**：⚠️ 无快照 no-op（测试 4）、重复恢复（beforeEach 每例复位 + 恢复后 level 归零可再恢复）、降级到 level=0 收口（共用体）均覆盖；缺口为 applyDegrade(0) 入口分支与 bridge 未注册场景（见风险 R1/R2）。
- **无跳过测试**：✅ 无 `it.skip` / `describe.skip` / `xit` / `todo`。
- **运行验证**：`cd frontend && npm run test -- src/__tests__/scene/performance-snapshot.test.ts` → **4/4 passed，14ms**（Vitest v4.1.9）。`npm run check`（tsc 全量）未单独跑——本审计只读不改码、无新增类型面，被测文件的类型防线由既有 CI 覆盖，故跳过并在此注明（同 round-47 处理）。

---

- **审核日期**：2026-08-15
- **审核员**：子代理 round56-performance-snapshot
