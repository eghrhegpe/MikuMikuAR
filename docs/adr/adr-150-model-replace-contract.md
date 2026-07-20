# ADR-150: 模型替换原子操作契约（Model Replace Contract）

- **状态**: ✅ 已完成
- **日期**: 2026-07-20
- **完成日期**: 2026-07-20
- **相关**: ADR-131（BrowseOutcome 统一契约）、ADR-045（统一 LoadManager 队列）、ADR-121（全局动作意图）、ADR-124（文件系统架构）

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

#### 执行序列

```
1. snapshot ← 保存旧模型的可继承状态
   ├── vmdPath / vmdName（动作）
   ├── boneLockBoneName（骨骼锁定）
   ├── transform（position / rotation / scaling）
   ├── orbit（alpha / beta / radius）
   ├── visibility / wireframe / opacity
   ├── physicsEnabled
   ├── gazeEnabled
   └── morphWeights
2. loadPMXFile(newPath)          — 新模型解析（通过 LoadManager.load）
3. [子步骤] loadVMDInternal(snapshot.vmdPath)
   — 折叠进原子操作，不走队列，不对外暴露
   — 失败时静默回退（见下表），不阻断 replace
4. [子步骤] applyBoneLock(snapshot.boneLockBoneName)
   — 同名骨匹配，失败则静默解锁
5. [子步骤] applyRemainingState(snapshot)
   — transform / orbit / visibility / physics / gaze / morph
6. removeModel(oldId)            — 旧模型销毁
7. UI 导航（BrowseOutcome）
```

#### 状态继承裁定表

| 状态 | 继承 | 失败行为 |
|------|------|---------|
| Transform (position/rotation/scaling) | ✅ 继承 | — |
| Orbit (alpha/beta/radius) | ✅ 继承 | — |
| Bone Lock | ✅ 同名骨匹配 | 无同名骨 → 静默解锁，UI 开关同步关闭 |
| VMD 动作 | ✅ 折叠进 replace | 见下方 VMD 失败边界表 |
| 可见性 / 线框 / 透明度 | ✅ 继承 | — |
| 物理开关 | ✅ 继承 | — |
| 视线追踪 | ✅ 继承 | — |
| Morph 权重 | ✅ 继承 | — |
| **换装 Outfit** | ❌ **不继承**（重置） | — |

#### VMD 继承失败边界

VMD 继承在任何失败情况下**均不阻断 replaceModel 整体成功**。动画是尽力而为的附加值，非原子操作的一部分。

| 场景 | 行为 | 日志 |
|------|------|------|
| 骨骼错位（不完美） | ✅ 继续播，不干预 | — |
| VMD 文件路径失效 | ✅ 静默回退 idle，新模型无动画 | `[replace] VMD path invalid, skipping inherit` |
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

### 决策三（衍生效应）：VMD loadInternal

引入 `loadVMDInternal(path, targetModelId)` 供 replace 原子操作内部使用。其特性：

- 复用 VMD 解析的底层能力（与 `loadVMDFromPath` 共享解析逻辑）
- 不调用 `enqueue`，不走 LoadManager 调度器
- 不产生独立 LoadManager trace（日志上标记为 `[replace] 子步骤`，而非独立 Task）
- 不在 UI 上产生 loading 指示或错误弹窗

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
- 反序列化获得 LoadManager 的队列保护和 trace 能力，便于调试场景崩溃
- 统一 trace 链路：所有模型加载（用户触发 + 系统恢复）都在 LoadManager 可追溯
- VMD 和 bone lock 继承的失败边界清晰，避免下游依赖误以为"替换一定带动作"

### 负面

- `loadVMDInternal` 引入一条"半公开"的加载路径，需在编码时明确标记其只供原子操作内部使用
- restore 插队逻辑增加了调度器的复杂度，单队 priority 需要维护 invariant：「用户 load 不被 abort，restore 抱团不被插断」
- 反序列化迁移到 restore() 需要改动 `scene-serialize.ts` 的模型恢复循环

### 兼容性

- `loadPMXFile(path, asStage, skipAutoApply)` 签名不对外暴露，外部（库 / 拖放 / 反序列化）统一走 `load()` / `restore()`
- 已有 `load()` 调用点无 API 变更
- `scene-serialize.ts` 需从直接调用 `loadPMXFile` 迁移到 `LoadManager.restore()`，属于向后不兼容的内部重构
