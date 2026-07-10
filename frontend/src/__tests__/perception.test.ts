// [doc:adr-071] 感知层单元测试 — 状态管理 + 生命周期
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// 迁移函数为纯函数，静态导入即可；scene-serialize 的重依赖下方统一 mock
import { migratePerceptionFromProcMotion, migrateBalanceSwayFromProcMotion } from '../scene/scene-serialize';

// =====================================================================
// hoisted mock state
// =====================================================================

const mockState = vi.hoisted(() => ({
    focusedModelId: null as string | null,
    triggerAutoSave: vi.fn(),
    modelManager: {
        get: vi.fn(),
    } as any,
    scene: {
        onBeforeRenderObservable: {
            add: vi.fn(() => ({})),
            remove: vi.fn(),
        },
        activeCamera: null,
        // 记录最后一次 onBeforeRenderObservable.add 注册的回调，供 triggerLastObserver 触发
        lastObserverCallback: null as null | (() => void),
    } as any,
}));

vi.mock('../scene/scene', () => ({
    get focusedModelId() {
        return mockState.focusedModelId;
    },
    modelManager: mockState.modelManager,
    scene: mockState.scene,
    triggerAutoSave: mockState.triggerAutoSave,
}));

vi.mock('../ar/ar-camera', () => ({
    isARActive: () => false,
}));

// scene-serialize 重依赖：全部空 mock（仅在函数体内使用，模块加载期不触发）
vi.mock('../core/wails-bindings', () => ({}));
vi.mock('../core/i18n/t', () => ({ t: (k: string) => k }));
vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({}));
vi.mock('../core/config', () => ({}));
vi.mock('../scene/camera/camera', () => ({}));
vi.mock('../scene/motion/vmd-loader', () => ({}));
vi.mock('../outfit/audio', () => ({}));
vi.mock('../outfit/outfit', () => ({}));
vi.mock('../scene/env/props', () => ({}));
vi.mock('../scene/env/env-bridge', () => ({}));
vi.mock('../scene/motion/proc-motion-bridge', () => ({}));
vi.mock('../scene/motion/lipsync-bridge', () => ({}));
vi.mock('../motion-algos/procedural-motion', () => ({}));
vi.mock('../motion-algos/lipsync', () => ({}));

// =====================================================================
// SUT
// =====================================================================

type Sut = typeof import('../scene/motion/perception');
let sut: Sut;

beforeEach(async () => {
    vi.resetModules();
    sut = await import('../scene/motion/perception');

    mockState.focusedModelId = null;
    mockState.triggerAutoSave.mockReset();
    mockState.modelManager.get.mockReset();
    mockState.scene.onBeforeRenderObservable.add.mockReset();
    // 记录 observer 回调，返回空对象作为 Observer 句柄
    mockState.scene.onBeforeRenderObservable.add.mockImplementation((cb: () => void) => {
        mockState.scene.lastObserverCallback = cb;
        return {};
    });
    mockState.scene.lastObserverCallback = null;
    mockState.scene.onBeforeRenderObservable.remove.mockReset();
});

// =====================================================================
// 默认状态
// =====================================================================

describe('默认 PerceptionState', () => {
    it('所有开关默认开启', () => {
        const s = sut.getPerceptionState();
        expect(s.breathEnabled).toBe(true);
        expect(s.blinkEnabled).toBe(true);
        expect(s.headTrackingEnabled).toBe(true);
        expect(s.eyeTrackingEnabled).toBe(true);
    });

    it('getPerceptionState 返回副本（修改不影响内部状态）', () => {
        const s1 = sut.getPerceptionState();
        s1.breathEnabled = false;
        const s2 = sut.getPerceptionState();
        expect(s2.breathEnabled).toBe(true);
    });
});

// =====================================================================
// setter
// =====================================================================

describe('setBreathEnabled', () => {
    it('更新 breathEnabled', () => {
        sut.setBreathEnabled(false);
        expect(sut.getPerceptionState().breathEnabled).toBe(false);
    });

    it('调用 triggerAutoSave', () => {
        sut.setBreathEnabled(false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('setBlinkEnabled', () => {
    it('更新 blinkEnabled', () => {
        sut.setBlinkEnabled(false);
        expect(sut.getPerceptionState().blinkEnabled).toBe(false);
    });

    it('调用 triggerAutoSave', () => {
        sut.setBlinkEnabled(false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('setHeadTrackingEnabled', () => {
    it('更新 headTrackingEnabled', () => {
        sut.setHeadTrackingEnabled(false);
        expect(sut.getPerceptionState().headTrackingEnabled).toBe(false);
    });

    it('调用 triggerAutoSave', () => {
        sut.setHeadTrackingEnabled(false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('setEyeTrackingEnabled', () => {
    it('更新 eyeTrackingEnabled', () => {
        sut.setEyeTrackingEnabled(false);
        expect(sut.getPerceptionState().eyeTrackingEnabled).toBe(false);
    });

    it('调用 triggerAutoSave', () => {
        sut.setEyeTrackingEnabled(false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

// =====================================================================
// setPerceptionState（批量合并）
// =====================================================================

describe('setPerceptionState', () => {
    it('部分更新（合并而非替换）', () => {
        sut.setPerceptionState({ breathEnabled: false });
        const s = sut.getPerceptionState();
        expect(s.breathEnabled).toBe(false);
        expect(s.blinkEnabled).toBe(true); // 未变更字段保留
    });

    it('全量更新', () => {
        sut.setPerceptionState({
            breathEnabled: false,
            blinkEnabled: false,
            headTrackingEnabled: false,
            eyeTrackingEnabled: false,
        });
        const s = sut.getPerceptionState();
        expect(s.breathEnabled).toBe(false);
        expect(s.blinkEnabled).toBe(false);
        expect(s.headTrackingEnabled).toBe(false);
        expect(s.eyeTrackingEnabled).toBe(false);
    });
});

// =====================================================================
// activatePerception / deactivatePerception 生命周期
// =====================================================================

describe('activatePerception', () => {
    it('无目标模型 ID 时 warn 并返回', () => {
        mockState.focusedModelId = null;
        sut.activatePerception();
        expect(mockState.scene.onBeforeRenderObservable.add).not.toHaveBeenCalled();
    });

    it('模型未加载时 warn 并返回', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue(null);
        sut.activatePerception();
        expect(mockState.scene.onBeforeRenderObservable.add).not.toHaveBeenCalled();
    });

    it('模型已加载时注册 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({ mmdModel: {} });
        sut.activatePerception();
        expect(mockState.scene.onBeforeRenderObservable.add).toHaveBeenCalledOnce();
    });

    it('重复激活同一模型不重复注册', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({ mmdModel: {} });
        sut.activatePerception();
        sut.activatePerception();
        expect(mockState.scene.onBeforeRenderObservable.add).toHaveBeenCalledOnce();
    });

    it('切换模型时先注销旧 observer 再注册新 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({ mmdModel: {} });
        sut.activatePerception();
        sut.activatePerception('m2');
        expect(mockState.scene.onBeforeRenderObservable.remove).toHaveBeenCalled();
        expect(mockState.scene.onBeforeRenderObservable.add).toHaveBeenCalledTimes(2);
    });
});

describe('deactivatePerception', () => {
    it('注销 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({ mmdModel: {} });
        sut.activatePerception();
        sut.deactivatePerception();
        expect(mockState.scene.onBeforeRenderObservable.remove).toHaveBeenCalledOnce();
    });

    it('未激活时调用不抛错', () => {
        expect(() => sut.deactivatePerception()).not.toThrow();
    });
});

// =====================================================================
// onPerceptionModelRemoved
// =====================================================================

describe('onPerceptionModelRemoved', () => {
    it('移除当前感知模型时注销 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({ mmdModel: {} });
        sut.activatePerception();
        sut.onPerceptionModelRemoved('m1');
        expect(mockState.scene.onBeforeRenderObservable.remove).toHaveBeenCalledOnce();
    });

    it('移除其他模型时不影响当前 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({ mmdModel: {} });
        sut.activatePerception();
        sut.onPerceptionModelRemoved('other');
        expect(mockState.scene.onBeforeRenderObservable.remove).not.toHaveBeenCalled();
    });
});

// =====================================================================
// 微表情（Micro Expression）状态
// =====================================================================

describe('microExpression state', () => {
    it('默认 emotion 为 neutral，microExpressionEnabled 为 true', () => {
        const state = sut.getPerceptionState();
        expect(state.emotion).toBe('neutral');
        expect(state.microExpressionEnabled).toBe(true);
    });

    it('setPerceptionState 可更新 emotion', () => {
        sut.setPerceptionState({ emotion: 'happy' });
        expect(sut.getPerceptionState().emotion).toBe('happy');
    });

    it('setPerceptionState 可关闭微表情', () => {
        sut.setPerceptionState({ microExpressionEnabled: false });
        expect(sut.getPerceptionState().microExpressionEnabled).toBe(false);
    });
});

// =====================================================================
// _applyMicroExpression 实时叠加（通过 observer 回调触发）
// =====================================================================

// Mock morphTargetManager（与 _applyBlinking 用的 API 一致）
function makeMockMorphManager(names: string[]) {
    const influences = new Map<string, number>();
    for (const n of names) influences.set(n, 0);
    return {
        getMorphTargetNames: () => names,
        getMorphTargetByName: (name: string) =>
            influences.has(name) ? { set influence(v: number) { influences.set(name, v); } } : null,
        getInfluence: (name: string) => influences.get(name) ?? 0,
    };
}

function makeMockModelWithMorphManager(morphManager: ReturnType<typeof makeMockMorphManager>) {
    return {
        mesh: { morphTargetManager: morphManager },
        runtimeBones: [],
    };
}

// 触发 perception observer 回调
function triggerLastObserver(): void {
    mockState.scene.lastObserverCallback?.();
}

describe('_applyMicroExpression', () => {
    beforeEach(() => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('neutral 情绪不写入任何 morph', () => {
        const mockMorphManager = makeMockMorphManager(['笑み', '困り', '驚き', '怒り']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setPerceptionState({ emotion: 'neutral', microExpressionEnabled: true });
        sut.activatePerception('m1');
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('笑み')).toBe(0);
    });

    it('happy 情绪周期性脉冲笑み morph', () => {
        const mockMorphManager = makeMockMorphManager(['笑み']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: true });
        sut.activatePerception('m1');
        // 脉冲峰值在 1/4 周期（t = MICRO_EXPR_PERIOD/4 = 1s），sin²(π/2)=1
        vi.mocked(performance.now).mockReturnValue(1000);
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('笑み')).toBeGreaterThan(0);
        expect(mockMorphManager.getInfluence('笑み')).toBeLessThanOrEqual(0.15);
    });

    it('microExpressionEnabled=false 时不写入', () => {
        const mockMorphManager = makeMockMorphManager(['笑み']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: false });
        sut.activatePerception('m1');
        vi.mocked(performance.now).mockReturnValue(1000);
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('笑み')).toBe(0);
    });

    it('morph 不存在时静默跳过', () => {
        const mockMorphManager = makeMockMorphManager([]);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: true });
        sut.activatePerception('m1');
        vi.mocked(performance.now).mockReturnValue(1000);
        expect(() => triggerLastObserver()).not.toThrow();
    });

    it('开启写入后关闭 → 旧 morph influence 归零（防冻结）', () => {
        const mockMorphManager = makeMockMorphManager(['笑み']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: true });
        sut.activatePerception('m1');
        // 1. 写入笑み（峰值 t=1s）
        vi.mocked(performance.now).mockReturnValue(1000);
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('笑み')).toBeGreaterThan(0);
        // 2. 关闭开关
        sut.setPerceptionState({ microExpressionEnabled: false });
        triggerLastObserver();
        // 3. 笑み应归零，不残留
        expect(mockMorphManager.getInfluence('笑み')).toBe(0);
    });

    it('切换情绪时旧 morph 归零（防串味）', () => {
        const mockMorphManager = makeMockMorphManager(['笑み', '怒り']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: true });
        sut.activatePerception('m1');
        // 1. 写入笑み
        vi.mocked(performance.now).mockReturnValue(1000);
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('笑み')).toBeGreaterThan(0);
        // 2. 切换为 angry
        sut.setPerceptionState({ emotion: 'angry' });
        triggerLastObserver();
        // 3. 笑み归零，怒り写入
        expect(mockMorphManager.getInfluence('笑み')).toBe(0);
        expect(mockMorphManager.getInfluence('怒り')).toBeGreaterThan(0);
    });

    it('切换到 neutral 时旧 morph 归零', () => {
        const mockMorphManager = makeMockMorphManager(['笑み']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: true });
        sut.activatePerception('m1');
        vi.mocked(performance.now).mockReturnValue(1000);
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('笑み')).toBeGreaterThan(0);
        // 切换为 neutral
        sut.setPerceptionState({ emotion: 'neutral' });
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('笑み')).toBe(0);
    });
});

// =====================================================================
// scene-serialize perception migration — 旧存档迁移
// =====================================================================

describe('scene-serialize perception migration', () => {
    it('旧存档无 perception.emotion 时默认 neutral', () => {
        // 旧 perception 数据缺 emotion/microExpressionEnabled 字段，setPerceptionState 合并后应取默认值
        sut.setPerceptionState({ breathEnabled: true, blinkEnabled: true });
        expect(sut.getPerceptionState().emotion).toBe('neutral');
        expect(sut.getPerceptionState().microExpressionEnabled).toBe(true);
    });

    it('旧存档 procMotion.boneToggles.emotion=true 时映射为 microExpressionEnabled=true, emotion=neutral', () => {
        // emotion toggle 的语义是「启用微表情」（boolean），不映射具体情绪
        const oldProcMotion = { boneToggles: { emotion: true } } as any;
        const migrated = migratePerceptionFromProcMotion(oldProcMotion);
        expect(migrated.microExpressionEnabled).toBe(true);
        expect(migrated.emotion).toBe('neutral');
    });

    it('旧存档 procMotion.boneToggles.emotion=false 时映射为 microExpressionEnabled=false', () => {
        const oldProcMotion = { boneToggles: { emotion: false } } as any;
        const migrated = migratePerceptionFromProcMotion(oldProcMotion);
        expect(migrated.microExpressionEnabled).toBe(false);
        expect(migrated.emotion).toBe('neutral');
    });
});

// =====================================================================
// scene-serialize balanceSway migration — 旧存档躯干 toggle 迁移
// =====================================================================

describe('scene-serialize balanceSway migration', () => {
    it('旧存档 boneToggles.center=true 时映射为 balanceSwayEnabled=true', () => {
        const old = { boneToggles: { center: true, upper2: false, waist: false, allParent: false } };
        const migrated = migrateBalanceSwayFromProcMotion(old as any);
        expect(migrated.balanceSwayEnabled).toBe(true);
    });

    it('旧存档四个躯干 toggle 全 false 时映射为 balanceSwayEnabled=false', () => {
        const old = { boneToggles: { center: false, upper2: false, waist: false, allParent: false } };
        const migrated = migrateBalanceSwayFromProcMotion(old as any);
        expect(migrated.balanceSwayEnabled).toBe(false);
    });

    it('旧存档无 boneToggles 时默认 balanceSwayEnabled=true', () => {
        const migrated = migrateBalanceSwayFromProcMotion({} as any);
        expect(migrated.balanceSwayEnabled).toBe(true);
    });
});

// =====================================================================
// 重心微动（Balance Sway）状态
// =====================================================================

describe('balanceSway state', () => {
    it('默认 balanceSwayEnabled 为 true', () => {
        const state = sut.getPerceptionState();
        expect(state.balanceSwayEnabled).toBe(true);
    });

    it('setBalanceSwayEnabled 可关闭重心微动', () => {
        sut.setBalanceSwayEnabled(false);
        expect(sut.getPerceptionState().balanceSwayEnabled).toBe(false);
    });
});

// =====================================================================
// _applyBalanceSway 实时叠加（通过 observer 回调触发）
// =====================================================================

// Mock runtimeBones（模拟 babylon-mmd IMmdRuntimeBone + linkedBone）
function makeMockRuntimeBones(names: string[]) {
    return names.map(name => ({
        name,
        linkedBone: makeMockLinkedBone(),
        childBones: [],
        updateWorldMatrix: vi.fn(),
    }));
}

// linkedBone：rotationQuaternion 支持 copyFrom 读取 + 重新赋值追踪；
// position 支持 y 读写 + 写入追踪
function makeMockLinkedBone() {
    const pos = makeMockVector3();
    let rotQ: any = { x: 0, y: 0, z: 0, w: 1 };
    let rotWritten = false;
    return {
        get rotationQuaternion() { return rotQ; },
        set rotationQuaternion(v: any) { rotQ = v; rotWritten = true; },
        get _rotWritten() { return rotWritten; },
        position: pos,
    };
}

function makeMockVector3() {
    let _y = 0;
    return {
        x: 0,
        z: 0,
        get y() { return _y; },
        set y(v: number) { _y = v; (this as any)._wasWritten = true; },
        _wasWritten: false,
    };
}

describe('_applyBalanceSway', () => {
    beforeEach(() => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
        // 关闭其他感知功能，隔离重心微动的写入断言（呼吸会写 spine 骨骼干扰）
        sut.setPerceptionState({
            breathEnabled: false,
            blinkEnabled: false,
            headTrackingEnabled: false,
            eyeTrackingEnabled: false,
            microExpressionEnabled: false,
        });
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('balanceSwayEnabled=false 时不写入任何骨骼', () => {
        const mockRuntimeBones = makeMockRuntimeBones(['センター', '上半身2', '腰', '全ての親']);
        const mmdModel = { runtimeBones: mockRuntimeBones, mesh: {} };
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setBalanceSwayEnabled(false);
        sut.activatePerception('m1');
        vi.mocked(performance.now).mockReturnValue(500); // 0.5s
        triggerLastObserver();
        // 无骨骼被写入（rotation/position 不变）
        for (const b of mockRuntimeBones) {
            expect(b.linkedBone._rotWritten).toBe(false);
            expect(b.linkedBone.position._wasWritten).toBe(false);
        }
    });

    it('开启时写入 center 骨骼的 position 和 rotation', () => {
        const mockRuntimeBones = makeMockRuntimeBones(['センター']);
        const mmdModel = { runtimeBones: mockRuntimeBones, mesh: {} };
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setBalanceSwayEnabled(true);
        sut.activatePerception('m1');
        vi.mocked(performance.now).mockReturnValue(500); // 0.5s → phase = π/2
        triggerLastObserver();
        const center = mockRuntimeBones.find(b => b.name === 'センター')!;
        expect(center.linkedBone.position._wasWritten).toBe(true);
        expect(center.linkedBone._rotWritten).toBe(true);
    });

    it('骨骼不存在时静默跳过', () => {
        const mockRuntimeBones = makeMockRuntimeBones([]); // 无骨骼
        const mmdModel = { runtimeBones: mockRuntimeBones, mesh: {} };
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setBalanceSwayEnabled(true);
        sut.activatePerception('m1');
        vi.mocked(performance.now).mockReturnValue(500);
        expect(() => triggerLastObserver()).not.toThrow();
    });

    it('关闭后 center position.y 归零（防残留）', () => {
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
        // 2. 关闭开关
        sut.setBalanceSwayEnabled(false);
        triggerLastObserver();
        // 3. position.y 应归零（Lerp 到 0）
        expect(center.linkedBone.position.y).toBe(0);
    });
});
