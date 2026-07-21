// [doc:adr-071] 感知层单元测试 — 状态管理 + 生命周期
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Quaternion } from '@babylonjs/core';
// 迁移函数为纯函数，静态导入即可；scene-serialize 的重依赖下方统一 mock
import {
    migratePerceptionFromProcMotion,
    migrateLipSyncFromOldState,
} from '../scene/scene-migrate';
import { _gazeAlpha } from '../scene/motion/perception-shared';

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
    // Lip-sync 依赖 mock（audio 管道 + 口型算法）
    isAudioPlaying: vi.fn(() => false),
    getAudioPath: vi.fn(() => ''),
    getProcBeatDetector: vi.fn(() => null),
    findLipMorph: vi.fn(() => null),
    findAllLipMorphs: vi.fn(() => ({ open: null, close: null, pucker: null, smile: null })),
    amplitudeToWeight: vi.fn(() => 0),
}));

// ADR-147 管线 mock：perception 通过 getMotionPipeline().register() 注册帧回调
const mockPipeline = vi.hoisted(() => ({
    register: vi.fn(),
    unregister: vi.fn(),
    lastRunCallback: null as null | ((ctx?: any) => void),
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
vi.mock('../outfit/audio', () => ({
    isAudioPlaying: mockState.isAudioPlaying,
    getAudioPath: mockState.getAudioPath,
}));
vi.mock('../outfit/outfit', () => ({}));
vi.mock('../scene/env/props', () => ({}));
vi.mock('../scene/env/env-bridge', () => ({}));
// perception.ts 通过 getScene() 延迟获取 scene 实例（避免与 scene.ts 形成静态循环依赖），
// 测试侧用 mockState.scene 复用同一份 mock，与 vi.mock('../scene/scene') 行为一致
vi.mock('../scene/env/env-impl', () => ({
    getScene: () => mockState.scene,
}));
vi.mock('../scene/motion/motion-pipeline', () => ({
    getMotionPipeline: () => mockPipeline,
}));
vi.mock('../scene/motion/proc-motion-bridge', () => ({
    getProcBeatDetector: mockState.getProcBeatDetector,
}));
vi.mock('../scene/motion/lipsync-bridge', () => ({}));
vi.mock('../motion-algos/procedural-motion', () => ({}));
vi.mock('../motion-algos/lipsync', () => ({
    findLipMorph: mockState.findLipMorph,
    findAllLipMorphs: mockState.findAllLipMorphs,
    amplitudeToWeight: mockState.amplitudeToWeight,
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
    mockState.scene.isDisposed = false;
    // ADR-147 管线 mock 重置：register 返回 unregister 函数，记录 run 回调供 triggerLastObserver 触发
    mockPipeline.register.mockReset();
    mockPipeline.unregister.mockReset();
    mockPipeline.lastRunCallback = null;
    mockPipeline.register.mockImplementation((layer: any) => {
        mockPipeline.lastRunCallback = layer.run;
        return () => mockPipeline.unregister(layer.id);
    });
    // Lip-sync mock 默认值：无音频、无 morph（各测试按需覆盖）
    mockState.isAudioPlaying.mockReset();
    mockState.isAudioPlaying.mockReturnValue(false);
    mockState.getAudioPath.mockReset();
    mockState.getAudioPath.mockReturnValue('');
    mockState.getProcBeatDetector.mockReset();
    mockState.getProcBeatDetector.mockReturnValue(null);
    mockState.findLipMorph.mockReset();
    mockState.findLipMorph.mockReturnValue(null);
    mockState.findAllLipMorphs.mockReset();
    mockState.findAllLipMorphs.mockReturnValue({
        open: null,
        close: null,
        pucker: null,
        smile: null,
    });
    mockState.amplitudeToWeight.mockReset();
    mockState.amplitudeToWeight.mockReturnValue(0);
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
        expect(s.balanceSwayEnabled).toBe(true); // [doc:adr-079] Phase 2
    });

    it('getPerceptionState 返回副本（修改不影响内部状态）', () => {
        const s1 = sut.getPerceptionState();
        s1.breathEnabled = false;
        const s2 = sut.getPerceptionState();
        expect(s2.breathEnabled).toBe(true);
    });

    it('默认眨眼频率为 0.25Hz（生理合理，每 4 秒一次）', () => {
        const s = sut.getPerceptionState();
        expect(s.blinkFrequency).toBe(0.25);
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
        mockState.modelManager.get.mockReturnValue({ mmdModel: { mesh: { isDisposed: () => false } } });
        sut.activatePerception();
        expect(mockPipeline.register).toHaveBeenCalledOnce();
    });

    it('重复激活同一模型不重复注册', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({ mmdModel: { mesh: { isDisposed: () => false } } });
        sut.activatePerception();
        sut.activatePerception();
        expect(mockPipeline.register).toHaveBeenCalledOnce();
    });

    it('切换模型时先注销旧 observer 再注册新 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({ mmdModel: { mesh: { isDisposed: () => false } } });
        sut.activatePerception();
        sut.activatePerception('m2');
        expect(mockPipeline.unregister).toHaveBeenCalled();
        expect(mockPipeline.register).toHaveBeenCalledTimes(2);
    });
});

describe('deactivatePerception', () => {
    it('注销 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({ mmdModel: { mesh: { isDisposed: () => false } } });
        sut.activatePerception();
        sut.deactivatePerception();
        expect(mockPipeline.unregister).toHaveBeenCalledOnce();
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
        mockState.modelManager.get.mockReturnValue({ mmdModel: { mesh: { isDisposed: () => false } } });
        sut.activatePerception();
        sut.onPerceptionModelRemoved('m1');
        expect(mockPipeline.unregister).toHaveBeenCalledOnce();
    });

    it('移除其他模型时不影响当前 observer', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({ mmdModel: { mesh: { isDisposed: () => false } } });
        sut.activatePerception();
        sut.onPerceptionModelRemoved('other');
        expect(mockPipeline.unregister).not.toHaveBeenCalled();
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

// Mock morphTargetManager（与 Babylon.js MorphTargetManager API 一致）
function makeMockMorphManager(names: string[]) {
    const influences = new Map<string, number>();
    for (const n of names) {
        influences.set(n, 0);
    }
    return {
        numTargets: names.length,
        getTarget: (i: number) => ({
            name: names[i],
            set influence(v: number) {
                influences.set(names[i], v);
            },
        }),
        getTargetByName: (name: string) =>
            influences.has(name)
                ? {
                      set influence(v: number) {
                          influences.set(name, v);
                      },
                  }
                : null,
        getInfluence: (name: string) => influences.get(name) ?? 0,
    };
}

function makeMockModelWithMorphManager(morphManager: ReturnType<typeof makeMockMorphManager>) {
    return {
        mesh: { morphTargetManager: morphManager, isDisposed: () => false },
        runtimeBones: [],
    };
}

// 触发 perception 管线层回调（ADR-147 管线架构）
function triggerLastObserver(): void {
    mockPipeline.lastRunCallback?.();
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
// scene-serialize lipSync migration — 旧存档独立 lipSync state 迁移
// =====================================================================

describe('scene-serialize lipSync migration', () => {
    it('旧存档 lipSync.enabled=true 时映射为 lipSyncEnabled=true', () => {
        const old = {
            lipSync: { enabled: true, sensitivity: 0.3, intensity: 0.9, multiMorphEnabled: true },
        };
        const migrated = migrateLipSyncFromOldState(old);
        expect(migrated.lipSyncEnabled).toBe(true);
        expect(migrated.lipSyncSensitivity).toBe(0.3);
        expect(migrated.lipSyncIntensity).toBe(0.9);
        expect(migrated.lipSyncMultiMorphEnabled).toBe(true);
    });

    it('旧存档无 lipSync 字段时使用默认值', () => {
        const migrated = migrateLipSyncFromOldState({});
        expect(migrated.lipSyncEnabled).toBe(false);
        expect(migrated.lipSyncSensitivity).toBe(0.2);
        expect(migrated.lipSyncIntensity).toBe(0.8);
        expect(migrated.lipSyncMultiMorphEnabled).toBe(false);
    });
});

// =====================================================================
// Lip-sync 状态
// =====================================================================

describe('lipSync state', () => {
    it('默认 lipSyncEnabled 为 false（需用户主动开启）', () => {
        const state = sut.getPerceptionState();
        expect(state.lipSyncEnabled).toBe(false);
    });

    it('默认 sensitivity=0.2, intensity=0.8, multiMorphEnabled=false', () => {
        const state = sut.getPerceptionState();
        expect(state.lipSyncSensitivity).toBe(0.2);
        expect(state.lipSyncIntensity).toBe(0.8);
        expect(state.lipSyncMultiMorphEnabled).toBe(false);
    });

    it('setLipSyncEnabled 可开启 lip-sync', () => {
        sut.setLipSyncEnabled(true);
        expect(sut.getPerceptionState().lipSyncEnabled).toBe(true);
    });

    it('setLipSyncSensitivity 钳制 0..1', () => {
        sut.setLipSyncSensitivity(1.5);
        expect(sut.getPerceptionState().lipSyncSensitivity).toBe(1);
        sut.setLipSyncSensitivity(-0.5);
        expect(sut.getPerceptionState().lipSyncSensitivity).toBe(0);
    });

    it('setLipSyncIntensity 钳制 0..1', () => {
        sut.setLipSyncIntensity(2.0);
        expect(sut.getPerceptionState().lipSyncIntensity).toBe(1);
    });
});

// =====================================================================
// _applyLipSync 实时叠加（通过 observer 回调触发）
// =====================================================================

describe('_applyLipSync', () => {
    beforeEach(() => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('lipSyncEnabled=false 时不写入任何 morph', () => {
        const mockMorphManager = makeMockMorphManager(['あ']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        sut.setLipSyncEnabled(false);
        sut.activatePerception('m1');
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('あ')).toBe(0);
    });

    it('开启且音频播放时写入 あ morph', () => {
        const mockMorphManager = makeMockMorphManager(['あ']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        mockState.isAudioPlaying.mockReturnValue(true);
        mockState.getAudioPath.mockReturnValue('/test/audio.mp3');
        mockState.getProcBeatDetector.mockReturnValue({ getLevel: () => 0.5 });
        mockState.findLipMorph.mockReturnValue('あ');
        mockState.findAllLipMorphs.mockReturnValue({
            open: 'あ',
            close: null,
            pucker: null,
            smile: null,
        });
        mockState.amplitudeToWeight.mockReturnValue(0.5);
        sut.setLipSyncEnabled(true);
        sut.activatePerception('m1');
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('あ')).toBeGreaterThan(0);
    });

    it('morph 不存在时静默跳过', () => {
        const mockMorphManager = makeMockMorphManager([]);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        mockState.isAudioPlaying.mockReturnValue(true);
        mockState.getAudioPath.mockReturnValue('/test/audio.mp3');
        mockState.findLipMorph.mockReturnValue(null);
        sut.setLipSyncEnabled(true);
        sut.activatePerception('m1');
        expect(() => triggerLastObserver()).not.toThrow();
    });

    it('关闭后 morph influence 归零（防残留）', () => {
        const mockMorphManager = makeMockMorphManager(['あ']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        mockState.isAudioPlaying.mockReturnValue(true);
        mockState.getAudioPath.mockReturnValue('/test/audio.mp3');
        mockState.getProcBeatDetector.mockReturnValue({ getLevel: () => 0.5 });
        mockState.findLipMorph.mockReturnValue('あ');
        mockState.findAllLipMorphs.mockReturnValue({
            open: 'あ',
            close: null,
            pucker: null,
            smile: null,
        });
        mockState.amplitudeToWeight.mockReturnValue(0.5);
        sut.setLipSyncEnabled(true);
        sut.activatePerception('m1');
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('あ')).toBeGreaterThan(0);
        // 关闭
        sut.setLipSyncEnabled(false);
        triggerLastObserver();
        expect(mockMorphManager.getInfluence('あ')).toBe(0);
    });
});

// ── 视线追踪锥形限位回归（防止"背后翻转 180°"悄悄回潮）──
describe('视线追踪锥形限位（_clampHeadGazeTarget / _clampEyeGazeTarget）', () => {
    const parentWorldQ = Quaternion.Identity(); // 身体/头部正前、正立

    it('头部：背后相机时被钳到 ±≈75°（而非翻转 180°）', () => {
        const behindQ = Quaternion.FromEulerAngles(0, Math.PI, 0);
        const e = sut
            ._clampHeadGazeTarget(Quaternion.Identity(), behindQ, parentWorldQ)
            .toEulerAngles();
        expect(Math.abs(e.y)).toBeGreaterThan((70 * Math.PI) / 180);
        expect(Math.abs(e.y)).toBeLessThan((80 * Math.PI) / 180);
        expect(Math.abs(e.x)).toBeLessThan(1e-3);
    });

    it('头部：正前方相机时保持正前（不钳制）', () => {
        const frontQ = Quaternion.FromEulerAngles(0, 0, 0);
        const e = sut
            ._clampHeadGazeTarget(Quaternion.Identity(), frontQ, parentWorldQ)
            .toEulerAngles();
        expect(Math.abs(e.y)).toBeLessThan(1e-3);
        expect(Math.abs(e.x)).toBeLessThan(1e-3);
    });

    it('头部：俯仰被钳到 ±≈35°，不向上翻 180°', () => {
        const upQ = Quaternion.FromEulerAngles(Math.PI / 2, 0, 0);
        const e = sut
            ._clampHeadGazeTarget(Quaternion.Identity(), upQ, parentWorldQ)
            .toEulerAngles();
        expect(Math.abs(e.x)).toBeGreaterThan((30 * Math.PI) / 180);
        expect(Math.abs(e.x)).toBeLessThan((40 * Math.PI) / 180);
        expect(Math.abs(e.y)).toBeLessThan(1e-3);
    });

    it('眼球：背后相机时被钳到 ±≈9°（而非翻转 180°）', () => {
        const behindQ = Quaternion.FromEulerAngles(0, Math.PI, 0);
        const e = sut
            ._clampEyeGazeTarget(Quaternion.Identity(), behindQ, parentWorldQ)
            .toEulerAngles();
        expect(Math.abs(e.y)).toBeGreaterThan((4 * Math.PI) / 180);
        expect(Math.abs(e.y)).toBeLessThan((14 * Math.PI) / 180);
        expect(Math.abs(e.x)).toBeLessThan(1e-3);
    });

    it('眼球：俯仰被钳到 ±≈8°，不向上翻 180°', () => {
        const upQ = Quaternion.FromEulerAngles(Math.PI / 2, 0, 0);
        const e = sut._clampEyeGazeTarget(Quaternion.Identity(), upQ, parentWorldQ).toEulerAngles();
        expect(Math.abs(e.x)).toBeGreaterThan((3 * Math.PI) / 180);
        expect(Math.abs(e.x)).toBeLessThan((13 * Math.PI) / 180);
        expect(Math.abs(e.y)).toBeLessThan(1e-3);
    });

    it('眼球限位比头部更紧（9° < 75°）：同样背后目标，眼幅更小', () => {
        const behindQ = Quaternion.FromEulerAngles(0, Math.PI, 0);
        const eyeYaw = Math.abs(
            sut._clampEyeGazeTarget(Quaternion.Identity(), behindQ, parentWorldQ).toEulerAngles().y
        );
        const headYaw = Math.abs(
            sut._clampHeadGazeTarget(Quaternion.Identity(), behindQ, parentWorldQ).toEulerAngles().y
        );
        expect(eyeYaw).toBeLessThan(headYaw);
    });
});

// ── ADR-150: Gaze Delta 指数衰减 ──
describe('_gazeAlpha', () => {
    it('60fps 与 120fps 下收敛速度一致', () => {
        const alpha60 = _gazeAlpha(0.5, 1 / 60);
        const alpha120 = _gazeAlpha(0.5, 1 / 120);
        // 120fps 单帧 alpha 约为 60fps 的一半（指数衰减特性）
        expect(alpha120).toBeCloseTo(alpha60 / 2, 2);
    });

    it('边界值 dt=0 时 alpha=0', () => {
        expect(_gazeAlpha(0.5, 0)).toBe(0);
    });

    it('边界值 dt 极大时 alpha 被钳到 1', () => {
        expect(_gazeAlpha(0.5, 10)).toBe(1);
    });
});

describe('gaze reset', () => {
    it('deactivatePerception 时调用 _resetGazeState', () => {
        const spy = vi.spyOn(sut, '_resetGazeState');
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false } },
        });
        sut.activatePerception('m1');
        spy.mockClear();
        sut.deactivatePerception();
        expect(spy).toHaveBeenCalledOnce();
        spy.mockRestore();
    });
});

// =====================================================================
// [doc:adr-079] Phase 2 — 重心微动（balanceSway）接入
// =====================================================================

describe('setBalanceSwayEnabled', () => {
    it('更新 balanceSwayEnabled', () => {
        sut.setBalanceSwayEnabled(false);
        expect(sut.getPerceptionState().balanceSwayEnabled).toBe(false);
    });

    it('调用 triggerAutoSave', () => {
        sut.setBalanceSwayEnabled(false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('migratePerceptionFromProcMotion — balanceSway 迁移', () => {
    it('旧存档无 boneToggles 时 balanceSwayEnabled=true（默认 always-on）', () => {
        const migrated = migratePerceptionFromProcMotion({} as any);
        expect(migrated.balanceSwayEnabled).toBe(true);
    });

    it('旧存档 boneToggles.center=true 时 balanceSwayEnabled=true', () => {
        const migrated = migratePerceptionFromProcMotion({
            boneToggles: { center: true, upper2: false, waist: false, allParent: false },
        } as any);
        expect(migrated.balanceSwayEnabled).toBe(true);
    });

    it('旧存档 boneToggles 全 false 时 balanceSwayEnabled=false（用户明确关闭）', () => {
        const migrated = migratePerceptionFromProcMotion({
            boneToggles: { center: false, upper2: false, waist: false, allParent: false },
        } as any);
        expect(migrated.balanceSwayEnabled).toBe(false);
    });
});

// =====================================================================
// [doc:adr-151] balanceSway 独立参数暴露
// =====================================================================

describe('balanceSway 可调参数', () => {
    it('默认 period=2.0, amplitude=1.0', () => {
        const s = sut.getPerceptionState();
        expect(s.balanceSwayPeriod).toBe(2.0);
        expect(s.balanceSwayAmplitude).toBe(1.0);
    });

    it('setBalanceSwayPeriod 钳制 0.5–5.0', () => {
        sut.setBalanceSwayPeriod(0.1);
        expect(sut.getPerceptionState().balanceSwayPeriod).toBe(0.5);
        sut.setBalanceSwayPeriod(10);
        expect(sut.getPerceptionState().balanceSwayPeriod).toBe(5.0);
        sut.setBalanceSwayPeriod(3.0);
        expect(sut.getPerceptionState().balanceSwayPeriod).toBe(3.0);
    });

    it('setBalanceSwayAmplitude 钳制 0–2.0', () => {
        sut.setBalanceSwayAmplitude(-1);
        expect(sut.getPerceptionState().balanceSwayAmplitude).toBe(0);
        sut.setBalanceSwayAmplitude(5);
        expect(sut.getPerceptionState().balanceSwayAmplitude).toBe(2.0);
        sut.setBalanceSwayAmplitude(1.5);
        expect(sut.getPerceptionState().balanceSwayAmplitude).toBe(1.5);
    });

    it('调用 triggerAutoSave', () => {
        sut.setBalanceSwayPeriod(3.0);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
        sut.setBalanceSwayAmplitude(0.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });
});
