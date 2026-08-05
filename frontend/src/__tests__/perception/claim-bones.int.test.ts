// perception/claim-bones.int.test.ts — ADR-163 感知层冲突可视化（骨骼认领 + 冲突 banner）（ADR-204 P3，拆自旧 perception.test.ts）
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

        // P1 模块抢占 頭
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
    }, 30000);

    it('d) 冲突 banner 无冲突时隐藏', async () => {
        mockState.focusedModelId = 'm1';
        const { updatePerceptionConflictBanner } = await import('../../menus/motion-gaze-levels');
        const el = document.createElement('div');
        updatePerceptionConflictBanner(el, 'm1');
        expect(el.style.display).toBe('none');
    }, 30000);

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
    }, 30000);

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
    }, 30000);
});
