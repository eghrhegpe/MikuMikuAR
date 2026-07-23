# ADR-150 模型替换状态继承 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"库中点击替换模型"从一个状态全丢的"load + remove"二元操作，变成"换模型但不换上下文"的原子操作——继承 transform/orbit/visibility/physics/morph/boneOverrides/feet/sceneMotionId/boneLock，外层包裹场景级撤销。

**Architecture:** 在 `model-ops.ts` 新增两个纯函数 `captureInheritedState(inst)` / `applyInheritedState(newId, snap)`，由 `library-actions.ts` 的 `startReplaceModel` 在 load 成功后、removeModel 之前调用。VMD 继承通过 `sceneMotionId` 引用场景动作库实现（ADR-167 既有广播链路自动应用），不引入 `loadVMDInternal`。外层用 `pushUndoSnapshot` + `offerSceneUndoAndRefresh` 提供撤销入口（ADR-127/158 既有机制）。

**Tech Stack:** TypeScript, Vitest, Babylon.js, babylon-mmd

**ADR-150 方案裁剪说明：**
- 决策一（LoadManager 三层 `load`/`restore`/`loadPMXFile` 内部化 + priority bypass）——**永久搁置**。反序列化并行加载实际无故障，restore 插队逻辑增加调度器复杂度但用户感知收益为零。
- 决策二（Replace 原子操作 + 状态继承）——**本计划实施**。继承项根据后 ADR-167 时代重新裁定。
- 决策三（`loadVMDInternal`）——**从方案中移除**。后 ADR-167 时代 VMD 通过 `sceneMotionId` 引用，`model-loader.ts:564-609` 已有自动应用逻辑。

---

## File Structure

| 文件 | 责任 | 改动类型 |
|------|------|---------|
| `frontend/src/scene/manager/model-ops.ts` | 新增 `captureInheritedState` / `applyInheritedState` / `ReplaceSnapshot` 类型 | 修改（追加导出） |
| `frontend/src/menus/library-actions.ts` | `startReplaceModel` 改造为 snapshot → load → apply → remove → undo | 修改（重写函数体） |
| `frontend/src/__tests__/scene/replace-model-inherit.test.ts` | `captureInheritedState` / `applyInheritedState` 单元测试 | 新建 |
| `docs/adr/adr-150-model-replace-contract.md` | 状态改回"实施中"，方案裁剪说明，继承裁定表更新 | 修改 |

**不涉及：** `load-manager.ts`、`scene-serialize.ts`、`motion-intent.ts`、`vmd-loader.ts`、`model-loader.ts`

---

## 继承裁定表（最终版）

| 状态 | 继承 | 应用方式 | 失败行为 |
|------|------|---------|---------|
| Transform (position/rotation/scaling) | ✅ | `modelManager.setPosition/setRotation/setScaling` | — |
| Orbit (azimuth/elevation/distance) + positionMode | ✅ | `modelManager.setOrbit/setPositionMode` | — |
| Visibility / Wireframe / Opacity | ✅ | `modelManager.setVisibility/setWireframe/setOpacity` | — |
| Bone Lines / Bone Joints 可见性 | ✅ | `modelManager.setBoneLinesVis/setBoneJointsVis` | — |
| Physics Enabled | ✅ | `modelManager.setPhysics` | — |
| Morph 权重 | ✅ | 遍历旧模型 morphs，`modelManager.setMorphWeight` | 新模型无同名 morph → 静默跳过 |
| Bone Overrides | ✅ | 遍历 `inst.boneOverrides`，`setBoneOverride` | 新模型无同名骨 → 静默跳过（不写入 store） |
| Feet State | ✅ | 直接赋值 `inst.feet`（结构化克隆） | — |
| sceneMotionId（VMD 引用） | ✅ | 赋值 `inst.motionSlots.primary.sceneMotionId` | model-loader 自动应用场景动作；引用失效由 ADR-167 回退处理 |
| Bone Lock | ✅ | `setOrbitBoneLock(true, oldBoneName)` | 新模型无同名骨 → 不调用 lock，日志提示 |
| **Outfit** | ❌ **不继承** | 重置 | — |
| **Perception pin 状态** | ❌ P2 后续 | 自动 `activatePerception(id)` 已够用 | — |

---

## Task 1: 定义 ReplaceSnapshot 类型与 captureInheritedState 纯函数

**Files:**
- Modify: `frontend/src/scene/manager/model-ops.ts`（末尾追加）
- Test: `frontend/src/__tests__/scene/replace-model-inherit.test.ts`（新建）

- [ ] **Step 1: 写失败测试 — captureInheritedState 提取全部字段**

新建 `frontend/src/__tests__/scene/replace-model-inherit.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { captureInheritedState } from '../../scene/manager/model-ops';
import type { ModelInstance } from '@/core/types';

// 最小可用的 ModelInstance mock：仅包含 captureInheritedState 读取的字段
function makeMockInst(overrides: Partial<ModelInstance> = {}): ModelInstance {
    return {
        id: 'old-1',
        name: 'Old',
        filePath: '/old.pmx',
        modelDir: '/',
        meshes: [],
        rootMesh: {} as any,
        vmdData: null,
        vmdName: '',
        vmdPath: null,
        animationDuration: 0,
        vmdLayers: [],
        kind: 'actor',
        visible: true,
        opacity: 0.8,
        wireframe: true,
        showBoneLines: true,
        showBoneJoints: false,
        physicsEnabled: true,
        scaling: 1.5,
        rotationY: 30,
        rotation: [0.1, 0.523, 0],
        boneOverrides: [
            { boneName: '上半身', euler: [5, 0, 0], weight: 1, enabled: true },
        ],
        feet: {
            enabled: true, intensity: 0.6, soleHeight: 0.05,
            jumpThreshold: 0.5, bodySmooth: 0.5, footSmooth: 0.5,
            maxAngle: 30, reachAngle: 15,
        },
        positionMode: 'orbit',
        orbitAzimuth: 45,
        orbitElevation: -10,
        orbitDistance: 8,
        motionSlots: { primary: { source: 'inherit', status: 'compatible', sceneMotionId: 'motion-xyz' } },
        ...overrides,
    } as unknown as ModelInstance;
}

describe('captureInheritedState', () => {
    it('提取全部可继承字段', () => {
        const inst = makeMockInst();
        const snap = captureInheritedState(inst);
        expect(snap.visible).toBe(true);
        expect(snap.opacity).toBe(0.8);
        expect(snap.wireframe).toBe(true);
        expect(snap.showBoneLines).toBe(true);
        expect(snap.showBoneJoints).toBe(false);
        expect(snap.physicsEnabled).toBe(true);
        expect(snap.scaling).toBe(1.5);
        expect(snap.rotation).toEqual([0.1, 0.523, 0]);
        expect(snap.positionMode).toBe('orbit');
        expect(snap.orbitAzimuth).toBe(45);
        expect(snap.orbitElevation).toBe(-10);
        expect(snap.orbitDistance).toBe(8);
        expect(snap.boneOverrides).toHaveLength(1);
        expect(snap.boneOverrides[0].boneName).toBe('上半身');
        expect(snap.feet.enabled).toBe(true);
        expect(snap.sceneMotionId).toBe('motion-xyz');
    });

    it('motionSlots 为 undefined 时 sceneMotionId 为 undefined', () => {
        const inst = makeMockInst({ motionSlots: undefined });
        const snap = captureInheritedState(inst);
        expect(snap.sceneMotionId).toBeUndefined();
    });

    it('boneOverrides 为空数组时正常返回空数组', () => {
        const inst = makeMockInst({ boneOverrides: [] });
        const snap = captureInheritedState(inst);
        expect(snap.boneOverrides).toEqual([]);
    });

    it('快照中的数组/对象是深拷贝，不引用原 inst', () => {
        const inst = makeMockInst();
        const snap = captureInheritedState(inst);
        snap.boneOverrides[0].boneName = '篡改';
        snap.feet.enabled = false;
        expect(inst.boneOverrides[0].boneName).toBe('上半身');
        expect(inst.feet.enabled).toBe(true);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test -- src/__tests__/scene/replace-model-inherit.test.ts`
Expected: FAIL — `captureInheritedState is not a function` 或导入错误

- [ ] **Step 3: 实现 ReplaceSnapshot 类型 + captureInheritedState**

在 `frontend/src/scene/manager/model-ops.ts` 末尾追加：

```typescript
// ======== [doc:adr-150] 模型替换状态继承 ========

/** [doc:adr-150] 替换模型时从旧模型捕获、应用到新模型的可继承状态快照。
 *  不含 outfit（重置）、VMD 文件数据（通过 sceneMotionId 引用场景动作库）。 */
export interface ReplaceSnapshot {
    visible: boolean;
    opacity: number;
    wireframe: boolean;
    showBoneLines: boolean;
    showBoneJoints: boolean;
    physicsEnabled: boolean;
    scaling: number;
    rotation: [number, number, number];
    positionMode: 'cartesian' | 'orbit';
    /** 仅 positionMode==='orbit' 时有意义 */
    orbitAzimuth?: number;
    orbitElevation?: number;
    orbitDistance?: number;
    /** 直角坐标，仅 positionMode==='cartesian' 时应用；orbit 模式由 orbit 三参数定位 */
    position: [number, number, number];
    boneOverrides: BoneOverrideEntry[];
    feet: FeetState;
    /** [doc:adr-167] 场景动作库引用；undefined=继承默认动作 */
    sceneMotionId?: string;
    /** [doc:adr-150] 轨道相机骨骼锁定骨名；新模型无同名骨则解锁 */
    boneLockBoneName?: string;
}

/** [doc:adr-150] 从旧 ModelInstance 提取可继承状态（深拷贝，不引用原 inst 字段）。 */
export function captureInheritedState(inst: ModelInstance): ReplaceSnapshot {
    return {
        visible: inst.visible,
        opacity: inst.opacity,
        wireframe: inst.wireframe,
        showBoneLines: inst.showBoneLines,
        showBoneJoints: inst.showBoneJoints,
        physicsEnabled: inst.physicsEnabled,
        scaling: inst.scaling,
        rotation: [...inst.rotation] as [number, number, number],
        positionMode: inst.positionMode ?? 'cartesian',
        orbitAzimuth: inst.orbitAzimuth,
        orbitElevation: inst.orbitElevation,
        orbitDistance: inst.orbitDistance,
        position: inst.meshes[0]?.position
            ? [inst.meshes[0].position.x, inst.meshes[0].position.y, inst.meshes[0].position.z]
            : [0, 0, 0],
        boneOverrides: inst.boneOverrides.map((b) => ({ ...b, euler: [...b.euler] as [number, number, number] })),
        feet: { ...inst.feet },
        sceneMotionId: inst.motionSlots?.primary?.sceneMotionId,
        boneLockBoneName: getOrbitBoneLock().boneName ?? undefined,
    };
}
```

同时在 `model-ops.ts` 顶部 import 块补充（若尚无）：

```typescript
import type { BoneOverrideEntry, FeetState, ModelInstance } from '@/core/types';
import { getOrbitBoneLock } from '../camera/camera';
```

注意：`getOrbitBoneLock` 当前从 `'../camera/camera'` 导出（`camera.ts:978`）。`model-ops.ts:14` 已 import `getCameraMode, switchCameraMode` from `'../camera/camera'`，只需在同 行追加 `getOrbitBoneLock`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test -- src/__tests__/scene/replace-model-inherit.test.ts`
Expected: PASS — 4 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add frontend/src/scene/manager/model-ops.ts frontend/src/__tests__/scene/replace-model-inherit.test.ts
git commit -m "feat(adr-150): add captureInheritedState for model replace snapshot"
```

---

## Task 2: 实现 applyInheritedState — 将快照应用到新模型

**Files:**
- Modify: `frontend/src/scene/manager/model-ops.ts`
- Test: `frontend/src/__tests__/scene/replace-model-inherit.test.ts`（追加测试）

- [ ] **Step 1: 写失败测试 — applyInheritedState 调用 modelManager setter**

在 `replace-model-inherit.test.ts` 追加（顶部 import 补充 `applyInheritedState` 与 mock）：

```typescript
import { applyInheritedState } from '../../scene/manager/model-ops';
import type { ReplaceSnapshot } from '../../scene/manager/model-ops';

// mock modelManager 与 setBoneOverride / setOrbitBoneLock / getFocusedModelBoneNames
vi.mock('../../scene/scene', () => ({
    modelManager: {
        setVisibility: vi.fn(),
        setOpacity: vi.fn(),
        setWireframe: vi.fn(),
        setBoneLinesVis: vi.fn(),
        setBoneJointsVis: vi.fn(),
        setPhysics: vi.fn(),
        setScaling: vi.fn(),
        setRotation: vi.fn(),
        setPosition: vi.fn(),
        setOrbit: vi.fn(),
        setPositionMode: vi.fn(),
        setMorphWeight: vi.fn(),
        getMorphs: vi.fn(() => [{ name: '笑い', type: 0 }]),
    },
}));

vi.mock('../../scene/motion/bone-override', () => ({
    setBoneOverride: vi.fn(),
}));

vi.mock('../../scene/camera/camera', () => ({
    getOrbitBoneLock: vi.fn(() => ({ enabled: false, boneName: null })),
    setOrbitBoneLock: vi.fn(),
    getFocusedModelBoneNames: vi.fn(() => ['上半身', '首', '左腕']),
    getCameraMode: vi.fn(() => 'orbit'),
    switchCameraMode: vi.fn(),
}));

import { modelManager } from '../../scene/scene';
import { setBoneOverride } from '../../scene/motion/bone-override';
import { setOrbitBoneLock, getFocusedModelBoneNames } from '../../scene/camera/camera';

describe('applyInheritedState', () => {
    it('调用 modelManager setter 应用基础状态', () => {
        const snap: ReplaceSnapshot = {
            visible: false, opacity: 0.5, wireframe: true,
            showBoneLines: true, showBoneJoints: false, physicsEnabled: false,
            scaling: 2.0, rotation: [0.1, 0.2, 0.3], positionMode: 'cartesian',
            position: [1, 2, 3], boneOverrides: [], feet: { enabled: false, intensity: 0, soleHeight: 0, jumpThreshold: 0.5, bodySmooth: 0.5, footSmooth: 0.5, maxAngle: 30, reachAngle: 15 },
        };
        applyInheritedState('new-1', snap);
        expect(modelManager.setVisibility).toHaveBeenCalledWith('new-1', false);
        expect(modelManager.setOpacity).toHaveBeenCalledWith('new-1', 0.5);
        expect(modelManager.setWireframe).toHaveBeenCalledWith('new-1', true);
        expect(modelManager.setScaling).toHaveBeenCalledWith('new-1', 2.0);
        expect(modelManager.setPosition).toHaveBeenCalledWith('new-1', 1, 2, 3);
        expect(modelManager.setPhysics).toHaveBeenCalledWith('new-1', false);
    });

    it('positionMode=orbit 时调用 setOrbit 而非 setPosition', () => {
        const snap: ReplaceSnapshot = {
            visible: true, opacity: 1, wireframe: false,
            showBoneLines: false, showBoneJoints: false, physicsEnabled: true,
            scaling: 1, rotation: [0, 0, 0], positionMode: 'orbit',
            orbitAzimuth: 30, orbitElevation: -5, orbitDistance: 10,
            position: [0, 0, 0], boneOverrides: [], feet: { enabled: false, intensity: 0, soleHeight: 0, jumpThreshold: 0.5, bodySmooth: 0.5, footSmooth: 0.5, maxAngle: 30, reachAngle: 15 },
        };
        applyInheritedState('new-1', snap);
        expect(modelManager.setOrbit).toHaveBeenCalledWith('new-1', 30, -5, 10);
        expect(modelManager.setPosition).not.toHaveBeenCalled();
    });

    it('boneOverrides 仅对新模型存在的骨骼调用 setBoneOverride', () => {
        const snap: ReplaceSnapshot = {
            visible: true, opacity: 1, wireframe: false,
            showBoneLines: false, showBoneJoints: false, physicsEnabled: true,
            scaling: 1, rotation: [0, 0, 0], positionMode: 'cartesian',
            position: [0, 0, 0],
            boneOverrides: [
                { boneName: '上半身', euler: [5, 0, 0], weight: 1, enabled: true },
                { boneName: '不存在的骨', euler: [0, 0, 0], weight: 1, enabled: true },
            ],
            feet: { enabled: false, intensity: 0, soleHeight: 0, jumpThreshold: 0.5, bodySmooth: 0.5, footSmooth: 0.5, maxAngle: 30, reachAngle: 15 },
        };
        applyInheritedState('new-1', snap);
        expect(setBoneOverride).toHaveBeenCalledTimes(1);
        expect(setBoneOverride).toHaveBeenCalledWith('上半身', [5, 0, 0], 1, true, 'new-1');
    });

    it('boneLockBoneName 在新模型存在时调用 setOrbitBoneLock(true)', () => {
        const snap: ReplaceSnapshot = {
            visible: true, opacity: 1, wireframe: false,
            showBoneLines: false, showBoneJoints: false, physicsEnabled: true,
            scaling: 1, rotation: [0, 0, 0], positionMode: 'cartesian',
            position: [0, 0, 0], boneOverrides: [], boneLockBoneName: '首',
            feet: { enabled: false, intensity: 0, soleHeight: 0, jumpThreshold: 0.5, bodySmooth: 0.5, footSmooth: 0.5, maxAngle: 30, reachAngle: 15 },
        };
        applyInheritedState('new-1', snap);
        expect(setOrbitBoneLock).toHaveBeenCalledWith(true, '首');
    });

    it('boneLockBoneName 在新模型不存在时不调用 setOrbitBoneLock(true)', () => {
        const snap: ReplaceSnapshot = {
            visible: true, opacity: 1, wireframe: false,
            showBoneLines: false, showBoneJoints: false, physicsEnabled: true,
            scaling: 1, rotation: [0, 0, 0], positionMode: 'cartesian',
            position: [0, 0, 0], boneOverrides: [], boneLockBoneName: '消失的骨',
            feet: { enabled: false, intensity: 0, soleHeight: 0, jumpThreshold: 0.5, bodySmooth: 0.5, footSmooth: 0.5, maxAngle: 30, reachAngle: 15 },
        };
        applyInheritedState('new-1', snap);
        expect(setOrbitBoneLock).not.toHaveBeenCalledWith(true, expect.anything());
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm run test -- src/__tests__/scene/replace-model-inherit.test.ts`
Expected: FAIL — `applyInheritedState is not a function`

- [ ] **Step 3: 实现 applyInheritedState**

在 `frontend/src/scene/manager/model-ops.ts` 追加：

```typescript
/** [doc:adr-150] 将状态快照应用到新模型（通过 modelManager setter + setBoneOverride）。
 *  必须在新模型已注册到 modelRegistry 后调用。boneOverrides 仅对新模型存在的骨骼应用。 */
export function applyInheritedState(newId: string, snap: ReplaceSnapshot): void {
    const mm = modelManager;
    if (!mm) {
        logWarn('adr-150', 'applyInheritedState: modelManager unavailable');
        return;
    }

    // 1. 基础可见性 / 物理开关
    mm.setVisibility(newId, snap.visible);
    mm.setOpacity(newId, snap.opacity);
    mm.setWireframe(newId, snap.wireframe);
    mm.setBoneLinesVis(newId, snap.showBoneLines);
    mm.setBoneJointsVis(newId, snap.showBoneJoints);
    mm.setPhysics(newId, snap.physicsEnabled);

    // 2. 变换
    mm.setScaling(newId, snap.scaling);
    mm.setRotation(newId, new Vector3(snap.rotation[0], snap.rotation[1], snap.rotation[2]));
    if (snap.positionMode === 'orbit' && snap.orbitAzimuth !== undefined && snap.orbitElevation !== undefined && snap.orbitDistance !== undefined) {
        mm.setPositionMode(newId, 'orbit');
        mm.setOrbit(newId, snap.orbitAzimuth, snap.orbitElevation, snap.orbitDistance);
    } else {
        mm.setPositionMode(newId, 'cartesian');
        mm.setPosition(newId, snap.position[0], snap.position[1], snap.position[2]);
    }

    // 3. Bone Overrides — 仅对新模型存在的骨骼应用，避免 store 堆积无效条目
    const newBoneNames = new Set(getFocusedModelBoneNames());
    for (const b of snap.boneOverrides) {
        if (newBoneNames.has(b.boneName)) {
            setBoneOverride(b.boneName, b.euler, b.weight, b.enabled, newId, b.absolute);
        }
    }

    // 4. Feet State — 直接写入 ModelInstance（model-loader 已创建默认 feet，此处覆盖）
    const newInst = modelRegistry.get(newId);
    if (newInst) {
        newInst.feet = { ...snap.feet };
        // sceneMotionId 继承：赋值后由 ADR-167 既有广播链路自动应用 VMD
        if (snap.sceneMotionId !== undefined) {
            newInst.motionSlots = {
                primary: {
                    source: 'inherit',
                    status: 'compatible',
                    sceneMotionId: snap.sceneMotionId,
                },
            };
        }
    }

    // 5. Bone Lock — 同名骨匹配，失败静默不锁
    if (snap.boneLockBoneName && newBoneNames.has(snap.boneLockBoneName)) {
        setOrbitBoneLock(true, snap.boneLockBoneName);
    } else if (snap.boneLockBoneName) {
        logWarn('adr-150', `bone lock '${snap.boneLockBoneName}' not found on new model, lock cleared`);
    }
}
```

补充 import（`model-ops.ts` 顶部）：

```typescript
import { setBoneOverride } from '../motion/bone-override';
import { getOrbitBoneLock, setOrbitBoneLock, getFocusedModelBoneNames } from '../camera/camera';
```

注意：`model-ops.ts:14` 已有 `import { getCameraMode, switchCameraMode } from '../camera/camera';`，合并为同一行：
```typescript
import { getCameraMode, switchCameraMode, getOrbitBoneLock, setOrbitBoneLock, getFocusedModelBoneNames } from '../camera/camera';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm run test -- src/__tests__/scene/replace-model-inherit.test.ts`
Expected: PASS — 9 个测试全绿（Task1 的 4 个 + Task2 的 5 个）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/scene/manager/model-ops.ts frontend/src/__tests__/scene/replace-model-inherit.test.ts
git commit -m "feat(adr-150): add applyInheritedState to apply snapshot to new model"
```

---

## Task 3: 改造 startReplaceModel — 接入状态继承 + 撤销保护

**Files:**
- Modify: `frontend/src/menus/library-actions.ts:250-343`（`startReplaceModel` 函数体）
- Test: 手动验证（UI 集成路径，依赖完整 Babylon 运行时，不写单测）

- [ ] **Step 1: 改造 startReplaceModel**

在 `frontend/src/menus/library-actions.ts` 顶部 import 块补充（若尚无）：

```typescript
import { captureInheritedState, applyInheritedState } from '../scene/manager/model-ops';
```

将 `startReplaceModel`（第 250-343 行）的 `doReplace` 内部 `.then(async (handle) => {...})` 块改造。

**改造前**（`library-actions.ts:278-312`）：
```typescript
.then(async (handle) => {
    if (!handle?.id) {
        stackRegistry.modelStack?.reRender();
        setStatus(t('library.modelLoadFailed'), false);
        return;
    }
    removeModel(replaceId);
    try {
        stackRegistry.modelStack?.resetToRoot();
        // ... UI 导航 ...
    } catch (uiErr) {
        logWarn('library-actions', 'replace UI navigation failed', uiErr);
        setStatus(t('status.done'), true);
    }
})
```

**改造后**：
```typescript
.then(async (handle) => {
    if (!handle?.id) {
        stackRegistry.modelStack?.reRender();
        setStatus(t('library.modelLoadFailed'), false);
        return;
    }
    // [doc:adr-150] 应用继承状态到新模型（在 removeModel 旧模型之前，
    // 确保旧模型 inst 仍可查询；此时新模型已注册，焦点已由 model-loader 切换）
    applyInheritedState(handle.id, snapshot);
    // [doc:adr-127] 破坏性操作场景级撤销保护
    removeModel(replaceId);
    offerSceneUndoAndRefresh(t('model-detail.replaced'), undoSnap, () =>
        stackRegistry.modelStack?.reRender()
    );
    try {
        stackRegistry.modelStack?.resetToRoot();
        let newName = handle.name;
        if (loadKind === 'prop') {
            const { propRegistry } = await import('../core/config');
            newName = propRegistry.get(handle.id)?.name ?? handle.name;
        } else {
            newName = modelRegistry.get(handle.id)?.name ?? handle.name;
        }
        await prepareModelRestore(getBrowseDir(browseCategory), browseCategory);
        stackRegistry.modelStack?.push(
            buildLevel(
                getBrowseDir(browseCategory),
                t('model-detail.replaceModelTo', { name: newName }),
                filter,
                stackRegistry.modelStack!,
                [],
                { mode: 'jumpToDir', modelId: handle.id }
            )
        );
        setStatus(t('status.done'), true);
    } catch (uiErr) {
        logWarn('library-actions', 'replace UI navigation failed', uiErr);
        setStatus(t('status.done'), true);
    }
})
```

同时在 `doReplace` 函数体最开头（第 262 行 `setStatus(t('library.loadingModel'), false);` 之前）捕获快照与撤销点：

```typescript
const doReplace = (path: string, libraryPath?: string, innerPath?: string): void => {
    // [doc:adr-150] 替换前捕获旧模型可继承状态 + 场景撤销快照
    const oldInst = modelRegistry.get(replaceId);
    const snapshot = oldInst ? captureInheritedState(oldInst) : null;
    const undoSnap = pushUndoSnapshot();
    setStatus(t('library.loadingModel'), false);
    // ... 后续不变 ...
```

并将 `.then` 内的 `applyInheritedState(handle.id, snapshot)` 加守卫：

```typescript
if (snapshot) {
    applyInheritedState(handle.id, snapshot);
}
```

`offerSceneUndoAndRefresh` 调用加守卫：

```typescript
offerSceneUndoAndRefresh(
    t('model-detail.replaced'),
    undoSnap,
    () => stackRegistry.modelStack?.reRender()
);
```

- [ ] **Step 2: 确认 i18n key 存在**

Run: `cd frontend && grep -r "model-detail.replaced" src/core/i18n/`
Expected: 命中至少一个语种文件。若无命中，在 5 个语种文件（zh-CN/zh-TW/en/ja/ko）的 `model-detail` 命名空间下补：

```json
"replaced": "模型已替换"
```
（zh-TW: "模型已替換", en: "Model replaced", ja: "モデルを置換しました", ko: "모델을 교체했습니다"）

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `cd frontend && npm run check`
Expected: 0 tsc 错误

Run: `cd frontend && npm run test`
Expected: 全绿（新增测试 + 既有测试，允许预存的 6 个 Babylon mock 失败）

Run: `cd frontend && npm run test -- src/__tests__/bindings/app.contract.test.ts`
Expected: 17 项契约测试通过（无绑定变更）

- [ ] **Step 4: 提交**

```bash
git add frontend/src/menus/library-actions.ts frontend/src/core/i18n/
git commit -m "feat(adr-150): replace model inherits state with undo protection"
```

---

## Task 4: 更新 ADR-150 文档 — 状态修正 + 方案裁剪记录

**Files:**
- Modify: `docs/adr/adr-150-model-replace-contract.md`

- [ ] **Step 1: 修正 ADR-150 文档首部状态与方案裁剪说明**

将第 3 行 `- **状态**: ✅ 已完成` 改为：

```markdown
- **状态**: 🔄 实施中（2026-07-22 重构方案，决策二落地中）
```

在第 6 行「相关」后追加方案裁剪说明段落：

```markdown
## 方案裁剪说明（2026-07-22 重估）

> 本 ADR 原含三大决策，经后 ADR-167（场景级动作库）落地后的代码现状重估，裁剪如下：

| 决策 | 状态 | 理由 |
|------|------|------|
| 决策一：LoadManager 三层 `load`/`restore`/`loadPMXFile` + priority bypass | **永久搁置** | 反序列化并行加载实际无故障；restore 插队逻辑增加调度器复杂度但用户感知收益为零 |
| 决策二：Replace 原子操作 + 状态继承 | **实施中** | 真实用户痛点。VMD 继承路径从 `loadVMDInternal` 改为 `sceneMotionId` 引用场景动作库 |
| 决策三：`loadVMDInternal` | **移除** | 后 ADR-167 时代 VMD 通过 `sceneMotionId` 引用，`model-loader.ts` 已有自动应用逻辑，无需半公开加载路径 |

**与 ADR-131 的边界澄清：** ADR-131 管"替换后 UI 去哪"（BrowseOutcome 派发，已完成）；ADR-150 管"替换时状态怎么传"（状态继承，本决策二）。
```

- [ ] **Step 2: 更新继承裁定表**

将原文「决策二」下的「状态继承裁定表」（第 83-95 行）替换为「实施计划」中的最终版裁定表（含 Bone Lines/Bone Joints/Feet/sceneMotionId/Bone Lock 新增项，移除 VMD 直继承行）。

- [ ] **Step 3: 修正 status.md 描述（若 status.md 有 ADR-150 条目）**

Run: `cd frontend && npm run gen:status`（自动从 ADR 首部状态生成索引表）

确认 `docs/status.md` 中 ADR-150 条目状态从"已完成"变为"实施中"。

- [ ] **Step 4: 提交**

```bash
git add docs/adr/adr-150-model-replace-contract.md docs/status.md
git commit -m "docs(adr-150): revise status to in-progress, record scheme trimming"
```

---

## 验收清单

- [ ] `npm run check` 0 错误
- [ ] `npm run test` 全绿（新增 9 个测试 + 既有测试）
- [ ] `app.contract.test.ts` 17 项通过
- [ ] `go build ./...` 通过（无 Go 改动，但确认无副作用）
- [ ] 手动验证：加载模型 A → 调整 transform/opacity/wireframe/physics/bone lock → 库中点替换为模型 B → B 继承全部上述状态，bone lock 若 B 无同名骨则自动解锁
- [ ] 手动验证：替换后点击撤销 toast → 场景回滚到替换前
- [ ] ADR-150 文档状态改为"实施中"，含方案裁剪说明

## 风险

| 风险 | 缓解 |
|------|------|
| `applyInheritedState` 在 model-loader 自动应用 VMD 之前/之后执行时序冲突 | model-loader 的 VMD 应用在加载流程内同步完成（`model-loader.ts:564-636`），`applyInheritedState` 在 `.then(handle)` 中调用，此时 VMD 已应用完毕。`sceneMotionId` 赋值后若与默认动作一致则无操作；若不同则需手动触发广播——**P2 验证点**，若发现 VMD 未切换再补 `broadcastMotion()` 调用 |
| Bone Lock 的 `focusedModelId` 在 apply 时已是新模型 | 这是预期行为：model-loader 加载完成后 `setFocusedModelId(id)` 已执行（`model-loader.ts:656`），`setOrbitBoneLock` 基于 focusedModelId 正好针对新模型 |
| morph 权重未在快照中捕获 | ModelInstance 不存 morph 权重（morph 在 mmdModel.morph 上）。本计划**不继承 morph 权重**（裁定表移除该行），因新模型 morph 通道名通常不同，强行继承易错。若需继承，P2 补 `modelManager.getMorphs` 遍历 |
