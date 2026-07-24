// [doc:adr-150] 模型替换状态继承单元测试
// 策略：captureInheritedState/applyInheritedState 是纯函数，仅依赖 modelManager setter、
// setBoneOverride、camera 的 getOrbitBoneLock/setOrbitBoneLock/getFocusedModelBoneNames。
// model-ops.ts 的其余重依赖（scene/env/motion/transform）统一空 mock。
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ======== 重依赖空 mock（模块加载期不触发 new Scene 等） ========
const mmState = vi.hoisted(() => ({
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
        getMorphs: vi.fn(() => [{ name: '笑い', type: 0 }]),
    },
}));

const cameraState = vi.hoisted(() => ({
    getOrbitBoneLock: vi.fn(() => ({ enabled: false, boneName: null })),
    setOrbitBoneLock: vi.fn(),
    getFocusedModelBoneNames: vi.fn(() => ['上半身', '首', '左腕']),
}));

const boneOverrideState = vi.hoisted(() => ({
    setBoneOverride: vi.fn(),
}));

vi.mock('../../core/config', () => ({
    modelRegistry: new Map(),
    focusedModelId: null,
    isPlaying: false,
    setIsPlaying: vi.fn(),
    setAutoLoop: vi.fn(),
    setSeekDragging: vi.fn(),
    dom: { canvas: {} },
    mmdRuntime: null,
}));
vi.mock('@/core/state', () => ({
    createDefaultFeetState: vi.fn(() => ({
        enabled: false,
        intensity: 0,
        soleHeight: 0,
        jumpThreshold: 0.5,
        bodySmooth: 0.5,
        footSmooth: 0.5,
        maxAngle: 30,
        reachAngle: 15,
    })),
}));
vi.mock('../../core/i18n/t', () => ({ t: (k: string) => k }));
vi.mock('../../scene/scene', () => ({ modelManager: mmState.modelManager }));
vi.mock('../../scene/env/env', () => ({ refreshWaterRenderList: vi.fn() }));
vi.mock('../../scene/camera/camera', () => cameraState);
vi.mock('../../scene/motion/playback', () => ({ updatePlaybackUI: vi.fn() }));
vi.mock('../../outfit/audio', () => ({ disposeAudio: vi.fn() }));
vi.mock('../../scene/motion/motion-modules/registry', () => ({ setTargetModel: vi.fn() }));
vi.mock('../../scene/manager/model-manager', () => ({
    getFormationLabels: vi.fn(() => ({}) as any),
}));
vi.mock('../../scene/transform/transform-adapter', () => ({ registerTransformAdapter: vi.fn() }));
vi.mock('../../scene/motion/bone-override', () => ({
    setBoneOverride: boneOverrideState.setBoneOverride,
}));

import { captureInheritedState, applyInheritedState } from '../../scene/manager/model-ops';
import type { ReplaceSnapshot } from '../../scene/manager/model-ops';
import type { ModelInstance } from '@/core/types';
import { modelRegistry } from '../../core/config';
import { setBoneOverride } from '../../scene/motion/bone-override';
import { setOrbitBoneLock } from '../../scene/camera/camera';
import { modelManager } from '../../scene/scene';

// 最小可用的 ModelInstance mock
function makeMockInst(overrides: Partial<ModelInstance> = {}): ModelInstance {
    return {
        id: 'old-1',
        name: 'Old',
        filePath: '/old.pmx',
        modelDir: '/',
        meshes: [
            {
                position: { x: 1, y: 2, z: 3 },
            } as any,
        ],
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
        boneOverrides: [{ boneName: '上半身', euler: [5, 0, 0], weight: 1, enabled: true }],
        feet: {
            enabled: true,
            intensity: 0.6,
            soleHeight: 0.05,
            jumpThreshold: 0.5,
            bodySmooth: 0.5,
            footSmooth: 0.5,
            maxAngle: 30,
            reachAngle: 15,
        },
        positionMode: 'orbit',
        orbitAzimuth: 45,
        orbitElevation: -10,
        orbitDistance: 8,
        motionSlots: {
            primary: { source: 'inherit', status: 'compatible', sceneMotionId: 'motion-xyz' },
        },
        ...overrides,
    } as unknown as ModelInstance;
}

function makeBaseSnap(overrides: Partial<ReplaceSnapshot> = {}): ReplaceSnapshot {
    return {
        visible: true,
        opacity: 1,
        wireframe: false,
        showBoneLines: false,
        showBoneJoints: false,
        physicsEnabled: true,
        scaling: 1,
        rotation: [0, 0, 0],
        positionMode: 'cartesian',
        position: [0, 0, 0],
        boneOverrides: [],
        feet: {
            enabled: false,
            intensity: 0,
            soleHeight: 0,
            jumpThreshold: 0.5,
            bodySmooth: 0.5,
            footSmooth: 0.5,
            maxAngle: 30,
            reachAngle: 15,
        },
        ...overrides,
    };
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
        expect(snap.position).toEqual([1, 2, 3]);
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

describe('applyInheritedState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (modelRegistry as Map<string, unknown>).set('new-1', {
            id: 'new-1',
            feet: {},
            motionSlots: undefined,
        });
    });

    it('调用 modelManager setter 应用基础状态', () => {
        const snap = makeBaseSnap({
            visible: false,
            opacity: 0.5,
            wireframe: true,
            showBoneLines: true,
            physicsEnabled: false,
            scaling: 2.0,
            position: [1, 2, 3],
        });
        applyInheritedState('new-1', snap);
        expect(modelManager.setVisibility).toHaveBeenCalledWith('new-1', false);
        expect(modelManager.setOpacity).toHaveBeenCalledWith('new-1', 0.5);
        expect(modelManager.setWireframe).toHaveBeenCalledWith('new-1', true);
        expect(modelManager.setScaling).toHaveBeenCalledWith('new-1', 2.0);
        expect(modelManager.setPosition).toHaveBeenCalledWith('new-1', 1, 2, 3);
        expect(modelManager.setPhysics).toHaveBeenCalledWith('new-1', false);
    });

    it('positionMode=orbit 时调用 setOrbit 而非 setPosition', () => {
        const snap = makeBaseSnap({
            positionMode: 'orbit',
            orbitAzimuth: 30,
            orbitElevation: -5,
            orbitDistance: 10,
        });
        applyInheritedState('new-1', snap);
        expect(modelManager.setOrbit).toHaveBeenCalledWith('new-1', 30, -5, 10);
        expect(modelManager.setPosition).not.toHaveBeenCalled();
    });

    it('boneOverrides 仅对新模型存在的骨骼调用 setBoneOverride', () => {
        const snap = makeBaseSnap({
            boneOverrides: [
                { boneName: '上半身', euler: [5, 0, 0], weight: 1, enabled: true },
                { boneName: '不存在的骨', euler: [0, 0, 0], weight: 1, enabled: true },
            ],
        });
        applyInheritedState('new-1', snap);
        expect(setBoneOverride).toHaveBeenCalledTimes(1);
        expect(setBoneOverride).toHaveBeenCalledWith(
            '上半身',
            [5, 0, 0],
            1,
            true,
            'new-1',
            undefined
        );
    });

    it('boneLockBoneName 在新模型存在时调用 setOrbitBoneLock(true)', () => {
        const snap = makeBaseSnap({ boneLockBoneName: '首' });
        applyInheritedState('new-1', snap);
        expect(setOrbitBoneLock).toHaveBeenCalledWith(true, '首');
    });

    it('boneLockBoneName 在新模型不存在时不调用 setOrbitBoneLock(true)', () => {
        const snap = makeBaseSnap({ boneLockBoneName: '消失的骨' });
        applyInheritedState('new-1', snap);
        expect(setOrbitBoneLock).not.toHaveBeenCalledWith(true, expect.anything());
    });

    it('sceneMotionId 赋值到新模型 motionSlots', () => {
        const snap = makeBaseSnap({ sceneMotionId: 'motion-abc' });
        const newInst = modelRegistry.get('new-1') as any;
        applyInheritedState('new-1', snap);
        expect(newInst.motionSlots).toEqual({
            primary: { source: 'inherit', status: 'compatible', sceneMotionId: 'motion-abc' },
        });
    });

    it('feet 状态深拷贝到新模型', () => {
        const snap = makeBaseSnap({
            feet: {
                enabled: true,
                intensity: 0.7,
                soleHeight: 0.1,
                jumpThreshold: 0.6,
                bodySmooth: 0.4,
                footSmooth: 0.5,
                maxAngle: 25,
                reachAngle: 12,
            },
        });
        const newInst = modelRegistry.get('new-1') as any;
        applyInheritedState('new-1', snap);
        expect(newInst.feet.enabled).toBe(true);
        expect(newInst.feet.intensity).toBe(0.7);
        // 深拷贝验证
        newInst.feet.enabled = false;
        expect(snap.feet.enabled).toBe(true);
    });
});
