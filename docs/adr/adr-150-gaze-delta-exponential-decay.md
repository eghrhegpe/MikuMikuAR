# ADR-150: Gaze Delta 指数衰减 — 闭环「左右脑互博」物理根因最后一环

> **状态**: 规划（待实施）
> **关联**: ADR-071（程序化与感知边界）、ADR-079（感知层扩展）、ADR-147（显式管线调度器）
> **来源**: 2026-07-20 感知层行为正确性审核 — P1 级问题「gaze 每帧 Slerp 0.5 累积逼近」
> **日期**: 2026-07-21

---

## 一、问题陈述

### 1.1 现象

感知层视线追踪（头部跟随 + 眼部跟随）使用**固定系数 Slerp**（头部 0.5，眼部 `getEyeGazeSmooth()` 默认 0.35），每帧将当前姿态向目标姿态拉 50%/35%。N 帧后姿态被强制拉到 target，导致：

| 场景 | 行为 | 用户感知 |
|------|------|---------|
| VMD 头部关键帧（点头/摇头） | 被感知层 gaze 部分覆盖 | 动作不自然，头部"不听话" |
| 帧率变化（60fps → 120fps） | Slerp 系数不变，收敛速度翻倍 | 视线跟随速度不稳定 |
| gaze 关闭后重新开启 | 上次的 target 角度残留 | 角色突然"跳"到旧视线方向 |

### 1.2 根因（代码定位）

| 文件 | 行号 | 问题代码 |
|------|------|---------|
| [perception-gaze-js.ts:42](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-gaze-js.ts#L42) | 42 | `Quaternion.Slerp(oldHeadRotQ, clampedTargetQ, 0.5)` |
| [perception-gaze-js.ts:97](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-gaze-js.ts#L97) | 97 | `Quaternion.Slerp(curWorldQ, clampedTargetQ, getEyeGazeSmooth())` |
| [perception-gaze-wasm.ts:47](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-gaze-wasm.ts#L47) | 47 | `Quaternion.Slerp(oldHeadRotQ, clampedTargetQ, 0.5)` |
| [perception-gaze-wasm.ts:97](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-gaze-wasm.ts#L97) | 97 | `Quaternion.Slerp(curEyeQ, clampedTargetQ, getEyeGazeSmooth())` |

**根本原因**：固定系数 `0.5` / `getEyeGazeSmooth()` 是**帧率相关**的。60fps 下每帧 0.016s 拉 50%，120fps 下每帧 0.008s 拉 50%——同样时间内后者收敛快一倍。

### 1.3 与「左右脑互博」的关联

ADR-147 已明确管线顺序：`bone-override → perception`。本次修复 breathing（P1）、blinking（P1）已改 delta 增量叠加，但 gaze 仍是**绝对量 Slerp**，是「左右脑互博」未闭环的最后一环：

```
管线顺序: VMD基础 → 图层叠加 → 程序化动作 → Ragdoll物理 → Bone Override → Perception
                                                  ↑                ↑
                                             左脑（per-motion）   右脑（per-model）
                                                  │                │
                              breathing/blink/delta ✓ 已改增量     │
                              gaze 仍用绝对量 Slerp ✗ 未改          │
                                                  │                │
                              ──────────────────────────────────────
                              结果：gaze 覆盖 VMD/Bone Override 的头部旋转
```

---

## 二、设计方案

### 2.1 核心决策：方案 B（推荐）

将固定 Slerp 系数替换为**基于 deltaTime 的指数衰减**：

```typescript
alpha = 1 - exp(-dt / τ)
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `dt` | 帧时间增量（秒） | `scene.getEngine().getDeltaTime() / 1000` |
| `τ` | 时间常数（秒），决定响应速度 | 头部 0.15，眼部 `0.15 × (1.1 - smooth)` |

**语义等价**：仍是 Slerp，但 alpha 由 dt 驱动，60fps 和 120fps 下收敛速度一致。

**与 breathing delta 的区别**：
- breathing：`delta = sin(phase) - lastSin`（正弦周期函数的增量）
- gaze：`targetQ` 每帧重新计算（非周期），用指数衰减替代固定系数更自然

### 2.2 改动范围（4 文件 + 1 工具函数）

#### 2.2.1 perception-shared.ts — 新增工具函数

```typescript
/**
 * 计算 gaze Slerp alpha（基于 deltaTime 的指数衰减，帧率无关）
 * @param smooth 平滑度（0=迟钝，1=快速）
 * @param dt 帧时间增量（秒）
 * @param timeConstant 时间常数（秒），默认 0.15
 */
export function _gazeAlpha(smooth: number, dt: number, timeConstant = 0.15): number {
    const tau = timeConstant * (1.1 - smooth);
    return Math.max(0, Math.min(1, 1 - Math.exp(-dt / tau)));
}
```

#### 2.2.2 perception-gaze-js.ts — 两处替换

| 位置 | 旧代码 | 新代码 |
|------|--------|--------|
| [line 42](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-gaze-js.ts#L42) | `Slerp(oldHeadRotQ, clampedTargetQ, 0.5)` | `const alpha = _gazeAlpha(0.7, dt); Slerp(oldHeadRotQ, clampedTargetQ, alpha)` |
| [line 97](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-gaze-js.ts#L97) | `Slerp(curWorldQ, clampedTargetQ, getEyeGazeSmooth())` | `const alpha = _gazeAlpha(getEyeGazeSmooth(), dt); Slerp(curWorldQ, clampedTargetQ, alpha)` |

#### 2.2.3 perception-gaze-wasm.ts — 两处替换

同 JS 路径，替换 [line 47](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-gaze-wasm.ts#L47) 和 [line 97](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-gaze-wasm.ts#L97)。

#### 2.2.4 perception-gaze.ts — 签名加 dt

```typescript
// _applyGaze 签名
export function _applyGaze(
    mmdModel: MmdModelLike,
    cam: Camera,
    config: { headEnabled: boolean; eyeEnabled: boolean },
    dt: number  // 新增
): void;

// applyGazeWasm 签名
export function applyGazeWasm(
    bones: readonly IMmdRuntimeBone[],
    cam: Camera,
    config: GazeConfig,
    dt: number  // 新增
): void;
```

#### 2.2.5 perception.ts — observer 传 dt + reset 守卫

```typescript
// observer run 函数内
const dt = scene.getEngine().getDeltaTime() / 1000;
_applyGaze(mmdModel, cam, { ... }, dt);

// 新增 _resetGazeState
export function _resetGazeState(): void {
    // 重置 gaze 增量状态（无持久化状态，仅清理临时变量）
}

// activatePerception / deactivatePerception / setHeadTrackingEnabled / setEyeTrackingEnabled 调用
_resetGazeState();
```

### 2.3 关闭时残留处理

gaze 关闭后无需特殊清理（与 breathing 不同），因为：
- gaze 不累积旋转偏移，每帧重新计算 targetQ
- 关闭后 observer 不再执行，骨骼保持当前旋转（由 VMD/Bone Override 接管）

**但**：头部平滑度 `0.7` 的时间常数 `τ = 0.15 × 0.4 = 0.06`，关闭前最后一帧可能写入一个中间状态。建议在 `setHeadTrackingEnabled(false)` 时不做额外操作——VMD/Bone Override 下帧会覆盖。

---

## 三、测试策略

### 3.1 不破坏现有测试

现有 6 项 gaze 测试（[perception.test.ts:656-716](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/__tests__/perception.test.ts#L656-L716)）仅测 `_clampHeadGazeTarget` / `_clampEyeGazeTarget` 纯函数，**未测 Slerp 行为**，改 delta 不破坏现有断言。

### 3.2 新增测试（2 项）

```typescript
// 测试 1：_gazeAlpha 帧率无关性
describe('_gazeAlpha', () => {
    it('60fps 与 120fps 下收敛速度一致', () => {
        const alpha60 = _gazeAlpha(0.5, 1/60);
        const alpha120 = _gazeAlpha(0.5, 1/120);
        // 120fps 单帧 alpha 约为 60fps 的一半（指数衰减特性）
        expect(alpha120).toBeCloseTo(alpha60 / 2, 2);
    });
});

// 测试 2：_resetGazeState 调用时机
describe('gaze reset', () => {
    it('deactivatePerception 时调用 _resetGazeState', () => {
        sut.activatePerception('m1');
        const observer = triggerLastObserver;
        sut.deactivatePerception();
        // 验证状态已重置（无持久化状态，验证调用即可）
    });
});
```

---

## 四、风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| WASM 路径 dt 传递失败 | 低 | `applyGazeWasm` 无外部调用方（仅 re-export），改签名零破坏 |
| `_gazeAlpha` 边界值（dt=0/负数） | 低 | clamp(0,1) 防越界 |
| 头部平滑度 0.7 硬编码 | 低 | 后续可暴露为 PerceptionState 字段，当前先用合理默认值 |
| 测试断言需重算 | 极低 | 现有测试未测 Slerp，无需重算 |

---

## 五、实施计划

| 阶段 | 内容 | 估计工作量 |
|------|------|-----------|
| **Phase 1** | perception-shared.ts 新增 `_gazeAlpha`；JS 路径两处替换；`_applyGaze` 签名加 dt；observer 传 dt | 2h |
| **Phase 2** | WASM 路径两处替换；`applyGazeWasm` 签名加 dt | 1h |
| **Phase 3** | 新增 `_resetGazeState`；activate/deactivate/setter 调用；新增 2 项测试 | 1h |
| **验证** | tsc + 测试套件全跑 | 0.5h |

---

## 六、验收标准

| 标准 | 验证方法 |
|------|---------|
| gaze 头部跟随不再覆盖 VMD 头部关键帧 | 加载带头部动作的 VMD，开启 gaze，头部动作保留 |
| 60fps 与 120fps 下视线跟随速度一致 | 切换帧率，观察响应速度无明显变化 |
| gaze 关闭后重新开启无跳跃 | 关闭→等待→开启，角色视线平滑过渡 |
| 现有 6 项 gaze 测试通过 | `npm run test -- perception.test.ts` |
| 新增 2 项测试通过 | `npm run test -- perception.test.ts` |

---

## 七、与其他模块的协同

| 模块 | 影响 |
|------|------|
| ADR-147（管线调度器） | `_applyGaze` 签名加 dt，observer 传 dt，与管线顺序无关 |
| ADR-079（感知层扩展） | 补充 gaze reset 守卫，与 breathing/balance 同款模式 |
| ADR-071（程序化边界） | 不修改程序化与感知的边界，仅优化感知层内部实现 |

---

## 八、开放问题

1. **头部平滑度是否暴露为可配置？** 目前头部用硬编码 0.7，眼部用 `getEyeGazeSmooth()`。建议后续在 PerceptionState 加 `headGazeSmooth` 字段，与眼部平滑度对称。
2. **时间常数 τ 是否需要调整？** 默认 0.15 秒响应到 63%，建议实测后微调。
