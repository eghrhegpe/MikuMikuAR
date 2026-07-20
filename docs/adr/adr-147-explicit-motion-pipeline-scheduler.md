# ADR-147: 动作管线显式调度器 + 集中骨骼覆盖状态

> **状态**: 实施中（R1 双观察者隐式定序已根治、R2 帧钩子插入序已根治；Phase 3 / Phase 2 step 2 运行时接入待协调）
> **背景**: 用户反馈骨骼修改系统「设计让人头晕、难排查、后面 AI 改了连带前面代码出问题」。经实地查证（见 2026-07-20 骨骼修改链路审计），根因是**管线顺序靠注册时序隐式决定、骨骼写入状态分散在三个数据结构**。同一时段出现第二个 AI 并发提交 `motion-modules/*`（7f0c1a18），证实多写者互相踩的现实风险已发生。本 ADR 在已落地的缓解措施（D 测试护栏 + B 冲突可视化）之上，给出根因级修复设计。
> **范围**: 新增 `MotionPipeline` 显式调度器（治理注册时序隐式定序，R1 已根治）+ 帧钩子显式 `order` 排序（R2 已根治）+ 可选 `BoneOverrideStore` 集中状态（治理三套作用域副本，Phase 2 内核已落地）。

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
| R2 ✅ | **帧钩子插入序决定同骨获胜者（已治理）** | 原 `_runFrameHooks`（`bone-override.ts:389`）按 `_frameHooks` **插入顺序**遍历。现改为带 `order` 的数组并按 `order` 升序 + 快照遍历；`registerBoneOverrideFrameHook(hook, order)` 加显式 order，导出 `FRAME_HOOK_ORDER`（RIDING=10/SWAY=20/HAND_SYMMETRY=30）；三模块显式声明权重。同骨获胜者由声明顺序决定，不再依赖注册次序 |
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
| P5 ✅ | 帧钩子顺序/注册（已治理：`registerBoneOverrideFrameHook` 加显式 `order`，等价于 P5 路径被 `order` 声明拦截） | 帧钩子模块「看起来没生效」 → 已消除 |

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
  | 'frame-hooks'     // ⑤b 帧钩子（内部按显式 order 升序）
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

## 六·补 语义迁移映射表（Phase 2 step 2 前置决策）

Phase 2 step 2 把 `registry.claimBones` / `_boneConflicts` / `releaseOwnedBones` 替换为 `BoneOverrideStore` 对应 API。两侧语义存在 **6 处差异**，未对齐即接入会导致 **仲裁翻转 / bake 静默跳过 / 冲突幽灵 / banner 缺卡片** 四类静默回归。本表逐项锁定迁移决策，step 2 实施须逐条对照。

### 表 1：核心语义对照

| # | 维度 | registry 现状 | store 现状 | 迁移决策 | 代码改动点 |
|---|------|--------------|-----------|---------|-----------|
| **M1** | 优先级方向 | `myPriority < otherPriority` → 小=高（registry.ts:204） | 已对齐为 `<`（bone-override-store.ts:124） | ✅ **已锁定一致**，接入零翻转 | 无（P1 已修） |
| **M2** | priority 来源 | `_registry.get(moduleId)?.priority ?? 999`（registry.ts:183-184） | 调用方显式传入（claimBones 第 3 参） | step 2 中 `prepareBake` 显式透传 `mod.priority`；无 priority 的模块按 999（最低）处理 | module-base.ts:235 |
| **M3** | **返回值语义** | 返 `claimed` = 本模块**现拥有**骨（含已拥有+新认领+抢占），不含落败骨（registry.ts:186/228/230） | 当前返 `preempted` = 本模块**从他人抢来**的骨（bone-override-store.ts:147） | 🔴 **须翻转为 `claimed`**，否则 6 个 bake 的 `claimed.includes()` / `claimed.length===0` 判定全部错位（riding-model:77 会误跳过整个 bake） | bone-override-store.ts `claimBones` 返回集 + 单测（bone-override-store.test.ts:29-51）同步改 |
| **M4** | **冲突记录视角** | 双视角：抢占方记「落败方视角」(registry.ts:211) + 落败方记「自身视角」(registry.ts:220)，均 keyed by **loser** | 仅记赢家视角一次（bone-override-store.ts:129-136），落败分支不记录（:137-139） | 🔴 **须补落败方视角**，使 store `getConflicts` 按 loser 分组后与 registry 输出一致（B banner 才能显示「我想抢但被抢」卡片） | bone-override-store.ts `claimBones` 落败分支补 `_recordConflict` |
| **M5** | **释放清冲突** | `releaseOwnedBones` 调 `_clearConflict(modelId, moduleId)` 清该 loser 卡片（registry.ts:296） | `releaseBones` **不清 `_conflicts`**（bone-override-store.ts:150-162），仅 `disposeModel` 清 | 🔴 **须补**：`releaseBones` 末尾清 `loserModuleId===moduleId` 的冲突（对齐 registry，避免幽灵冲突累积） | bone-override-store.ts `releaseBones` |
| **M6** | **setSlot/clearSlot 所有权守卫** | 无公开 setSlot；槽位仅经 claimBones 内部 `clearBoneOverride` 管理，外部无法绕过 | 公开 `setSlot`/`clearSlot` 无守卫，外部可写/清未认领骨的 slot → R3「幽灵 slot」换壳 | 🟠 **须加守卫**：`setSlot` 要求 `slot.sourceModuleId` 已认领该骨，否则 warn+忽略；`clearSlot` 要求调用方持有所有权 | bone-override-store.ts `setSlot`/`clearSlot` |
| **M7** | release 行为差 | `releaseOwnedBones` 只清 ownedBones 记录，**不**清引擎 slot（registry.ts:288 注释明示由调用方负责） | `releaseBones` 额外 `clearSlot`（bone-override-store.ts:157） | step 2 中 store 已合并清 slot，调用方原 `clearBoneOverride` 冗余调用可删（或保留为无害双清，须验证无副作用） | module-base / 各 disable 路径 |
| **M8** | **BoneConflict.stage 字段** | 接口 `BoneConflict{bone,byModule}`，无 stage（registry.ts:240-245） | 接口 `BoneConflict{modelId,bone,loserModuleId,winnerModuleId,loserPriority,winnerPriority}`，无 stage（bone-override-store.ts:43-50） | 🟡 **须补可选 `winnerStage?`/`loserStage?`**，满足 §九 验收 3「冲突来源可追溯至 stage」；经注入 `stageResolver` 或 claimBones 传入 stage 填充 | bone-override-store.ts 接口 + 构造注入 |
| **M9** | **priority=0 哨兵歧义** | 无此问题（priority 始终从 `_registry` 读，claimBones 不经 `_ensureModule`） | `_ensureModule(modelId, moduleId, priority=0)` 的 `else if (priority !== 0)` 守卫，priority=0 合法值却不更新（bone-override-store.ts:210） | 🟡 **重构**：`_ensureModule` 去掉 priority 形参，仅首建置默认；`claimBones` 内 `state.priority = priority` 统一权威写入（M1 已含该写入，保留即可） | bone-override-store.ts `_ensureModule`/`claimBones` |

### 表 2：API 名称 / 签名迁移

| registry API | store 等价 | 迁移说明 |
|--------------|-----------|---------|
| `claimBones(modelId, moduleId, bones)` | `store.claimBones(modelId, moduleId, priority, bones)` | 增 priority 形参（M2）；返回值改 claimed（M3） |
| `releaseOwnedBones(modelId, moduleId)` | `store.releaseBones(modelId, moduleId)` | 行为含清 slot（M7）+ 清冲突（M5） |
| `getOwnedBones(modelId, moduleId)` | `store.getOwnedBones(modelId, moduleId)` | 签名一致 |
| `getModuleConflicts(modelId, moduleId)` | `store.getConflicts(modelId)` 后按 `loserModuleId` 分组 | 形状差异，banner 侧包 `groupByLoser` 适配器（M4） |
| `getAllConflicts(modelId)` | `store.getConflicts(modelId)` | store 已扁平化；banner 分组即可 |
| `getConflictCount(modelId)` | `store.getConflicts(modelId).length` | 直接替代 |
| `clearBoneOverride(bone, modelId)`（引擎级） | `store.clearSlot(modelId, bone)` | store 的 slot 即覆盖；M7 双清须验证 |
| `_boneConflicts` 内部 | `store._conflicts`（私有） | 不再暴露，UI 经 `getConflicts` |

### 表 3：B banner（motion-override-levels.ts）迁移

- 现状：`getAllConflicts(modelId)` 返 `Array<{moduleId, conflicts: BoneConflict[]}>`，按 loser 渲染「⚠ {moduleId}: {bone}←{byModule}」。
- 迁移：`getConflicts(modelId)` 返扁平 `BoneConflict[]`，banner 内须 `groupByLoser(edges)` 还原 `{loserModuleId, edges}` 结构后再渲染；**store 须按 M4 双视角记录**，否则 only-winner 视角会丢「落败方卡片」。
- stage 展示：M8 落地后，卡片可附加 `(loserStage)` / `(winnerStage)` 后缀，满足 §九 验收 3。

### 表 4：调用点清单（step 2 须逐处改造）

| 调用点 | 当前 | step 2 改造 |
|--------|------|------------|
| `module-base.ts:235` `prepareBake` | `claimBones(modelId, moduleId, bones)` | `store.claimBones(modelId, moduleId, mod.priority, bones)`；返回值语义由 M3 保证 |
| `sway-motion.ts:91` | `claimBones(modelId, MODULE_ID, MANAGED_BONES)` | 同上，priority 取 sway 模块 `def.priority` |
| `module-base.ts` disable 路径 | `releaseOwnedBones(...)` | `store.releaseBones(...)`（含清 slot+冲突，M5/M7） |
| `motion-override-levels.ts` `updateConflictBanner` | `getAllConflicts` | `getConflicts` + `groupByLoser` 适配器（M4） |
| 各 bake（body-posture/hand-symmetry/position-offset/riding-model/finger-pose/sway-motion） | `claimed.includes(bone)` / `claimed.length===0` | 依赖 M3（store 返 claimed）即零改；不依赖返回值顺序 |

### 决策状态汇总

| 决策 | 状态 | 接入前必须？ |
|------|------|------------|
| M1 priority 方向 | ✅ 已锁（P1 修） | 已满足 |
| M2 priority 来源 | 决策明确 | 是（prepareBake 透传） |
| M3 返回值翻 claimed | ✅ 已落（store 内部） | 已满足（claimBones 返 claimed，含单测） |
| M4 冲突双视角 | ✅ 已落（store 内部） | 已满足（落败分支补 `_recordConflict` + 去重） |
| M5 releaseBones 清冲突 | ✅ 已落（store 内部） | 已满足（releaseBones 清 loser===moduleId 卡片） |
| M6 setSlot/clearSlot 守卫 | ✅ 已落（store 内部） | 已满足（越权写/清 warn+忽略，含单测） |
| M7 release 清 slot 双清验证 | 决策明确 | 是（验证无害） |
| M8 BoneConflict.stage | ✅ 已落（store 内部） | 已满足（构造注入 `stageOf`，含单测） |
| M9 priority=0 哨兵 | ✅ 已落（store 内部） | 已满足（`_ensureModule` 去 priority 形参，含单测） |

> **结论**：M1 已锁；M2/M7 决策明确；**M3/M4/M5/M6/M8/M9 的 store 内部改动已全部落地（含单测同步，store 单测 12/12 全绿）**。Phase 2 step 2 现可安全推进 runtime 接入（表 4 调用点）：`module-base.ts:235 prepareBake` 与 `sway-motion.ts:91` 改调 `store.claimBones(..., mod.priority, bones)`（M2 透传 + M3 claimed 零改 bake）、disable 路径改 `store.releaseBones`（M5/M7）、`motion-override-levels.ts` 接 `getConflicts` + `groupByLoser` 适配器（M4）。

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
| Phase 1 step 2：接入运行时（bone-override/perception 改为管线层 + 单驱动 observer） | `02c1269e` | ✅ 已落地 | `bone-override.ts` 注册 `'bone-override'` 层 + 单一驱动 observer（每帧 `pipeline.runFrame`）；`perception.ts` 注册 `'perception'` 层（模型聚焦时动态 register）。R1 根治：覆写序由 stage 决定，与注册时序解耦。`scene.ts` 零改动 |
| R2 帧钩子显式 order 排序 | （本提交） | ✅ 已落地 | `bone-override.ts`：`_frameHooks` 由 `Set` 改为带 `order` 数组，按 `order` 升序 + 快照遍历；导出 `FRAME_HOOK_ORDER`；三模块（sway/riding/hand-symmetry）传入显式权重。R2 根治：同骨获胜者由声明顺序决定，不再依赖注册次序。`motion-frame-hooks.test.ts` 4 例锁死 |
| Phase 2 step 2：运行时接入 | （本提交） | ✅ 已落地 | `registry.ts` 改薄 facade 委托 `BoneOverrideStore` 单例（保留旧公开签名 + `{bone,byModule}` 冲突形状，`getModuleConflicts`/`getAllConflicts` 重映射 loser/winner 视角）；`module-base.ts` `disable()` 移除冗余 `clearBoneOverride` 循环（store.releaseBones 已级联清引擎槽，避免双清破断言）；`bone-override-store.ts` 修正单例 `onClearEngineSlot` 实参序 `(modelId,bone)→(bone,modelId)`。经 grep `motion-intent.ts` 零命中（ADR 列项实际不存在，已排除）。31 例 registry 单测 + 209 例 motion/bone 单测全绿 |
| 语义迁移映射表（六·补） | （本提交） | ✅ 已立 + store 内部改动落地 | M1 已锁（P1 修）；M2/M7 决策明确；**M3/M4/M5/M6/M8/M9 的 store 内部改动已全部落地**（含单测同步，store 单测 12/12 全绿），Phase 2 step 2 可安全推进 runtime 接入（表 4 调用点） |

> **审核修复记录（2026-07-20）**：据 ADR-147 进度风险审核，已落地 3 项修复（均仅内核/单测，未接入运行时）：
> - **P1 priority 语义对齐**：`bone-override-store.ts` 抢占判定由 `priority > conflict.priority` 改为 `priority < conflict.priority`，与 `registry.ts:204`「数值越小优先级越高」一致，消除 Phase 2 step 2 接入时的仲裁整体翻转风险；配套 store 单测数值同步翻转。
> - **P2 资源泄漏**：`stopBoneOverride` 补释放 `_driverHandle`（单一驱动 observer）并重置 `_driverScene`，修复 stop 后每帧仍触发 `runFrame` 的残留 observer 泄漏。
> - **P3 runFrame 异常隔离**：`MotionPipeline.runFrame` 单 layer 抛错 `try/catch` 隔离，不影响后续层（对齐 Babylon 单 observer 抛错不影响其他 observer 行为）；新增隔离单测锁死。

> **语义迁移映射表落地（2026-07-20，本轮）**：据六·补映射表，已将 M3–M9 的 store 内部改动全部落地（未接入 runtime，仍属 Phase 2 内核范畴，零运行时行为回归）：
> - **M3 返回值翻 claimed**：`claimBones` 返本模块现拥有骨（含已拥有+新认领+抢占），对齐 registry `claimed`，根治 bake `claimed.includes` 误跳过。
> - **M4 冲突双视角**：落败分支补 `_recordConflict(loser=本模块)`，镜像 registry `:220`；`_recordConflict` 加 `(bone,loser,winner)` 去重。
> - **M5 releaseBones 清冲突**：末尾清 `loserModuleId===moduleId` 卡片，对齐 registry `_clearConflict`。
> - **M6 所有权守卫**：`setSlot` 拒绝为其他模块写的骨写 slot；`clearSlot` 加可选 `expectedModuleId`，越权清 warn+忽略。
> - **M8 BoneConflict.stage**：接口补 `winnerStage?/loserStage?`，构造注入 `stageOf` 填充，满足 §九 验收 3。
> - **M9 priority=0 哨兵**：`_ensureModule` 去 priority 形参，优先级统一由 `claimBones` 的 `state.priority=priority` 权威写入。
> - 验证：`bone-override-store.test.ts` 12/12 全绿（含 M3–M9 专项用例）；`tsc --noEmit` 对改动文件零错误（全项目唯一 tsc 错误在另一写者未跟踪的 `plaza-state.ts`，与本 ADR 无关）。

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
