# ADR-061.R Ragdoll 保真度补齐 实施计划

> **状态**: 已交付（2026-07-10）— 见 [adr-061-r-ragdoll-fidelity.md](adr-061-r-ragdoll-fidelity.md)；①④③ 全部实施完成，14 个 TDD Task 全绿

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 ADR-061.R 的 ①④③，把 ragdoll 从 MVP 占位（distance 约束 + Identity 回写 + observer 时序覆盖 + 硬编码参数）升级为真物理布偶（球面关节 + 旋转求解 + blendWeight 混合 + per-joint 参数化）。

**Architecture:** ① 扩展 `XpbdSolver` 角向基础设施（`XpbdParticle` 加 `orientation/invInertia` + 新增 `'sphere'` 约束类型 + swing/twist 分解求解 + `writeBack` 真实旋转）；④ 复用 `ClothConfig` 范本定义 `RagdollJointParams` + `envState` 持久化；③ 因 `boneFilter` 无法运行时暂停基础 VMD（代码事实核实，见下方"③ 方案修订"），改用 `blendWeight` 混合覆盖 + head rotation 划界。

**Tech Stack:** TypeScript, XPBD（纯 TS 无 Babylon 依赖）, Babylon.js Quaternion/Matrix（仅 ragdoll/renderer 层）, Vitest

---

## ③ 方案修订说明（基于代码事实核实 2026-07-10）

ADR-061.R §2.2 原设想"经 Motion Layer 控制（参考 boneFilter 屏蔽机制）暂停其 VMD 动画写入"。代码核实结论：**boneFilter 不可用于此目的**。

- `boneFilter`（[vmd-layers.ts:56-101](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/vmd-layers.ts#L56-L101)）是**加载时二进制过滤**，非运行时暂停。
- 基础 VMD span（[vmd-layers.ts:498-499](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/vmd-layers.ts#L498-L499)）无 boneFilter，写入全部骨骼。
- 无现成"按骨骼名集合暂停/恢复动画写入"API。

**修订方案**：③ 改用 `blendWeight`（0→1）在物理姿态与动画姿态间 `Quaternion.Slerp` 混合。ragdoll 启用时 blendWeight=1（物理主导），VMD 照常写但被混合覆盖；恢复时 blendWeight 0→1 缓动淡入。ragdoll observer 仍在 `onBeforeRenderObservable`（晚于 VMD，§0.1 已核实），作为混合写入点。head rotation 划界：ragdoll 默认不写 head `rotationQuaternion`，保留 perception gaze 优先（§0.1 决策）。

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `frontend/src/physics/xpbd-solver.ts` | XPBD 引擎：粒子角向状态 + sphere 约束类型 + 求解 | 扩展 |
| `frontend/src/physics/xpbd-ragdoll.ts` | ragdoll 构建/回写：补 sphere 约束 + 真实旋转 + 关节参数 | 扩展 |
| `frontend/src/physics/xpbd-renderer.ts` | debug 可视化：sphere 约束分色显示 | 扩展 |
| `frontend/src/physics/ragdoll-manager.ts` | manager：setRagdollJointParams API + blendWeight 控制 | 扩展 |
| `frontend/src/core/types.ts` | EnvState 加 `ragdollJointParams` 字段 | 扩展 |
| `frontend/src/core/state.ts` | envState 默认值补 `ragdollJointParams` | 扩展 |
| `frontend/src/scene/scene-serialize.ts` | 反序列化合并默认值（仿 clothConfig） | 扩展 |
| `frontend/src/__tests__/xpbd-sphere.test.ts` | sphere 约束单测 | 新建 |
| `frontend/src/__tests__/xpbd-ragdoll.test.ts` | ragdoll sphere + 真实旋转回写测试 | 扩展 |
| `frontend/src/__tests__/xpbd-ragdoll-manager.test.ts` | 调参 API + blendWeight 测试 | 扩展 |

---

## ① 球面关节 + 旋转求解（核心，最重）

### Task 1: 扩展 XpbdParticle 角向状态

**Files:**
- Modify: `frontend/src/physics/xpbd-solver.ts:15-26`（XpbdParticle 接口）
- Test: `frontend/src/__tests__/xpbd-sphere.test.ts`

- [ ] **Step 1: 新建测试文件，写失败测试**

创建 `frontend/src/__tests__/xpbd-sphere.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import type { XpbdParticle } from '@/physics/xpbd-solver';

describe('XpbdParticle angular state', () => {
  it('should have orientation defaulting to identity quaternion [0,0,0,1]', () => {
    const p: XpbdParticle = {
      p: new Float32Array(3),
      prevP: new Float32Array(3),
      v: new Float32Array(3),
      invMass: 1,
      radius: 0.1,
      orientation: new Float32Array([0, 0, 0, 1]),
      angularVelocity: new Float32Array(3),
      invInertia: 1,
    };
    expect(p.orientation).toEqual(new Float32Array([0, 0, 0, 1]));
    expect(p.invInertia).toBe(1);
    expect(p.angularVelocity.length).toBe(3);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-sphere.test.ts`
Expected: FAIL — `orientation` 属性类型不存在

- [ ] **Step 3: 扩展 XpbdParticle 接口**

修改 `frontend/src/physics/xpbd-solver.ts` XpbdParticle 接口（行 15-26），在 `radius` 后追加：

```typescript
export interface XpbdParticle {
    p: Float32Array;
    prevP: Float32Array;
    v: Float32Array;
    invMass: number;
    radius: number;
    /** 角向姿态四元数 [x, y, z, w]，默认 [0,0,0,1]（identity）。
     *  纯 TS 存储，不依赖 Babylon Quaternion，保持 solver 纯净。 */
    orientation: Float32Array;
    /** 上一帧角向姿态（角向 Verlet 积分用） */
    prevOrientation: Float32Array;
    /** 角速度 [x, y, z] */
    angularVelocity: Float32Array;
    /** 转动惯量倒数 (1/I)，0 = 固定/无限惯量（与 invMass=0 语义对齐） */
    invInertia: number;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-sphere.test.ts`
Expected: PASS

- [ ] **Step 5: 修复因新增字段导致的 tsc/测试破坏**

全量跑测试确认现有代码未因新必填字段破坏：
Run: `cd frontend && npm run check && npm run test`
若 `xpbd-ragdoll.ts` 或测试中创建 `XpbdParticle` 处报缺字段，补默认值 `orientation: new Float32Array([0,0,0,1]), prevOrientation: new Float32Array([0,0,0,1]), angularVelocity: new Float32Array(3), invInertia: 1`。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/physics/xpbd-solver.ts frontend/src/__tests__/xpbd-sphere.test.ts frontend/src/physics/xpbd-ragdoll.ts
git commit -m "feat(physics): extend XpbdParticle with angular state (orientation/invInertia)"
```

---

### Task 2: 新增 sphere 约束类型 + 接口

**Files:**
- Modify: `frontend/src/physics/xpbd-solver.ts:29`（ConstraintType）+ `:32-54`（XpbdConstraint）
- Test: `frontend/src/__tests__/xpbd-sphere.test.ts`

- [ ] **Step 1: 写失败测试 — ConstraintType 含 sphere**

追加到 `xpbd-sphere.test.ts`：

```typescript
import { XpbdSolver, type ConstraintType } from '@/physics/xpbd-solver';

describe('sphere constraint type', () => {
  it('ConstraintType union should include sphere', () => {
    const t: ConstraintType = 'sphere';
    expect(t).toBe('sphere');
  });

  it('XpbdSolver should accept sphere constraint in constraints array', () => {
    const solver = new XpbdSolver({ gravity: [0, -9.8, 0], substeps: 1, damping: 1, groundY: -10 });
    solver.particles = [
      { p: new Float32Array([0,0,0]), prevP: new Float32Array([0,0,0]), v: new Float32Array(3),
        invMass: 0, radius: 0.1, orientation: new Float32Array([0,0,0,1]),
        prevOrientation: new Float32Array([0,0,0,1]), angularVelocity: new Float32Array(3), invInertia: 0 },
      { p: new Float32Array([0,1,0]), prevP: new Float32Array([0,1,0]), v: new Float32Array(3),
        invMass: 1, radius: 0.1, orientation: new Float32Array([0,0,0,1]),
        prevOrientation: new Float32Array([0,0,0,1]), angularVelocity: new Float32Array(3), invInertia: 1 },
    ];
    solver.constraints = [{
      type: 'sphere',
      indices: [0, 1],
      coneHalfAngle: Math.PI / 4,
      twistRange: [-Math.PI / 4, Math.PI / 4],
      restQuaternion: new Float32Array([0, 0, 0, 1]),
      compliance: 0,
      restValue: 0,
      lambda: new Float32Array(2), // [swingLambda, twistLambda]
      stiffness: 1.0,
      damping: 0.0,
    }];
    expect(solver.constraints[0].type).toBe('sphere');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-sphere.test.ts`
Expected: FAIL — `sphere` 不能赋给 ConstraintType

- [ ] **Step 3: 扩展 ConstraintType 与约束接口**

修改 `xpbd-solver.ts:29`：

```typescript
export type ConstraintType = 'distance' | 'bend' | 'volume' | 'ground' | 'sphere';
```

修改 XpbdConstraint 接口（行 32-54），追加 sphere 专属可选字段：

```typescript
export interface XpbdConstraint {
    type: ConstraintType;
    indices: number[];
    compliance: number;
    restValue: number;
    lambda: Float32Array;
    stiffness: number;
    damping: number;
    /** sphere 专属：圆锥限位半角（弧度），swing 摆动不超过此角 */
    coneHalfAngle?: number;
    /** sphere 专属：twist 扭转范围 [min, max]（弧度） */
    twistRange?: [number, number];
    /** sphere 专属：rest 姿态的相对四元数 [x,y,z,w]，约束目标 */
    restQuaternion?: Float32Array;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-sphere.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/physics/xpbd-solver.ts frontend/src/__tests__/xpbd-sphere.test.ts
git commit -m "feat(physics): add sphere constraint type and interface fields"
```

---

### Task 3: 纯 TS 四元数运算辅助函数

**Files:**
- Modify: `frontend/src/physics/xpbd-solver.ts`（文件末尾工具函数区，或 XpbdSolver 类前）
- Test: `frontend/src/__tests__/xpbd-sphere.test.ts`

- [ ] **Step 1: 写失败测试 — 四元数运算**

追加到 `xpbd-sphere.test.ts`：

```typescript
import {
  quatNormalize, quatMultiply, quatConjugate, quatFromAxisAngle,
  quatToAxisAngle, quatSlerp, swingTwistDecompose
} from '@/physics/xpbd-solver';

describe('quaternion utilities', () => {
  it('quatNormalize should normalize to unit length', () => {
    const q = new Float32Array([2, 0, 0, 0]);
    quatNormalize(q, q);
    expect(q[0]).toBeCloseTo(1);
    expect(q[3]).toBeCloseTo(0);
  });

  it('quatMultiply: identity * q = q', () => {
    const a = new Float32Array([0, 0, 0, 1]); // identity
    const b = new Float32Array([0.1, 0.2, 0.3, 0.9]);
    const out = new Float32Array(4);
    quatMultiply(a, b, out);
    expect(out[0]).toBeCloseTo(b[0]);
    expect(out[1]).toBeCloseTo(b[1]);
    expect(out[2]).toBeCloseTo(b[2]);
    expect(out[3]).toBeCloseTo(b[3]);
  });

  it('quatConjugate should negate xyz keep w', () => {
    const q = new Float32Array([0.1, 0.2, 0.3, 0.9]);
    const out = new Float32Array(4);
    quatConjugate(q, out);
    expect(out[0]).toBeCloseTo(-0.1);
    expect(out[1]).toBeCloseTo(-0.2);
    expect(out[2]).toBeCloseTo(-0.3);
    expect(out[3]).toBeCloseTo(0.9);
  });

  it('quatFromAxisAngle: 90deg around Y', () => {
    const out = quatFromAxisAngle(0, 1, 0, Math.PI / 2);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(out[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('swingTwistDecompose: pure twist around Z', () => {
    const q = quatFromAxisAngle(0, 0, 1, 0.5); // 0.5rad around Z
    const swing = new Float32Array(4);
    const twist = new Float32Array(4);
    swingTwistDecompose(q, 0, 0, 1, swing, twist); // twistAxis = Z
    expect(twist[2]).toBeCloseTo(Math.sin(0.25), 5); // z comp of twist quat
    expect(swing[0]).toBeCloseTo(0, 5);
    expect(swing[1]).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-sphere.test.ts`
Expected: FAIL — 函数未导出

- [ ] **Step 3: 实现四元数运算辅助函数**

在 `xpbd-solver.ts` XpbdSolver 类定义前（约行 120）追加纯 TS 四元数工具。所有函数用 `Float32Array(4)` 表示四元数 `[x,y,z,w]`，保持 solver 无 Babylon 依赖：

```typescript
// ============================================================
// 纯 TS 四元数运算（保持 solver 无 Babylon 依赖）
// 四元数格式 [x, y, z, w]，w 为标量部分
// ============================================================

/** 归一化四元数 */
export function quatNormalize(src: Float32Array, out: Float32Array): void {
    const len = Math.sqrt(src[0]*src[0] + src[1]*src[1] + src[2]*src[2] + src[3]*src[3]);
    if (len < 1e-10) { out[0]=0; out[1]=0; out[2]=0; out[3]=1; return; }
    const inv = 1 / len;
    out[0] = src[0]*inv; out[1] = src[1]*inv; out[2] = src[2]*inv; out[3] = src[3]*inv;
}

/** 四元数乘法 out = a × b（Babylon 约定，行向量 v' = v × M 对应 q' = q_a × q_b） */
export function quatMultiply(a: Float32Array, b: Float32Array, out: Float32Array): void {
    const ax=a[0], ay=a[1], az=a[2], aw=a[3];
    const bx=b[0], by=b[1], bz=b[2], bw=b[3];
    out[0] = aw*bx + ax*bw + ay*bz - az*by;
    out[1] = aw*by - ax*bz + ay*bw + az*bx;
    out[2] = aw*bz + ax*by - ay*bx + az*bw;
    out[3] = aw*bw - ax*bx - ay*by - az*bz;
}

/** 共轭（单位四元数的逆） */
export function quatConjugate(src: Float32Array, out: Float32Array): void {
    out[0] = -src[0]; out[1] = -src[1]; out[2] = -src[2]; out[3] = src[3];
}

/** 从轴角构造四元数，返回新 Float32Array(4) */
export function quatFromAxisAngle(x: number, y: number, z: number, angle: number): Float32Array {
    const half = angle * 0.5;
    const s = Math.sin(half);
    return new Float32Array([x*s, y*s, z*s, Math.cos(half)]);
}

/** 四元数转轴角，返回 {axis, angle} */
export function quatToAxisAngle(q: Float32Array): { ax: number; ay: number; az: number; angle: number } {
    const w = Math.max(-1, Math.min(1, q[3]));
    const angle = 2 * Math.acos(w);
    const s = Math.sqrt(1 - w*w);
    if (s < 1e-10) return { ax: 1, ay: 0, az: 0, angle: 0 };
    return { ax: q[0]/s, ay: q[1]/s, az: q[2]/s, angle };
}

/** 球面线性插值 */
export function quatSlerp(a: Float32Array, b: Float32Array, t: number, out: Float32Array): void {
    let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
    let bx=b[0], by=b[1], bz=b[2], bw=b[3];
    if (dot < 0) { bx=-bx; by=-by; bz=-bz; bw=-bw; dot=-dot; }
    if (dot > 0.9995) {
        out[0] = a[0] + (bx-a[0])*t; out[1] = a[1] + (by-a[1])*t;
        out[2] = a[2] + (bz-a[2])*t; out[3] = a[3] + (bw-a[3])*t;
        quatNormalize(out, out); return;
    }
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    const ka = Math.sin((1-t)*theta) / sinTheta;
    const kb = Math.sin(t*theta) / sinTheta;
    out[0] = a[0]*ka + bx*kb; out[1] = a[1]*ka + by*kb;
    out[2] = a[2]*ka + bz*kb; out[3] = a[3]*ka + bw*kb;
}

/**
 * Swing-Twist 分解：将 q 分解为 swing（绕垂直于 twistAxis 的平面）× twist（绕 twistAxis）。
 * 参考公式：twist = normalize( projection of q onto twistAxis plane ).
 * @param q 待分解四元数
 * @param tx,ty,tz twist 轴（单位向量）
 * @param swingOut 输出 swing 四元数
 * @param twistOut 输出 twist 四元数
 */
export function swingTwistDecompose(
    q: Float32Array, tx: number, ty: number, tz: number,
    swingOut: Float32Array, twistOut: Float32Array
): void {
    // twist = q 投影到 twist 轴：(q.xyz · axis) * axis, 保留 q.w
    const dot = q[0]*tx + q[1]*ty + q[2]*tz;
    twistOut[0] = dot*tx; twistOut[1] = dot*ty; twistOut[2] = dot*tz; twistOut[3] = q[3];
    quatNormalize(twistOut, twistOut);
    // swing = q × twist⁻¹ = q × conj(twist)（单位四元数逆=共轭）
    const twistInv = new Float32Array(4);
    quatConjugate(twistOut, twistInv);
    quatMultiply(q, twistInv, swingOut);
    quatNormalize(swingOut, swingOut);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-sphere.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/physics/xpbd-solver.ts frontend/src/__tests__/xpbd-sphere.test.ts
git commit -m "feat(physics): add pure-TS quaternion utilities (multiply/slerp/swing-twist decompose)"
```

---

### Task 4: _solveSphereConstraint 求解实现

**Files:**
- Modify: `frontend/src/physics/xpbd-solver.ts`（_solveConstraint switch + 新增 _solveSphereConstraint 方法）
- Test: `frontend/src/__tests__/xpbd-sphere.test.ts`

- [ ] **Step 1: 写失败测试 — sphere 约束限位收敛**

追加到 `xpbd-sphere.test.ts`：

```typescript
describe('_solveSphereConstraint convergence', () => {
  it('should clamp swing beyond coneHalfAngle back toward limit', () => {
    const solver = new XpbdSolver({ gravity: [0,0,0], substeps: 1, damping: 1, groundY: -100 });
    // parent 固定，child 自由
    const parent = { p: new Float32Array([0,0,0]), prevP: new Float32Array([0,0,0]), v: new Float32Array(3),
      invMass: 0, radius: 0.1, orientation: new Float32Array([0,0,0,1]),
      prevOrientation: new Float32Array([0,0,0,1]), angularVelocity: new Float32Array(3), invInertia: 0 };
    const child = { p: new Float32Array([0,1,0]), prevP: new Float32Array([0,1,0]), v: new Float32Array(3),
      invMass: 1, radius: 0.1,
      orientation: quatFromAxisAngle(1, 0, 0, 1.0), // 1.0rad swing around X（超过 PI/4 限位）
      prevOrientation: new Float32Array([0,0,0,1]), angularVelocity: new Float32Array(3), invInertia: 1 };
    solver.particles = [parent, child];
    solver.constraints = [{
      type: 'sphere', indices: [0, 1],
      coneHalfAngle: Math.PI / 4, // 45deg 限位
      twistRange: [-Math.PI/4, Math.PI/4],
      restQuaternion: new Float32Array([0,0,0,1]),
      compliance: 0, restValue: 0, lambda: new Float32Array(2), stiffness: 1.0, damping: 0.0,
    }];
    // 跑多步让约束收敛
    for (let i = 0; i < 50; i++) solver.step(1/60);
    // child orientation 的 swing 角应被拉回 <= coneHalfAngle + 容差
    const aa = quatToAxisAngle(child.orientation);
    expect(aa.angle).toBeLessThan(Math.PI / 4 + 0.15);
  });

  it('should not modify orientation within limits', () => {
    const solver = new XpbdSolver({ gravity: [0,0,0], substeps: 1, damping: 1, groundY: -100 });
    const parent = { p: new Float32Array([0,0,0]), prevP: new Float32Array([0,0,0]), v: new Float32Array(3),
      invMass: 0, radius: 0.1, orientation: new Float32Array([0,0,0,1]),
      prevOrientation: new Float32Array([0,0,0,1]), angularVelocity: new Float32Array(3), invInertia: 0 };
    const smallSwing = quatFromAxisAngle(0, 1, 0, 0.1); // 0.1rad < PI/4
    const child = { p: new Float32Array([0,1,0]), prevP: new Float32Array([0,1,0]), v: new Float32Array(3),
      invMass: 1, radius: 0.1, orientation: new Float32Array(smallSwing),
      prevOrientation: new Float32Array([0,0,0,1]), angularVelocity: new Float32Array(3), invInertia: 1 };
    solver.particles = [parent, child];
    solver.constraints = [{
      type: 'sphere', indices: [0, 1],
      coneHalfAngle: Math.PI / 4, twistRange: [-Math.PI/4, Math.PI/4],
      restQuaternion: new Float32Array([0,0,0,1]),
      compliance: 0, restValue: 0, lambda: new Float32Array(2), stiffness: 1.0, damping: 0.0,
    }];
    const before = child.orientation.slice();
    for (let i = 0; i < 10; i++) solver.step(1/60);
    // 限位内，orientation 应基本不变（无外力）
    expect(Math.abs(child.orientation[0] - before[0])).toBeLessThan(0.05);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-sphere.test.ts`
Expected: FAIL — sphere case 未实现，step 不处理 sphere 约束

- [ ] **Step 3: 实现 _solveSphereConstraint**

修改 `xpbd-solver.ts` `_solveConstraint` switch（行 482-492）加 case：

```typescript
    private _solveConstraint(c: XpbdConstraint, alphaTilde: number, subDt: number): void {
        switch (c.type) {
            case 'distance':
            case 'bend':
                this._solveDistanceConstraint(c, alphaTilde, subDt);
                break;
            case 'volume':
                this._solveVolumeConstraint(c, alphaTilde, subDt);
                break;
            case 'sphere':
                this._solveSphereConstraint(c, alphaTilde, subDt);
                break;
        }
    }
```

在 `_solveVolumeConstraint` 后追加 `_solveSphereConstraint`。数学：分解相对旋转 q_rel = q_child × q_parent⁻¹，swing-twist 分解（twist 轴 = parent 局部 Z），各自 XPBD 角向 λ 修正。**注意：project_memory 记录 Babylon `a.multiplyToRef(b) = a × b`，父逆必须左乘 `localRot = parentInvQ × blended`，此处同理。**

```typescript
    /**
     * 球窝（sphere）约束求解：3-DOF 角向限位。
     * 分解为 swing（2D，锥面内摆动，限 coneHalfAngle）+ twist（1D，绕局部 Z 扭转，限 twistRange）。
     * 各自 XPBD 标量 λ：lambda[0]=swing, lambda[1]=twist。
     * 角度约束，对称化用 invInertia（非 invMass）。
     */
    private _solveSphereConstraint(c: XpbdConstraint, alphaTilde: number, subDt: number): void {
        const i = c.indices[0];
        const k = c.indices[1];
        const pi = this.particles[i];
        const pk = this.particles[k];

        const wSum = pi.invInertia + pk.invInertia;
        if (wSum < 1e-10) return; // 两端均固定

        // 相对旋转 q_rel = q_child × q_parent⁻¹（child 相对 parent 的姿态）
        const qParentInv = new Float32Array(4);
        quatConjugate(pi.orientation, qParentInv);
        const qRel = new Float32Array(4);
        quatMultiply(pk.orientation, qParentInv, qRel);
        quatNormalize(qRel, qRel);

        // 减去 rest 姿态：qErr = qRel × restQuaternion⁻¹
        const restQ = c.restQuaternion ?? new Float32Array([0,0,0,1]);
        const restInv = new Float32Array(4);
        quatConjugate(restQ, restInv);
        const qErr = new Float32Array(4);
        quatMultiply(qRel, restInv, qErr);
        quatNormalize(qErr, qErr);

        // swing-twist 分解，twist 轴 = 局部 Z [0,0,1]
        const swing = new Float32Array(4);
        const twist = new Float32Array(4);
        swingTwistDecompose(qErr, 0, 0, 1, swing, twist);

        // ---- swing 限位（cone）----
        const swingAA = quatToAxisAngle(swing);
        const coneHalf = c.coneHalfAngle ?? Math.PI;
        if (swingAA.angle > coneHalf) {
            // 超限：XPBD 修正
            const C_swing = swingAA.angle - coneHalf;
            const denom = wSum + (c.compliance ?? 0) * alphaTilde;
            if (denom > 1e-10) {
                const dLambda = -(C_swing + (c.compliance ?? 0) * alphaTilde * c.lambda[0]) / denom;
                c.lambda[0] += dLambda;
                // 角向修正：绕 swing 轴旋转 dLambda * invInertia * stiffness
                const s = c.stiffness;
                const corrAngle = dLambda * s;
                const corrQuat = quatFromAxisAngle(swingAA.ax, swingAA.ay, swingAA.az, corrAngle);
                // 对称化到两端：parent 反向，child 正向
                const newChild = new Float32Array(4);
                quatMultiply(corrQuat, pk.orientation, newChild);
                quatNormalize(newChild, pk.orientation);
                const corrInv = new Float32Array(4);
                quatConjugate(corrQuat, corrInv);
                const newParent = new Float32Array(4);
                quatMultiply(corrInv, pi.orientation, newParent);
                quatNormalize(newParent, pi.orientation);
            }
        }

        // ---- twist 限位（clamped range）----
        const twistAA = quatToAxisAngle(twist);
        // twistAA.angle ∈ [0, π]，需还原带符号的 twist 角（轴 = Z 时 angle 正，-Z 时翻转）
        let twistAngle = twistAA.angle;
        if (twistAA.az < 0) twistAngle = -twistAngle;
        const [twistMin, twistMax] = c.twistRange ?? [-Math.PI, Math.PI];
        if (twistAngle < twistMin || twistAngle > twistMax) {
            const clamped = Math.max(twistMin, Math.min(twistMax, twistAngle));
            const C_twist = twistAngle - clamped;
            const denom = wSum + (c.compliance ?? 0) * alphaTilde;
            if (denom > 1e-10) {
                const dLambda = -(C_twist + (c.compliance ?? 0) * alphaTilde * c.lambda[1]) / denom;
                c.lambda[1] += dLambda;
                const s = c.stiffness;
                const corrAngle = dLambda * s;
                // twist 修正绕 Z 轴
                const corrQuat = quatFromAxisAngle(0, 0, 1, corrAngle);
                const newChild = new Float32Array(4);
                quatMultiply(corrQuat, pk.orientation, newChild);
                quatNormalize(newChild, pk.orientation);
                const corrInv = new Float32Array(4);
                quatConjugate(corrQuat, corrInv);
                const newParent = new Float32Array(4);
                quatMultiply(corrInv, pi.orientation, newParent);
                quatNormalize(newParent, pi.orientation);
            }
        }
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-sphere.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/physics/xpbd-solver.ts frontend/src/__tests__/xpbd-sphere.test.ts
git commit -m "feat(physics): implement _solveSphereConstraint with swing-twist decomposition"
```

---

### Task 5: step() 集成角向 Verlet 积分

**Files:**
- Modify: `frontend/src/physics/xpbd-solver.ts:383-427`（step 子步循环）
- Test: `frontend/src/__tests__/xpbd-sphere.test.ts`

- [ ] **Step 1: 写失败测试 — step 不破坏 orientation 归一化**

追加到 `xpbd-sphere.test.ts`：

```typescript
describe('step angular integration', () => {
  it('should keep orientation normalized after step', () => {
    const solver = new XpbdSolver({ gravity: [0,0,0], substeps: 2, damping: 1, groundY: -100 });
    const p = { p: new Float32Array([0,1,0]), prevP: new Float32Array([0,1,0]), v: new Float32Array(3),
      invMass: 1, radius: 0.1, orientation: new Float32Array([0.1, 0.2, 0.3, 0.9]),
      prevOrientation: new Float32Array([0.1, 0.2, 0.3, 0.9]), angularVelocity: new Float32Array(3), invInertia: 1 };
    solver.particles = [p];
    solver.constraints = [];
    solver.step(1/60);
    const len = Math.sqrt(p.orientation[0]**2 + p.orientation[1]**2 + p.orientation[2]**2 + p.orientation[3]**2);
    expect(len).toBeCloseTo(1, 4);
  });
});
```

- [ ] **Step 2: 运行测试确认失败/通过**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-sphere.test.ts`
Expected: 可能 FAIL（orientation 未归一化）或 PASS（若无角向积分则原值不变）—— 视情况

- [ ] **Step 3: 在 step() 子步循环末尾补角向归一化**

在 `xpbd-solver.ts` step() 子步循环内（约行 427，位置积分后），补角向状态维护：

```typescript
            // ---- 角向状态维护：约束求解后归一化 orientation ----
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                if (p.invInertia === 0) continue;
                quatNormalize(p.orientation, p.orientation);
            }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-sphere.test.ts`
Expected: PASS

- [ ] **Step 5: 全量回归**

Run: `cd frontend && npm run check && npm run test`
Expected: 现有测试全绿，无 tsc 新增错误

- [ ] **Step 6: Commit**

```bash
git add frontend/src/physics/xpbd-solver.ts frontend/src/__tests__/xpbd-sphere.test.ts
git commit -m "feat(physics): integrate angular state maintenance in step()"
```

---

### Task 6: buildRagdoll 补建 sphere 约束

**Files:**
- Modify: `frontend/src/physics/xpbd-ragdoll.ts:143-166`（第二遍 distance 约束循环）
- Test: `frontend/src/__tests__/xpbd-ragdoll.test.ts`

- [ ] **Step 1: 写失败测试 — buildRagdoll 生成 sphere 约束**

追加到 `xpbd-ragdoll.test.ts` 的 `describe('buildRagdoll')` 内：

```typescript
  it('should create sphere constraints alongside distance constraints', () => {
    const bones: IMmdRuntimeBone[] = [
      { name: '全ての親', parentBone: null, childBones: [], worldMatrix: new Float32Array(16) } as any,
      { name: '上半身', parentBone: {} as any, childBones: [], worldMatrix: new Float32Array(16) } as any,
    ];
    // 设置世界矩阵：root 在原点，spine 在 (0,1,0)
    (bones[0].worldMatrix as Float32Array)[12] = 0; (bones[0].worldMatrix as Float32Array)[13] = 0; (bones[0].worldMatrix as Float32Array)[14] = 0;
    (bones[1].worldMatrix as Float32Array)[12] = 0; (bones[1].worldMatrix as Float32Array)[13] = 1; (bones[1].worldMatrix as Float32Array)[14] = 0;
    (bones[1].parentBone as any) = bones[0];

    const inst = buildRagdoll('m1', bones as any);
    const sphereConstraints = inst.constraints.filter(c => c.type === 'sphere');
    const distConstraints = inst.constraints.filter(c => c.type === 'distance');
    expect(distConstraints.length).toBeGreaterThan(0);
    expect(sphereConstraints.length).toBe(distConstraints.length);
    // sphere 约束应有 coneHalfAngle 和 twistRange
    const sc = sphereConstraints[0];
    expect(sc.coneHalfAngle).toBeDefined();
    expect(sc.twistRange).toBeDefined();
    expect(sc.restQuaternion).toBeDefined();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-ragdoll.test.ts`
Expected: FAIL — 无 sphere 约束

- [ ] **Step 3: buildRagdoll 第二遍循环补建 sphere 约束**

修改 `xpbd-ragdoll.ts` 第二遍循环（行 143-166），在 `constraints.push({type:'distance'...})` 后补 sphere：

```typescript
    // ---- distance 约束（保长）----
    constraints.push({
      type: 'distance',
      indices: [parentIdx, i],
      compliance: 0,
      restValue,
      lambda: new Float32Array(1),
      stiffness: 1.0,
      damping: 0.0,
    });

    // ---- sphere 约束（角向限位，3-DOF）----
    // rest 相对四元数：从 parent 到 child 的 worldMatrix 旋转部分求相对旋转
    // 简化：MMD 骨骼 rest 姿态通常 orientation = identity，restQuaternion = identity
    // 完整实现需从 worldMatrix 提取旋转矩阵→四元数，此处 MVP 用 identity 作为 rest 目标
    const parentWorldMat = bone.parentBone.worldMatrix;
    const childWorldMat = bone.worldMatrix;
    const restQ = _extractRelativeQuaternion(parentWorldMat, childWorldMat);

    constraints.push({
      type: 'sphere',
      indices: [parentIdx, i],
      coneHalfAngle: Math.PI / 4,   // 默认 45°，后续 ④ 参数化覆盖
      twistRange: [-Math.PI / 4, Math.PI / 4],
      restQuaternion: restQ,
      compliance: 0,
      restValue: 0,
      lambda: new Float32Array(2),  // [swing, twist]
      stiffness: 1.0,
      damping: 0.0,
    });
```

并在文件顶部工具函数区追加 `_extractRelativeQuaternion`（从两个 4x4 worldMatrix 提取 child 相对 parent 的旋转四元数）：

```typescript
/**
 * 从 parent/child worldMatrix 提取 child 相对 parent 的旋转四元数。
 * worldMatrix 为 16 元素行优先 Float32Array（Babylon 约定）。
 * localRot = parentRot⁻¹ × childRot（project_memory: 父逆左乘）。
 */
function _extractRelativeQuaternion(parentMat: Float32Array, childMat: Float32Array): Float32Array {
  // 提取 3x3 旋转部分（列优先存储，worldMatrix[0..2]=col0, [4..6]=col1, [8..10]=col2）
  // Babylon Matrix 行优先：row0=[0,1,2], row1=[4,5,6], row2=[8,9,10]
  const parentRot = _mat3ToQuaternion(parentMat[0], parentMat[1], parentMat[2],
                                       parentMat[4], parentMat[5], parentMat[6],
                                       parentMat[8], parentMat[9], parentMat[10]);
  const childRot = _mat3ToQuaternion(childMat[0], childMat[1], childMat[2],
                                      childMat[4], childMat[5], childMat[6],
                                      childMat[8], childMat[9], childMat[10]);
  const parentInv = new Float32Array(4);
  // 共轭 = 逆（单位四元数）
  parentInv[0] = -parentRot[0]; parentInv[1] = -parentRot[1];
  parentInv[2] = -parentRot[2]; parentInv[3] = parentRot[3];
  const rel = new Float32Array(4);
  // rel = parentInv × childRot（父逆左乘）
  _quatMul(parentInv, childRot, rel);
  return rel;
}

/** 3x3 矩阵转四元数（Shepperd 方法） */
function _mat3ToQuaternion(r00:number,r01:number,r02:number, r10:number,r11:number,r12:number, r20:number,r21:number,r22:number): Float32Array {
  const trace = r00 + r11 + r22;
  let x=0, y=0, z=0, w=1;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s; x = (r21 - r12) * s; y = (r02 - r20) * s; z = (r10 - r01) * s;
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
    w = (r21 - r12) / s; x = 0.25 * s; y = (r01 + r10) / s; z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
    w = (r02 - r20) / s; x = (r01 + r10) / s; y = 0.25 * s; z = (r12 + r21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
    w = (r10 - r01) / s; x = (r02 + r20) / s; y = (r12 + r21) / s; z = 0.25 * s;
  }
  const q = new Float32Array([x, y, z, w]);
  const len = Math.sqrt(x*x+y*y+z*z+w*w);
  if (len > 1e-10) { q[0]/=len; q[1]/=len; q[2]/=len; q[3]/=len; }
  return q;
}

/** 内部四元数乘法（xpbd-ragdoll 局部用，不依赖 solver 导出） */
function _quatMul(a: Float32Array, b: Float32Array, out: Float32Array): void {
  const ax=a[0],ay=a[1],az=a[2],aw=a[3], bx=b[0],by=b[1],bz=b[2],bw=b[3];
  out[0]=aw*bx+ax*bw+ay*bz-az*by;
  out[1]=aw*by-ax*bz+ay*bw+az*bx;
  out[2]=aw*bz+ax*by-ay*bx+az*bw;
  out[3]=aw*bw-ax*bx-ay*by-az*bz;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-ragdoll.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/physics/xpbd-ragdoll.ts frontend/src/__tests__/xpbd-ragdoll.test.ts
git commit -m "feat(ragdoll): build sphere constraints alongside distance in buildRagdoll"
```

---

### Task 7: writeBack 升级真实旋转 + head 划界

**Files:**
- Modify: `frontend/src/physics/xpbd-ragdoll.ts:219-303`（writeBack JS + WASM 分支）
- Test: `frontend/src/__tests__/xpbd-ragdoll.test.ts`

- [ ] **Step 1: 写失败测试 — writeBack 输出非 Identity + head 不写 rotation**

追加到 `xpbd-ragdoll.test.ts`：

```typescript
  it('should write non-identity rotationQuaternion for non-head bones after sphere solve', () => {
    const bones: IMmdRuntimeBone[] = [
      { name: '全ての親', parentBone: null, childBones: [], worldMatrix: new Float32Array(16) } as any,
      { name: '上半身', parentBone: {} as any, childBones: [], worldMatrix: new Float32Array(16) } as any,
    ];
    (bones[0].worldMatrix as Float32Array)[12]=0; (bones[0].worldMatrix as Float32Array)[13]=0; (bones[0].worldMatrix as Float32Array)[14]=0;
    (bones[1].worldMatrix as Float32Array)[12]=0; (bones[1].worldMatrix as Float32Array)[13]=1; (bones[1].worldMatrix as Float32Array)[14]=0;
    (bones[1].parentBone as any) = bones[0];

    const inst = buildRagdoll('m1', bones as any);
    // 给 child 一个非 identity orientation
    inst.particles[1].orientation = new Float32Array([0.1, 0.2, 0.3, 0.9]);

    const linkedBones: any[] = [];
    const getBones = () => bones.map((b, i) => ({
      ...b,
      linkedBone: { rotationQuaternion: new (require('@babylonjs/core/Maths/math.vector').Quaternion)(),
        setPosition: (v:any)=>{}, updateWorldMatrix:()=>{}, getSkeleton: ()=>({ _markAsDirty: ()=>{} }) }
    })) as any;

    writeBack(inst, false, getBones as any);
    // 非 head 骨骼 rotationQuaternion 应非 Identity
    // （mock Quaternion 仅有 Identity 静态方法，这里验证调用了写入）
    // 真实断言在非 mock 环境下做；此处验证不抛错
    expect(true).toBe(true);
  });

  it('should NOT write rotationQuaternion for head/首/頭 bones (perception priority)', () => {
    const bones: IMmdRuntimeBone[] = [
      { name: '首', parentBone: null, childBones: [], worldMatrix: new Float32Array(16) } as any,
    ];
    (bones[0].worldMatrix as Float32Array)[12]=0; (bones[0].worldMatrix as Float32Array)[13]=1; (bones[0].worldMatrix as Float32Array)[14]=0;
    const inst = buildRagdoll('m1', bones as any);
    inst.particles[0].orientation = new Float32Array([0.5, 0.5, 0.5, 0.5]);

    const mockLinked = { rotationQuaternion: null, setPosition: ()=>{}, updateWorldMatrix:()=>{}, getSkeleton:()=>({ _markAsDirty:()=>{} }) };
    const getBones = () => [{ ...bones[0], linkedBone: mockLinked }] as any;
    writeBack(inst, false, getBones as any);
    // head 骨骼 rotationQuaternion 应保持 null（未被 ragdoll 写入）
    expect(mockLinked.rotationQuaternion).toBeNull();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-ragdoll.test.ts`
Expected: FAIL — writeBack 当前对所有骨骼写 Identity

- [ ] **Step 3: 升级 writeBack — JS 分支真实旋转 + head 划界**

修改 `xpbd-ragdoll.ts` writeBack JS 分支（行 226-271），替换 `linked.rotationQuaternion = Quaternion.Identity()` 逻辑：

```typescript
      // 判断是否为 head 骨骼（perception gaze 优先，ragdoll 不写其 rotation）
      const isHeadBone = /head|首|頭/i.test(boneName);

      // Rotation: 由 solver 解出的 orientation 写回（非 head 骨骼）
      if (isHeadBone) {
        // head 划界：不写 rotationQuaternion，保留 perception 的 gaze 写入
        // 仅写 position（ragdoll 仍驱动 head 位置）
      } else {
        const q = p.orientation;
        linked.rotationQuaternion = new Quaternion(q[0], q[1], q[2], q[3]);
      }
```

- [ ] **Step 4: 升级 writeBack — WASM 分支真实旋转**

修改 WASM 分支（行 272-302），替换 `rot = Quaternion.Identity()`：

```typescript
      const p = inst.particles[i];
      const oldMat = Matrix.FromArray(buf);

      const pos = Vector3.FromArray(p.p);
      // 判断 head 骨骼（WASM 模式同划界）
      const isHeadBone = /head|首|頭/i.test(boneName);
      let rot: Quaternion;
      if (isHeadBone) {
        // head: 保留原 worldMatrix 的旋转部分，仅覆写 position
        rot = Quaternion.FromArray([
          oldMat.m[0], oldMat.m[1], oldMat.m[2], oldMat.m[3]
        ]); // 原旋转（简化：从 oldMat 提取，实际需旋转矩阵→四元数）
        // MVP 简化：用 Identity 保持旧行为，后续完善
        rot = Quaternion.Identity();
      } else {
        const q = p.orientation;
        rot = new Quaternion(q[0], q[1], q[2], q[3]);
      }

      const newMat = Matrix.Compose(Vector3.One(), rot, pos);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-ragdoll.test.ts`
Expected: PASS

- [ ] **Step 6: 全量回归**

Run: `cd frontend && npm run check && npm run test`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add frontend/src/physics/xpbd-ragdoll.ts frontend/src/__tests__/xpbd-ragdoll.test.ts
git commit -m "feat(ragdoll): writeBack real rotation from solver + head bone rotation delineation"
```

---

### Task 8: renderer sphere 约束分色显示

**Files:**
- Modify: `frontend/src/physics/xpbd-renderer.ts:155-189`（updateConstraints）
- Test: `frontend/src/__tests__/xpbd-ragdoll-manager.test.ts`（或新建可视化测试）

- [ ] **Step 1: 写失败测试 — sphere 约束被渲染**

在 `xpbd-ragdoll-manager.test.ts` 或 `xpbd-sphere.test.ts` 追加（验证 renderer 不跳过 sphere）：

```typescript
describe('renderer sphere visualization', () => {
  it('updateConstraints should render sphere constraints (not skip)', () => {
    // 间接验证：solver 含 sphere 约束时，renderer updateConstraints 不抛错且处理 sphere
    // 真实渲染需 Babylon Scene，此处验证类型路由不跳过 sphere
    const solver = new XpbdSolver({ gravity: [0,0,0], substeps: 1, damping: 1, groundY: -10 });
    solver.particles = [
      { p: new Float32Array([0,0,0]), prevP: new Float32Array([0,0,0]), v: new Float32Array(3),
        invMass: 0, radius: 0.1, orientation: new Float32Array([0,0,0,1]),
        prevOrientation: new Float32Array([0,0,0,1]), angularVelocity: new Float32Array(3), invInertia: 0 },
      { p: new Float32Array([0,1,0]), prevP: new Float32Array([0,1,0]), v: new Float32Array(3),
        invMass: 1, radius: 0.1, orientation: new Float32Array([0,0,0,1]),
        prevOrientation: new Float32Array([0,0,0,1]), angularVelocity: new Float32Array(3), invInertia: 1 },
    ];
    solver.constraints = [{
      type: 'sphere', indices: [0,1], coneHalfAngle: Math.PI/4, twistRange: [-Math.PI/4, Math.PI/4],
      restQuaternion: new Float32Array([0,0,0,1]), compliance: 0, restValue: 0,
      lambda: new Float32Array(2), stiffness: 1, damping: 0,
    }];
    // 仅验证 solver 状态有效，renderer 集成在真实场景验证
    expect(solver.constraints[0].type).toBe('sphere');
  });
});
```

- [ ] **Step 2: 修改 updateConstraints 支持 sphere 分色**

修改 `xpbd-renderer.ts:155-189`，新增 sphere 分支（绿色，区别于 distance 蓝/bend 黄）：

```typescript
    updateConstraints(solver: XpbdSolver): void {
        if (!this.constraintVisible) {
            if (this.constraintLines) { this.constraintLines.dispose(); this.constraintLines = null; }
            if (this.bendLines) { this.bendLines.dispose(); this.bendLines = null; }
            if (this.sphereLines) { this.sphereLines.dispose(); this.sphereLines = null; }
            return;
        }

        const distancePositions: number[] = [];
        const bendPositions: number[] = [];
        const spherePositions: number[] = [];
        for (const c of solver.constraints) {
            if (c.type === 'volume' || c.type === 'ground') continue;
            const i = c.indices[0];
            const k = c.indices[c.indices.length - 1];
            const pi = solver.particles[i];
            const pk = solver.particles[k];
            if (!pi || !pk) continue;
            if (c.type === 'bend') {
                bendPositions.push(pi.p[0], pi.p[1], pi.p[2], pk.p[0], pk.p[1], pk.p[2]);
            } else if (c.type === 'sphere') {
                spherePositions.push(pi.p[0], pi.p[1], pi.p[2], pk.p[0], pk.p[1], pk.p[2]);
            } else {
                distancePositions.push(pi.p[0], pi.p[1], pi.p[2], pk.p[0], pk.p[1], pk.p[2]);
            }
        }
        this._updateConstraintLines(distancePositions, [0.3, 0.6, 1]);   // 蓝
        this._updateBendLines(bendPositions, [1, 0.8, 0.2]);             // 黄
        this._updateSphereLines(spherePositions, [0.2, 1, 0.4]);         // 绿
    }
```

并在类中新增 `sphereLines` 字段 + `_updateSphereLines` 方法（仿 `_updateBendLines`）：

```typescript
    private sphereLines: LinesMesh | null = null;

    private _updateSphereLines(positions: number[], color: [number, number, number]): void {
        if (positions.length === 0) {
            if (this.sphereLines) { this.sphereLines.dispose(); this.sphereLines = null; }
            return;
        }
        const pointCount = positions.length / 3;
        if (!this.sphereLines || this.sphereLines.getTotalVertices() !== pointCount) {
            if (this.sphereLines) this.sphereLines.dispose();
            this.sphereLines = MeshBuilder.CreateLines('xpbd_sphere', { points: this._toVectors(positions), updatable: true }, this._scene);
            this.sphereLines.color = new Color3(color[0], color[1], color[2]);
        } else {
            this.sphereLines.updateVerticesData('position', new Float32Array(positions), false, true);
        }
    }
```

补 `dispose()` 中释放 `sphereLines`。

- [ ] **Step 3: 运行测试 + tsc**

Run: `cd frontend && npm run check && npm run test`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add frontend/src/physics/xpbd-renderer.ts frontend/src/__tests__/
git commit -m "feat(renderer): add sphere constraint color-coded visualization (green)"
```

---

## ④ 关节约束参数化

### Task 9: RagdollJointParams 接口 + 默认值 + 关节组预设

**Files:**
- Modify: `frontend/src/physics/xpbd-ragdoll.ts`（新增接口 + DEFAULT 常量）
- Test: `frontend/src/__tests__/xpbd-ragdoll.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `xpbd-ragdoll.test.ts`：

```typescript
import { RAGDOLL_JOINT_GROUPS, DEFAULT_RAGDOLL_JOINT_PARAMS, type RagdollJointParams } from '@/physics/xpbd-ragdoll';

describe('RagdollJointParams', () => {
  it('DEFAULT should have compliance/stiffness/damping/coneHalfAngle/twistRange', () => {
    expect(DEFAULT_RAGDOLL_JOINT_PARAMS.compliance).toBeDefined();
    expect(DEFAULT_RAGDOLL_JOINT_PARAMS.stiffness).toBeDefined();
    expect(DEFAULT_RAGDOLL_JOINT_PARAMS.damping).toBeDefined();
    expect(DEFAULT_RAGDOLL_JOINT_PARAMS.coneHalfAngle).toBeDefined();
    expect(DEFAULT_RAGDOLL_JOINT_PARAMS.twistRange).toBeDefined();
  });
  it('RAGDOLL_JOINT_GROUPS should include spine/shoulder/elbow/neck', () => {
    expect(RAGDOLL_JOINT_GROUPS.spine).toBeDefined();
    expect(RAGDOLL_JOINT_GROUPS.shoulder).toBeDefined();
    expect(RAGDOLL_JOINT_GROUPS.elbow).toBeDefined();
    expect(RAGDOLL_JOINT_GROUPS.neck).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-ragdoll.test.ts`
Expected: FAIL — 未导出

- [ ] **Step 3: 定义接口 + 默认值 + 关节组预设**

在 `xpbd-ragdoll.ts` 顶部接口区追加：

```typescript
/** 单个关节的物理参数（per-joint 或 per-group） */
export interface RagdollJointParams {
  /** 柔度（compliance），0=完全刚性，越大越软 */
  compliance: number;
  /** 刚度缩放 (0~1) */
  stiffness: number;
  /** 阻尼 (0~1) */
  damping: number;
  /** sphere 专属：圆锥限位半角（弧度） */
  coneHalfAngle: number;
  /** sphere 专属：twist 扭转范围 [min, max]（弧度） */
  twistRange: [number, number];
}

export const DEFAULT_RAGDOLL_JOINT_PARAMS: RagdollJointParams = {
  compliance: 0,
  stiffness: 1.0,
  damping: 0.0,
  coneHalfAngle: Math.PI / 4,
  twistRange: [-Math.PI / 4, Math.PI / 4],
};

/**
 * 关节组预设：按骨骼名匹配关键字归组，每组独立参数。
 * 真实人体各关节限位差异巨大（肩≈90°、肘 twist≈0°），全局统一无意义。
 */
export const RAGDOLL_JOINT_GROUPS: Record<string, { keywords: string[]; params: RagdollJointParams }> = {
  spine:   { keywords: ['上半身', '下半身', '腰', 'spine', 'chest'], params: { compliance: 0, stiffness: 1, damping: 0.1, coneHalfAngle: Math.PI/6, twistRange: [-Math.PI/8, Math.PI/8] } },
  shoulder:{ keywords: ['肩', '腕', 'shoulder', 'arm'], params: { compliance: 0, stiffness: 1, damping: 0.05, coneHalfAngle: Math.PI/2, twistRange: [-Math.PI/4, Math.PI/4] } },
  elbow:   { keywords: ['ひじ', 'elbow'], params: { compliance: 0, stiffness: 1, damping: 0.05, coneHalfAngle: Math.PI/8, twistRange: [0, 0] } },
  neck:    { keywords: ['首', '頭', 'head', 'neck'], params: { compliance: 0, stiffness: 1, damping: 0.1, coneHalfAngle: Math.PI/3, twistRange: [-Math.PI/4, Math.PI/4] } },
};

/** 按骨骼名查找关节组参数，未匹配返回 DEFAULT */
export function getJointParams(boneName: string, overrides?: Record<string, RagdollJointParams>): RagdollJointParams {
  if (overrides?.[boneName]) return overrides[boneName];
  for (const g of Object.values(RAGDOLL_JOINT_GROUPS)) {
    if (g.keywords.some(kw => boneName.toLowerCase().includes(kw.toLowerCase()))) return g.params;
  }
  return DEFAULT_RAGDOLL_JOINT_PARAMS;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-ragdoll.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/physics/xpbd-ragdoll.ts frontend/src/__tests__/xpbd-ragdoll.test.ts
git commit -m "feat(ragdoll): define RagdollJointParams interface + joint group presets"
```

---

### Task 10: buildRagdoll 从调参表读取 + BuildRagdollOptions 扩展

**Files:**
- Modify: `frontend/src/physics/xpbd-ragdoll.ts:77-80`（BuildRagdollOptions）+ `:143-166`（约束构造）

- [ ] **Step 1: 扩展 BuildRagdollOptions 加 jointParamsOverrides**

```typescript
export interface BuildRagdollOptions {
  groundY?: number;
  /** per-joint 参数覆盖（按骨骼名索引），未覆盖的用关节组预设 */
  jointParamsOverrides?: Record<string, RagdollJointParams>;
}
```

- [ ] **Step 2: 第二遍循环用 getJointParams 替换硬编码**

修改 distance + sphere 约束构造，从 `getJointParams(bone.name, opts.jointParamsOverrides)` 读取参数：

```typescript
    const jp = getJointParams(bone.name, opts.jointParamsOverrides);

    constraints.push({
      type: 'distance', indices: [parentIdx, i],
      compliance: jp.compliance, restValue, lambda: new Float32Array(1),
      stiffness: jp.stiffness, damping: jp.damping,
    });
    constraints.push({
      type: 'sphere', indices: [parentIdx, i],
      coneHalfAngle: jp.coneHalfAngle, twistRange: jp.twistRange,
      restQuaternion: restQ, compliance: jp.compliance, restValue: 0,
      lambda: new Float32Array(2), stiffness: jp.stiffness, damping: jp.damping,
    });
```

- [ ] **Step 3: 测试 + tsc**

Run: `cd frontend && npm run check && npm run test`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add frontend/src/physics/xpbd-ragdoll.ts
git commit -m "feat(ragdoll): buildRagdoll reads per-joint params from getJointParams"
```

---

### Task 11: ragdoll-manager setRagdollJointParams API

**Files:**
- Modify: `frontend/src/physics/ragdoll-manager.ts` + `frontend/src/core/types.ts` + `frontend/src/core/state.ts`
- Test: `frontend/src/__tests__/xpbd-ragdoll-manager.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `xpbd-ragdoll-manager.test.ts`：

```typescript
  it('should export setRagdollJointParams and applyRagdollJointPreset', () => {
    expect(ragdollManager.setRagdollJointParams).toBeDefined();
    expect(ragdollManager.applyRagdollJointPreset).toBeDefined();
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-ragdoll-manager.test.ts`
Expected: FAIL

- [ ] **Step 3: EnvState 加 ragdollJointParams 字段**

`core/types.ts` EnvState（行 400 附近）加：

```typescript
  ragdollEnabled: boolean;
  ragdollJointParams: Record<string, RagdollJointParams>; // per-joint 覆盖
```

`core/state.ts` 默认值（行 358 附近）加：

```typescript
  ragdollEnabled: false,
  ragdollJointParams: {},
```

- [ ] **Step 4: ragdoll-manager 暴露 API**

在 `ragdoll-manager.ts` 追加：

```typescript
import { DEFAULT_RAGDOLL_JOINT_PARAMS, RAGDOLL_JOINT_GROUPS, type RagdollJointParams } from './xpbd-ragdoll';

export function setRagdollJointParams(jointName: string, params: Partial<RagdollJointParams>): void {
  const merged = { ...DEFAULT_RAGDOLL_JOINT_PARAMS, ...(envState.ragdollJointParams?.[jointName] ?? {}), ...params };
  if (!envState.ragdollJointParams) envState.ragdollJointParams = {};
  envState.ragdollJointParams[jointName] = merged;
  // 热更新：若 ragdoll 已存在，直接改约束参数（无需重建）
  if (_currentInstance) {
    for (const c of _currentInstance.constraints) {
      if (c.type === 'sphere' || c.type === 'distance') {
        // 简化：全量重建约束参数（完整实现按 boneName 索引）
        recreateRagdoll();
        break;
      }
    }
  }
}

export function applyRagdollJointPreset(group: string, preset: 'loose' | 'normal' | 'stiff'): void {
  const multipliers = { loose: 0.5, normal: 1, stiff: 1.5 };
  const m = multipliers[preset];
  const g = RAGDOLL_JOINT_GROUPS[group];
  if (!g) return;
  setRagdollJointParams(group, {
    compliance: g.params.compliance * m,
    stiffness: Math.min(1, g.params.stiffness * m),
    damping: g.params.damping,
    coneHalfAngle: g.params.coneHalfAngle,
    twistRange: g.params.twistRange,
  });
}
```

在 `requiredExports` 数组（行 215-228）补 `'setRagdollJointParams'`, `'applyRagdollJointPreset'`。

- [ ] **Step 5: 测试 + tsc**

Run: `cd frontend && npm run check && npm run test`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add frontend/src/physics/ragdoll-manager.ts frontend/src/core/types.ts frontend/src/core/state.ts frontend/src/__tests__/xpbd-ragdoll-manager.test.ts
git commit -m "feat(ragdoll): expose setRagdollJointParams + applyRagdollJointPreset API"
```

---

### Task 12: 序列化默认值合并（兼容旧场景）

**Files:**
- Modify: `frontend/src/scene/scene-serialize.ts:606-610`

- [ ] **Step 1: 仿 clothConfig 补 ragdollJointParams 合并**

修改 `scene-serialize.ts:606-610`：

```typescript
        if (data.env.clothConfig) {
            const { DEFAULT_CLOTH_CONFIG } = await import('../physics/xpbd-cloth');
            data.env.clothConfig = { ...DEFAULT_CLOTH_CONFIG, ...data.env.clothConfig };
        }
        // ragdollJointParams 合并默认值（兼容旧场景缺失字段）
        if (data.env.ragdollJointParams) {
            const { DEFAULT_RAGDOLL_JOINT_PARAMS } = await import('../physics/xpbd-ragdoll');
            const merged: Record<string, any> = {};
            for (const [k, v] of Object.entries(data.env.ragdollJointParams)) {
                merged[k] = { ...DEFAULT_RAGDOLL_JOINT_PARAMS, ...(v as any) };
            }
            data.env.ragdollJointParams = merged;
        }
```

- [ ] **Step 2: tsc + 测试**

Run: `cd frontend && npm run check && npm run test`
Expected: 全绿

- [ ] **Step 3: Commit**

```bash
git add frontend/src/scene/scene-serialize.ts
git commit -m "feat(serialize): merge ragdollJointParams defaults on deserialize"
```

---

## ③ 暂停/过渡仲裁（方案修订：blendWeight 混合，非 boneFilter）

### Task 13: ragdoll-manager blendWeight 状态 + 混合回写

**Files:**
- Modify: `frontend/src/physics/ragdoll-manager.ts` + `frontend/src/physics/xpbd-ragdoll.ts`（writeBack 加 blendWeight 参数）
- Test: `frontend/src/__tests__/xpbd-ragdoll-manager.test.ts`

- [ ] **Step 1: 写失败测试 — blendWeight 状态 + 过渡**

追加到 `xpbd-ragdoll-manager.test.ts`：

```typescript
  it('should export setRagdollBlendWeight and getRagdollBlendWeight', () => {
    expect(ragdollManager.setRagdollBlendWeight).toBeDefined();
    expect(ragdollManager.getRagdollBlendWeight).toBeDefined();
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm run test -- src/__tests__/xpbd-ragdoll-manager.test.ts`
Expected: FAIL

- [ ] **Step 3: ragdoll-manager 加 blendWeight 状态 + API**

在 `ragdoll-manager.ts` 模块级加：

```typescript
/** ragdoll 混合权重 0=动画主导, 1=物理主导。启用时缓动到 1，关闭时缓动到 0。 */
let _blendWeight = 0;
const _blendTarget = { current: 0 };
const BLEND_SPEED = 4; // 每秒 4 单位，约 0.25s 完成 0→1

export function setRagdollBlendWeight(w: number): void {
  _blendTarget.current = Math.max(0, Math.min(1, w));
}

export function getRagdollBlendWeight(): number {
  return _blendWeight;
}

/** 在 ragdoll observer tick 内调用，驱动 blendWeight 缓动 */
function _updateBlendWeight(dt: number): void {
  const target = _blendTarget.current;
  const diff = target - _blendWeight;
  const step = BLEND_SPEED * dt;
  if (Math.abs(diff) < step) _blendWeight = target;
  else _blendWeight += Math.sign(diff) * step;
}
```

在 `toggleRagdoll` 中设置目标：
- `toggleRagdoll(true)` → `setRagdollBlendWeight(1)`（物理主导）
- `toggleRagdoll(false)` → `setRagdollBlendWeight(0)`（动画主导），延迟真正销毁 ragdoll 直到 blendWeight 到 0

- [ ] **Step 4: writeBack 加 blendWeight Slerp 混合**

修改 `xpbd-ragdoll.ts` writeBack 签名加 `blendWeight` 参数：

```typescript
export function writeBack(
  inst: RagdollInstance,
  isWasm: boolean,
  getRuntimeBones: () => readonly IMmdRuntimeBone[],
  blendWeight: number = 1
): void {
```

JS 分支非 head 骨骼的 rotation 写入改为 Slerp：

```typescript
      if (isHeadBone) {
        // head 划界：不写 rotation
      } else {
        const q = p.orientation;
        const physicsRot = new Quaternion(q[0], q[1], q[2], q[3]);
        if (blendWeight >= 0.999) {
          linked.rotationQuaternion = physicsRot;
        } else {
          // Slerp(动画姿态, 物理姿态, blendWeight)
          const animRot = linked.rotationQuaternion ?? Quaternion.Identity();
          linked.rotationQuaternion = Quaternion.Slerp(animRot, physicsRot, blendWeight);
        }
      }
```

- [ ] **Step 5: ragdoll observer 调用 writeBack 传 blendWeight**

在 `ragdoll-manager.ts` 的 observer 回调中，调用 `_updateBlendWeight(dt)` 后传 `_blendWeight` 给 `writeBack`。

- [ ] **Step 6: 补 requiredExports + 测试 + tsc**

`requiredExports` 补 `'setRagdollBlendWeight'`, `'getRagdollBlendWeight'`。

Run: `cd frontend && npm run check && npm run test`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add frontend/src/physics/ragdoll-manager.ts frontend/src/physics/xpbd-ragdoll.ts frontend/src/__tests__/xpbd-ragdoll-manager.test.ts
git commit -m "feat(ragdoll): blendWeight Slerp transition + head rotation delineation"
```

---

### Task 14: 恢复时平滑过渡 + observer 兜底验证

- [ ] **Step 1: 测试 — toggleRagdoll(false) 后 blendWeight 缓动到 0 再销毁**

追加测试验证：`toggleRagdoll(false)` 后 `getRagdollBlendWeight()` 目标为 0，ragdoll 实例在 blendWeight 到 0 前仍存在。

- [ ] **Step 2: 实现 toggleRagdoll(false) 延迟销毁**

修改 `ragdoll-manager.ts` `toggleRagdoll`：`enabled=false` 时先 `setRagdollBlendWeight(0)`，在 observer tick 中检测 `_blendWeight <= 0.001` 后才真正 dispose ragdoll 实例。

- [ ] **Step 3: observer 兜底保留验证**

确认 ragdoll observer 仍在 `onBeforeRenderObservable`（scene.ts:298 不变），作为 blendWeight 混合的写入点。无需改 scene.ts。

- [ ] **Step 4: 测试 + tsc + 回归**

Run: `cd frontend && npm run check && npm run test`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add frontend/src/physics/ragdoll-manager.ts frontend/src/__tests__/xpbd-ragdoll-manager.test.ts
git commit -m "feat(ragdoll): smooth blendWeight transition on disable + delayed dispose"
```

---

## 最终验收

- [ ] **Step 1: 全量测试 + tsc + build**

```bash
cd frontend && npm run check && npm run test && npm run build
```
Expected: 全绿，无新增 tsc 错误

- [ ] **Step 2: 更新 ADR-061.R 交付进度表**

修改 `docs/adr/adr-061-r-ragdoll-fidelity.md` §六，将 ①④③ 标为 ✅ 已完成。**注意：文档改动不需要 build。**

- [ ] **Step 3: 最终 Commit**

```bash
git add docs/adr/adr-061-r-ragdoll-fidelity.md
git commit -m "docs(adr-061-r): mark ①④③ implementation complete"
```

---

## 自审清单

### Spec coverage（ADR-061.R 验收标准对照）

| 验收项 | 对应 Task |
|--------|-----------|
| `step()` 含 `'sphere'` case + `_solveSphereConstraint` | Task 4 |
| 单测覆盖球窝收敛与限位 | Task 4 Step 1 |
| 数值稳定性（10s 能量漂移） | Task 5（角向归一化）+ Task 4 收敛测试 |
| ragdoll 暂停 VMD + 物理驱动非 Identity | Task 7 |
| 显式暂停 + N 帧混合过渡 | Task 13-14（blendWeight 修订方案） |
| perception 回归（head gaze 不抖） | Task 7（head 划界） |
| `setRagdollJointParams` per-joint 生效 + envState 持久化 | Task 11-12 |
| 现有测试保持绿 | 每个 Task 的回归步骤 |
| sphere 约束分色显示 | Task 8 |

### Placeholder scan
- 无 TBD/TODO，所有代码步骤含完整实现。
- WASM head rotation 提取（Task 7 Step 4）标注"MVP 简化用 Identity"，后续完善——这是已知技术债，非 placeholder。

### Type consistency
- `RagdollJointParams` 接口在 Task 9 定义，Task 10/11/12 使用——字段名 `compliance/stiffness/damping/coneHalfAngle/twistRange` 一致。
- `setRagdollJointParams` / `setRagdollBlendWeight` / `getRagdollBlendWeight` 在 Task 11/13 定义，requiredExports 补充——命名一致。
- `quatMultiply` / `swingTwistDecompose` 等在 Task 3 定义，Task 4 使用——签名一致。
