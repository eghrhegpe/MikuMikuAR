# ADR-056: WASM 运行时 Motion Layers 解锁 — JS 帧流合并 + 单图层兜底

> **状态**: ✅ 已实施（2026-07-08 代码核实；wasm-layers-blender.ts 实现 + vmd-layers.ts:534 集成）
> **背景**: ADR-054 将「WASM/JS 运行时分裂」列为 🔴 P0 架构决策。经代码事实核对，ADR-054 中「gaze 仅 JS 生效」的描述**已过时**——ADR-016 双路径 gaze（WASM frontBuffer 直写 + JS linkedBone）已落地。真实裂缝收窄为单项：`MmdCompositeAnimation` 在 WASM 运行时不可用，多 VMD 图层混合退化为单图层。本 ADR 锁定该裂缝的解决方案。

---

## 一、修正诊断（2026-07-06 代码事实）

### 1.1 能力矩阵（核实后）

| 能力 | WASM Runtime | JS Runtime | 证据 |
|------|--------------|------------|------|
| WASM Bullet 物理（头发/服装刚体） | ✅ | ❌ | [env-bridge.ts:196](../../frontend/src/scene/env/env-bridge.ts#L196) |
| XPBD 布料 | ✅ | ✅ | ADR-019 |
| Gaze Tracking（头/眼跟随） | ✅ frontBuffer 直写 | ✅ linkedBone | [proc-motion-bridge.ts:82](../../frontend/src/scene/motion/proc-motion-bridge.ts#L82) `_isWasmRuntime` |
| 程序化动作（Idle/AutoDance） | ✅ VMD 帧注入 | ✅ | ADR-021 |
| **Motion Layers（多 VMD composite）** | ❌ 回退单图层 | ✅ | [vmd-layers.ts:524](../../frontend/src/scene/motion/vmd-layers.ts#L524) |
| LipSync | ✅ | ✅ | — |

### 1.2 运行时切换 UI 已存在

[motion-procmotion-levels.ts:372-403](../../frontend/src/menus/motion-procmotion-levels.ts#L372-L403) 已有「WASM 物理 / JS 调试」切换器，藏在程序化动作菜单 → 高级设置，切换走 `location.reload()`。默认 WASM。

### 1.3 真实裂缝

仅剩 **Motion Layers**：`MmdWasmRuntime.createRuntimeAnimation` 期望 `MmdWasmAnimation` 类型，`MmdCompositeAnimation` 不兼容（[vmd-layers.ts:522-536](../../frontend/src/scene/motion/vmd-layers.ts#L522-L536)），WASM 下多 VMD 图层回退到主图层 + `console.warn`。

---

## 二、决策选项

### Option A: 推动上游 babylon-mmd

向上游 PR 让 `MmdWasmRuntime` 原生支持 `MmdCompositeAnimation`。

- ✅ 长期最干净的解
- ❌ 时间线不可控，fork 维护成本高
- ❌ 不解决当前用户痛点

### Option B: 锁定默认运行时策略

不做新工程，只拍板默认并文档化。

- **B1**: 默认 WASM，接受多 VMD 图层不可用（现状）
- **B2**: 默认 JS，接受无 Bullet 物理（牺牲头发/服装刚体物理）
- ✅ 零实现成本
- ❌ 要么损失多图层，要么损失物理——两者都是核心能力

### Option C: JS 帧流合并（扩展 ADR-016 gaze 模式）

每帧在 JS 侧求值各 VMD 图层的骨骼变换，与 base VMD 经 WASM 管线计算的结果在 frontBuffer 层面混合，绕过 `MmdCompositeAnimation`。

- ✅ 保留 WASM 物理 + 解锁多图层 → 消除分裂
- ✅ 复用 ADR-016 已验证的基础设施（`_isWasmRuntime` / `_writeMatToBuffer` / `_propagateChildrenWasm`）
- ✅ 与 ADR-021 程序化动作的 VMD 帧注入模式同构
- ⚠️ 需实现 VMD 帧求值器（含 Bezier 插值）
- ⚠️ 每帧混合开销（视作用骨骼数而定，见 §3.2 性能预估）

### Option C+B 混合（**选定**）

以 C 为主要路径让 WASM 拿到多图层能力，B1 作为降级兜底：C 失败或异常时回退到当前的单图层 + 警告行为。

---

## 三、决策

**采用 C+B 混合方案**。

### 3.1 核心理由

1. **裂缝已收窄**：gaze 双路径已落地，剩 Motion Layers 单项，C 方案的工程边界清晰
2. **模式已验证**：ADR-016 gaze 的 frontBuffer 直写 + 递归传播子骨骼已在生产运行，C 方案是同一模式的扩展（从 head/eyes 两骨扩展到全骨骼图层混合）
3. **不牺牲核心能力**：B 单独选会丢物理或多图层，两者都是 MikuMikuAR 的护城河
4. **降级保护**：B1 兜底确保 C 实现缺陷不会阻塞用户

### 3.2 非目标

- ❌ 不改动 `MmdCompositeAnimation` 在 JS 运行时的现有路径（JS 版保持原生 composite）
- ❌ 不推动上游 babylon-mmd（Option A 留作远期）
- ❌ 不移除运行时切换 UI（保留作为调试/对比入口）

### 3.3 性能预估（按作用骨骼数分级）

gaze observer 实测约 0.05ms/帧（2 骨）。图层混合的开销与作用骨骼数线性相关：

| 场景 | 作用骨骼数 | 预估开销 | 风险 |
|------|-----------|---------|------|
| 单图层 overlay（仅改 1-2 骨） | 2 | ~0.05ms | 低 |
| 3 图层 × 20 骨骼 | 60 | ~1.5ms | 中（Phase 5 基准验证） |
| 3 图层 × 100 骨骼（全骨骼） | 300 | ~7.5ms | 高（可能掉帧） |

**硬约束**：为防止用户无意加载全骨骼覆盖图层导致性能崩溃，`boneFilter` 未指定时默认将图层作用集限制为上半身/上肢核心骨骼：

```typescript
const DEFAULT_LAYER_BONE_FILTER = [
    '上半身', '上半身2', '首', '頭',
    '左腕', '右腕', '左ひじ', '右ひじ', '左手首', '右手首',
];
```

如需全骨骼覆盖，用户必须显式指定 `boneFilter: ['*']` 并在 UI 确认性能影响。此约束仅作用于 WASM 帧流合并路径，JS 运行时的原生 `MmdCompositeAnimation` 不受影响。

---

## 四、技术方案

### 4.1 架构

```
┌─────────────────────────────────────────────────────────────┐
│  WASM Runtime（默认）                                        │
│                                                              │
│  base VMD ──► MmdWasmAnimation ──► WASM 动画管线 ──┐         │
│                                                     ▼        │
│  overlay VMD layers ──► VMD 帧求值器 ──► 图层混合器 ──┐       │
│  (JS 侧每帧求值)         (Bezier 插值)    (权重 + boneFilter) │
│                                                     ▼        │
│  ┌── 单一 observer（onBeforeRenderObservable, afterPhysics 之后）──┐
│  │ 1. 图层混合覆写（全骨骼，按 boneFilter 限定作用集）            │
│  │ 2. gaze 覆写（head/eyes，在图层混合之后覆盖，保证 gaze 优先）  │
│  │ 3. _propagateChildrenWasm 递归传播子骨骼                       │
│  └────────────────────────────────────────────────────────────────┘
│                                                              │
│  WASM Bullet 物理 ◄── 在 observer 执行之前完成               │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 关键复用

| 已有资产 | 复用点 | 位置 |
|----------|--------|------|
| `_isWasmRuntime(bone)` | 运行时检测 | proc-motion-bridge.ts:82 |
| `_writeMatToBuffer(buf, m)` | Matrix → frontBuffer | proc-motion-bridge.ts:87 |
| `_propagateChildrenWasm(parent, oldMat, newMat)` | 递归传播子骨骼 | proc-motion-bridge.ts:102 |
| `buildVmd(bones, morphs, ...)` | VMD 二进制写入 | motion-algos/vmd-writer.ts |
| `_filterVmdBones(data, filter)` | VMD 骨骼过滤 | vmd-layers.ts:55 |

### 4.3 时序与 observer 合并

**合并为单一 observer**，注册在 `scene.onBeforeRenderObservable`，在 `mmdRuntime.afterPhysics` 之后执行，读到的是本帧 WASM 已计算完成的 frontBuffer。执行顺序：

1. **图层混合覆写**：对每个 overlay 图层求值 → 按 weight 与 base 混合 → 覆写 frontBuffer（仅作用 boneFilter 集合内的骨骼）
2. **gaze 覆写**：在图层混合之后覆盖 head/eyes，保证用户视线追踪优先于 VMD 图层
3. **递归传播**：`_propagateChildrenWasm` 对所有被覆写的骨骼传播子骨骼

> 合并 observer 避免「图层混合与 gaze 同时覆写同一骨骼」的时序冲突（风险表第 5 项）。gaze 现有 observer（`_headTrackingObserver`）将被吸收进新 observer，或在 gaze 启用时由新 observer 统一调度。

### 4.4 混合策略

| 维度 | 算法 | 说明 |
|------|------|------|
| 位置（Vector3） | **Lerp**（线性插值） | `pos = base.pos * (1 - w) + overlay.pos * w` |
| 旋转（Quaternion） | **Slerp**（球面线性插值） | `rot = Quaternion.Slerp(base.rot, overlay.rot, w)`，不可用 Lerp（会导致非单位四元数 + 旋转失真） |
| 多图层权重 | **归一化到 1.0** | 若 Σweight > 1，按 `w_i' = w_i / Σw` 归一化，与 JS 运行时 `MmdCompositeAnimation` 行为一致 |

混合公式（单骨骼，N 个 overlay 图层）：
```
final.pos = base.pos
final.rot = base.rot
for each layer i (按 weight 降序):
    w_i' = w_i / max(1, Σw)   // 归一化
    final.pos = Lerp(final.pos, layer_i.pos, w_i')
    final.rot = Slerp(final.rot, layer_i.rot, w_i')
```

> gaze 覆写（步骤 2）不受权重归一化影响，直接覆盖 head/eyes 的 frontBuffer。

---

## 五、实施路标（文件级）

### Phase 1: VMD 帧求值器（新模块）

**创建** `frontend/src/motion-algos/vmd-evaluator.ts`

职责：解析 VMD ArrayBuffer，给定帧号求值指定骨骼的变换（含 Bezier 插值曲线）。

接口草案：
```typescript
export interface VmdBoneFrame {
    boneName: string;
    position: Vector3;
    rotation: Quaternion;
}
export function createVmdEvaluator(data: ArrayBuffer): {
    evalBoneFrame(boneName: string, frame: number): VmdBoneFrame | null;
    evalAllBones(frame: number): Map<string, VmdBoneFrame>;
    dispose(): void;
};
```

**实现约束**：
- **Bezier 插值**：VMD 每帧包含 4 条贝塞尔曲线（X/Y/Z/R），求值器须与 babylon-mmd 的 `MmdBoneAnimationTrack` 实现保持一致。**已调研上游实现**（2026-07-06），结论如下：
  - **复用 `VmdLoader.loadFromBufferAsync(name, buffer)`** 得到 `MmdAnimation`，直接遍历其 `boneTracks` / `movableBoneTracks`（已暴露为 `readonly` 数组，每个 track 含 `name` / `frameNumbers: Uint32Array` / `rotations: Float32Array` / `rotationInterpolations: Uint8Array`，movable 另含 `positions` / `positionInterpolations`）
  - **复用 `BezierInterpolate(x1, x2, y1, y2, x)` 函数**（`babylon-mmd/esm/Runtime/Animation/bezierInterpolate`），二分法 15 次迭代，eps=1e-5
  - **求值算法**（参照 `mmdRuntimeModelAnimation.js`）：
    - 旋转：`weight = BezierInterpolate(interp[i*4]/127, interp[i*4+1]/127, interp[i*4+2]/127, interp[i*4+3]/127, gradient)` → `Quaternion.SlerpToRef(rotA, rotB, weight, result)`
    - 位置（movable）：X/Y/Z 各自 `BezierInterpolate` 得 `xWeight/yWeight/zWeight` → `posA.axis += (posB.axis - posA.axis) * weight`（逐轴 Lerp）
    - `gradient = (frame - frameA) / (frameB - frameA)`，插值参数除以 127 归一化
  - **无需从零写 VMD 解析器**，vmd-evaluator 只负责：构建 `Map<boneName, track>` 查找表 + 二分查找 frame + 调用 `BezierInterpolate` + Slerp/Lerp
  - 偏差容忍度：与上游同源同函数，理论上零偏差；单图层求值结果须与 WASM 内置动画管线一致以便对比验证
- **首尾帧边界**：`frame < 0` 或 `frame < 首帧` 返回首帧；`frame > 末帧` 返回末帧；track 帧数为 0 返回 `null`；track 帧数为 1 返回该唯一帧。
- **内存管理**：`dispose()` 释放 `MmdAnimation` 引用与 `Map` 查找表，避免图层频繁增删时泄漏。

**测试要求**：单元测试覆盖率 ≥ 80%，覆盖解析正确性、Bezier 插值数值验证（与参照实现对比）、首尾帧边界、跨帧求值、空数据兜底。

### Phase 2: WASM 图层混合器（新模块）

**创建** `frontend/src/scene/motion/wasm-layers-blender.ts`

职责：每帧 observer，读取 base frontBuffer + 各 overlay 图层求值结果，按权重混合，覆写 frontBuffer + 传播子骨骼。

接口草案：
```typescript
export function setupWasmLayersBlender(modelId: string): void;
export function teardownWasmLayersBlender(modelId: string): void;
```

**实现约束**：
- 复用 `_propagateChildrenWasm` 模式
- 混合策略按 §4.4：位置 Lerp + 旋转 Slerp + 多图层权重归一化
- **`boneFilter` 默认作用集**：未指定时使用 `DEFAULT_LAYER_BONE_FILTER`（§3.3），防止全骨骼覆盖导致性能崩溃；显式 `boneFilter: ['*']` 才允许全骨骼
- observer 合并按 §4.3：图层混合 → gaze 覆写 → 递归传播

### Phase 3: vmd-layers.ts 集成

**修改** [vmd-layers.ts:522-536](../../frontend/src/scene/motion/vmd-layers.ts#L522-L536)

将 WASM 回退路径从「单图层 + warn」改为：
1. 检测多图层场景 → 启动 `setupWasmLayersBlender`
2. base VMD 走正常 `loadVMDMotion` 路径
3. overlay 图层注册到 blender
4. 异常 try/catch → 降级到当前单图层 + warn（B1 兜底）

**Feature flag**：增加环境变量 `VITE_WASM_LAYERS_BLEND=0` 强制回退单图层（便于线上问题快速止血）。读取方式与 `VITE_MMD_RUNTIME` 一致，在 vmd-layers.ts 入口处检查。

### Phase 4: ADR 文档闭环

- **修改** [ADR-054](adr-054-roadmap-next.md) §二「WASM / JS 运行时分裂」：修正「gaze 仅 JS 生效」为「gaze 双路径已实施（ADR-016）」，裂缝描述更新为「仅 Motion Layers，已由 ADR-056 解决」
- **修改** [ADR-054](adr-054-roadmap-next.md) §三 P2 第 12 项：从「待决策」移至「已决策，已实施（ADR-056）」
- **修改** [ADR-051](adr-051-vmd-layers-bonefilter.md) §「WASM 运行时回退」：补充「ADR-056 已通过 C 方案解决，WASM 下多图层混合走 JS 帧流合并」
- 本 ADR 实施完成后状态改为「已实施」

### Phase 5: 测试与验收

- vmd-evaluator 单元测试（覆盖率 ≥ 80%，含 Bezier 数值对比）
- wasm-layers-blender 集成测试（mock frontBuffer，验证 Lerp/Slerp/归一化）
- 端到端：WASM 运行时下加载 2 个 VMD 图层，验证混合生效
- **性能基准数据**（写入本 ADR §九「实施后性能数据」）：

| 场景 | 作用骨骼数 | 帧耗时（ms） | 帧率影响 |
|------|-----------|-------------|---------|
| 单图层（base only） | 0 | — | 基线 |
| 双图层（gaze scope） | 2 | — | — |
| 双图层（上半身） | 10 | — | — |
| 三图层（上半身） | 30 | — | — |
| 三图层（全骨骼 `['*']`） | 300 | — | — |
| JS 运行时 composite（对照） | — | — | — |

- 回归：gaze tracking + 程序化动作在 WASM 下仍正常

---

## 六、风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| VMD Bezier 插值实现与 babylon-mmd 内置不一致 → 混合结果与 JS composite 有视觉差异 | 中 | Phase 5 对比测试；接受细微差异（混合本身是用户自定义行为） |
| 全骨骼 frontBuffer 覆写开销高于 gaze（gaze 仅 2 骨，图层混合可能数十骨） | 中 | 性能基准；必要时限制 boneFilter 作用集；降级到 B1 |
| `MmdWasmRuntimeBone.worldMatrix` 是 frontBuffer 切片视图，覆写时序错位 | 中 | 复用 gaze 已验证的 `onBeforeRenderObservable` + `afterPhysics` 之后时序 |
| WASM 升级 breaking change 导致覆写失效 | 低 | ADR-016 已评估，gaze 仅依赖公开 API；图层混合同理 |
| 图层混合与 gaze observer 同时覆写同一骨骼 | 中 | 已由 §4.3 合并为单一 observer 解决：图层混合 → gaze 覆写 → 递归传播，gaze 优先级最高 |

---

## 七、后续方向

- **Option A 上游推动**：若 C 方案稳定，可向上游 PR 让 `MmdWasmRuntime` 原生支持 composite，最终移除 JS 帧流合并的运行时开销
- **图层混合 UI**：当前 Motion Layers UI 无 WASM/JS 差异提示，C 方案落地后可移除「WASM 仅支持单图层」的状态栏警告
- **JS 运行时退役评估**：C 方案稳定后，评估是否保留 JS 运行时作为调试入口，或完全移除以降低维护成本

---

## 八、相关 ADR

- [ADR-016](adr-016-gaze-tracking-architecture.md) — gaze 双路径（本 ADR 的基础设施来源）
- [ADR-021](adr-021-procedural-motion.md) — VMD 帧注入模式（本 ADR 的同构参考）
- [ADR-051](adr-051-vmd-layers-bonefilter.md) — VMD 图层 + boneFilter（本 ADR 的修改对象）
- [ADR-054](adr-054-roadmap-next.md) — 路线图（本 ADR 的 P0 决策项来源，需同步修正）

---

## 九、实施后性能数据

> Phase 5 验收后填入。基准方法：固定场景 + 模型，使用 `performance.now()` 测量 observer 单帧耗时，每场景采样 1000 帧取 P50/P95。

**基准实现说明（2026-07-10 实测）**：WASM 运行时在 headless node 中需 fetch wasm 二进制、加载不可靠，故本基准**忠实复刻** `wasm-layers-blender.ts` 的 `_applyLayersBlending` 热路径——真实 PMX 骨骼图（泠鸢yousa-登门喜鹊.pmx，774 骨 / 139 leaf）+ 真实 `VmdEvaluator` 求值 + 真实 Babylon `Matrix` 写入（`_writeMatToBuffer` 拷 16 float、`_propagateChildrenWasm` 用 `Matrix.FromArrayToRef`/`Invert`/`multiply`，与 WASM 管线 frontBuffer 覆写为同量级 O(N) 内存写）。WASM Bullet 物理开销未计入（与图层混合正交）。每场景 warmup 50 帧后采样 1000 帧。脚本见 `frontend/src/__tests__/wasm-layers-blender.perf.test.ts`（运行：`npx vitest run --config vitest.perf.config.ts src/__tests__/wasm-layers-blender.perf.test.ts`）。

| 场景 | 作用骨骼数 | 帧耗时 P50（ms） | 帧耗时 P95（ms） | 帧率影响（@60fps 预算 16.67ms） |
|------|-----------|-----------------|-----------------|--------------------------------|
| 单图层（base only） | 0 | 基线 | 基线 | 基线 |
| 双图层（gaze scope，2 leaf 骨） | 2 | 0.0044 | 0.0106 | 可忽略（<0.1%） |
| 双图层（上半身，前10根骨/大子树） | 10 | 0.9216 | 1.4639 | ~8.8% |
| 三图层（上半身，前30根骨） | 30 | 1.3954 | 1.7991 | ~10.8% |
| 三图层（全骨骼 `['*']`，min(300,774)） | 300 | 2.1592 | 2.6810 | ~16%（仅混合成本，不含物理） |
| JS 运行时 composite（对照） | — | — | — | 原生 `MmdCompositeAnimation`，不叠加本 ADR 混合（性能详见 §3.2/§3.3 预估） |

**结论**：单帧图层混合成本由「作用骨数 + 子树深度」主导（前 10 根骨多为根部骨骼→大子树→传播成本陡增）；图层层数仅增加 O(层) 的 entries 循环，影响可忽略。默认 `DEFAULT_LAYER_BONE_FILTER`（上半身/上肢核心骨）将作用集控制在 10–30 骨区间，单帧混合 <2ms，满足 60fps 预算；全骨骼覆盖（`['*']`）需用户在 UI 确认性能影响（§3.3 约束），实测 300 骨 <2.7ms 仍可控。

---

## 十、审核记录

- **2026-07-06** 用户审核批准，签署意见：✅ 批准实施。审核意见已吸收至 §3.3（性能预估 + 默认 boneFilter）、§4.1（Bezier 一致性 + 首尾帧 + 内存）、§4.3（单 observer 时序）、§4.4（Slerp + 权重归一化）、§五（Phase 1 单测覆盖率 / Phase 2 默认 boneFilter / Phase 3 feature flag / Phase 5 性能基准写入 §九）。
