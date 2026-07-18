# 计划：程序化动作 per-model 化 + 双槽位（v2 修订）

> 起草：2026-07-18 18:42 → 修订：2026-07-18 18:51
> 状态：规划（待 Jieling 拍板）
> 关联 ADR：ADR-021（程序化）、ADR-071（感知）、ADR-116（动作覆盖模块）、ADR-121（全局动作意图）、ADR-129（场景级动作 UI）

---

## 0. 关键发现（代码实证，决定可行性）

### 0.1 两个技术前提——均已验证为「可行」

**前提 A：程序化生成器能否拆 base / overlay？**

✅ **不需要拆类。** `proc-motion-shared.ts:9-24` 的 `PROC_MOTION_BONE_CATEGORIES` 已把身体切成 13 类（center/upper/upper2/waist/head/arm/groove/shoulder/allParent/wrist/footIk/blink/emotion），并由 `ProcMotionState.boneToggles`（`:36`）逐类开关控制生成范围。

- "基础型程序化" = 全部 toggle 开（全身 idle 摆动）
- "叠加型程序化" = 只开 `arm`/`wrist`/`shoulder`（手势）或只开 `emotion`+`vpdApplyEnabled`（表情微动）

→ 生成器本体零改动；overlay 程序化 = **用受限 `boneToggles` 生成 + 作为图层注入**。无需新生成器类。

**前提 B：babylon-mmd 是否支持「基础动作 + 叠加动作」两层 VMD 混合？**

✅ **已支持，且是 per-model 的。** `vmd-layers.ts` 的 `_rebuildCompositeAnimation`（`:506`）已是：

```
基础 VMD (inst.vmdData, weight=1.0)  ┐
  + 各启用 VMD 图层 (inst.vmdLayers[], 各带 weight + boneFilter)  ┘→ MmdCompositeAnimation / MmdAnimationSpan（JS）
                                                                  → 或 WASM addWasmLayer（GPU 混合，:635）
```

- 每模型独立 `inst.vmdLayers[]`（`core/types.ts:142`），**per-model 叠加**。
- `_filterVmdBones`（`:59`）能在**二进制层把 VMD 限定到指定骨骼** → "只动手指/只动面部"的叠加型程序化直接可用。

### 0.2 决定性利好：现有 `vmdLayers` ≈ 用户设想的「槽位2」

用户设想的「槽位2 叠加层」与现有 `inst.vmdLayers` 数据模型**同构**：

| 用户设想 | 现有实现 |
|---------|---------|
| 槽位1（基础动作） | `inst.vmdData`（inherit/pinned 注入） |
| 槽位2（叠加层：VMD/程序化/表情） | `inst.vmdLayers[]`（weight + boneFilter） |
| 叠加混合 | `MmdCompositeAnimation` / WASM blender |

→ **不需要新造引擎能力**。双槽位 = 把 `inst.vmdData`（基础）+ `inst.vmdLayers`（叠加）在 UI 上显式化为「槽位1 / 槽位2」两个可配置源。程序化只需作为"可注入的来源"接入这两处即可。

---

## 1. 核心架构原则（用户洞察：参数 vs 启用分离）

| 维度 | 归属 | 存储位置 |
|------|------|---------|
| **程序化参数**（intensity/speed/boneToggles/视线追踪/微表情） | per-motion（跟随动作走） | `SceneMotionIntent.motionModules.procmotion`（`types.ts:94`） |
| **程序化启用状态**（本角色是否走程序化、走哪个预设） | per-model | `ModelInstance.motionSlots` |

这**化解了上一轮「per-motion vs per-model 冲突」**：参数随动作共享（多角色一致），启用权在角色（差异化）。与 ADR-116/121 骨骼覆盖"跟动作走"原则自洽。

> ⚠️ 现状 `procState` 是模块级全局单例（`proc-motion-bridge.ts:29`）。要 per-motion 化，需把参数从全局 `procState` 迁移进 `SceneMotionIntent.motionModules`——这是本计划最大的重构点，但路径已被骨骼覆盖（ADR-116）验证可行。

---

## 2. 存储 Schema 提案

### 2.1 场景级（参数随动作走）

```typescript
// SceneMotionIntent.motionModules 增加一个 proc 模块
interface ProcModuleState {
    idle: ProcMotionState;       // 基础型参数（全身）
    overlay: ProcMotionState;    // 叠加型参数（按 boneToggles 限定区域）
    overlayPreset: 'gesture' | 'expression' | 'none';
}
```

### 2.2 实例级（启用权在角色）—— 双槽位

```typescript
type SlotSource = 'inherit' | 'pinned' | 'procedural';

interface MotionSlotConfig {
    source: SlotSource;
    pinned?: SceneMotionIntent;        // source='pinned'
    procRole?: 'idle' | 'autodance' | 'gesture' | 'expression'; // source='procedural' 时选预设
}

interface ModelMotionSlots {
    primary: MotionSlotConfig;   // 槽位1：基础（默认 inherit）
    overlay: MotionSlotConfig;   // 槽位2：叠加（默认 inherit=null → 等价于无叠加）
}

// ModelInstance 上
interface ModelInstance {
    motionSlots: ModelMotionSlots;   // 替换旧 motionAssignment
}
```

> 迁移：旧 `motionAssignment` 字段在加载时映射为 `motionSlots.primary`（pinned→pinned，inherit→inherit）；`overlay` 默认空。

---

## 3. 执行管线（关键）

复用现有 `vmd-layers` 管线，新增"程序化图层"注入：

```
槽位1（基础）:
  ├─ inherit → 场景 VMD (inst.vmdData)
  ├─ pinned  → 固定 VMD 快照 (inst.vmdData)
  └─ procedural → 用场景 proc 模块 idle 参数生成 VMD，写入 inst.vmdData
        ↓
槽位2（叠加，走 inst.vmdLayers）:
  ├─ 无叠加 → 不添加图层
  ├─ inherit → 场景级图层（SceneMotionIntent.vmdLayers 复制到实例）
  ├─ pinned  → 额外 VMD 图层（boneFilter 限定叠加型骨骼）
  └─ procedural → 用场景 proc 模块 overlay 参数生成 VMD，作为图层注入（boneFilter 限定区域）
        ↓
_rebuildCompositeAnimation(modelId)  ← 现有混合（已支持 base + N overlay）
        ↓
骨骼覆盖模块（per-motion，applyMotionModulesToModel）
        ↓
Ragdoll 物理 → Perception
```

### 3.1 集成要点（务必注意）

- **程序化 base 必须走 `vmdLayers` 管线，不能像现在 `proc-motion-bridge.ts:112` 那样直接 `loadVMDMotion`**：现有 procmotion 直接 `setRuntimeAnimation` 会绕过 `_rebuildCompositeAnimation`，与槽位2 叠加冲突。程序化生成结果应注入 `inst.vmdData`（base）或 `inst.vmdLayers`（overlay），由统一 rebuild 收口。
- **`initMotionBroadcast`（`motion-popup.ts:153`）跳过逻辑扩展**：`procedural`/`pinned` 槽位1 的模型不被场景 broadcast 覆盖（保留）；但场景 proc 模块参数变更时，需重新触发这些模型的 rebuild。

---

## 4. 加载时继承上一个角色设置

### 4.1 实现点（低复杂度）

模型加载完成回调（model-loader / modelManager 的 add 路径）中：

```typescript
function inheritFromLastActor(newInst: ModelInstance, lastInst: ModelInstance | null) {
    if (!lastInst) return;
    // 继承槽位1 的「策略选择」，不继承 pinned 具体快照
    newInst.motionSlots.primary.source = lastInst.motionSlots.primary.source;
    newInst.motionSlots.primary.procRole = lastInst.motionSlots.primary.procRole;
    // overlay 默认不继承（角色个性化）
}
```

### 4.2 继承范围

| 字段 | 继承？ | 理由 |
|------|--------|------|
| 槽位1 source / procRole | ✅ | 多角色编排策略应一致 |
| 槽位1 pinned 快照 | ❌ | 新角色不一定有该动作 |
| 槽位2 全部 | ❌ | 叠加层是角色个性化 |
| 程序化参数（场景级） | — | 本就随场景动作共享，无需继承 |
| 骨骼覆盖 / 外观 / 故障排除 | ❌ | 已 per-motion 或强 per-model |

> "上一个角色"引用：取 `modelRegistry` 中最后加入 / 最近聚焦的实例即可，无需新增全局概念。

---

## 5. 次级菜单 UI（模型详情页 → 动作折叠组）

```
[动作]
  ├─ 动作1（基础）→ 进入
  │     ├─ 跟随场景 [当前: 街舞]
  │     ├─ 程序化 → [idle / autodance]
  │     └─ 固定VMD → [浏览]
  ├─ 动作2（叠加）→ 进入
  │     ├─ 无叠加
  │     ├─ 程序化叠加 → [gesture / expression]
  │     └─ 固定VMD叠加 → [浏览，boneFilter 限定]
  └─ 姿势库
```

---

## 6. 分阶段实施（修订）

| 阶段 | 内容 | 复杂度 | 依赖 |
|------|------|--------|------|
| **P0** | 程序化参数从全局 `procState` 迁入 `SceneMotionIntent.motionModules` | 高 | 复用 ADR-116 迁移路径 |
| **P1** | `motionSlots` 双槽位 schema 替换 `motionAssignment` + 迁移 | 中 | P0 |
| **P2** | 程序化作为可注入来源接入 `vmdLayers` 管线（base + overlay） | 中 | P0/P1 + §3.1 集成 |
| **P3** | 加载时继承槽位1 策略 | 低 | P1 |
| **P4** | 次级菜单 UI 重构（动作1/动作2 入口） | 中 | P1/P2 |

> 阶段 2（角色级叠加槽位）在 v1 计划中的疑虑已消解：`vmdLayers` 已是 per-model 叠加基础设施。

---

## 7. 风险表

| 等级 | 位置 | 风险 | 缓解 |
|------|------|------|------|
| 🔴 P0 | `proc-motion-bridge.ts:29` | `procState` 全局单例 → per-motion 迁移是最大重构 | 仿 ADR-116 骨骼覆盖，参数入 `motionModules`，桥改为读场景 proc 模块 |
| 🟠 P2 | §3.1 集成 | 程序化 base 直接 `loadVMDMotion` 会绕过 `vmdLayers` rebuild | 程序化结果注入 `inst.vmdData`/`inst.vmdLayers`，统一由 `_rebuildCompositeAnimation` 收口 |
| 🟠 P2 | `vmd-layers.ts:629` WASM 路径 | WASM blender 当前仅支持 base + layer，多层/程序化图层需验证 `addWasmLayer` 能接收程序化生成的 VMD | 先用 JS `MmdCompositeAnimation` 路径跑通，WASM 路径做兼容验证 |
| 🟡 P3 | `motion-popup.ts:153` 广播 | 场景 proc 参数变更需重新触发 procedural 模型的 rebuild | 广播回调中检测 `primary.source==='procedural'` 的模型并 rebuild |
| 🟡 P3 | 叠加权重 | 槽位2 默认全覆盖（weight=1）适合表情/手势；进阶权重滑块待评估 | 阶段 4 前先用 weight=1 |
| 🟢 P4 | E2E | 旧 `motion:procmotion` 场景级断言需重定位 | 按 E2E 契约重定位到模型详情页 |

---

## 8. 结论

> **用户的细化方案可行，且比 v1 计划风险更低。** 关键原因：`vmdLayers` 已是 per-model 双槽位叠加基础设施，`boneToggles` 已是生成器区域限定机制——两个"新能力"其实都已存在，本计划主要是**重组数据流与 UI**，而非新造引擎能力。
>
> 唯一真正重的重构是 **P0：把程序化参数从全局单例迁入 per-motion 的 `motionModules`**（与骨骼覆盖同构，路径已验证）。
>
> 建议从 P0 起步，参数迁移跑通后再做双槽位与叠加注入。
