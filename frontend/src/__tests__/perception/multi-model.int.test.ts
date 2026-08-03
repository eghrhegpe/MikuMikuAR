// perception/multi-model.int.test.ts — ADR-164 模型加载自动激活 + ADR-166 多模型隔离（ADR-204 P3，拆自旧 perception.test.ts）
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    getBoneOverrideStoreForTest,
    type PerceptionSut,
} from './perception-mocks';

let sut: PerceptionSut;

beforeEach(async () => {
    sut = await setupPerceptionTest(mockState, mockPipeline);
});

describe('ADR-164 模型加载自动激活', () => {
    it('8. 全员感知模式下新模型加载时自动激活', () => {
        const inst1 = { mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] } };
        mockState.modelManager.get.mockImplementation((id: string) => (id === 'm1' ? inst1 : null));
        mockState.modelManager.modelRegistry.set('m1', inst1);
        mockState.focusedModelId = 'm1';
        sut.activatePerception('m1');
        sut.enableAllPerception();

        // 模拟新模型 m2 加载
        const inst2 = { mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] } };
        mockState.modelManager.get.mockImplementation((id: string) =>
            id === 'm1' ? inst1 : id === 'm2' ? inst2 : null
        );
        mockState.modelManager.modelRegistry.set('m2', inst2);
        // 在全员感知模式下调用 activatePerception(m2) 应激活 m2
        sut.activatePerception('m2');
        expect(sut.getPerceptionStateFor('m2').breathEnabled).toBe(true);
    });
});

// =====================================================================
// [doc:adr-166] P4-3 — 多模型隔离回归测试
// =====================================================================

describe('ADR-166 多模型隔离', () => {
    it('1. setPerceptionStateFor 写入场景级单例（所有模型共享参数）', () => {
        sut.setPerceptionStateFor('m1', { breathFrequency: 0.5 });
        sut.setPerceptionStateFor('m2', { breathFrequency: 0.7 });

        // [fix:P3] 场景级存储：最后一次写入生效，对所有模型一致
        expect(sut.getPerceptionStateFor('m1').breathFrequency).toBe(0.7);
        expect(sut.getPerceptionStateFor('m2').breathFrequency).toBe(0.7);
        expect(sut.getPerceptionState().breathFrequency).toBe(0.7);
    });

    it('2. 焦点 setBreathFrequency 写入场景级单例（pinned 模型同参）', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] },
        });
        sut.activatePerception('m1');
        sut.pinPerception('m2');
        sut.setPerceptionStateFor('m2', { breathFrequency: 0.3 });

        // [fix:P3] 场景级存储：焦点 setter 对所有模型生效（含 pinned）
        sut.setBreathFrequency(0.7);

        expect(sut.getPerceptionStateFor('m1').breathFrequency).toBe(0.7);
        expect(sut.getPerceptionStateFor('m2').breathFrequency).toBe(0.7);
    });

    it('3. 非感知模块释放骨骼时触发感知层自动 reclaim', async () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] },
        });
        sut.activatePerception('m1');

        const store = await getBoneOverrideStoreForTest();

        // 模拟其他模块抢占 頭 骨
        store.claimBones('m1', 'body-posture', 1, ['頭']);
        expect(store.getOwnedBones('m1', 'perception.gaze.head').has('頭')).toBe(false);

        // 模拟关闭 Bone Override：body-posture 释放骨骼
        store.releaseBones('m1', 'body-posture');

        // 感知层应自动 reclaim → 重新拥有 頭
        expect(store.getOwnedBones('m1', 'perception.gaze.head').has('頭')).toBe(true);
    });
});
