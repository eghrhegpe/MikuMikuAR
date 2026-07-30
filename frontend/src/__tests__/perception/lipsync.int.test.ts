// perception/lipsync.int.test.ts — 旧档迁移（perception/lipSync）+ lipSync 状态 + _applyLipSync（ADR-204 P3，拆自旧 perception.test.ts）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockState = vi.hoisted(() => ({
    focusedModelId: null as string | null,
    triggerAutoSave: vi.fn(),
    modelManager: {
        get: vi.fn(),
        modelRegistry: new Map<string, any>(),
    },
    scene: {
        onBeforeRenderObservable: {
            add: vi.fn(() => ({})),
            remove: vi.fn(),
        },
        activeCamera: null,
        isDisposed: false,
    },
    isAudioPlaying: vi.fn(() => false),
    getAudioPath: vi.fn(() => ''),
    getProcBeatDetector: vi.fn(() => null),
    findLipMorph: vi.fn(() => null),
    findAllLipMorphs: vi.fn(() => ({ open: null, close: null, pucker: null, smile: null })),
    amplitudeToWeight: vi.fn(() => 0),
}));
const mockPipeline = vi.hoisted(() => ({
    register: vi.fn(),
    unregister: vi.fn(),
    lastRunCallback: null as null | ((ctx?: any) => void),
}));

vi.mock('../../scene/scene', () => sceneModuleFactory(mockState));
vi.mock('../../ar/ar-camera', () => arCameraModuleMock);
vi.mock('../../core/wails-bindings', () => wailsBindingsModuleMock);
vi.mock('../../core/i18n/t', () => i18nTModuleMock);
vi.mock('@babylonjs/core/Materials/standardMaterial', () => standardMaterialModuleMock);
vi.mock('../../core/config', () => configModuleFactory(mockState));
vi.mock('../../scene/camera/camera', () => cameraModuleMock);
vi.mock('../../scene/motion/vmd-loader', () => vmdLoaderModuleMock);
vi.mock('../../outfit/audio', () => outfitAudioModuleFactory(mockState));
vi.mock('../../outfit/outfit', () => outfitModuleMock);
vi.mock('../../scene/env/props', () => envPropsModuleMock);
vi.mock('../../scene/env/_bridge/env-bridge', () => envBridgeModuleMock);
vi.mock('../../scene/env/env-impl', () => envImplModuleFactory(mockState));
vi.mock('../../scene/motion/motion-pipeline', () => motionPipelineModuleFactory(mockPipeline));
vi.mock('../../scene/motion/proc-motion-bridge', () => procMotionBridgeModuleFactory(mockState));
vi.mock('../../scene/motion/lipsync-bridge', () => lipsyncBridgeModuleMock);
vi.mock('../../motion-algos/procedural-motion', () => proceduralMotionModuleMock);
vi.mock('../../motion-algos/lipsync', () => lipsyncAlgosModuleFactory(mockState));

import {
    setupPerceptionTest,
    sceneModuleFactory,
    arCameraModuleMock,
    wailsBindingsModuleMock,
    i18nTModuleMock,
    standardMaterialModuleMock,
    configModuleFactory,
    cameraModuleMock,
    vmdLoaderModuleMock,
    outfitAudioModuleFactory,
    outfitModuleMock,
    envPropsModuleMock,
    envBridgeModuleMock,
    envImplModuleFactory,
    motionPipelineModuleFactory,
    procMotionBridgeModuleFactory,
    lipsyncBridgeModuleMock,
    proceduralMotionModuleMock,
    lipsyncAlgosModuleFactory,
    makeMockMorphManager,
    makeMockModelWithMorphManager,
    triggerLastObserver,
    type PerceptionSut,
} from './perception-mocks';
// 迁移函数为纯函数，静态导入即可
import {
    migratePerceptionFromProcMotion,
    migrateLipSyncFromOldState,
} from '../../scene/scene-migrate';

let sut: PerceptionSut;

beforeEach(async () => {
    sut = await setupPerceptionTest(mockState, mockPipeline);
});

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
        triggerLastObserver(mockPipeline);
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
        triggerLastObserver(mockPipeline);
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
        expect(() => triggerLastObserver(mockPipeline)).not.toThrow();
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
        triggerLastObserver(mockPipeline);
        expect(mockMorphManager.getInfluence('あ')).toBeGreaterThan(0);
        // 关闭
        sut.setLipSyncEnabled(false);
        triggerLastObserver(mockPipeline);
        expect(mockMorphManager.getInfluence('あ')).toBe(0);
    });
});
