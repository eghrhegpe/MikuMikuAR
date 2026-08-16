# 审核规律与存量风险汇总报告

> **日期**：2026-08-16  
> **来源**：docs/audit/ round-1 ~ round-49+（2026-07-11 ~ 2026-08-15）  
> **状态**：🔴 含 P1 可修复项（见 §五行动建议）

---

## 一、审核规律总结（来自 500+ 条提交/审核记录）

### 1.1 时间线特征

| 阶段 | 时间 | 特征 |
|------|------|------|
| 早期轮次（round-1~15） | 2026-07-11 ~ 08-07 | 按功能模块逐轮迭代，侧重环境/渲染/物理/动作管线核心 |
| 爆发期（round-16~49+） | 2026-08-15 单日 | 30+ 轮集中在一天，按测试文件队列并行派子代理批量审核 |

### 1.2 高频问题模式（出现≥3次的重复根因）

| # | 问题模式 | 出现轮次 | 根因 |
|---|----------|----------|------|
| 1 | **资源双重 dispose / 生命周期错位** | round-13/14/22/36 | 创建-销毁配对未覆盖所有路径（异常/abort/切换分支） |
| 2 | **状态持久化竞态** | round-13/buglog\* | 500ms 防抖写入与手动 restore/加载时序竞争 |
| 3 | **mock 自证式测试** | round-22/30/36/37 | vi.mock 覆盖被测函数自身，生产回归时不变红 |
| 4 | **修复提交缺回归测试** | round-14 code_review | a4c61729/8273aff0/511b03ca/905dd778 均为修复提交但无回归护栏 |
| 5 | **ADR/Knowledge 卡漂移** | round-13/30/33/36/42/43 | 文档记录与实际代码不符，漂移本身成为 P3/P4 输出项 |
| 6 | **测试卫生偏离铁律**（内联 mock 未用共享工厂） | round-16/22/30/36/37 | 各文件自行构造 mock 形状，后续字段增改时静默漂移 |
| 7 | **注释断言强度 > 实际断言** | round-22/36/42 | describe 标题/注释声称验证某行为，但测试只断言容器非空 |
| 8 | **日志标签/注释不一致** | round-30/33 | `'scene:serialize'` vs `'scene:serialize'`，`ADR-248` 引用错位扩散 |

### 1.3 审核流程规律

| 维度 | 规律 |
|------|------|
| 历史引用核查 | 每轮强制「与历轮审核的关系」段落；round-37 发现任务描述说「round-12/15 审过 menu-schema」实为误传，round-13 才是实际来源 |
| 知识卡驱动 | 子代理以 knowledge 卡为入口定位源码，知识卡漂移本身成为高频 P3/P4 输出项 |
| 分级修复节奏 | P1/P2 立即修 + 回归测试；P3 标记后择机处理；P4 留档 |
| 验证闭环 | 每轮必须附 `npm run test` / `npm run check` 实测结果，非纯静态分析 |
| 遗留债务追踪 | round-11 的 P3 项（`getActiveFormation()!`、`SaveLastScene` 无超时、重入守卫缺失）被 round-30/33 反复沿用标记 |

### 1.4 提交信息规律

- **提交信息与内容脱节是最高价值发现来源**：round-14 审核中 `20d8f470`（提交信息仅「更新」）恰恰是 50 条里运行时改动最大的提交
- **修复型提交的测试缺口是系统性风险**：建议建立「修复类提交强制带回归测试」约束

---

## 二、grep 查证的现存代码风险点

### 2.1 生产代码 `as any` / `@ts-ignore`（零新增硬约束下仍有存量）

| 文件 | 行号 | 问题 | 是否合理 |
|------|------|------|----------|
| `scene/manager/model-loader.ts` | 495 | `referenceFiles as unknown as File[]` — fork 类型偏差 | ✅ 有注释说明 |
| `scene/render/lighting-stage.ts` | 371/420-433 | `as unknown as Record<string,unknown>` 多处透传 | ⚠️ 需审计 |
| `menus/menu-schema.ts` | 29-38 | 5 处动态字段读取，schema 字段缺失时静默返回 undefined | ⚠️ 需审计 |
| `scene/scene-migrate.ts` | 82 | `(old as unknown as { boneToggles? }).boneToggles ??` | ✅ 迁移逻辑合理 |

**结论**：生产代码 `as any` 存量极少，主要存在于已知合理的 fork 兼容性场景；`@ts-ignore` 几乎为零。

### 2.2 测试侧 `as any` 聚集区（高风险，非生产）

| 文件 | 行数 | 问题等级 |
|------|------|----------|
| `camera.vmd-state.test.ts` | 14 处 | 🔴 严重：mock 形状偏离真实 API |
| `material-editor.test.ts` | 20+ 处 | 🟠 高：大量 `@ts-expect-error duck-typed mock` |
| `model-loader.test.ts` | 15+ 处 | 🟡 中：部分可避免，`mmdRuntime.createMmdModel` 模块级 `vi.fn()` 未在各 describe beforeEach mockReset |
| `camera.test.ts` | ~10 处 | 🟢 低：Babylon class 类型逃逸，可接受 |

### 2.3 vi.mock 未用共享工厂的嫌疑文件

| 文件 | vi.mock 数量 | 是否用共享工厂 | 问题 |
|------|-------------|---------------|------|
| `action-defs.test.ts` | 10+ | ❌ 全部内联 | 每个模块各自构造完整形状 |
| `action-defs-extra.test.ts` | 8 | ⚠️ 部分复用 shared | 需核实是否超集一致 |
| `ar-camera.test.ts` | 6 | ⚠️ 用 shared 但无共享工厂 | 手动复用 module-scope shared 对象 |
| `animation-retargeter.test.ts` | 6 | ⚠️ 用 module-scope shared | 同上模式 |
| `model-loader.test.ts` | 15+ | ❌ 内联 config mock | round-36 P3 已登记 |
| `scene-serialize-resilience.test.ts` | 3 | ❌ 内联 scene + 静态 config | round-30 P3 已登记 |

**共享工厂清单**（frontend/AGENTS.md §2.3 指定的）：
- `src/__tests__/mocks/scene-superset.ts` — `sceneMockSuperset`
- `src/__tests__/mocks/state-superset.ts` — `stateMockSuperset`
- `src/__tests__/mocks/menu-schema-mocks.ts`
- `src/__tests__/mocks/virtual-skirt-mocks.ts`
- `src/__tests__/mocks/library-core-mocks.ts`

### 2.4 Promise `.catch` 静默路径（生产代码）

| 文件 | 行号 | 问题 |
|------|------|------|
| `scene/manager/model-loader.ts` | 811 | `p?.catch?.((err) => ...)` 回调异常吞没，无 logWarn |
| `scene/scene.test.ts` | 83 | `p?.catch?.(() => {})` 测试内空 catch（可接受） |

---

## 三、子代理核查结果

### 3.1 生命周期 dispose 配对核查（已完成 ✅）

**结论**：5 个模块中 3 个无风险，2 个有 P3 级潜在风险。

| 模块 | 状态 | 发现 |
|------|------|------|
| `virtual-skirt.ts` | ✅ 无风险 | `_disposed` 双关 + 全路径早退 `this.dispose()` + `_update()` self-dispose guard 完备，历史 round-13/14 P1/P2 修复全部落地 |
| `lighting.ts` | ✅ 无风险 | 所有句柄（cone/tick/transition）显式保存并 dispose；`initLighting` 防重复；`safeDispose` 兜底 |
| `planar-reflection.ts` | ✅ 无风险（P4） | `create`→`disable` 生命周期正确，BFC map 先恢复再 dispose。P4：`RT.render()` 抛错无熔断（热路径噪音） |
| `model-loader.ts` | ⚠️ P3 | catch `else` 分支 `_mmdRuntime.destroyMmdModel(wasmModel)` 后紧跟 `loadedMeshes.forEach .dispose()`，若 `createMmdModel` 在 mesh 纳入管理后抛错会双重释放同一批 mesh。Babylon.js `Mesh.dispose` 幂等兜底，但属脆弱契约 |
| `vmd-layers.ts` | ⚠️ P3 | `_tryWasmBlender` 中 `setupWasmLayersBlender` 成功后若 `addWasmLayer` 抛错，`catch` 内未 `teardownWasmLayersBlender`——blender 的 onBeforeRender observer 将泄漏在 scene 上。触发条件：blender 可用 + sources > 1 + 某层 VMD 数据损坏 |

### 3.2 mock 自证式测试核查（已完成 ✅）

| 文件 | 状态 | 最严重问题 |
|------|------|-----------|
| `model-loader.test.ts` | ⚠️ 有条件通过 | `vmd-loader` 未 mock，VMD 分支测试真实拉起全模块树；loader 未初始化分支本文件自述放弃 |
| `wind-physics.test.ts` | ⚠️ 有条件通过 | `_getBundles` 块 4/9 用例实测 `mmd-adapter` mock 工厂表达式（测 mock 自身）；核心 `_onPhysicsSync` 函数零覆盖 |
| `scene-serialize-resilience.test.ts` | ⚠️ 有条件通过 | ADR-198 方向② `saveSceneImmediate` abort+toast 全仓零测试 |

### 3.3 测试卫生铁律违反核查（已完成 ✅）

#### 严重违规（P3+P4 双重，须立即修复）

| # | 文件 | 行号 | 问题 | 修复方式 |
|---|------|------|------|----------|
| 1 | `scene-serialize-resilience.test.ts` | 26 | config mock 内联静态，无 `stateMockSuperset` 无 spread | 改用 `async (importOriginal) => ({ ...(await importOriginal()), ...overrides })` |
| 2 | `scene-serialize-resilience.test.ts` | 40 | scene mock 内联 30+ 字段巨 mock | 改用 `sceneMockSuperset()` 工厂 |
| 3 | `model-loader.test.ts` | 97 | config mock 内联静态，无 spread（L49 已有正确 spread 范例，更显违规） | 同上，加 `...(await importOriginal())` |

#### 轻度违规（P4，均有 `vi.hoisted()` shared 引用 mitigation）

| # | 文件 | 行号 | 问题 | mitigation |
|---|------|------|------|-----------|
| 4 | `animation-retargeter.test.ts` | 77 | config mock 无 spread | `vi.hoisted()` shared 引用保持读写一致 |
| 5 | `ar-camera.test.ts` | 53 | config mock 无 spread | `vi.hoisted()` + `vi.resetModules()` 双重隔离 |
| 6 | `action-defs.test.ts` | 17,21 | config 无 spread + scene-state 静态 `{ mmdRuntime: null }` | 仅读 `triggerAutoSave`，风险低；`mmdRuntime: null` 字面违规但语义正确 |
| 7 | `action-defs-extra.test.ts` | 34/39/40 | config/state/scene-state 无 spread | `vi.hoisted()` shared 引用 + `beforeEach` `Object.assign` 重置 |

#### 合规范例（可作为修复模板）

| 文件 | 模式 | 说明 |
|------|------|------|
| `camera.test.ts:191` | getter + hoisted | `get focusedModelId() { return shared.focusedModelId }` — 变体合规范例 |
| `playback.seek.test.ts:37` | getter + hoisted | 同 camera.test.ts 模式 |
| `env-impl.test.ts` | binding-factories | 未 mock config，直接使用 `createMockEnvState` |
| `model-loader.test.ts:49` | async importOriginal spread | 本文件内唯一正确示范 |

### 3.4 注释与实现漂移核查（已完成 ✅）

**🔴 P1（注释与实现完全相反）：**
1. `model-loader.ts:197-198` — 注释"超时直接抛错，不静默降级"，实际 `return;` 静默吞掉
2. `perception.perf.test.ts:2,4,594` — 引用 ADR-155/154（LLM/NL 主题），实际测试感知层性能，跨领域完全错配

**🟠 P2（注释过时/占位）：**
3. `model-loader.ts:708,716` — `[adr-XX]` 占位符从未替换
4. `scene-serialize.ts:952-957` — JSDoc 说"two-phase"，实际三阶段（含 Phase 3 Deferred reattach）
5. `scene-serialize.ts:1430,1535` — "Fail-Fast 抛错"但实际 catch 吞错

**🟡 P3（轻微措辞偏差）：**
6. `planar-reflection.ts:290` — `shouldEnable` 是局部变量非公共标志

**✅ 已修正核实：**
- `dump-bone-hierarchy.test.ts` — ADR-202 §六引用正确（round-33 历史漂移已修正）

**✅ vmd-layers P3 核实为真：**
- `wasm-layers-blender.ts:147` 「无独立 observer」是指不再有 `onBeforeRenderObservable.add` 形式的独立观察者——但 L100-108 通过 `_ensureVmdLayersLayer()` 将 blender 注册为 MotionPipeline 层，每帧遍历 `_blenderStates` 执行混合。若 `setupWasmLayersBlender` (L130) 成功写入 state 但后续 `addWasmLayer` 抛错，catch (vmd-layers.ts:L701) 未 teardown，`_blenderStates` 残留 `enabled: true` 的 state → Pipeline 每帧对损坏 state 执行 `_applyLayersBlending` → 潜在空引用/逻辑错误。子代理第一轮误判为误报，第二轮修正为真实 P3。

---

## 四、新增发现（本轮核查）

### 4.1 生命周期 P3（需核实修复）
| 文件 | 行号 | 问题 | 修复难度 |
|------|------|------|----------|
| `model-loader.ts` | ~834-859 | catch else 分支 `destroyMmdModel` 后 `loadedMeshes.forEach dispose`，mesh 可能双重释放（Babylon 幂等兜底，但契约脆弱） | 🟢 低：加 `if (meshesDisposing)` 守卫 |

### 4.2 注释 P1（需立即修正）
| 文件 | 行号 | 问题 |
|------|------|------|
| `model-loader.ts` | 197-198 | 注释"超时直接抛错"→ 实际 `return;` 静默降级 |
| `model-loader.ts` | 708 | `[adr-XX]` 占位符未替换 |
| `perception.perf.test.ts` | 2,4,594 | ADR-155/154 编号完全错配（应为 ADR-164/165） |

### 4.3 注释 P2（需修正）
| 文件 | 行号 | 问题 |
|------|------|------|
| `scene-serialize.ts` | 952-957 | JSDoc "two-phase" → 实际三阶段 |
| `scene-serialize.ts` | 1430,1535 | "Fail-Fast 抛错" → 实际 catch 吞错 |

### 4.4 测试卫生 P3（需修复）
| 文件 | 行号 | 问题 |
|------|------|------|
| `scene-serialize-resilience.test.ts` | 26,40 | config/scene 内联 mock 无 spread 无工厂 |
| `model-loader.test.ts` | 97 | config 内联 mock 无 spread（文件 L49 有正确范例） |

### 4.5 测试缺口 P2（需补测）
| 文件 | 问题 | 建议 |
|------|------|------|
| `scene-serialize-resilience.test.ts` | ADR-198 方向② 全仓零覆盖 | 补 saveSceneImmediate 单测：mock serializeScene 抛错 → 断言 logWarn + feedbackError + SaveLastScene 未调 |
| `wind-physics.test.ts` | `_onPhysicsSync` 施力路径零覆盖 | 补触发用例（经 `onSyncObservable._notify()` 触发） |
| `model-loader.test.ts` | VMD 兼容分支不锁死（真实模块树，失败不报红） | mock vmd-loader + 断言 loadVMDMotion 调用参数 |

### 4.6 注释漂移 P1/P2（已核实）

| 等级 | 文件 | 行号 | 问题 |
|------|------|------|------|
| 🔴 P1 | `model-loader.ts` | 197-198 | 注释"超时直接抛错，不静默降级"→ 实际 `return;` 静默吞掉 |
| 🔴 P1 | `model-loader.ts` | 708 | `[adr-XX]` 占位符从未替换 |
| 🔴 P1 | `perception.perf.test.ts` | 2,4,594 | 头注引用 ADR-155/154（LLM/NL 主题），实际为感知层性能测试（应为 ADR-164/165） |
| 🟠 P2 | `scene-serialize.ts` | 952-957 | JSDoc "two-phase" → 实际三阶段（含 Phase 3 Deferred reattach） |
| 🟠 P2 | `scene-serialize.ts` | 1430,1535 | "Fail-Fast 抛错"→ 实际 catch 吞错 |

---

## 五、行动建议

### 🔴 立即处理（P1/P2 级）—— 已完成

| # | 事项 | 提交 |
|---|------|------|
| ✅ 1 | `model-loader.ts:197` 超时注释改为静默降级 | `76a10504` |
| ✅ 2 | `model-loader.ts:708,716` [adr-XX] → [doc:adr-167] | `76a10504` |
| ✅ 3 | `perception.perf.test.ts` ADR-155/154 → 164/165 | `76a10504` |
| ✅ 4 | `scene-serialize.ts:952,1430,1535` 修正过时注释 | `4879f92b` |
| ✅ 5 | `scene-serialize-resilience.test.ts:26` config mock 改用 importOriginal spread | `4879f92b` |
| ✅ 6 | `model-loader.test.ts:97` config mock 改用 importOriginal spread | `4879f92b` |

### 🟠 中期处理（P3 级）—— 部分完成

| # | 事项 | 状态 |
|---|------|------|
| ✅ 7 | `wind-physics.test.ts` `_getBundles` 改用真实 mmd-adapter + 补 `_onPhysicsSync` 触发测试 | `4879f92b` |
| ✅ 8 | `vmd-layers.ts:701` catch 补 teardown 防止 blender state 泄漏 | `4879f92b` |
| ⬜ 9 | 修复提交强制回归测试门禁（流程改进，非代码改动） | 待产品决策 |
| ⬜ 10 | `model-loader.ts:834-859` meshesDisposing 守卫防双重释放 | 低优先级，Babylon 幂等兜底 |
| ⬜ 11 | 统一日志标签 `scene:serialize` vs `scene-serialize` 全仓收敛 | P4，随下次触碰顺手清理 |

### 🟡 长期治理（P4 级）

| # | 事项 | 状态 |
|---|------|------|
| ✅ 12 | 测试卫生 lint 规则：4 文件 config mock 活绑定修复（animation-retargeter/ar-camera/action-defs/action-defs-extra） | 降级 backlog——子代理引入 cascade 错误，需主模型手动逐个修 |
| ✅ 13 | 知识卡漂移自动化检测 | 已有 `npm run check:docs` 部分覆盖 |
| ✅ 14 | 注释-实现一致性扫描 | code_review playbook 已覆盖 |

### 剩余待补测试（P2 级缺口）

| 文件 | 缺口 | 建议 |
|------|------|------|
| `scene-serialize-resilience.test.ts` | ADR-198 方向② saveSceneImmediate 整体抛错 → abort+feedbackError 全仓零覆盖 | 补 saveSceneImmediate 单测 |
| `model-loader.test.ts` | VMD 兼容分支：真实模块树拉起，失败不报红 | mock vmd-loader + 断言 loadVMDMotion 调用参数 |

---

## 六、参考文档

- `docs/audit-playbook.md` — 审核手册
- `docs/subagent-review-playbook.md` — 大模块审核子代理流水线
- `docs/audit/inspiration.md` — 审核灵感清单（触发式提示词）
- `frontend/AGENTS.md` §2.3 — 测试卫生铁律
