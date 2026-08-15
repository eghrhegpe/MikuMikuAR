# dump-bone-hierarchy — 审核结果（round33 / 第 1 个子代理）

## 头部

- **审核范围**
  - 测试文件：`frontend/src/__tests__/scene/dump-bone-hierarchy.test.ts`（145 行）
  - 被测源码：`frontend/src/scene/motion/bone-override.ts` 的 `dumpBoneHierarchy`（1121-1172 行），核心 IK 推导分支 1148-1158 行；关联约定源 `frontend/src/core/mmd-adapter.ts:251-310`（solveIkNative，-1 哨兵守卫）、`frontend/src/core/types.ts:552-557`（MmdRuntimeBoneExtended）、`frontend/src/core/scene-state.ts:66-68`（focusedModelId 活绑定）
- **测试执行**：`cd frontend && npm run test -- src/__tests__/scene/dump-bone-hierarchy.test.ts` → **4 passed（4.36s）**，无跳过。`npm run check`（tsc 全量）未跑：本审核只读、零改动，且耗时过长，按任务约定跳过并注明。
- **总体结论：⚠️ 有条件通过** — 生产推导逻辑正确、与全仓 WASM 约定同构、测试 4/4 全绿、无类型逃生、无功能级 P1。但有 1 项 P2（ADR-248 编号错位在向新产物扩散，round-18 已标 P2 且部分修复）+ 3 项 P3（测试边界缺口、断言范围、重复模式），处理上述项后转 ✅。

---

## 亮点

- **推导逻辑与全仓单一约定同构**：`hasIkSolver = !!(ikSolver || (typeof ikSolverIndex === 'number' && ikSolverIndex >= 0))`（bone-override.ts:1151）与 `solveIkNative` 的 `ikSolverIndex < 0 → return false` 哨兵守卫（mmd-adapter.ts:287）、feet-adjustment.ts:338 的 `canSolve` 判定完全一致——「负数=无求解器」约定三端落实，无一处漂移。
- **负数哨兵透传而非抹平**：`ikSolverIndex: typeof ikSolverIndex === 'number' ? ikSolverIndex : undefined`（bone-override.ts:1158）忠实保留 -1 原始值供调试，同时 JS 模式输出 `undefined`，契约干净（测试 1 断言 `toBe(-1)` 正验证了这一点）。
- **测试 mock 符合测试卫生铁律**：`vi.mock('@/core/state')` 使用 async `importActual` spread 保留活绑定（frontend/AGENTS.md「async importOriginal spread 禁静态化」规则），未误用静态 `stateMockSuperset`（其头注释明确「async importActual（保留活绑定）…不动」）；mock 目标 `@/core/state` 是 `export * from './scene-state'` 的 barrel（state.ts:14），路径正确。
- **makeBone 最小 mock 形态贴生产判定**：仅保留 dump 读取字段，条件展开（`...(opts.ikSolverIndex !== undefined ? ... : {})`）保证「缺省=undefined 而非 null」，与生产 `typeof === 'number'` 判定语义吻合，避免 null 污染。
- **用例卫生**：`beforeEach` 清 overrideMap 防跨用例污染；每个用例 launch/shutdown 配对（`_getRuntimeBones` 由 stop 置 null）；`for...of` 全节点断言而非抽查。
- **消费者契约完好**：`menus/motion-override-levels.ts:941-945` 对 `dumpBoneHierarchy` 的 null 返回（无模型/无骨骼）有反馈兜底 + 早退，无空引用风险。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | dump-bone-hierarchy.test.ts:2,58 + bone-override.ts:1148 | 测试头注释/describe 标题/生产推导注释标注 `[ADR-248]`，但官方 `docs/adr/adr-248-derived-cache-reference-key.md` 主题是「派生缓存依赖引用键」，与 IK 推导无关；该逻辑的真实依据是 ADR-202（WASM IK 重解，mmd-adapter.ts:252 标注）与 WASM 运行时 -1 哨兵约定。round-18 审计已为此标 P2 且 `logger.ts:7`/`debug-log-panel.ts:3` 已修正为「勿引用 ADR-248」，但 `bone-override.ts:653/657/859/1148` 与本新测试文件仍沿用错误编号——错位在向新产物扩散，溯源断裂 | 按 round-18 先例处置：测试头/describe 与 bone-override.ts:1148 注释改为 `[ADR-202 §六]`（真实决策依据）；或为该约定补立正式 ADR 号后统一更正 |
| 🟡 P3 | dump-bone-hierarchy.test.ts:63-144 | 推导矩阵未全覆盖：① 缺「ikSolver 与 ikSolverIndex 同时存在」用例（任务要求核验的边界，生产 OR 语义下结果应 true）；② `ikSolverIndex=0`（`>= 0` 分界）未测，仅测 3/-1；③ 显式 `ikSolver: null` 未测（makeBone 缺省=undefined，生产对 null/undefined 同判 falsy，风险低） | 补 2 个用例：both-present（断言 hasIkSolver=true、ikSolverIndex 透传 3）、`ikSolverIndex=0` 边界 |
| 🟡 P3 | dump-bone-hierarchy.test.ts（套件范围） | 仅覆盖 IK 推导；`dumpBoneHierarchy` 其余契约字段（parentIndex/childCount/isOverridden/overrideEntry/totalOverridden、空骨骼→null、显式 modelId 优先于 focusedModelId、dump.modelId/timestamp）均未断言。describe 限定「IK 推导」可接受，但层级/覆盖字段回归无防护（如父索引逻辑被改坏该套件不会报） | 在现有用例中顺带断言 parentIndex/childCount（mock 已提供 parentBone/childBones），或补 1 个「覆盖状态 + 空骨骼→null」用例 |
| 🟡 P3 | bone-override.ts:1150,363,704 + feet-adjustment.ts:338 + hand-modules.ts:261 + mmd-adapter.ts:287 | 「WASM ikSolverIndex 非负判定」同一模式在 ≥4 文件 6+ 处重复（内联 `as { ikSolverIndex?: number }` 强转 + `typeof === 'number' && >= 0`），-1 哨兵靠注释口头同步（mmd-adapter.ts:264），无命名常量 | 在 `core/types.ts` 的 `MmdRuntimeBoneExtended` 增加 `ikSolverIndex?: number` 字段（消除全部内联强转），并导出 `hasWasmIk(bone)` 辅助 + `NO_IK_INDEX = -1` 命名常量，各调用点收敛 |
| 🟢 P4 | dump-bone-hierarchy.test.ts:46-52 | 每个 it 新建 `NullEngine`/`Scene` 且从不 dispose，4 用例泄漏 4 套引擎对象（node 环境下无害，但违背资源释放卫生） | `launchBones` 返回 engine/scene，`shutdownBones` 中 `engine.dispose()`/`scene.dispose()` |
| 🟢 P4 | dump-bone-hierarchy.test.ts:41 | `makeBone` 用 `as unknown as IMmdRuntimeBone & MmdRuntimeBoneExtended` 双重断言（测试内可接受），`ikSolver?: object | null` 类型过宽（未体现 `IkSolver` 的 solve 签名） | 用 `Partial<MmdRuntimeBoneExtended> & IMmdRuntimeBone` 或 Pick 收窄类型 |

---

## 测试质量评价

- **断言有效性**：✅ 核心断言真实有效——双模式（JS `ikSolver` / WASM `ikSolverIndex`）与 -1 哨兵均被真实验证：测试 1 同时断言 `hasIkSolver` 布尔值与 `ikSolverIndex` 透传值（-1→false、3→true），测试 2/4 全节点 for...of 断言，测试 3 验证 JS 模式 `ikSolverIndex` 为 undefined 且 `ikSolver` 使 hasIkSolver=true。**无"断言恒真"式空转**。
- **mock 合理性**：✅ 符合卫生铁律（async importActual spread、最小 mock、beforeEach 隔离）；Node 环境 + 真 NullEngine/Scene + 真 motion-pipeline，属集成级验证 wiring（比纯单测重，首用例 656ms 的 Babylon 导入开销可接受，换来对 startBoneOverride/stopBoneOverride 真实生命周期的覆盖）。
- **边界覆盖**：⚠️ 负数（-1）、缺省（undefined）、JS 字段三条主路径齐；缺「两者皆有」「ikSolverIndex=0」「显式 null」三处边界（见 P3）。
- **跳过测试**：✅ 无 `it.skip`/`.todo`/`xit`。
- **测试卫生**：⚠️ 引擎/场景未 dispose（P4）；跨用例状态由 beforeEach + shutdown 配对管理，无泄漏路径。

---

## 附注

- 生产侧 `dumpBoneHierarchy` 本身：`_getRuntimeBones?.()` 空安全、空骨骼→null 早退、`new Map` 索引构建 O(n)、无资源持有、无异常吞没（playbook 九维度中类型安全/异常处理/资源释放/状态流/职责单一均达标）；未发现新增 `as any`/`@ts-ignore`（两处强转为结构性窄化，非逃生通道）。
- ADR-248 编号错位为已知问题（round-18 logger 审计 P2，已部分修复），本次为新扩散点，建议随 round-18 遗留项一并处理。

---

审核日期：2026-08-15
审核员：子代理 round33-dump-bone-hierarchy
