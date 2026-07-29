// perception/multi-model.int.test.ts — ADR-164 模型加载自动激活 + ADR-166 多模型隔离（ADR-204 P3，拆自旧 perception.test.ts）
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../scene/scene', async () => (await import('./perception-mocks')).sceneModuleMock);
vi.mock('../../ar/ar-camera', async () => (await import('./perception-mocks')).arCameraModuleMock);
vi.mock('../../core/wails-bindings', async () => (await import('./perception-mocks')).wailsBindingsModuleMock);
vi.mock('../../core/i18n/t', async () => (await import('./perception-mocks')).i18nTModuleMock);
vi.mock('@babylonjs/core/Materials/standardMaterial', async () => (await import('./perception-mocks')).standardMaterialModuleMock);
vi.mock('../../core/config', async () => (await import('./perception-mocks')).configModuleMock);
vi.mock('../../scene/camera/camera', async () => (await import('./perception-mocks')).cameraModuleMock);
vi.mock('../../scene/motion/vmd-loader', async () => (await import('./perception-mocks')).vmdLoaderModuleMock);
vi.mock('../../outfit/audio', async () => (await import('./perception-mocks')).outfitAudioModuleMock);
vi.mock('../../outfit/outfit', async () => (await import('./perception-mocks')).outfitModuleMock);
vi.mock('../../scene/env/props', async () => (await import('./perception-mocks')).envPropsModuleMock);
vi.mock('../../scene/env/env-bridge', async () => (await import('./perception-mocks')).envBridgeModuleMock);
vi.mock('../../scene/env/env-impl', async () => (await import('./perception-mocks')).envImplModuleMock);
vi.mock('../../scene/motion/motion-pipeline', async () => (await import('./perception-mocks')).motionPipelineModuleMock);
vi.mock('../../scene/motion/proc-motion-bridge', async () => (await import('./perception-mocks')).procMotionBridgeModuleMock);
vi.mock('../../scene/motion/lipsync-bridge', async () => (await import('./perception-mocks')).lipsyncBridgeModuleMock);
vi.mock('../../motion-algos/procedural-motion', async () => (await import('./perception-mocks')).proceduralMotionModuleMock);
vi.mock('../../motion-algos/lipsync', async () => (await import('./perception-mocks')).lipsyncAlgosModuleMock);

import { setupPerceptionTest, mockState, getBoneOverrideStoreForTest, type PerceptionSut } from './perception-mocks';

let sut: PerceptionSut;

beforeEach(async () => {
    sut = await setupPerceptionTest();
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
    it('1. setPerceptionStateFor 写入不同 context 互不干扰', () => {
        sut.setPerceptionStateFor('m1', { breathFrequency: 0.5 });
        sut.setPerceptionStateFor('m2', { breathFrequency: 0.7 });

        expect(sut.getPerceptionStateFor('m1').breathFrequency).toBe(0.5);
        expect(sut.getPerceptionStateFor('m2').breathFrequency).toBe(0.7);
        expect(sut.getPerceptionState().breathFrequency).toBe(0.3); // fallback 默认不受影响
    });

    it('2. 焦点 setBreathFrequency 不污染 pinned 模型 ctx.state', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] },
        });
        sut.activatePerception('m1');
        sut.pinPerception('m2');
        sut.setPerceptionStateFor('m2', { breathFrequency: 0.3 });

        // 焦点 setter 仅影响焦点 context，不污染 pinned
        sut.setBreathFrequency(0.7);

        expect(sut.getPerceptionStateFor('m1').breathFrequency).toBe(0.7);
        expect(sut.getPerceptionStateFor('m2').breathFrequency).toBe(0.3);
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
