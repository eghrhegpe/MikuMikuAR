// [doc:adr-071] 感知层单元测试 — 状态管理 + 生命周期
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
        const mockMorphManager = makeMockMorphManager(['笑み', '困りォ', '驚き', '怒り']);
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
});
