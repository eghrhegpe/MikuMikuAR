# ADR-079 Phase 2: 重心微动迁移至感知层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 idle 的躯干微晃（center/upper2/waist/allParent 四骨骼）从 VMD 关键帧方式迁移到 perception.ts 的 always-on 实时叠加，idle 退化为仅保留手臂/肩膀/手腕微动。

**Architecture:** 在 `perception.ts` 新增 `_applyBalanceSway(mmdModel, time, enabled)` 实时叠加函数，采用与 `_applyBreathing` 同款的「读后写 + Slerp/Lerp」叠加模式（rotation 用 Slerp，position 用 Lerp），确保与用户 VMD 共存而非覆盖。`proc-motion-idle.ts` 的 center/upper2/waist/allParent 生成块删除，手臂/肩膀/手腕保留。序列化扩展 `balanceSwayEnabled` 字段 + 旧存档迁移（`boneToggles.center/upper2/waist/allParent` 任一为 true → `balanceSwayEnabled: true`）。

**Tech Stack:** TypeScript, Babylon.js, babylon-mmd, Vitest

---

## 前置知识（Phase 1 已验证的模式）

Phase 1（微表情迁移）已建立以下模式，Phase 2 遵循同款：

1. **PerceptionState 扩展**：加字段 + 默认值 + 独立 setter（`setBalanceSwayEnabled`，与 `setBreathEnabled` 同款）
2. **observer 注册**：在 `activatePerception` 的 `onBeforeRenderObservable.add` 回调内，微表情之后、gaze 之前新增 `_applyBalanceSway` 调用
3. **测试**：通过 `triggerLastObserver()` 触发 observer 回调，`mock performance.now()` 控制时间，不导出测试专用函数
4. **序列化迁移**：导出 `migrateBalanceSwayFromProcMotion` 供测试引用
5. **i18n**：`motion.xxx` 命名空间，5 语言同步
6. **UI**：`addToggleRow` + `setBalanceSwayEnabled + activatePerception + getMotionMenu()?.updateControls()`

## idle 躯干微晃算法（迁移源）

idle 的 4 个躯干骨骼块（`proc-motion-idle.ts` L48-132），`loopFrames ≈ 120`，`phase = f/loopFrames * 2π`：

| 骨骼 | 候选名 | position | rotation | amplitude |
|------|--------|----------|----------|-----------|
| upper2 | 上半身2 | 无 | rx = sin(phase*0.7+0.3) * 0.015 | 0.015 * intensity |
| waist | 腰 | 无 | rz = sin(phase+0.5) * 0.02 | 0.02 * intensity |
| allParent | 全ての親 | 无 | rx = sin(t*0.2+1.1)*0.005, rz = sin(t*0.3+2.3)*0.005 | 0.005 * intensity |
| center | センター | bobY = sin(phase) * 0.04 | rz = sin(slowPhase)*0.1, rx = sin(phase*0.37+0.5)*0.03 | 0.1/0.03/0.04 * intensity |

**实时转换**：`loopFrames=120 @60fps → period = 2s`，所以 `phase = time * π`（即 `time * 2π / 2`）。

**叠加策略**（与 `_applyBreathing` 同款）：
- rotation：读 `linkedBone.rotationQuaternion` → Slerp 到目标四元数（权重 0.5）→ 写回
- position：读 `linkedBone.position` → Lerp 到目标（权重 0.5）→ 写回
- 与 `_applyBreathing` 的 spine 不冲突（写不同骨骼）
- center(センター) 是 spine(上半身) 的父骨骼，center 的 bobY 通过骨骼链传播到 spine 是物理正确行为

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `frontend/src/scene/motion/perception.ts` | 感知层核心 | 修改：新增 `_applyBalanceSway` + 扩展 `PerceptionState` + setter |
| `frontend/src/__tests__/perception.test.ts` | 感知层测试 | 修改：新增重心微动测试 |
| `frontend/src/motion-algos/proc-motion-idle.ts` | idle VMD 生成 | 修改：移除 center/upper2/waist/allParent 块 |
| `frontend/src/scene/scene-serialize.ts` | 场景序列化 | 修改：扩展 `balanceSwayEnabled` + 旧存档迁移 |
| `frontend/src/menus/motion-gaze-levels.ts` | Gaze/感知 UI | 修改：新增重心微动开关 |
| `frontend/src/core/i18n/locales/{zh-CN,en,ja,ko,zh-TW}.ts` | i18n | 修改：新增翻译键 |
| `docs/adr/adr-079-perception-layer-expansion.md` | ADR | 修改：Phase 2 完成记录 |

---

## Task 1: 扩展 PerceptionState 加入 balanceSwayEnabled

**Files:**
- Modify: `frontend/src/scene/motion/perception.ts`（PerceptionState 接口 + DEFAULT + setter）
- Test: `frontend/src/__tests__/perception.test.ts`

- [ ] **Step 1: 写失败测试**

在 `frontend/src/__tests__/perception.test.ts` 末尾新增：

```typescript
// =====================================================================
// 重心微动（Balance Sway）状态
// =====================================================================

describe('balanceSway state', () => {
    it('默认 balanceSwayEnabled 为 true', () => {
        const sut = makeSut();
        const state = sut.getPerceptionState();
        expect(state.balanceSwayEnabled).toBe(true);
    });

    it('setBalanceSwayEnabled 可关闭重心微动', () => {
        const sut = makeSut();
        sut.setBalanceSwayEnabled(false);
        expect(sut.getPerceptionState().balanceSwayEnabled).toBe(false);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL — `state.balanceSwayEnabled` is undefined

- [ ] **Step 3: 扩展 PerceptionState 接口与默认值**

在 `frontend/src/scene/motion/perception.ts` 修改 `PerceptionState` 接口（紧邻 `microExpressionEnabled` 之后）：

```typescript
export interface PerceptionState {
    breathEnabled: boolean;
    blinkEnabled: boolean;
    headTrackingEnabled: boolean;
    eyeTrackingEnabled: boolean;
    microExpressionEnabled: boolean;
    emotion: Emotion;
    balanceSwayEnabled: boolean;
}
```

`DEFAULT_PERCEPTION_STATE` 新增：

```typescript
const DEFAULT_PERCEPTION_STATE: PerceptionState = {
    breathEnabled: true,
    blinkEnabled: true,
    headTrackingEnabled: true,
    eyeTrackingEnabled: true,
    microExpressionEnabled: true,
    emotion: 'neutral',
    balanceSwayEnabled: true,
};
```

新增独立 setter（与 `setMicroExpressionEnabled` 同款，紧邻之后）：

```typescript
/** 设置重心微动开关 */
export function setBalanceSwayEnabled(enabled: boolean): void {
    perceptionState.balanceSwayEnabled = enabled;
    triggerAutoSave();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: PASS（2 个新测试通过）

- [ ] **Step 5: 类型检查 + 提交**

Run: `cd frontend && npm run check`
Expected: PASS

```bash
git add frontend/src/scene/motion/perception.ts frontend/src/__tests__/perception.test.ts
git commit -m "feat(perception): 扩展 PerceptionState 加入 balanceSwayEnabled"
```

---

## Task 2: 实现 _applyBalanceSway 实时叠加

**Files:**
- Modify: `frontend/src/scene/motion/perception.ts`（新增函数 + 注册到 observer）
- Test: `frontend/src/__tests__/perception.test.ts`

**设计说明**：
- 4 骨骼：center(センター) + upper2(上半身2) + waist(腰) + allParent(全ての親)
- rotation 用 Slerp 叠加（读当前 → Slerp 到目标 → 写回），与 `_applyBreathing` 同款
- position（center 的 bobY）用 Lerp 叠加（读当前 y → Lerp 到目标 → 写回）
- period = 2s（从 idle 的 loopFrames=120@60fps 转换）
- intensity = 1.0（固定，不再从 ProcMotionState 读取）
- 复用 `matchBone` 匹配候选名，复用 `_q()` 四元数池

- [ ] **Step 1: 写失败测试**

在 `frontend/src/__tests__/perception.test.ts` 新增（参考 Phase 1 微表情测试的 mock 模式）：

```typescript
// =====================================================================
// _applyBalanceSway 实时叠加（通过 observer 回调触发）
// =====================================================================

describe('_applyBalanceSway', () => {
    beforeEach(() => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('balanceSwayEnabled=false 时不写入任何骨骼', () => {
        const sut = makeSut();
        // mock 模型含 center 骨骼，但 runtimeBones 需模拟 linkedBone
        const mockRuntimeBones = makeMockRuntimeBones(['センター', '上半身2', '腰', '全ての親']);
        const mmdModel = { runtimeBones: mockRuntimeBones, mesh: {} };
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setBalanceSwayEnabled(false);
        sut.activatePerception('m1');
        vi.mocked(performance.now).mockReturnValue(500); // 0.5s
        triggerLastObserver();
        // 无骨骼被写入（rotation/position 不变）
        for (const b of mockRuntimeBones) {
            expect(b.linkedBone.rotationQuaternion._wasWritten).toBe(false);
            expect(b.linkedBone.position._wasWritten).toBe(false);
        }
    });

    it('开启时写入 center 骨骼的 position 和 rotation', () => {
        const sut = makeSut();
        const mockRuntimeBones = makeMockRuntimeBones(['センター']);
        const mmdModel = { runtimeBones: mockRuntimeBones, mesh: {} };
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setBalanceSwayEnabled(true);
        sut.activatePerception('m1');
        vi.mocked(performance.now).mockReturnValue(500); // 0.5s = phase = 0.5*π = π/2
        triggerLastObserver();
        const center = mockRuntimeBones.find(b => b.name === 'センター');
        expect(center!.linkedBone.position._wasWritten).toBe(true);
        expect(center!.linkedBone.rotationQuaternion._wasWritten).toBe(true);
    });

    it('骨骼不存在时静默跳过', () => {
        const sut = makeSut();
        const mockRuntimeBones = makeMockRuntimeBones([]); // 无骨骼
        const mmdModel = { runtimeBones: mockRuntimeBones, mesh: {} };
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setBalanceSwayEnabled(true);
        sut.activatePerception('m1');
        vi.mocked(performance.now).mockReturnValue(500);
        expect(() => triggerLastObserver()).not.toThrow();
    });

    it('关闭后 center position.bobY 归零（防残留）', () => {
        const sut = makeSut();
        const mockRuntimeBones = makeMockRuntimeBones(['センター']);
        const mmdModel = { runtimeBones: mockRuntimeBones, mesh: {} };
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setBalanceSwayEnabled(true);
        sut.activatePerception('m1');
        // 1. 开启时写入
        vi.mocked(performance.now).mockReturnValue(500);
        triggerLastObserver();
        const center = mockRuntimeBones.find(b => b.name === 'センター')!;
        expect(center.linkedBone.position._wasWritten).toBe(true);
        // 2. 关闭
        sut.setBalanceSwayEnabled(false);
        triggerLastObserver();
        // 3. position.y 应归零（Lerp 到 0）
        expect(center.linkedBone.position.y).toBe(0);
    });
});
```

**测试辅助**（在测试文件顶部新增）：

```typescript
// Mock runtimeBones（模拟 babylon-mmd IMmdRuntimeBone + linkedBone）
function makeMockRuntimeBones(names: string[]) {
    return names.map(name => ({
        name,
        linkedBone: {
            rotationQuaternion: makeMockQuaternion(),
            position: makeMockVector3(),
        },
        childBones: [],
        updateWorldMatrix: vi.fn(),
    }));
}

function makeMockQuaternion() {
    return {
        x: 0, y: 0, z: 0, w: 1,
        copyFrom: vi.fn(function(this: any, src: any) { this.x = src.x; this.y = src.y; this.z = src.z; this.w = src.w; return this; }),
        _wasWritten: false,
    };
}

function makeMockVector3() {
    return {
        x: 0, y: 0, z: 0,
        _wasWritten: false,
        set _y(v: number) { (this as any).__y = v; this._wasWritten = true; },
        get y() { return (this as any).__y ?? 0; },
    };
}
```

**注意**：mock 的 `linkedBone.rotationQuaternion` 需支持 `copyFrom` + 属性写入；`linkedBone.position` 需支持 `y` 属性读写。若 mock 过于复杂，可简化为只验证「函数被调用且不抛异常」+ 「关闭时 y 归零」两个核心断言。先读 perception.test.ts 现有 mock 结构，确认能否复用。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL — observer 回调中无重心微动逻辑

- [ ] **Step 3: 实现 _applyBalanceSway**

在 `frontend/src/scene/motion/perception.ts` 新增（紧邻 `_applyMicroExpression` 之后）。**需先 grep 确认 perception.ts 顶部已导入 `BONE_CENTER_CANDIDATES` / `BONE_UPPER2_CANDIDATES` / `BONE_WAIST_CANDIDATES` / `BONE_ALLPARENT_CANDIDATES`，若未导入则从 `proc-motion-shared` 补充导入。**

```typescript
// ── 重心微动（躯干骨骼平衡微晃，从 proc-motion-idle.ts 迁移） ──

/** 重心微动周期（秒，从 idle loopFrames=120@60fps 转换） */
const BALANCE_SWAY_PERIOD = 2.0;
/** 重心微动各骨骼振幅（从 idle 算法提取，intensity 固定 1.0） */
const SWAY_AMP = {
    center_rz: 0.1,      // center 慢速摆动
    center_rx: 0.03,     // center 微动
    center_bobY: 0.04,   // center 上下浮动
    upper2_rx: 0.015,    // 上半身2 前后倾
    waist_rz: 0.02,      // 腰 左右摆
    allParent_rx: 0.005, // 全親 微倾
    allParent_rz: 0.005,
};

/** 上次写入的骨骼名（用于关闭时复位 position） */
let _lastBalanceSwayBones: string[] = [];

function _applyBalanceSway(mmdModel: any, time: number, enabled: boolean): void {
    const boneNames: string[] = mmdModel.runtimeBones.map((b: any) => b.name);

    const centerName = matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upper2Name = matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const waistName = matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const allParentName = matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);

    // 关闭时复位 position.bobY 到 0（防残留冻结）
    if (!enabled) {
        for (const name of _lastBalanceSwayBones) {
            const bone = mmdModel.runtimeBones.find((b: any) => b.name === name);
            if (bone?.linkedBone?.position) {
                bone.linkedBone.position.y = 0;
            }
        }
        _lastBalanceSwayBones = [];
        return;
    }

    const phase = (time % BALANCE_SWAY_PERIOD) / BALANCE_SWAY_PERIOD * Math.PI * 2;
    const slowPhase = phase * 0.5;
    const written: string[] = [];

    // center: position bobY + rotation rz/rx
    if (centerName) {
        const bone = mmdModel.runtimeBones.find((b: any) => b.name === centerName);
        if (bone?.linkedBone) {
            const bobY = Math.sin(phase) * SWAY_AMP.center_bobY;
            // position Lerp 叠加（与当前值 0.5 权重平均）
            bone.linkedBone.position.y = (bone.linkedBone.position.y + bobY) * 0.5;

            const rz = Math.sin(slowPhase) * SWAY_AMP.center_rz;
            const rx = Math.sin(phase * 0.37 + 0.5) * SWAY_AMP.center_rx;
            // rotation 直接构造目标四元数（与 idle VMD 一致）
            const targetQ = _q().fromEulerAngles(rx, 0, rz);
            const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
            Quaternion.SlerpToRef(localQ, targetQ, 0.5, localQ);
            bone.linkedBone.rotationQuaternion = localQ;
            written.push(centerName);
        }
    }

    // upper2: rotation rx
    if (upper2Name) {
        const bone = mmdModel.runtimeBones.find((b: any) => b.name === upper2Name);
        if (bone?.linkedBone) {
            const rx = Math.sin(phase * 0.7 + 0.3) * SWAY_AMP.upper2_rx;
            const targetQ = _q().fromEulerAngles(rx, 0, 0);
            const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
            Quaternion.SlerpToRef(localQ, targetQ, 0.5, localQ);
            bone.linkedBone.rotationQuaternion = localQ;
            written.push(upper2Name);
        }
    }

    // waist: rotation rz
    if (waistName) {
        const bone = mmdModel.runtimeBones.find((b: any) => b.name === waistName);
        if (bone?.linkedBone) {
            const rz = Math.sin(phase + 0.5) * SWAY_AMP.waist_rz;
            const targetQ = _q().fromEulerAngles(0, 0, rz);
            const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
            Quaternion.SlerpToRef(localQ, targetQ, 0.5, localQ);
            bone.linkedBone.rotationQuaternion = localQ;
            written.push(waistName);
        }
    }

    // allParent: rotation rx/rz
    if (allParentName) {
        const bone = mmdModel.runtimeBones.find((b: any) => b.name === allParentName);
        if (bone?.linkedBone) {
            const rx = Math.sin(phase * 0.2 + 1.1) * SWAY_AMP.allParent_rx;
            const rz = Math.sin(phase * 0.3 + 2.3) * SWAY_AMP.allParent_rz;
            const targetQ = _q().fromEulerAngles(rx, 0, rz);
            const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
            Quaternion.SlerpToRef(localQ, targetQ, 0.5, localQ);
            bone.linkedBone.rotationQuaternion = localQ;
            written.push(allParentName);
        }
    }

    _lastBalanceSwayBones = written;
}
```

**注意**：`_q()` 是 perception.ts 已有的四元数池函数（`_applyBreathing` 在用）。`fromEulerAngles` 是 Babylon.js `Quaternion.FromEulerAnglesToRef` 或手动构造——**先 grep 确认 perception.ts 是否已有 fromEulerAngles 的使用**，若无，用 `Quaternion.FromEulerAngles(rx, 0, rz)` 直接构造（不进池，因 4 骨骼独立）。`BONE_*_CANDIDATES` 常量需从 `proc-motion-shared` 导入——先 grep 确认 perception.ts 顶部已导入了哪些。

- [ ] **Step 4: 注册到 perception observer**

在 observer 回调内，微表情之后、gaze 之前新增：

```typescript
        // 4. 重心微动（无条件调用，内部处理关闭复位）
        _applyBalanceSway(mmdModel, time, perceptionState.balanceSwayEnabled);

        // 5. 头部跟随 + 眼部跟随（gaze）
```

（原 gaze 的注释序号从 4 改为 5）

- [ ] **Step 5: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: PASS

- [ ] **Step 6: 类型检查**

Run: `cd frontend && npm run check`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add frontend/src/scene/motion/perception.ts frontend/src/__tests__/perception.test.ts
git commit -m "feat(perception): 实现 _applyBalanceSway 躯干微晃实时叠加"
```

---

## Task 3: 移除 idle 的 center/upper2/waist/allParent 生成块

**Files:**
- Modify: `frontend/src/motion-algos/proc-motion-idle.ts:48-132`（删除 4 个块）
- Modify: `frontend/src/motion-algos/proc-motion-shared.ts`（保留 category，因 autodance 可能引用）

- [ ] **Step 1: 确认 center/upper2/waist/allParent category 引用范围**

Run: `cd frontend && rg -n "boneToggles\.(center|upper2|waist|allParent)" src/motion-algos/ src/menus/ src/scene/ --type ts`
记录哪些文件引用这些 toggle。若 autodance 引用则保留 category。

- [ ] **Step 2: 删除 idle 的 4 个躯干生成块**

在 `frontend/src/motion-algos/proc-motion-idle.ts` 删除以下 4 个块（L48-132）：
- `if (upper2Bone && state.boneToggles.upper2) { ... }` 块（L48-67）
- `if (waistBone && state.boneToggles.waist) { ... }` 块（L69-83）
- `if (allParentBone && state.boneToggles.allParent) { ... }` 块（L85-105）
- `if (centerBone && state.boneToggles.center) { ... }` 块（L107-132）

**保留**：手臂（L134+）、肩膀、手腕的生成块。保留 `centerBone`/`upper2Bone`/`waistBone`/`allParentBone` 变量声明（L37-40）但因后续无引用，tsc 若报 unused 则删除声明。

- [ ] **Step 3: 运行测试 + 类型检查**

Run: `cd frontend && npx vitest run src/__tests__/procedural-motion.test.ts`（若存在）
Run: `cd frontend && npm run check`
Expected: PASS（若 idle 测试断言了 center 关键帧，需更新断言）

- [ ] **Step 4: 提交**

```bash
git add frontend/src/motion-algos/proc-motion-idle.ts
git commit -m "refactor(idle): 移除躯干微晃生成（已迁入感知层）"
```

---

## Task 4: 序列化扩展与旧存档迁移

**Files:**
- Modify: `frontend/src/scene/scene-serialize.ts`

- [ ] **Step 1: 写失败测试**

在 `frontend/src/__tests__/perception.test.ts` 新增迁移测试：

```typescript
describe('scene-serialize balanceSway migration', () => {
    it('旧存档 boneToggles.center=true 时映射为 balanceSwayEnabled=true', () => {
        const old = { boneToggles: { center: true, upper2: false, waist: false, allParent: false } };
        const migrated = migrateBalanceSwayFromProcMotion(old);
        expect(migrated.balanceSwayEnabled).toBe(true);
    });

    it('旧存档四个躯干 toggle 全 false 时映射为 balanceSwayEnabled=false', () => {
        const old = { boneToggles: { center: false, upper2: false, waist: false, allParent: false } };
        const migrated = migrateBalanceSwayFromProcMotion(old);
        expect(migrated.balanceSwayEnabled).toBe(false);
    });

    it('旧存档无 boneToggles 时默认 balanceSwayEnabled=true', () => {
        const migrated = migrateBalanceSwayFromProcMotion({});
        expect(migrated.balanceSwayEnabled).toBe(true);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL — `migrateBalanceSwayFromProcMotion` not defined

- [ ] **Step 3: 实现 migrateBalanceSwayFromProcMotion**

在 `frontend/src/scene/scene-serialize.ts` 新增导出函数（紧邻 `migratePerceptionFromProcMotion` 之后）：

```typescript
/** 从旧 procMotion 的躯干 toggle 迁移为 balanceSwayEnabled（任一为 true 则 true） */
export function migrateBalanceSwayFromProcMotion(
    old: { boneToggles?: { center?: boolean; upper2?: boolean; waist?: boolean; allParent?: boolean } }
): { balanceSwayEnabled: boolean } {
    const t = old.boneToggles;
    if (!t) return { balanceSwayEnabled: true }; // 无旧数据时默认开启
    return {
        balanceSwayEnabled: !!(t.center || t.upper2 || t.waist || t.allParent),
    };
}
```

在 `migratePerceptionFromProcMotion` 中合并调用（追加 `balanceSwayEnabled` 字段）：

```typescript
export function migratePerceptionFromProcMotion(
    old: Partial<ProcMotionState>
): Partial<PerceptionState> {
    const t = old.boneToggles;
    return {
        eyeTrackingEnabled: old.eyeTrackingEnabled ?? true,
        headTrackingEnabled: old.headTrackingEnabled ?? true,
        blinkEnabled: t?.blink ?? true,
        breathEnabled: true,
        microExpressionEnabled: t?.emotion ?? true,
        emotion: 'neutral',
        // 躯干微晃：四个 toggle 任一为 true 则开启
        balanceSwayEnabled: !!(t?.center || t?.upper2 || t?.waist || t?.allParent) ?? true,
    };
}
```

**注意**：`?? true` 在 `||` 结果为 false 时触发（即四个 toggle 全 false 或不存在时，默认 true）。但 `!!(... ) ?? true` 语法有误——`!!` 结果是 boolean，`??` 只对 null/undefined 生效。改为：`(t?.center || t?.upper2 || t?.waist || t?.allParent) === undefined ? true : !!(t?.center || t?.upper2 || t?.waist || t?.allParent)`。或更简洁：`const hasToggles = t && (t.center || t.upper2 || t.waist || t.allParent); balanceSwayEnabled: hasToggles === undefined ? true : !!hasToggles`。**实现时用简洁正确的写法。**

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/scene/scene-serialize.ts frontend/src/__tests__/perception.test.ts
git commit -m "feat(serialize): balanceSwayEnabled 迁移 + 旧存档 boneToggles 映射"
```

---

## Task 5: UI 接入

**Files:**
- Modify: `frontend/src/menus/motion-gaze-levels.ts`
- Modify: `frontend/src/core/i18n/locales/{zh-CN,en,ja,ko,zh-TW}.ts`

- [ ] **Step 1: 添加 i18n 翻译键**

5 个 locale 文件新增（示例 zh-CN）：

```typescript
'motion.balanceSway': '重心微动',
```

同步 en: `'Balance Sway'` / ja: `'重心微動'` / ko: `'중심 미동'` / zh-TW: `'重心微動'`。

- [ ] **Step 2: 在 motion-gaze-levels.ts 新增开关**

导入 `setBalanceSwayEnabled`，在微表情区块之后新增：

```typescript
import {
    // ... 现有导入 ...
    setBalanceSwayEnabled,  // 新增
} from '../scene/motion/perception';

// ... 在微表情区块之后 ...
addToggleRow(
    c,
    t('motion.balanceSway'),
    getPerceptionState().balanceSwayEnabled,
    (v) => {
        setBalanceSwayEnabled(v);
        activatePerception();
        getMotionMenu()?.updateControls();
    },
);
```

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `cd frontend && npm run check`
Run: `cd frontend && npm run test`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/src/menus/motion-gaze-levels.ts frontend/src/core/i18n/locales/
git commit -m "feat(ui): motion-gaze-levels 新增重心微动开关"
```

---

## Task 6: 更新 ADR-079 状态

**Files:**
- Modify: `docs/adr/adr-079-perception-layer-expansion.md`

- [ ] **Step 1: 更新状态行**

```markdown
> **状态**: Phase 1-2 已实施（2026-07-10）；Phase 3 待排期
```

- [ ] **Step 2: 新增 Phase 2 实施记录**

```markdown
### Phase 2: 重心微动迁移（2026-07-10）

- ✅ `PerceptionState` 扩展 `balanceSwayEnabled`
- ✅ `_applyBalanceSway` 实时叠加实现（4 骨骼：center/upper2/waist/allParent；rotation Slerp + position Lerp；period 2s）
- ✅ `proc-motion-idle.ts` 移除躯干微晃生成块（手臂/肩膀/手腕保留）
- ✅ 序列化扩展 + `migrateBalanceSwayFromProcMotion`（`boneToggles.center/upper2/waist/allParent` 任一 true → `balanceSwayEnabled: true`）
- ✅ UI 接入：motion-gaze-levels 新增重心微动开关
- ✅ i18n 5 语言同步
```

- [ ] **Step 3: 提交**

```bash
git add docs/adr/adr-079-perception-layer-expansion.md
git commit -m "docs(adr-079): Phase 2 重心微动迁移完成"
```

---

## 验收标准

- [ ] `npm run check` 通过
- [ ] `npm run test` 通过（无新增失败）
- [ ] `npm run build` 通过
- [ ] 重心微动在 enabled=false 时 position.bobY 归零
- [ ] 重心微动在 enabled=true 时写入 4 骨骼的 rotation + center 的 position
- [ ] 旧存档加载后 `balanceSwayEnabled` 按 `boneToggles.center/upper2/waist/allParent` 映射
- [ ] `proc-motion-idle.ts` 不再生成 center/upper2/waist/allParent 关键帧
- [ ] UI 可切换重心微动开关
