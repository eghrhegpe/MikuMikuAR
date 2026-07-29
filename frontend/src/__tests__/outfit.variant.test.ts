// [doc:adr-204] outfit.test.ts 拆分：applyOutfitVariant
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pre-load mock DOM elements so require() doesn't interfere with Vite SSR transform
vi.hoisted(() => {
    const ids = ['renderCanvas', 'statusBar', 'loading', 'loadingText', 'btnMainAction'];
    for (const id of ids) {
        const el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
});

import {
    mockEngine,
    mockScene,
    mockHemisphericLight,
    mockDirectionalLight,
    mockLight,
    mockArcRotateCamera,
    mockCamera,
    mockDefaultRenderingPipeline,
    mockTexture,
    mockMmdCamera,
    mockRegisterMmdModelLoaders,
    mockRegisterDxBmpTextureLoader,
    mockGetMmdWasmInstance,
    mockMmdWasmRuntime,
    mockVmdLoader,
    mockMmdWasmAnimation,
    mockMmdStandardMaterialProxy,
    mockMmdRuntimeShared,
    mockEmpty,
    mockSinglePhysicsRelease,
    mockSceneModule,
    mockT,
    mockToast,
} from './outfit-mocks';

vi.mock('@babylonjs/core/Engines/engine', () => mockEngine());
vi.mock('@babylonjs/core/scene', () => mockScene());
vi.mock('@babylonjs/core/Lights/hemisphericLight', () => mockHemisphericLight());
vi.mock('@babylonjs/core/Lights/directionalLight', () => mockDirectionalLight());
vi.mock('@babylonjs/core/Lights/light', () => mockLight());
vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => mockArcRotateCamera());
vi.mock('@babylonjs/core/Cameras/camera', () => mockCamera());
vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () => mockDefaultRenderingPipeline());
vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => mockMmdCamera());
vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () => mockEmpty());
vi.mock('babylon-mmd/esm/Loader/dynamic', () => mockRegisterMmdModelLoaders());
vi.mock('babylon-mmd/esm/Loader/registerDxBmpTextureLoader', () => mockRegisterDxBmpTextureLoader());
vi.mock('babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease', () => mockSinglePhysicsRelease());
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance', () => mockGetMmdWasmInstance());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation', () => mockEmpty());
vi.mock('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy', () => mockMmdStandardMaterialProxy());
vi.mock('babylon-mmd/esm/Runtime/mmdRuntimeShared', () => mockMmdRuntimeShared());
vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.default', () => mockEmpty());
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex', () => mockEmpty());
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment', () => mockEmpty());
vi.mock('@babylonjs/core/Materials/Textures/texture', () => mockTexture());
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => mockMmdWasmRuntime());
vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => mockVmdLoader());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation', () => mockMmdWasmAnimation());
vi.mock('../scene/scene', () => mockSceneModule());
vi.mock('../core/i18n/t', () => mockT());
vi.mock('../core/toast', () => mockToast());

import { modelRegistry, setLibraryRoot } from '../core/config';
import { createBaseInstance, createMockMaterial, createMockMesh } from './outfit-helpers';

describe('applyOutfitVariant', () => {
    let inst: any;
    const origDiffuse = {
        name: 'orig.png',
        url: 'orig.png',
        isReady: () => true,
        dispose: vi.fn(),
        onLoadObservable: { add: vi.fn(), remove: vi.fn() },
    };
    const origToon = {
        name: 'orig_toon.png',
        url: 'orig_toon.png',
        isReady: () => true,
        dispose: vi.fn(),
        onLoadObservable: { add: vi.fn(), remove: vi.fn() },
    };

    beforeEach(() => {
        modelRegistry.clear();
        setLibraryRoot('');
        vi.clearAllMocks();
        const sm = createMockMaterial('顔', { diffuseTexture: origDiffuse, toonTexture: origToon });
        inst = createBaseInstance({
            meshes: [createMockMesh(sm)],
            rootMesh: createMockMesh(sm),
            outfitFile: {
                version: 1,
                variants: [
                    {
                        name: '泳装',
                        byCategory: { 服装: { diffuse: 'swim.png', toon: 'swim_toon.png' } },
                    },
                    { name: '校服', byMaterial: { 顔: { diffuse: 'school.png' } } },
                    {
                        name: '演出服',
                        all: { diffuse: 'show.png', toon: 'show_toon.png' },
                    },
                ],
            },
        });
        modelRegistry.set('m1', inst);
    });

    it('should return early if no outfitFile', async () => {
        inst.outfitFile = undefined;
        const { applyOutfitVariant } = await import('../outfit/outfit');
        await applyOutfitVariant('m1', '泳装');
        expect(inst.activeVariant).toBeUndefined();
    });

    it('should capture _origTextures on first apply', async () => {
        const { applyOutfitVariant } = await import('../outfit/outfit');
        expect(inst._origTextures).toBeUndefined();
        await applyOutfitVariant('m1', '泳装');
        expect(inst._origTextures).toBeDefined();
        expect(inst._origTextures!.size).toBe(1);
        const orig = inst._origTextures!.get(0);
        expect(orig?.diffuse).toBe(origDiffuse);
        expect(orig?.toon).toBe(origToon);
    });

    it('should set activeVariant after apply', async () => {
        const { applyOutfitVariant } = await import('../outfit/outfit');
        await applyOutfitVariant('m1', '校服');
        expect(inst.activeVariant).toBe('校服');
    });

    it('should apply byMaterial override over byCategory', async () => {
        const { applyOutfitVariant } = await import('../outfit/outfit');
        await applyOutfitVariant('m1', '校服');
        expect(inst.activeVariant).toBe('校服');
    });

    it("should restore originals on '默认'", async () => {
        const { applyOutfitVariant } = await import('../outfit/outfit');
        await applyOutfitVariant('m1', '泳装');
        expect(inst.activeVariant).toBe('泳装');
        await applyOutfitVariant('m1', '默认');
        expect(inst.activeVariant).toBe('默认');
    });

    it('should be a no-op for unknown variant', async () => {
        const { applyOutfitVariant } = await import('../outfit/outfit');
        inst.activeVariant = '泳装';
        await applyOutfitVariant('m1', '不存在');
        expect(inst.activeVariant).toBe('泳装');
    });

    it('should apply "all" slot fallback', async () => {
        const { applyOutfitVariant } = await import('../outfit/outfit');
        await applyOutfitVariant('m1', '演出服');
        expect(inst.activeVariant).toBe('演出服');
    });

    it('should not re-capture _origTextures on second apply', async () => {
        const { applyOutfitVariant } = await import('../outfit/outfit');
        await applyOutfitVariant('m1', '泳装');
        const firstCapture = inst._origTextures;
        await applyOutfitVariant('m1', '校服');
        expect(inst._origTextures).toBe(firstCapture);
    });
});
