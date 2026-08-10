// perception-multi-model.int.test.ts — 骨骼认领/冲突 banner + 多模型激活/隔离（2026-08-10 合并 claim-bones + multi-model）
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
vi.mock('@/core/audio', () => outfitAudioModuleFactory(mockState));
vi.mock('@/scene/manager/outfit', () => outfitModuleMock);
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

describe('ADR-163 claimBones', () => {
    async function getStore() {
        return getBoneOverrideStoreForTest();
    }

    beforeEach(async () => {
        // 清理 store 中可能残留的冲突状态（使用与 sut 同一次模块求值的 store）
        const store = await getStore();
        store.disposeModel('m1');
        store.disposeModel('m2');
    });

    it('a) activatePerception 后感知层骨骼被正确认领', async () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] },
        });
        sut.activatePerception('m1');
        const store = await getStore();
        expect(store.getOwnedBones('m1', 'perception.gaze.head').size).toBeGreaterThan(0);
        expect(store.getOwnedBones('m1', 'perception.gaze.eye').size).toBeGreaterThan(0);
        expect(store.getOwnedBones('m1', 'perception.breath').size).toBeGreaterThan(0);
        expect(store.getOwnedBones('m1', 'perception.balance.center').size).toBeGreaterThan(0);
    });

    it('b) P1 抢占后感知层 ownedBones 不再包含被抢占骨骼', async () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] },
        });
        sut.activatePerception('m1');

        const store = await getStore();
        const before = store.getOwnedBones('m1', 'perception.gaze.head');
        expect(before.has('頭')).toBe(true);

        // priority=1（数值越小越高）抢占 perception.gaze.head 的骨骼
        store.claimBones('m1', 'body-posture', 1, ['頭']);

        const after = store.getOwnedBones('m1', 'perception.gaze.head');
        expect(after.has('頭')).toBe(false);
    });

    it('c) deactivatePerception 后 ownedBones 被释放', async () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] },
        });
        sut.activatePerception('m1');

        const store = await getStore();
        expect(store.getOwnedBones('m1', 'perception.gaze.head').size).toBeGreaterThan(0);

        sut.deactivatePerception();

        expect(store.getOwnedBones('m1', 'perception.gaze.head').size).toBe(0);
        expect(store.getOwnedBones('m1', 'perception.gaze.eye').size).toBe(0);
        expect(store.getOwnedBones('m1', 'perception.breath').size).toBe(0);
    });

    it('d) 冲突 banner 文本内容正确（仅焦点模型显示）', async () => {
        mockState.focusedModelId = 'm1';
        const store = await getStore();
        store.claimBones('m1', 'perception.gaze.head', 100, ['頭']);
        store.claimBones('m1', 'body-posture', 1, ['頭']);

        const { updatePerceptionConflictBanner } = await import('../../menus/motion-gaze-levels');
        const el = document.createElement('div');
        updatePerceptionConflictBanner(el, 'm1');

        expect(el.textContent).toContain('perception.gaze.head');
        expect(el.textContent).toContain('頭');
        expect(el.textContent).toContain('body-posture');
        expect(el.style.display).not.toBe('none');
    }, 5000);

    it('d) 冲突 banner 无冲突时隐藏', async () => {
        mockState.focusedModelId = 'm1';
        const { updatePerceptionConflictBanner } = await import('../../menus/motion-gaze-levels');
        const el = document.createElement('div');
        updatePerceptionConflictBanner(el, 'm1');
        expect(el.style.display).toBe('none');
    }, 5000);

    it('d) [doc:adr-166] 任意模型冲突均显示 banner（不限焦点）', async () => {
        mockState.focusedModelId = 'm1';
        const store = await getStore();
        store.claimBones('m2', 'perception.gaze.head', 100, ['頭']);
        store.claimBones('m2', 'body-posture', 1, ['頭']);

        const { updatePerceptionConflictBanner } = await import('../../menus/motion-gaze-levels');
        const el = document.createElement('div');
        updatePerceptionConflictBanner(el, 'm2');

        // [doc:adr-166] banner 不再限焦点，m2 有冲突即显示
        expect(el.style.display).not.toBe('none');
        expect(el.textContent).toContain('perception.gaze.head');
    }, 5000);

    it('d) [doc:adr-166 P2-3] renderPerceptionConflictBanners 同屏并显焦点+pinned 冲突', async () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] },
        });
        const store = await getStore();
        // 焦点 m1 有冲突
        store.claimBones('m1', 'perception.gaze.head', 100, ['頭']);
        store.claimBones('m1', 'body-posture', 1, ['頭']);
        // pinned m2 有冲突（pin 后再制造抢占）
        sut.pinPerception('m2');
        store.claimBones('m2', 'perception.gaze.head', 100, ['頭']);
        store.claimBones('m2', 'body-posture', 1, ['頭']);

        const { renderPerceptionConflictBanners } = await import('../../menus/motion-gaze-levels');
        const container = document.createElement('div');
        renderPerceptionConflictBanners(container);

        // 多模型场景：焦点 + pinned 冲突均显示，且带 modelId 前缀区分归属
        expect(container.textContent).toContain('m1');
        expect(container.textContent).toContain('m2');
        expect(container.textContent).toContain('perception.gaze.head');
    }, 5000);
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
