# ADR-150: 模型替换原子操作契约（Model Replace Contract）

- **状态**: ✅ 已完成（决策二完整落地：`captureInheritedState` + `applyInheritedState` + `startReplaceModel` 集成 + undo 保护 + toast 治理；2026-07-26 审核通过）
- **日期**: 2026-07-20
- **完成日期**: 2026-07-26
- **相关**: ADR-131（BrowseOutcome 统一契约）、ADR-045（统一 LoadManager 队列）、ADR-121（全局动作意图）、ADR-124（文件系统架构）、ADR-167（场景级动作库）、ADR-127（场景级撤销）

## 方案裁剪说明（2026-07-22 重估）

> 本 ADR 原含三大决策，经后 ADR-167（场景级动作库）落地后的代码现状重估，裁剪如下：

| 决策 | 状态 | 理由 |
|------|------|------|
| 决策一：LoadManager 三层 `load`/`restore`/`loadPMXFile` + priority bypass | **永久搁置** | 反序列化并行加载实际无故障；restore 插队逻辑增加调度器复杂度但用户感知收益为零 |
| 决策二：Replace 原子操作 + 状态继承 | **已落地** | 真实用户痛点。VMD 继承路径从 `loadVMDInternal` 改为 `sceneMotionId` 引用场景动作库 |
| 决策三：`loadVMDInternal` | **移除** | 后 ADR-167 时代 VMD 通过 `sceneMotionId` 引用，`model-loader.ts` 已有自动应用逻辑，无需半公开加载路径 |

**与 ADR-131 的边界澄清：** ADR-131 管"替换后 UI 去哪"（BrowseOutcome 派发，已完成）；ADR-150 管"替换时状态怎么传"（状态继承，决策二已落地）。

## 背景与问题

`replaceModel`（库中点击替换模型）当前实现为**"加载新模型 → 删除旧模型"**的二元拼接（`library-actions.ts:258-266`），而非原子操作。两个结构性问题：

### 1. 状态继承缺失

替换后旧模型全部状态丢失（VMD、变换、bone lock、可见性、物理开关、Morph 权重等），新模型以全默认值出现。用户想快速切换角色对比效果时，每次替换会经历"视角跳变 + 动画中断 + 自定义配置归零"的体验滑坡。

### 2. 反序列化绕过 LoadManager

`scene-serialize.ts` 直接调用 `loadPMXFile()`（~L538）绕过 LoadManager 的统一调度，导致：
- 无队列控制（N 个模型全并行加载，`babylon-mmd` 内部锁是唯一防线）
- 无 trace（`loadId` / `phase` 缺失，调试场景崩溃困难）
- 无 `kind` 统一调度（stage/actor/prop 的区别硬编码在调用点，kind 语义变化时会漏改）

## 决策

### 决策一：LoadManager 三层契约

`loadPMXFile` 提升为纯解析层（对内不对外），对外暴露两入口：

```typescript
LoadManager
├── loadPMXFile(path, ...)  // 纯解析层，不对模块外暴露
├── load(req)               // 用户触发：单队列 + UI（loading/cancel/retry）
└── restore(req)            // 系统触发：同队列 + high priority + 无 UI
```

#### 单队 + Priority Bypass

- `load()` 和 `restore()` 进入同一个串行队列（单一事实来源，trace 不乱）
- `restore()` 标记 `priority: 'high'`，调度时将 restore 任务插入队首（正在执行的 load 不 abort）
- restore 内部 N 个模型连续抱团执行，不被用户后续 load 插断
- 当前正在执行的 load 不被 abort（尊重已投入的 IO/解析成本）

| 时间 | 队列状态 | 说明 |
|------|---------|------|
| T0 | `[UserLoad_A]` | 用户点了加载模型 A |
| T1 | `[UserLoad_A]` | A 开始解析 |
| T2 | `[UserLoad_A]` | 用户打开存档，触发 restore(B, C, D) |
| T3 | `[UserLoad_A] -> [Restore_B, Restore_C, Restore_D]` | 插队：Restore 序列排到 A 后面 |
| T4 | `[Restore_B, Restore_C, Restore_D]` | A 解析完，开始 B |
| T5 | `[Restore_C, Restore_D]` | B 完成，开始 C |
| T6 | `[Restore_D]` | C 完成，开始 D |
| T7 | `[]` | D 完成，队列空 |
| T8 | `[UserLoad_E]` | 用户再点 E，正常排队 |

### 决策二：Replace 为原子操作

`replaceModel` 不再是"load + remove"的二元操作，而是一个单一事务（Transaction），在单条 Promise 链内完成全部继承逻辑。

#### 执行序列（实际实现，2026-07-26 终态）

```
1. snapshot ← captureInheritedState(oldInst)  — 捕获旧模型可继承状态（model-ops.ts:341）
   ├── sceneMotionId（VMD 引用，通过 ADR-167 场景动作库）
   ├── boneLockBoneName（骨骼锁定骨名）
   ├── transform（position / rotation / scaling / positionMode）
   ├── orbit（azimuth / elevation / distance）
   ├── visibility / wireframe / opacity / showBoneLines / showBoneJoints
   ├── physicsEnabled
   ├── boneOverrides（骨骼覆盖，含 euler/weight/enabled/absolute）
   └── feet（脚部地面跟随状态）
   ⚠️ 不含 outfit（重置）、morph（跨模型通道不通用）、perception pin（P2 后续）
2. pushUndoSnapshot()               — 场景撤销快照（替换前状态）
3. loadManager.load()               — 新模型解析（串行队列 + AbortController）
4. applyInheritedState(newId, snap) — 状态继承（model-ops.ts:371）
   ├── modelManager setter 写入基础状态
   ├── boneOverrides 过滤（仅对新模型存在的骨骼应用）
   ├── sceneMotionId 赋值 motionSlots
   ├── feet 深拷贝
   └── boneLock 同名骨匹配（失败静默解锁）
5. applyIntentToModel(id, intent)   — sceneMotionId 不同时重新触发 VMD 应用
6. removeModel(oldId)               — 旧模型销毁
7. offerSceneUndoAndRefresh()       — 撤销 toast + reRender
8. UI 导航（BrowseOutcome）
```

#### 状态继承裁定表（2026-07-26 终态，对齐实施计划）

| 状态 | 继承 | 应用方式 | 失败行为 |
|------|------|---------|---------|
| Transform (position/rotation/scaling) | ✅ 继承 | `modelManager.setPosition/setRotation/setScaling` | — |
| Orbit (azimuth/elevation/distance) + positionMode | ✅ 继承 | `modelManager.setOrbit/setPositionMode` | — |
| Visibility / Wireframe / Opacity | ✅ 继承 | `modelManager.setVisibility/setWireframe/setOpacity` | — |
| Bone Lines / Bone Joints 可见性 | ✅ 继承 | `modelManager.setBoneLinesVis/setBoneJointsVis` | — |
| Physics Enabled | ✅ 继承 | `modelManager.setPhysics` | — |
| Bone Overrides（骨骼覆盖） | ✅ 同名骨匹配 | 遍历 `snap.boneOverrides`，`setBoneOverride` | 新模型无同名骨 → 静默跳过（不写入 store） |
| Feet State（脚部地面跟随） | ✅ 继承 | 直接赋值 `inst.feet`（结构化克隆） | — |
| VMD 动作（sceneMotionId） | ✅ 继承引用 + 手动 apply | 赋值 `inst.motionSlots.primary.sceneMotionId`，`applyIntentToModel` 重新广播 | 引用失效由 ADR-167 回退处理；intent 未命中静默跳过 |
| Bone Lock | ✅ 同名骨匹配 | `setOrbitBoneLock(true, oldBoneName)` | 无同名骨 → 不调用 lock，日志提示 `[adr-150] bone lock cleared` |
| Morph 权重 | ❌ **不继承** | — | morph 存于 `mmdModel.morph` 非 `ModelInstance`，跨模型 morph 通道名不通用，强行继承易错。留 P2 后续 |
| 视线追踪（perception pin） | ❌ P2 后续 | — | 自动 `activatePerception(id)` 已够用，pin 状态跨模型无意义 |
| **换装 Outfit** | ❌ **不继承**（重置） | — | — |

#### VMD 继承失败边界

VMD 继承通过 `sceneMotionId` 引用场景动作库（ADR-167），在任何失败情况下**均不阻断 replaceModel 整体成功**。动画是尽力而为的附加值，非原子操作的一部分。

| 场景 | 行为 | 日志 |
|------|------|------|
| 骨骼错位（不完美） | ✅ 继续播，不干预 | — |
| sceneMotionId 引用的动作不存在 | ✅ 静默跳过，新模型保留 model-loader 默认 VMD | 无（intent 未命中，`if (intent)` 守卫跳过） |
| VMD 解析异常 | ✅ catch，新模型无动画 | `[replace] VMD inherit failed: <error>` |

#### Bone Lock 同名骨不存在的处理

```
替换完成 → getBoneByName(oldLockedBoneName) → null
  → unlockBone()
  → 相机回到自由 ArcRotateCamera
  → UI 骨骼锁定开关同步关闭
  → 日志: [replace] bone '{name}' not found on new model, lock cleared
```

用户感知：相机从锁定某块骨骼的逻辑，自然回退到自由环绕，无违和感。

#### 实施文件索引

| 文件 | 责任 |
|------|------|
| `frontend/src/scene/manager/model-ops.ts:312-435` | `ReplaceSnapshot` 类型 + `captureInheritedState` + `applyInheritedState` |
| `frontend/src/menus/library-actions.ts:194-317` | `startReplaceModel` 编排：snapshot → load → apply → remove → undo |
| `frontend/src/__tests__/scene/replace-model-inherit.test.ts` | 11 单测（capture 4 + apply 7） |

### 决策三（衍生效应）：VMD loadInternal — **[已移除]**

> 引入 `loadVMDInternal(path, targetModelId)` 供 replace 原子操作内部使用。其特性：
> 
> - 复用 VMD 解析的底层能力（与 `loadVMDFromPath` 共享解析逻辑）
> - 不调用 `enqueue`，不走 LoadManager 调度器
> - 不产生独立 LoadManager trace（日志上标记为 `[replace] 子步骤`，而非独立 Task）
> - 不在 UI 上产生 loading 指示或错误弹窗
>
> **移除原因（2026-07-22）**：后 ADR-167 时代 VMD 通过 `sceneMotionId` 引用场景动作库，`model-loader.ts` 已有自动应用逻辑，无需半公开加载路径。实际实现中 VMD 继承走 `applyIntentToModel` 公共 API。详见方案裁剪说明。

## 替代方案

| 方案 | 被否原因 |
|------|---------|
| **双队列**（load 和 restore 各一条队列） | 加载链路复杂一倍，trace 分叉；用户操作和系统恢复的仲裁逻辑易出错 |
| **VMD 继承走队列**（独立 Task） | replace 不再原子化，中间有窗口期被用户其他操作插队；违背"替换后当场恢复 VMD"的用户预期 |
| **Bone Lock 故障时锁到第一块骨骼** | 欺骗用户——UI 显示锁定状态但锁的是不相干的骨骼，违反"所见即所得"原则 |
| **反序列化继续跳过 LoadManager** | 三个问题（全并行/无 trace/无 dispatch）在 Web 端尤其致命，不可持续 |

## 后果

### 正面

- `replaceModel` 可预测：同一输入产生同一结果（状态继承使替换等价于"换模型但不换上下文"）
- `captureInheritedState` / `applyInheritedState` 纯函数设计：11 单测覆盖，深拷贝隔离，零副作用
- VMD 继承走 ADR-167 sceneMotionId 公共引用，不引入新的半公开加载路径
- Bone Override / Bone Lock 继承有同名骨过滤，失败边界清晰，不堆积无效 store 条目
- undo 保护复用 ADR-127/158 既有机制：替换前全量快照 → 替换后撤销 toast
- toast 治理：替换 zip 含 VMD+音频时从 5 条堆叠降为 1 条（"模型已替换 + 撤销"）

### 负面

- ~~`loadVMDInternal` 引入一条"半公开"的加载路径~~ — 已移除（走 ADR-167 sceneMotionId + `applyIntentToModel` 公共 API）
- ~~restore 插队逻辑增加调度器复杂度~~ — 决策一永久搁置，未引入
- ~~反序列化迁移到 restore()~~ — 决策一永久搁置，未改动 `scene-serialize.ts`
- `sceneMotionId` 继承后通过 `applyIntentToModel` 重新触发 VMD 加载，model-loader 可能已完成默认 VMD 加载，造成重复 I/O（首轮 VMD 解析无缓存时浪费）。P4 低优先级优化项。

### 兼容性

- `captureInheritedState` / `applyInheritedState` 为纯函数，无副作用导入
- 已有 `load()` 调用点无 API 变更；`replaceModel` 调用点对外接口不变（仍是 `replaceModel(m: LibraryModel): void`）
- ~~`loadPMXFile` 签名内部化、`scene-serialize.ts` 迁移到 `LoadManager.restore()`~~ — 决策一永久搁置，未实施
- undo 保护复用 ADR-127/158 既有 `pushUndoSnapshot` + `offerSceneUndoAndRefresh` 机制，无新增持久化格式
