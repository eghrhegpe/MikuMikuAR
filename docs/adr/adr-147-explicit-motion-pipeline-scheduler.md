# ADR-147: 动作管线显式调度器 + 集中骨骼覆盖状态

> **状态**: 实施中（Phase 1+2 内核切片已落地，待与 motion-modules 写者协调后接入运行时）
> **背景**: 用户反馈骨骼修改系统「设计让人头晕、难排查、后面 AI 改了连带前面代码出问题」。经实地查证（见 2026-07-20 骨骼修改链路审计），根因是**管线顺序靠注册时序隐式决定、骨骼写入状态分散在三个数据结构**。同一时段出现第二个 AI 并发提交 `motion-modules/*`（7f0c1a18），证实多写者互相踩的现实风险已发生。本 ADR 在已落地的缓解措施（D 测试护栏 + B 冲突可视化）之上，给出根因级修复设计。
> **范围**: 新增 `MotionPipeline` 显式调度器（治理注册时序隐式定序）+ 可选 `BoneOverrideStore` 集中状态（治理三套作用域副本）。**本 ADR 仅为设计立项，不修改任何 `scene/motion/*` 运行时源码**，待协调后按 Phase 实施。

---

## 一、问题陈述（用户原话三痛点）

1. **设计让人头晕**：没有「管线调度器」，6 个骨骼写入层的顺序靠 `import` 顺序 + `await` 调用顺序 + `onBeforeRenderObservable` 注册顺序三层隐式耦合决定。
2. **难排查**：骨骼抢占只在 `console.warn` 一闪而过；覆写关系跨父骨传播（`_propagateChildrenWasm`），单看子骨 slot 推不出最终姿态；作用域切换（`setTargetModel`）静默跳过会导致「切模型后模块全失效」。
3. **后面 AI 改了连带前面崩**：5 条已定位的真实回归路径（详见 §三）。

---

## 二、实测根因（2026-07-20 审计，file:line 已核对）

| # | 根因 | 实测证据 |
|---|------|---------|
| R1 | **双观察者隐式定序，无显式 order 声明** | bone-override（`scene.ts:515` 启动期注册）与 perception（`scene.ts:423` `onModelFocused→activateGazeTracking→activatePerception` 模型聚焦时注册）是**两个独立 `onBeforeRenderObservable` 观察者**，Babylon 按注册先后执行。覆写关系全靠「谁先被 import/调用」，编译器/单测无感知 |
| R2 | **帧钩子插入序决定同骨获胜者** | `_runFrameHooks`（`bone-override.ts:386`）按 `_frameHooks` **插入顺序**遍历，且在 slot 应用（`:496`）**之前**运行（`:478`）。sway/riding/hand-symmetry 中后注册者对同骨盖过先注册者、也盖过静态 `setBoneOverride` |
| R3 | **三套作用域副本，状态同步靠手维护** | 引擎层 `_overrideMaps`（per-model）+ 模块层 `intent.motionModules`（per-motion，ADR-129）+ 模块运行时 `_ownedBones`（per-model）三套结构各有副本，靠 `module-base.ts` 的 `setParam`/`enable`/`disable` 手动同步 |
| R4 | **复合语义跨骨传播，对单测不友好** | `_computeOverride`（`bone-override.ts:166`）`weight≥1` 时 `oldRotation × slot.quat`；现有单测 `oldRotation` 恒为 `Identity`，复合分支从未被真实父骨旋转触发（已通过 D 护栏补 4 例 + R4 Slerp 边界 3 例修复，file 现 13 例） |

---

## 三、已落地的缓解（治标，非根治）

| 措施 | 内容 | 局限 |
|------|------|------|
| **D 测试护栏** | `bone-override.test.ts` 补 4 例父骨传播用例，锁死 `_computeOverride` 复合语义，挡住路径 P2 | 仅护住 `weight≥1` 复合分支；不防 R1/R2/R3 |
| **B 冲突可视化** | `registry.ts` 新增 `_boneConflicts` 结构化记录 + `motion-override-levels.ts` 模块卡片顶部 banner 渲染 `getAllConflicts` 快照 | 仅让冲突「看得见」；不防注册时序翻转、不防帧钩子顺序、不防作用域副本漂移 |

**结论**：D+B 降低排查难度，但管线顺序仍隐式、状态仍三分，R1/R2/R3 未解，后面 AI 改时序/优先级/帧钩子仍会连锁前面崩。

---

## 四、5 条真实回归路径（后面 AI 一改 → 前面崩）

| # | 改动点（file:line） | 连锁后果 |
|---|---------------------|---------|
| P1 | perception 注册时机（`scene.ts:423`） | 覆写关系翻转，呼吸/眨眼失效 |
| P2 | `_computeOverride` 复合语义（`bone-override.ts:166`） | 所有旧模块 bake 姿态变化（**已于 2026-07-17 真实发生过**） |
| P3 | `priority` 数值（`registry.ts:179` `myPriority < otherPriority`） | 仲裁结果翻转，姿态错乱 |
| P4 | `claimBones` 仲裁规则（`registry.ts:149-202`） | `ownedBones` 语义变，disable 清错骨 |
| P5 | 帧钩子顺序/注册（`bone-override.ts:386`/`:478`） | 帧钩子模块「看起来没生效」 |

---

## 五、方案 A：显式管线调度器（推荐，Phase 1）

新建 `scene/motion/motion-pipeline.ts`，所有骨骼写入层**显式注册**并声明 `stage` 序号，调度器按序统一执行，注册时序与 import/await 顺序解耦。

```ts
// 概念接口（非最终实现）
type PipelineStage =
  | 'vmd-base'        // ①
  | 'vmd-layers'      // ②
  | 'proc-motion'     // ③
  | 'bone-override'   // ⑤ 引擎
  | 'module-bake'     // ⑤a 模块层 bake → _overrideMap
  | 'frame-hooks'     // ⑤b 帧钩子（内部再按注册序）
  | 'perception';     // ⑥

interface PipelineLayer {
  stage: PipelineStage;
  order: number;            // 同 stage 内的细粒度序
  run(ctx: FrameContext): void;
}

class MotionPipeline {
  register(layer: PipelineLayer): () => void;  // 返回 unregister
  runFrame(scene: Scene): void;                // 按 (stage, order) 升序执行
}
```

**收益**：
- R1 根治：覆写关系由 `stage` 声明决定，不再依赖 `scene.ts` 的 import/await 顺序。
- R2 收敛：`frame-hooks` 作为独立 stage，其内顺序显式可查；sway/riding/hand-symmetry 的竞争转为同 stage 内的 `order` 声明。
- P1/P5 路径被显式 stage 拦截：任何层改注册时机都必须在调度器登记，不再「悄悄」翻转。

**迁移步骤**：
1. 提取 `bone-override.ts` / `perception.ts` / `vmd-layers.ts` / `proc-motion-bridge.ts` 的每帧回调为 `PipelineLayer`。
2. `scene.ts` 改为 `pipeline.register(...)` 替代裸 `onBeforeRenderObservable.add`。
3. 保留 ADR-116 §一 的 6 层顺序作为 `stage` 常量，旧隐式顺序升级为显式契约。
4. 旧 `onBeforeRenderObservable` 路径保留一个 release 过渡期（双写比对）。

---

## 六、方案 E：集中骨骼覆盖状态（Phase 2，可选但推荐）

将 R3 的三套副本合并为单一 `BoneOverrideStore`：

```ts
class BoneOverrideStore {
  // 合并 _overrideMaps + intent.motionModules + _ownedBones
  setOverride(modelId, bone, entry): void;
  claimBones(modelId, moduleId, bones, priority): ConflictResult;
  release(modelId, moduleId): void;
  getConflicts(modelId): BoneConflict[];   // 复用 B 的 _boneConflicts 语义
  snapshot(modelId): ReadonlyState;
}
```

**收益**：R3 根治——状态来源唯一，模块开关/切模型/disable 全部走统一 API，消除「手动同步三副本」的漂移隐患；B 的冲突记录可直接迁入 store，UI 零改动。

**代价**：改动面大于 A，需同步迁移 `registry.ts` / `module-base.ts` / `motion-intent.ts` 三处读写。

---

## 七、多写者并发风险（本 ADR 的现实触发点）

审计期间观测到第二个 AI 并发提交 `motion-modules/*`（7f0c1a18 `getModuleMeta/inspectModule`）。若本 ADR 的 A/E 在**未协调**情况下直接改 `registry.ts`/`bone-override.ts`，将与对方改动形成冲突合并，正是 P3/P4 路径的活体版。

**约束（遵循多写者纪律）**：
- 本 ADR 立项阶段**只写文档**，不碰运行时源码。
- 实施阶段前，先与 `motion-modules/*` 的写者对齐文件认领边界（建议各自 worktree / 分支 + 认领注册表）。
- A 方案优先于 E：A 改动集中在新增 `motion-pipeline.ts` + `scene.ts` 注册点，与模块层源码冲突面最小。

---

## 八、实施阶段

| Phase | 内容 | 依赖 | 验收 |
|-------|------|------|------|
| **Phase 1** | 方案 A：`MotionPipeline` 调度器 + `scene.ts` 注册迁移 | 无 | 6 层顺序可由 stage 常量声明；单测验证 stage 序；现有 44 例 motion 单测全绿 |
| **Phase 2** | 方案 E：`BoneOverrideStore` 合并三副本 | Phase 1 | `grep` 确认 `_overrideMaps`/`intent.motionModules`/`_ownedBones` 仅 store 持有；B banner 迁移到 store API |
| **Phase 3** | 去隐式依赖：移除旧 `onBeforeRenderObservable` 双写路径 + 帧钩子裸注册 | Phase 1+2 | 全场景（含切模型/聚焦/disable）覆写关系稳定，无 console.warn 冲突残留 |

### 实施进度（2026-07-20）

| 切片 | 提交 | 状态 | 说明 |
|------|------|------|------|
| Phase 1 切片 1：`MotionPipeline` 内核 + 排序单测 | `5d7a63bd` | ✅ 已落地 | 新文件 `motion-pipeline.ts`，4 例单测锁死「序由 (stage,order) 决定、与注册序无关」。未接入 `scene.ts`（step 2 待协调） |
| Phase 2 切片 1：`BoneOverrideStore` 内核 + 不变量单测 | `b594a03f` | ✅ 已落地 | 新文件 `bone-override-store.ts`，合并三副本为单一内部存储；6 例单测锁死「disable/release 级联清 slot、抢占记冲突、model 隔离」。未接入运行时（step 2 待协调） |
| Phase 1 step 2：`scene.ts` 注册迁移 | — | ⏸ 阻塞 | 需改 `scene.ts`/`bone-override.ts`，与并发写者冲突面最大，先协调 |
| Phase 2 step 2：运行时接入 | — | ⏸ 阻塞 | 需迁移 `registry.ts`/`module-base.ts`/`motion-intent.ts` 三处读写，先协调 |

---

## 九、验收标准

1. **顺序确定性**：任何层的注册/导入顺序调整，不再改变同帧最终覆写结果（由 stage 契约保证）。
2. **状态单一源**：骨骼覆盖状态仅存于 `BoneOverrideStore`（Phase 2 后）。
3. **冲突可观测**：B banner 持续可用，且冲突来源可追溯至具体 `stage`/`moduleId`。
4. **回归护栏**：D 父骨传播单测 + 新增 pipeline 序单测共同拦截 P1–P5。
5. **零行为回归**：1557+ 单测全绿，VMD/图层/程序化/模块层/感知层六级行为与原生一致。

---

## 十、关联

- ADR-116（动作覆盖双层架构，§一定义 6 层管线顺序 — 本 ADR 的 stage 常量来源）
- ADR-129（模块配置 per-motion 迁移 — R3 三副本之一）
- ADR-122 / ADR-123（IK 感知覆盖 / compute override 语义 — 与 P2 复合语义相关，待其落地后本 ADR Phase 1 需对齐）
- 缓解措施：D（父骨传播单测护栏）、B（冲突可视化 banner）
