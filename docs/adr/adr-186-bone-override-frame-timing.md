---
kind: adr
id: 186
title: bone-override 帧内时序图——覆盖循环、传播与 IK 保护
status: accepted
date: 2026-07-26
superseded-by: null
---

# ADR-186: bone-override 帧内时序图

> **状态**: accepted
> **背景**: IK 位置保护（body-posture 平移センター）引入后，发现 foot-modules 的脚部位置偏移被保护机制抹掉。根因是 `_propagateChildrenWasm` 的传播时序 + IK 保护恢复时机未在文档中固化，导致改动者无法预见冲突。本 ADR 将 bone-override stage 内部的完整帧内时序以 Mermaid 时序图 + 文字约束固化，防止后续改动踩雷。
> **决策**: 将 bone-override stage 内部的 7 步时序作为架构约束文档化，任何新增帧钩子或覆盖循环后处理步骤必须遵守此序列。
> **2026-07-26 核实补充**: 确认 foot-modules 走「bake 写旋转 + frameHook 写位置」双路径；IK 保护仅 WASM 路径生效（JS 路径跳过 `_snapshotProtectedPositions`/`_restoreProtectedPositions`，与 ADR-186 时序图中步骤③⑤一致）。

---

## 一、管线全局视图

`MotionPipeline` 按 `(stage, order)` 升序调度（ADR-147）。当前注册的层：

| 层 ID | Stage | Order | 来源文件 |
|-------|-------|-------|----------|
| `wasm-vmd-layers` | `vmd-layers` | 0 | `wasm-layers-blender.ts` |
| **`bone-override`** | **`bone-override`** | **0** | **`bone-override.ts`** |
| `feet-adjustment` | `bone-override` | 5 | `feet-adjustment.ts` |
| `perception` | `perception` | 0 | `perception.ts` |

`bone-override` stage 内有两个层：bone-override 主回调（order=0）先执行，feet-adjustment（order=5）后执行。

---

## 二、bone-override 主回调帧内时序（order=0 内部）

```mermaid
sequenceDiagram
    participant Pipeline as MotionPipeline
    participant Hooks as 帧钩子集合
    participant BP as body-posture<br/>(order=5)
    participant FM as foot-modules<br/>(order=0)
    participant Loop as 覆盖循环
    participant Prop as _propagateChildrenWasm
    participant IK as IK 保护恢复
    participant Feet as feet-adjustment<br/>(order=5, 独立层)

    Pipeline->>Hooks: ① _runFrameHooks(focusedId)
    Note over Hooks: 按 order 升序遍历（快照迭代）

    Hooks->>FM: order=0(FEET): setBoneOverridePosition('左足IK', [fx,fy,fz])
    Note over FM: 写入 overrideMap slot（通过 FRAME_HOOK_ORDER.FEET 常量）

    Hooks->>BP: order=5: setBoneOverridePosition('センター', [0,h,d])
    Hooks->>BP: protectIkPosition('左足IK')
    Hooks->>BP: protectIkPosition('右足IK')
    Note over BP: 注册到 _protectedIkBoneNames Set

    Hooks->>Hooks: order=10: riding / order=20: sway / order=30: hand-symmetry ...

    Pipeline->>Pipeline: ② 构建 boneMap（boneName → runtimeBone）

    Pipeline->>IK: ③ _snapshotProtectedPositions(boneMap)
    Note over IK: 快照 左足IK/右足IK 的当前 worldMatrix<br/>（此时 = 动画位置，尚未被覆盖循环修改）

    Pipeline->>Loop: ④ 遍历 overrideMap，逐骨 _applyWasmOverride

    Loop->>Loop: 处理 センター slot: oldT + [0,h,d] → newMat
    Loop->>Prop: _propagateChildrenWasm(センター, oldMat, newMat)
    Prop->>Prop: 递归传播到所有子骨骼<br/>（含 左足IK/右足IK 如果它们是センター的子骨）
    Note over Prop: ⚠️ 传播是「每骨立即」而非「批量」：<br/>处理完センター立刻传播，再处理下一骨

    Loop->>Loop: 处理 左足IK slot: oldT + [fx,fy,fz] → newMat<br/>（此时 oldT 已被传播偏移）
    Loop->>Prop: _propagateChildrenWasm(左足IK, ...)

    Pipeline->>IK: ⑤ _restoreProtectedPositions(boneMap, snapshots, overrideMap)
    Note over IK: 对每个受保护骨骼：<br/>• 无自身覆盖 → 直接恢复到快照（动画位置）<br/>• 有自身覆盖 → finalT = snapshotT + slot.pos<br/>  （直接计算动画位置 + 用户偏移，旋转保持快照值）

    Pipeline->>IK: ⑥ [doc:adr-085 方案C] _solveManualLegIK(boneMap, overrideMap)
    Note over IK: 仅 WASM 模式触发：babylon-mmd WASM 运行时<br/>IkSolver 字段为 null，IK 链不会重解。<br/>本步骤用余弦定理手动求解髋、膝增量旋转：<br/>• targetPos = IK 目标骨当前 translation（= snapshotT + slot.pos）<br/>• endEffectorPos = targetPos - slot.pos（动画位置）<br/>• 应用 hipDelta 到大腿 worldMatrix + _propagateChildrenWasm<br/>• 应用 kneeDelta 到膝盖 worldMatrix + _propagateChildrenWasm<br/>JS 运行时由原版 IkSolver.solve() 处理，跳过本步骤。

    Pipeline->>Feet: ⑦ feet-adjustment 层执行（stage 内 order=5）
    Note over Feet: 读取 IK 目标世界坐标<br/>（已恢复正确：动画位置 + 用户偏移）<br/>钉住 XZ，调整 Y 到地面，重解腿部 IK
```

---

## 三、关键约束（改动时必须遵守）

### C1: 帧钩子只写 overrideMap，不直写 worldMatrix

帧钩子通过 `setBoneOverridePosition()` / `setBoneOverride()` 写入 overrideMap。worldMatrix 的修改统一在步骤④的覆盖循环中完成。唯一例外是 IK 保护恢复（步骤⑤），但它也在覆盖循环之后。

### C2: 传播是「每骨立即」而非「批量」

`_applyWasmOverride` 对每骨执行后立即调用 `_propagateChildrenWasm`。如果 overrideMap 中同时有父骨和子骨，父骨先处理时传播会改变子骨的 worldMatrix，子骨处理时读到的是传播后的值。Map 迭代序 = 插入序（先 `bake()` 写入的旋转骨先处理，后帧钩子写入的位置骨后处理）。

### C3: IK 保护快照在覆盖循环之前

步骤③的快照发生在帧钩子之后、覆盖循环之前。快照捕获的是「动画位置 + 之前管线的变换」，不包含任何 bone-override 的覆盖。

### C4: IK 保护恢复必须考虑自身覆盖

步骤⑤中，如果受保护骨骼在 overrideMap 中有自己的 position slot（如 foot-modules 的 footPosX/Y/Z），恢复时不能直接覆盖为快照值，必须计算 `finalT = snapshotT + slot.pos`（动画位置 + 用户偏移，旋转保持快照值）。当前实现直接从快照矩阵提取 translation，加上 slot.pos 写回 worldMatrix buffer。

### C5: feet-adjustment 在 bone-override 主回调之后

feet-adjustment 注册为同 stage 内 order=5 的独立层，读取的 IK 目标世界坐标已经是步骤⑤修复后的值。任何改变 IK 目标位置的机制必须在 order ≤ 5 内完成。

### C6: [doc:adr-085 方案C] 手动两骨骼 IK 仅 WASM 模式触发

步骤⑥的 `_solveManualLegIK` 仅在 WASM 运行时执行（`isWasmRuntime(bones[0])` 为 true）。原因：babylon-mmd 的 WASM 实现不暴露 `ikSolver` 字段（始终为 null），IK 链不会在动画解算后重解。JS 运行时由 babylon-mmd 原版 `IkSolver.solve()` 处理，无需手动求解。

求解算法（余弦定理）：
- 输入：hipPos / kneePos / endEffectorPos（动画位置）/ targetPos（动画位置 + slot.pos）
- 旋转轴：默认 `curDir × targetDir`；共线回退到腿平面法线 `(knee-hip) × (endEffector-hip)`
- 退化场景：腿完全伸直且三点共线 → changed=false（无旋转轴可用）
- 纯函数实现：`motion-algos/two-bone-ik.ts`，单测覆盖 15 例
- 引擎集成：`bone-override.ts:_solveManualLegIK`，复用 `_propagateChildrenWasm` 传播子骨骼

### C7: 方案C是临时替代，长期走方案A（fork babylon-mmd）

方案C的已知限制（待方案A解决）：
- 不处理 IK 链角度约束（MMD 膝关节只能沿单轴弯曲）
- 不迭代（一次求解，非收敛）
- 不处理物理（与 `canSkipWhenPhysicsEnabled` 无关）
- 适用于脚部位置偏移等小偏移场景；大偏移可能产生不自然姿态

方案A（长期）：fork babylon-mmd，在 WASM 运行时暴露 `ikSolver` 字段及 `solve()` 方法，使 JS 路径与 WASM 路径统一走原版 IK 求解器。落地后删除方案C。

---

## 四、帧钩子优先级表

| 常量 | 值 | 模块 | 写入骨骼 | 说明 |
|------|-----|------|----------|------|
| *(默认)* | 0 | foot-modules | 左足IK / 右足IK | 脚部位置偏移 + 旋转 |
| `BODY_POSITION` | 5 | body-posture | センター | 身体高度/前后 + IK 保护注册 |
| `RIDING` | 10 | riding-model | 下半身等 | 骑行踏板循环 |
| `SWAY` | 20 | *(已归档)* | 上半身 | 身体摇摆 |
| `HAND_SYMMETRY` | 30 | left-hand / right-hand | 手根骨 | 手部对称位置 |

> 新增帧钩子必须使用 `FRAME_HOOK_ORDER` 中的常量或申请新值。禁止裸数字。

---

## 五、传播与 IK 保护的交互矩阵

| センター 偏移 | 左足IK 有 slot | 传播影响 | 保护行为 | 最终 IK 世界位置 |
|:---:|:---:|:---:|:---:|:---:|
| 0 | 无 | 无 | 不触发 | 动画位置 |
| 0 | 有 | 无 | 不触发 | 动画位置 + slot.pos |
| ≠0 | 无 | IK 目标被平移 | 恢复到快照 | 动画位置（正确） |
| ≠0 | 有 | IK 目标被平移 + slot 叠加 | 恢复 + 叠加 slot | 动画位置 + slot.pos（正确） |

> 第 4 行即本次修复的场景：body-posture 和 foot-modules 同时激活时，保护机制撤销传播但保留用户设定的脚部偏移。

---

## 六、改动检查清单

新增或修改 bone-override stage 内的逻辑时，逐项检查：

1. **是否影响传播链？** 新增的骨骼覆盖是否通过 `_propagateChildrenWasm` 传播到 IK 目标？如果是，需要调用 `protectIkPosition()` 注册保护。
2. **是否在覆盖循环后执行？** 任何在覆盖循环之后修改 worldMatrix 的逻辑，必须考虑受保护骨骼的 slot 偏移（参见 C4）。
3. **帧钩子 order 是否声明？** 新增帧钩子必须指定 order，推荐从 `FRAME_HOOK_ORDER` 取值。
4. **feet-adjustment 时序是否兼容？** 所有影响 IK 目标位置的逻辑必须在 order ≤ 5 内完成。
