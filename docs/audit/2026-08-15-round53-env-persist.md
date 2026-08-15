# Round 53 审核报告 — env-persist 防抖持久化直接单测

**审核范围：**
- 测试文件：`frontend/src/__tests__/scene/env-persist.test.ts`（133 行，7 用例）
- 被测源码：`frontend/src/scene/env/_bridge/env-persist.ts`（118 行，防抖持久化模块）+ 依赖核实 `core/async.ts:109-138`（DebouncedTimer）、`core/backend/index.ts:34-92`（resolveBackend）、`core/feedback.ts:70-82`、`core/ui-state.ts:17-33`
- 验证：`cd frontend && npm run test -- src/__tests__/scene/env-persist.test.ts` → **7 passed / 0 failed（9ms）**；`npx eslint` 单文件 → 0 error / 2 warning；`npm run check`（tsc 全量）未跑（基线绿 + `tsconfig.json` `noUnusedLocals:false`，死导入不影响 check，已在报告内注明）

**总体结论：⚠️ 有条件通过**

测试本身通过且填补了真实覆盖缺口（防抖窗口、flush 链路、env-flush 失败反馈均为首次直接断言），但**未兑现文件头部声称的「cancel→await 竞态窗口」直接验证**（无任何用例先调度再 flush），且 uiState 防抖入口 `schedulePersistUI`、`cancelEnvPersistTimer` 行为、`flushUIState` 失败路径均零覆盖；附带 3 处死导入与 1 处 `as never` 冗余逃生。生产代码沿用 round-12 审后形态，无新增 `as any`/`@ts-ignore`。

**与既往审核的关系：**
- **round-12（2026-08-06）** 批量审 env-persist：⚠️ 有条件通过，明确登记「env-persist 直接测试」为零覆盖（`2026-08-06-round12-env-motion-core-ai.md:117`）；`docs/audit/inspiration.md:36` 记录 2026-08-04 三模块审残留：`as unknown`（P2）、flush/防抖失败文案不区分（P3）、**防抖核心路径无直接测试（P4）**。
- **本测试即该「防抖核心路径无直接测试」缺口的补测**（ADR-204 L1 分层：node 环境零 DOM 直接单测），与 env-bridge 集成测试（`set-env-state.int.test.ts` / `time-of-day.int.test.ts`，L2）形成 L1/L2 互补。
- **round-53 同轮兄弟测试 `cel-ground-persist.test.ts`** 覆盖 env-bridge 的 `registerCelGroundCoupling` + `cancelEnvPersistTimer` 耦合（集成层，验证中间态不落盘/最终态重调度）；本测试覆盖 env-persist 模块自身（单元层）。两层互补无重叠；且两文件均硬编码 500ms 防抖延迟（本测试 499/500 边界、cel 测试 `cel-ground-persist.test.ts:82`），防抖延迟变更需同步两文件（见 P3-4）。

---

**亮点：**

- **模块级单例 `DebouncedTimer` 复用 + 统一取消语义**：env/ui 两条链路各自持独立 timer（env-persist.ts:16,62），flush 与 cancel 共享同一 `cancel()` 清理路径（31,43,100），资源释放一致，无 timer 泄漏路径。
- **失败反馈零静默**：三条 catch 路径（flushEnvState 35-38、防抖回调 53-56、flushUIState 107-110）统一 `logWarn` + `feedbackStatus('env.persistFailed', undefined, false)`；`persistEnvState`/`persistUIState` 明确上抛、调用方负责 catch 的职责分层清晰（注释 18-19, 87-88）。
- **reactive Proxy 解引用纪律**：防抖回调与 flush 均以 `{ ...envState }` 普通副本落盘（34,53），规避 JSON.stringify 对 Proxy 枚举不完整（inspiration.md:32 自查锚点落实）。
- **测试 mock 形状与真实导出一致**：`@/core/state` 真实实现即 `export * from './ui-state'`（state.ts:17），mock 的 `uiState`/`setUIPersistCallback` 与 `@/core/config` 的 `envState` 均按真实导出超集建模，符合 frontend/AGENTS.md 2.3 共享超集纪律；`DebouncedTimer` 保持**真实实现**（未 mock），使 fake timers 能真实验证防抖窗口（env-persist.test.ts:58）。
- **防抖窗口边界断言有效**：测试 3 以 `advanceTimersByTimeAsync(499/1)` 精确验证「窗口内未触发 / 到点触发」（env-persist.test.ts:92-97），非笼统 `runAllTimers` 后断言。
- **失败反馈断言精确到参数**：测试 6 断言 `feedbackStatus('env.persistFailed', undefined, false)` 全参数（env-persist.test.ts:125），非仅「被调用」。
- **空载荷短路与 undefined 剔除均有载荷级断言**：测试 4 验证空载荷不调后端、测试 5 直接在真实 payload 对象上断言 `fontFamily` 被剔除且 `scale` 保留（100-116），直击 `_buildUIStatePayload`（65-75）核心逻辑。

---

**风险：**

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | env-persist.test.ts | 2-4（头部声称）、81-87（测试 2） | 头部声称「flushUIState cancel→await 竞态窗口…本文件直接测」，但**无任何用例先 schedule 再 flush/cancel 验证**：测试 2 名「立即刷写并取消挂起防抖」实际未先调度，「取消挂起」从未被行使；防抖到期回调已触发后 in-flight 写与 flush 并发双写也零断言 | 补用例：① `schedulePersistEnvState()` → `flushEnvState()` → `advanceTimers` → 断言防抖不再触发且后端仅一次写入；② 或补「防抖已触发后立即 flush → 两写竞态」断言。若暂不补，至少修正头部声称避免过度承诺 |
| 🟠 P2 | env-persist.test.ts | 54,67 | `schedulePersistUI`（uiState 防抖入口，生产 78-80）被导入但**零覆盖**；`cancelEnvPersistTimer` 仅 beforeEach 重置用（67），无「schedule→cancel→不触发」行为断言。文件宣称测「envState/uiState 防抖持久化」，实际 uiState 调度侧完全空白 | 补 `schedulePersistUI` 防抖窗口用例 + `cancelEnvPersistTimer` 取消行为用例（对称测试 3）；顺带消除未用导入 |
| 🟠 P2 | env-persist.ts | 31-38 / 53-56 / 100-110 | 生产侧并发双写竞态无守卫：防抖回调已触发（timer 已 null）后 `persistEnvState({...envState@T0})` 尚在 `await resolveBackend()`，此时 flush 携**更新快照**写入；若旧写晚于新写落地（Go RPC 到达顺序无保证），旧状态覆盖新状态。窗口窄、频率低，但文件头部声称验证的正是此窗口 | 评估引入 in-flight 写序号（写入前自增 seq，落盘时丢弃过期 seq）或串行化队列；至少将「最后写入者胜」语义在注释中显式声明，避免未来误判 |
| 🟡 P3 | env-persist.test.ts | 100-107 | 测试 4 就地变异共享 `__mocks.uiState`（全部置 undefined）后手动 `Object.assign` 恢复——若断言失败恢复不执行，测试 5（依赖 uiState 原始形状含 `scale`/`fontFamily`）将级联误报；测试间通过共享可变状态隐式耦合 | 改 try/finally 包裹，或在 beforeEach 统一重建 uiState 形状（对齐 `stateMockSuperset` 复位模式），删除测试体内就地变异 |
| 🟡 P3 | env-persist.test.ts | 47,54,58 | 3 处死导入：`beforeEach as _b`（47，与 6 行已导入的 beforeEach 重复，靠 `_` 前缀规避 lint）、`schedulePersistUI`（54）、`DebouncedTimer`（58）。eslint 实测 2 warnings（`/^_/u` 豁免 `_b`）；tsc 因 `noUnusedLocals:false` 不报 | 删除 3 处；`schedulePersistUI` 待补用例后再导入 |
| 🟡 P3 | env-persist.ts:57,79 / env-persist.test.ts:89-98 | 防抖延迟 500ms 魔法数值在生产双处硬编码（57 env / 79 ui），测试 3 硬编码 499/500 镜像，cel-ground-persist.test.ts:82 再镜像一次——改延迟需同步 4 处 | 提取 `const PERSIST_DEBOUNCE_MS = 500` 导出，测试从生产常量取值（`advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS - 1)`），消除漂移面 |
| 🟡 P3 | env-persist.test.ts | 109-116 / 128-132 | `resolveBackend.mock.results[0].value` 模式脆弱：假定每用例恰一次 resolveBackend 调用；若未来用例内多次调度（如防抖重复触发）将取到首个后端对象，断言错位且难排查 | 改为 hoisted 工厂内共享单一 backend 对象（`resolveBackend: vi.fn(() => backend)`），测试经 `backend.SetEnvState` 直接断言，顺带简化 `mockImplementationOnce` 失败注入 |
| 🟢 P4 | env-persist.test.ts | 129 | `persistUIState({ scale: 1.5 } as never)` 冗余类型逃生：`{ scale: 1.5 }` 本就可赋 `Partial<UIState>`（types.ts:449 `scale?: number`），`as never` 无必要且违反 frontend/AGENTS.md「不要新增 any 逃生」精神（测试文件同样适用） | 删除 `as never` |
| 🟢 P4 | env-persist.ts | 22,91 | `as unknown as` 双强转**遗留**（非本轮新增）：2026-08-04 审登记 P2（inspiration.md:36），round-12 复述，至今未修。注释已说明 Go 端 json.Unmarshal 合并语义，且 `app.contract.test.ts` 有契约护栏，实践风险低 | 遗留项建议正式入 buglog/待办跟踪；若 Go 契约漂移（SetEnvState 改完整覆盖语义）此强转会静默吞掉 Partial 语义，需在 `backend.data-chain.test.ts` 侧补 Partial 合并契约断言 |
| 🟢 P4 | env-persist.ts | 118 | `registerSceneAction` 返回的 identity 注销 token 被丢弃（场景 176-183 注释明确契约要求 dispose 时注销）。HMR 重载时新闭包会覆盖旧条目，无实际泄漏，但与 bridge 注销契约不对称 | 模块卸载路径（如有）持有 token；或在注释说明「模块级单例注册，HMR 覆盖即释放」的豁免依据 |
| 🟢 P4 | core/ui-state.ts | 19 | 注释「持久化回调。由 env-bridge.ts 在初始化时注册」已漂移：ADR-148 拆分后实际由 `env-persist.ts:114` 注册 | 注释改指 env-persist.ts |

---

**测试质量评价：**

- **断言有效性（中上）**：防抖窗口 499/1ms 边界断言真实有效；失败反馈断言精确到 `feedbackStatus` 全参数；空载荷与 undefined 剔除均在真实载荷对象上断言，非「只数调用次数」。但**竞态窗口声称未兑现**——文件头部点名的三个目标中，「cancel→await 竞态窗口」实为零覆盖（详见 P2-1），「防抖调度」仅覆盖 env 侧（ui 侧空白，P2-2），「失败反馈」仅覆盖 flushEnvState（ui 侧与防抖回调侧空白）。
- **Mock 合理性（良好）**：mock 模块形状与真实导出一致（state.ts:17 / config 均核实）；`vi.hoisted` + `vi.mock` 工厂符合 frontend/AGENTS.md 2.3 铁律；`DebouncedTimer` 保持真实以支持 fake timers 验证；`registerSceneAction`/`setUIPersistCallback` 模块加载副作用均有桩。唯一不足是 `mock.results[0].value` 的脆性取用模式（P3-6）。
- **边界覆盖（不足）**：无 `it.skip`/`xit`/`.todo`（7 用例全部生效 ✅）；但 cancel→await 竞态、`schedulePersistUI`、`cancelEnvPersistTimer` 行为、`flushUIState` 失败路径、防抖回调失败路径（生产 53-56）五项空白。
- **测试隔离（偏弱）**：测试 4 就地变异共享 mock 状态且恢复不在 `afterEach`（P3-3）；`beforeEach` 仅 `mockClear` + `cancelEnvPersistTimer`，不重建 uiState 形状，隔离依赖测试执行顺序。
- **卫生**：3 处死导入 + 1 处 `as never`（P3-4 / P4-8）；eslint 2 warnings 未达门禁但应清理。
- **验证结果**：`npm run test -- src/__tests__/scene/env-persist.test.ts` → 7/7 通过；lint 0 error/2 warning；`npm run check` 未跑（基线绿，且 `noUnusedLocals:false` 下死导入不构成 check 失败，故不阻塞结论）。

---

**结论条件（通过前应处理）：**
1. 补「cancel→await 竞态窗口」真实用例或修正头部声称（P2-1）；
2. 补 `schedulePersistUI` + `cancelEnvPersistTimer` 行为覆盖（P2-2）；
3. 清理死导入与 `as never`（P3-4 / P4-8）；
4. 测试 4 共享状态变异改 try/finally（P3-3）。

*审核日期：2026-08-15 · 审核员：子代理 round53-env-persist*
