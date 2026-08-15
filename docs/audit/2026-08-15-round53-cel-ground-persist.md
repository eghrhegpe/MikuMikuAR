# cel-shading 地面哑光临时切换持久化 — 审核结果（round-53）

**审核范围：**
- 测试文件：`frontend/src/__tests__/env-bridge/cel-ground-persist.test.ts`（93 行，全量）
- 被测源码：`frontend/src/scene/env/_bridge/env-bridge.ts:479-496`（registerCelGroundCoupling 回调）、`frontend/src/scene/env/_bridge/env-persist.ts:42-58`（cancelEnvPersistTimer / schedulePersistEnvState）、`frontend/src/scene/render/renderer.ts:102-108`（注册口）
- 关联链路（只读核查，非主审对象）：`scene-serialize.ts:1451-1479`（visibilitychange/beforeunload flush 路径）、`env-bridge.ts:461-474`（resetGroundPresetOnManualEdit middleware）、`core/async.ts:109-138`（DebouncedTimer）

**总体结论：⚠️ 有条件通过**

修复本身（07856c8f）实现正确：schedule→cancel 顺序无误、`pbr=false` 守卫合理、关闭时恢复最终态重新调度，测试 3/3 通过（实测 `npm run test -- src/__tests__/env-bridge/cel-ground-persist.test.ts`，7ms）。但有条件：① 测试核心断言（用例 1）不具备回归判别力——整体套件在删除 `cancelEnvPersistTimer()` 后仍全绿；② 生产侧存在残余漏洞——cel 激活期间退出/最小化应用时，`flushEnvState` 仍会把临时中间态写回后端，修复声明想防的场景只防住了防抖路径。

**与既往审核关系：**
- round-12（`docs/audit/2026-08-06-round12-env-motion-core-ai.md:74`）曾flag「cel 激活期间用户改 env 字段会重新持久化临时态」→ 由 `07856c8f`（2026-08-04）修复并配套本测试文件。
- round-53 env-persist 专项（本轮并行测试 1）审 `env-persist.ts` 本体；本测试（测试 3）审 cel 耦合对 `cancelEnvPersistTimer` 的使用。两者共用接缝：env-persist.ts:42-44 的取消实现（本测试经 globalThis 计时器 spy 黑盒验证）、500ms 防抖契约（本测试用例 2 与 set-env-state.int.test.ts:98/131 双重钉死）。覆盖互补：env-persist.test.ts 直测 cancel 函数，本测试验证「调用时机与顺序」——但见 P2-①，时机断言力度不足。

**亮点：**
- `env-bridge.ts:489-490` — schedule→cancel 顺序正确：先 `setEnvState`（内部 finally 必调度 500ms 防抖），再 `cancelEnvPersistTimer()` 取消，不会出现「取消后被重新调度」的竞态。
- `env-bridge.ts:487-491` — `if (_celGroundSnapshot.pbr)` 守卫：原始即 false 时不写不取消，避免无意义写入（测试用例 3 精准覆盖）。
- `env-bridge.ts:492-495` — 关闭时恢复快照原值并交给 setEnvState 重新调度，最终态必然落盘；快照读取实时 `envState.groundPbrEnabled`，无缓存陈旧问题。
- `core/async.ts:113-127` — DebouncedTimer 的 schedule 先 cancel 再设新定时器，`cancel()` 幂等；耦合复用同一实例，无自建定时器泄漏。
- 测试 `cel-ground-persist.test.ts:56` — 经 `h.registerCelGroundCoupling.mock.calls[0]?.[0]` 捕获模块加载时注册的回调，测试驱动真实 `setEnvState` 入口而非直接改 envState（头部注释明示约束，符合 frontend/AGENTS.md 的 vi.mock 工厂 hoisted 绑定规则）。
- 测试用例 2（:76-83）判别力合格：mockClear 后 cel 关闭，断言 `setTimeout(anyFn, 500)`，删除恢复分支即失败。

**风险表：**

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | `src/__tests__/env-bridge/cel-ground-persist.test.ts` | :68-74（用例 1） | 核心断言 `expect(clearTimeout).toHaveBeenCalled()` 无判别力：`DebouncedTimer.schedule` 内部先 cancel 再重设（async.ts:114），首条 setEnvState 已挂起定时器时，schedule 自身的 clearTimeout 即满足断言——删除 `cancelEnvPersistTimer()` 回归后本用例仍通过；且用例 2/3 与取消无关，**整套测试对「修复行」零守卫** | 改为判别性断言：捕获最后一次 `setTimeout` 返回句柄，断言 `clearTimeout` 以该句柄被调用（`const h = vi.mocked(setTimeout).mock.results.at(-1)!.value; expect(clearTimeout).toHaveBeenCalledWith(h)`）；并断言激活后防抖队列为空（如 `expect(setTimeout).toHaveBeenCalledTimes(2)` + clearTimeout 次数） |
| 🟠 P2 | `scene/env/_bridge/env-bridge.ts` :485-496 × `scene/scene-serialize.ts`:1459 | cel 激活期间退出/最小化 | 修复声明「用户在 cel 激活期间退出会把临时值当最终态持久化」只防住了 500ms 防抖路径：`cleanupAndFlushSave` 在 visibilitychange(hidden)/beforeunload 时无条件 `void flushEnvState()`，而 flushEnvState 持久化当前完整 envState（含临时 `groundPbrEnabled=false`）；`disposeRenderer` 仅置空 `_celGroundCoupling`（renderer.ts:176）不触发恢复回调。cel 开着退出 → 临时值永久落盘，下次启动地面保持哑光 | 在耦合注册处挂 visibilitychange(hidden) 监听：cel 激活期间 hidden 时先恢复快照再 flush（或让 flushEnvState 感知 cel 快照跳过临时字段）；至少应在 coupling 注释/ADR 中如实声明该残余窗口 |
| 🟡 P3 | `scene/env/_bridge/env-bridge.ts` :468 × :485-496 | resetGroundPresetOnManualEdit 与 cel 耦合交互 | `groundPbrEnabled ∈ GROUND_PRESET_KEYS`（env-ground-presets.ts:322），cel 临时切换走 setEnvState 会触发「手动微调脱离预设」中间件：激活即把当前 groundPreset（如 'polished'）静默置为 'custom' 并随最终态持久化——临时覆盖却永久丢失预设关联；cel 关闭恢复了数值但恢复不了关联 | 耦合分支先快照 groundPreset，关闭时一并恢复；或给 setEnvState 增加「临时态」旁路（如 ctx 标记跳过 preset 中间件）；本测试 mock 的 envState 无 groundPreset 字段，此交互零覆盖 |
| 🟡 P3 | `scene/env/_bridge/env-bridge.ts` :484 | HMR 重入 | `_celGroundSnapshot` 为模块级变量，env-bridge 热更新重执行即归 null；若 cel 正处于激活态，renderer 仅在切换沿触发回调（renderer.ts:517-527），不会补发 true → 关闭时 `else if (_celGroundSnapshot)` 不成立，临时 false 不再恢复并会落盘（dev-only，但同模块中间件已按 HMR 场景做过去重兜底，此处无兜底） | 与 registerEnvStateMiddleware 的 HMR 去重思路对齐：将快照移入 renderer 侧持有，或 HMR 时经 `_celGroundCoupling?.(true)` 补发一次激活态 |
| 🟡 P3 | `src/__tests__/env-bridge/cel-ground-persist.test.ts` | :11-93 | 「中间态不落盘」仅以计时器级证据背书：`mockSetEnvState`（backend mock）全程无断言、未用 fake timers 推进 500ms，无法证明中间态不达后端；删除 cancel 后测试也发现不了（叠加 P2-①） | 用例 1 用 `vi.useFakeTimers()` + `advanceTimersByTime(500)` 后断言 `mockSetEnvState` 未被以 `groundPbrEnabled:false` 调用；用例 2 推进后断言后端收到恢复值 |
| 🟢 P4 | `scene/env/_bridge/env-persist.ts` :57,79（+ 本测试 :82） | 500 魔法数值 | 防抖 500ms 在 schedulePersistEnvState/schedulePersistUI 各硬编码一次，测试再钉死一次；改延迟需同步 3 处 | 导出 `ENV_PERSIST_DEBOUNCE_MS` 常量，生产与测试共用 |
| 🟢 P4 | `scene/env/_bridge/env-bridge.ts` :492-495 | 快照 pbr=false 时关闭 | `else if (_celGroundSnapshot)` 无条件恢复：原始即 false 时关闭会再跑一次 setEnvState + 全量防抖持久化（值未变，冗余写盘 + 中间件空转） | 加值守卫：`if (envState.groundPbrEnabled !== _celGroundSnapshot.pbr)` 才恢复 |
| 🟢 P4 | `docs/adr/adr-114-ground-reflection-enhancement.md` :623 | 文档漂移 | ADR-114 仍描述「快照 groundPbrEnabled/groundContactShadowEnabled 并强制 contact=true」，而 1bf3912b「移除接触阴影」已删除该字段（前端全仓零命中），现实现只处理 pbr | 更新 ADR-114 对应段落，标注接触阴影已移除 |
| 🟢 P4 | `src/__tests__/env-bridge/cel-ground-persist.test.ts` | :13-22, :76-83 | 细节：vi.hoisted 的 `s.called` 计数从未断言（死代码）；用例 2 只断言重新调度、未断言恢复后的 `envState.groundPbrEnabled===true`；头部注释「不得 import './env-mocks'」与工厂内 `await import('./env-mocks')` 字面矛盾（实际约束是不在顶层/用例体内 import 断言句柄） | 删除 s.called；用例 2 补 `expect(envState.groundPbrEnabled).toBe(true)`（经 configModule 导入）；注释措辞改为「不得顶层 import 断言句柄」 |

**测试质量评价：**

- **结构与约定**：93 行小文件，`@vitest-environment node` 标注正确；10 连 vi.mock 走共享 `env-mocks` 工厂（ADR-204 模式），renderer 单独定制 mock（仅暴露 `registerCelGroundCoupling`，与 env-bridge.ts:24 唯一导入一致）；vi.mock 工厂仅引用 hoisted 绑定 `h`，符合 frontend/AGENTS.md 铁律；无跳过测试（无 `it.skip`/`describe.skip`）。
- **分支覆盖**：生产耦合块 3 个分支（激活+pbr / 激活+!pbr / 关闭+快照）被 3 个用例逐一命中，结构覆盖完整；缺失：关闭时快照 pbr=false 分支、快速连续切换（on/off/on 幂等）、flush 路径交互。
- **断言有效性**：用例 2、3 有效且具判别力；用例 1 为「伪断言」（见 P2-①）——这是本测试最大的质量缺口，套件实际未锁定修复行。
- **Mock 合理性**：用 globalThis setTimeout/clearTimeout spy + call-through 黑盒验证 DebouncedTimer 行为，不 mock 计时器本体，避免了「mock 掉被测逻辑」的假阳性；backend 经 makeMockBackend 桩化但未被断言（见 P3-⑤）。
- **93 行充分性**：对 20 行生产逻辑而言结构覆盖达标、文档注释清晰；但「回归守卫」与「端到端不落盘」两条主线均未真正锁死，需补 P2-①/P3-⑤ 两类断言后即可称充分。

**验证记录：** `cd frontend && npm run test -- src/__tests__/env-bridge/cel-ground-persist.test.ts` → 3/3 通过（421ms）。`npm run check` 未执行：本审核为只读审计、零代码改动，测试运行已覆盖编译路径；如需全量类型检查由主模型统一跑基线。

**审核日期：** 2026-08-15
**审核员：** 子代理 round53-cel-ground-persist
