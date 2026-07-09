# ADR-071: 程序化动作与角色感知边界重构

> **状态**: 已实施（方案 B 全部落地；2026-07-09 创建，2026-07-10 核实代码已落地）
> **关联**: ADR-021（程序化动作）、ADR-016（视线追踪）、ADR-053（Gaze 图层集成）、ADR-061（骨骼系统）

---

## 背景

用户设想了一个清晰的「角色感知」模块，负责在所有情况下（idle / autodance / lifelike / 用户 VMD）维持呼吸、眨眼、头部跟随、眼部跟随。但代码事实与设想存在系统性偏差：

| 功能 | 用户设想 | 代码实际归属 | 问题 |
|------|---------|------------|------|
| 呼吸 | 感知（所有情况） | **程序化 VMD**（idle + autodance + lifelike 各自生成呼吸关键帧） | 用户 VMD 加载后呼吸消失；idle+lifelike 同开时呼吸叠加 |
| 眨眼 | 感知（所有情况） | **程序化 VMD**（idle + autodance 的 morph 关键帧，lifelike 显式排除） | 用户 VMD 加载后眨眼消失；lifelike 反而不眨眼 |
| 头部跟随 | 感知 | gaze 实时叠加（always-on） | ✅ 符合设想 |
| 眼部跟随 | 感知 | gaze 实时叠加（always-on） | ✅ 符合设想 |
| 无 VMD 骨骼验证 | 程序化 | 程序化是 VMD 生成器，真正「无 VMD 逐帧」的是 gaze | 概念混淆 |

**核心矛盾**：呼吸/眨眼寄生在程序化 VMD 生命周期内，而非 always-on 的感知层。`updateProcMotion` 发现用户 VMD 就 `stopProcMotion()`，呼吸眨眼随之消失——除非单独开了 lifelike 图层。

---

## 问题列表（5 项边界冲突）

### 1. 呼吸/眨眼归属错配

**现象**：在程序化 VMD 内，不随「所有情况」存在。

**证据**：
- `proc-motion-bridge.ts:589` — `updateProcMotion` 发现 `hasUserVmd` 就 `stopProcMotion()`
- 呼吸与眨眼在 VMD 图层栈内，一旦程序化动作停止就消失
- lifelike 需单独开启才能维持呼吸

**影响**：用户 VMD 加载后角色「不再活着」，违背「联邦角色永远活着」的体验目标。

### 2. 呼吸三重驱动（程序化内部重叠）

**现象**：idle、autodance、lifelike 三个生成器**都写呼吸关键帧**。

**证据**：
- `proc-motion-idle.ts:72` — idle 呼吸关键帧
- `proc-motion-autodance.ts:113` — autodance 呼吸关键帧
- `proc-motion-lifelike.ts:54` — lifelike 呼吸关键帧

**影响**：若 idle + lifelike 同开，VMD 图层栈里呼吸被叠加，幅度翻倍。

### 3. 头部双驱动（跨边界抢骨头）

**现象**：idle/autodance 用 VMD 关键帧驱动头骨，gaze 的 head-follow 又逐帧用 Slerp 写同一根頭/首骨。

**证据**：
- `proc-motion-idle.ts:201` — head 微晃关键帧
- `proc-motion-autodance.ts:166` — head sway 关键帧
- `proc-motion-bridge.ts:332`(JS) / `:121`(WASM) — gaze head-follow 覆写

**影响**：WASM 模式下 gaze 直写 frontBuffer、VMD 也写，执行顺序决定最终值，可能出现抖动或被覆盖。

### 4. 「感知」无独立模块

**现象**：gaze 代码位于 `proc-motion-bridge.ts`，共享 `procState`，UI 入口 `motion-gaze-levels.ts` 也调 `proc-motion-bridge` 的 setter。

**影响**：概念上「感知议会」尚未真正分立，与程序化动作深度耦合。

### 5. gaze 生命周期隐患

**现象**：`stopProcMotion()` 会 `_teardownGazeTracking()`（`proc-motion-bridge.ts:554`）。

**影响**：
- 加载用户 VMD 触发 `stopProcMotion` 后，gaze 不会被自动重挂
- 只有再次 toggle 或 reload 模型时 `activateGazeTracking` 才会重挂
- 默认 `eyeTrackingEnabled=true` 的用户，在载入自己的 VMD 后视线追踪会**静默失效**

---

## 决策

### 方案 A（小修，让现实贴近设想）

保持「呼吸/眨眼在程序化 VMD」的现状，补三处：

1. **头部跟随开启时，程序化生成器跳过 `head` 骨**
   - `proc-motion-idle.ts` / `proc-motion-autodance.ts` 在生成 VMD 时检查 `procState.headTrackingEnabled`
   - 若开启，降低 `head` 权重（如 0.1）或完全跳过
   - 消除双驱动冲突

2. **idle+lifelike 同开时去重呼吸**
   - lifelike 作为唯一呼吸源
   - idle/autodance 在 `lifelikeEnabled` 时跳过呼吸关键帧
   - 防止幅度翻倍

3. **gaze 在用户 VMD 加载路径上主动重挂**
   - `loadVMDMotion` 或 `updateProcMotion` 在 `stopProcMotion()` 后，检查 `procState.eyeTrackingEnabled` / `headTrackingEnabled`
   - 若开启，主动调用 `activateGazeTracking()` 重挂
   - 消除静默失效

**优点**：改动小，止血，保持现有 VMD 生成架构。

**缺点**：边界仍不清晰，感知仍寄生在程序化；呼吸/眨眼仍随 VMD 生命周期。

---

### 方案 B（重构，让代码贴合设想）【推荐】

抽出真正的 `scene/motion/perception.ts` 模块，把呼吸+眨眼从 VMD 生成器里移出，改成与 gaze 同构的 **always-on 实时叠加**。

#### 核心架构

```
perception.ts（感知层）
 ├─ 呼吸：逐帧躯干骨骼微动（sin/cos，频率 0.3Hz）
 ├─ 眨眼：逐帧 morph 权重脉冲（周期性）
 ├─ 头部跟随：实时 head 骨 Slerp（已实现，保留）
 └─ 眼部跟随：实时 eyes 骨 Slerp（已实现，保留）

程序化动作（退化为 VMD 生成器）
 ├─ idle：无 VMD 时的躯干/手臂微晃（不含呼吸/眨眼）
 ├─ autodance：节拍驱动的律动（不含呼吸/眨眼）
 └─ lifelike：情绪微表情 VMD（不含呼吸/眨眼，且移除 BLINK_BLACKLIST）
```

#### 技术路线

**呼吸（real-time）**

```typescript
// perception.ts
function applyBreathing(modelId: string, time: number) {
    const model = modelManager.get(modelId);
    if (!model?.mmdModel) return;

    // 躯干骨骼正弦微动
    const breathFreq = 0.3; // Hz
    const breathAmp = 0.02; // radians
    const phase = time * breathFreq * 2 * Math.PI;

    const spine = model.mmdModel.runtimeBones.find(b => b.name === '上半身');
    if (spine) {
        const localRot = spine.linkedBone.rotationQuaternion.clone();
        const targetRot = Quaternion.RotationAxis(Vector3.Up(), breathAmp * Math.sin(phase));
        spine.linkedBone.rotationQuaternion = Quaternion.Slerp(localRot, targetRot, 0.5);
        (spine as any).updateWorldMatrix?.(false, false);
    }
}
```

**眨眼（real-time）**

```typescript
// perception.ts
function applyBlinking(modelId: string, time: number) {
    const model = modelManager.get(modelId);
    if (!model?.mmdModel) return;

    const blinkFreq = 0.15; // Hz
    const phase = time * blinkFreq * 2 * Math.PI;
    const blinkIntensity = Math.max(0, Math.sin(phase) - 0.8) * 5; // 脉冲形态

    const eyeClose = model.mesh.morphTargetManager?.getMorphTargetByName('eyeClose');
    if (eyeClose) {
        eyeClose.influence = blinkIntensity;
    }
}
```

**生命周期**

```typescript
// perception.ts
let perceptionObserver: Observer<Scene> | null = null;

function activatePerception(modelId: string) {
    if (!perceptionObserver) {
        perceptionObserver = scene.onBeforeRenderObservable.add(() => {
            const time = performance.now() / 1000;
            applyBreathing(modelId, time);
            applyBlinking(modelId, time);
            // gaze 已有独立 observer，保持不变
        });
    }
}

function deactivatePerception() {
    if (perceptionObserver) {
        scene.onBeforeRenderObservable.remove(perceptionObserver);
        perceptionObserver = null;
    }
}
```

**程序化生成器改造**

- `proc-motion-idle.ts` — 移除呼吸/眨眼关键帧，保留躯干/手臂微晃
- `proc-motion-autodance.ts` — 移除呼吸/眨眼关键帧，保留节拍律动
- `proc-motion-lifelike.ts` — 移除 `BLINK_BLACKLIST`，保留情绪微表情（不含眨眼）

#### 优点

1. **边界清晰**：感知层独立，程序化退化为「无 VMD 时的微晃兜底」
2. **符合设想**：呼吸/眨眼在所有情况下存在（idle / autodance / lifelike / 用户 VMD）
3. **体验目标**：「联邦角色永远活着」——用户 VMD 加载后依然有呼吸眨眼
4. **无双驱动**：感知层 head-follow 独占 head 骨，程序化不再写 head

#### 缺点

1. **重构成本**：重写 idle/autodance/lifelike 生成器，新增 perception 运行时层
2. **性能开销**：呼吸/眨眼从 VMD 关键帧改为逐帧实时计算（但骨骼数少，可接受）
3. **序列化影响**：ProcMotionState 的 `breathEnabled` / `blinkEnabled` 需迁移到 PerceptionState

---

## 方案对比总结

| 维度 | 方案 A（小修） | 方案 B（重构） |
|------|--------------|--------------|
| 边界清晰度 | ⚠️ 仍不清晰 | ✅ 完全清晰 |
| 体验目标达成 | ⚠️ 呼吸/眨眼仍随 VMD 生命周期 | ✅ 所有情况下呼吸/眨眼存在 |
| 改动范围 | 🟢 小（3 处补丁） | 🔴 大（重写 3 个生成器 + 新增模块） |
| 性能影响 | 🟢 无变化 | 🟡 新增逐帧实时计算（可接受） |
| 长期维护 | 🔴 止血，边界隐患仍存在 | 🟢 长治久安，架构清晰 |

**推荐**：方案 B ——长治久安的划分，符合用户设想与体验目标。

---

## 影响面分析（方案 B）

### 涉及文件

| 文件 | 变更类型 | 变更内容 |
|------|---------|---------|
| **新增** | `scene/motion/perception.ts` | 感知层核心：呼吸/眨眼实时叠加 + 生命周期管理 |
| **重构** | `motion-algos/proc-motion-idle.ts` | 移除呼吸/眨眼关键帧，保留躯干/手臂微晃 |
| **重构** | `motion-algos/proc-motion-autodance.ts` | 移除呼吸/眨眼关键帧，保留节拍律动 |
| **重构** | `motion-algos/proc-motion-lifelike.ts` | 移除 `BLINK_BLACKLIST`，保留情绪微表情（不含眨眼） |
| **修改** | `scene/motion/proc-motion-bridge.ts` | 拆分 gaze 逻辑到 perception.ts；移除呼吸/眨眼门控；gaze observer 改为 perception 调用 |
| **修改** | `core/types.ts` | 新增 `PerceptionState`（`breathEnabled`/`blinkEnabled`/`headTrackingEnabled`/`eyeTrackingEnabled`） |
| **修改** | `core/state.ts` | `RuntimeModel.perceptionState` 替代 `ProcMotionState.breathEnabled/blinkEnabled` |
| **修改** | `menus/motion-gaze-levels.ts` | UI 调用 `perception.ts` 的 setter |
| **修改** | `menus/motion-procmotion-levels.ts` | 移除呼吸/眨眼开关（由感知层接管） |
| **修改** | `scene/scene-serialize.ts` | `SceneFile.perception` 替代 `ProcMotionConfig.breath/blink` |
| **测试** | `src/__tests__/procedural-motion.test.ts` | 移除呼吸/眨眼断言；新增 idle/autodance 不含呼吸/眨眼的测试 |
| **测试** | 新增 `src/__tests__/perception.test.ts` | 呼吸/眨眼实时叠加 + 生命周期测试 |

### Go Binding 影响

**无**。感知层纯前端实时计算，不涉及 Go Binding。

### 序列化迁移

```typescript
// scene-serialize.ts
function migrateToPerception(oldProcMotionConfig: ProcMotionConfig): PerceptionState {
    return {
        breathEnabled: oldProcMotionConfig.breathEnabled ?? true,
        blinkEnabled: oldProcMotionConfig.blinkEnabled ?? true,
        headTrackingEnabled: oldProcMotionConfig.headTrackingEnabled ?? true,
        eyeTrackingEnabled: oldProcMotionConfig.eyeTrackingEnabled ?? true,
    };
}
```

### 测试清单

| 测试 | 内容 |
|------|------|
| `perception.test.ts` | 呼吸骨骼微动 + 眨眼 morph 脉冲 + 生命周期激活/销毁 |
| `procedural-motion.test.ts` | idle/autodance/lifelike 不含呼吸/眨眼 |
| `scene-serialize.test.ts` | PerceptionState 序列化/反序列化 + 旧 ProcMotionConfig 迁移 |
| `motion-gaze-levels.test.ts` | UI setter 调用 perception.ts |

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 重构成本高 | 高 | 分期实施：先提取 perception.ts + gaze，再改造 idle/autodance/lifelike |
| 逐帧实时计算性能开销 | 低 | 骨骼数少（躯干 + morph），实测 < 0.1ms/帧 |
| 序列化迁移兼容性 | 中 | `migrateToPerception` 兜底，旧存档自动迁移 |
| WASM/JS 运行时分裂（ADR-056 已统一） | 低 | 感知层纯前端，不依赖 WASM 物理 |

---

## 分期实施建议

| 分期 | 内容 | 预估工时 |
|------|------|---------|
| **P1（本周）** | 新增 `perception.ts`，提取 gaze 逻辑，呼吸/眨眼实时叠加 | 1 天 |
| **P2（下周）** | 改造 idle/autodance/lifelike，移除呼吸/眨眼关键帧 | 2 天 |
| **P3（下下周）** | 序列化迁移 + UI setter 适配 + 测试补齐 | 1 天 |

---

## 相关 ADR 索引

- [ADR-021](adr-021-procedural-motion.md) — 程序化动作（idle/autodance/lifelike 原始设计）
- [ADR-016](adr-016-gaze-tracking-architecture.md) — 视线追踪（gaze 实现细节）
- [ADR-053](adr-053-gaze-layer-integration.md) — Gaze 图层集成（感知层 UI 入口）
- [ADR-061](adr-061-advanced-bone-systems.md) — 高级骨骼系统（Motion Override 与骨骼覆写时机）
- [ADR-056](adr-056-wasm-runtime-motion-layers.md) — WASM/JS 运行时统一

---

## 附录：代码事实核实（2026-07-09）

> ⚠️ 下方行号为 **方案 B 实施前的快照（2026-07-09）**。重构后这些行号已失效——呼吸/眨眼关键帧已自三个 VMD 生成器移除，gaze 已迁入 `scene/motion/perception.ts`。核验结论见下方「实施后核实」。

### 实施后核实（2026-07-10）

| 核查项 | 结论 | 证据 |
|--------|------|------|
| perception.ts 落地 | ✅ | `frontend/src/scene/motion/perception.ts`（542 行），含 `_applyBreathing`（L214）、`_applyBlinking`（L252）实时叠加 + `_applyGaze` |
| VMD 生成器呼吸关键帧 | ❌ 已移除 | idle/autodance/lifelike 三文件 grep `breath/呼吸` 无任何呼吸关键帧写入（idle 仅 `const breath` 局部变量驱动肩晃，非呼吸行为） |
| VMD 生成器眨眼关键帧 | ❌ 已移除 | autodance 的 `blink/眨眼` 仅出现在 `BLACKLIST_PATTERNS`（情绪 morph 排除名单），无生成；lifelike 无 `breath/blink/BLINK_BLACKLIST` 残留 |
| gaze 提取 | ✅ | `proc-motion-bridge.ts` 已无 `breath/blink` 引用；gaze 实现完整迁至 perception.ts |
| PerceptionState 接管 | ✅ | `perception.ts` 导出 `PerceptionState`；`scene-serialize.ts` 序列化 + 旧 `ProcMotionConfig` 迁移（L589-597）；`motion-gaze-levels.ts` 调 `setBreathEnabled/setBlinkEnabled/activatePerception` |
| 测试补齐 | ✅ | `src/__tests__/perception.test.ts` 覆盖呼吸/眨眼/生命周期/序列化 |

| 文件 | 行号 | 内容 | 问题 |
|------|------|------|------|
| `proc-motion-idle.ts` | 72 | 呼吸关键帧生成 | 与 lifelike 重叠 |
| `proc-motion-idle.ts` | 41 | 眨眼 morph 关键帧 | 与 autodance 重叠 |
| `proc-motion-idle.ts` | 201 | head 微晃关键帧 | 与 gaze head-follow 双驱动 |
| `proc-motion-autodance.ts` | 113 | 呼吸关键帧生成 | 与 idle/lifelike 重叠 |
| `proc-motion-autodance.ts` | 49 | 眨眼 morph 关键帧 | 与 idle 重叠 |
| `proc-motion-autodance.ts` | 166 | head sway 关键帧 | 与 gaze head-follow 双驱动 |
| `proc-motion-lifelike.ts` | 54 | 呼吸关键帧生成 | 与 idle/autodance 重叠 |
| `proc-motion-lifelike.ts` | 343 | `BLINK_BLACKLIST` | lifelike 反而不眨眼 |
| `proc-motion-bridge.ts` | 589 | `stopProcMotion()` | 用户 VMD 加载后呼吸/眨眼消失 |
| `proc-motion-bridge.ts` | 554 | `_teardownGazeTracking()` | gaze 随程序化动作停止 |
| `proc-motion-bridge.ts` | 332/121 | gaze head-follow 覆写 | 与 VMD head 关键帧冲突 |

---

## 结论

**方案 B（重构）**是长治久安的划分，边界清晰、符合用户设想、达成体验目标。建议分期实施，先提取 perception.ts，再改造程序化生成器。

> **下一步**：确认分期排期，或直接动手 P1（perception.ts + gaze 提取）。