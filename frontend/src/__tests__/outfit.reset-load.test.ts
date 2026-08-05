// [doc:adr-204] outfit.test.ts 拆分：resetOutfit + loadOutfits
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
vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () =>
    mockDefaultRenderingPipeline()
);
vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => mockMmdCamera());
vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () => mockEmpty());
vi.mock('babylon-mmd/esm/Loader/dynamic', () => mockRegisterMmdModelLoaders());
vi.mock('babylon-mmd/esm/Loader/registerDxBmpTextureLoader', () =>
    mockRegisterDxBmpTextureLoader()
);
vi.mock('babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease', () =>
    mockSinglePhysicsRelease()
);
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance', () => mockGetMmdWasmInstance());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation', () =>
    mockEmpty()
);
vi.mock('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy', () => mockMmdStandardMaterialProxy());
vi.mock('babylon-mmd/esm/Runtime/mmdRuntimeShared', () => mockMmdRuntimeShared());
vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.default', () => mockEmpty());
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex', () => mockEmpty());
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment', () => mockEmpty());
vi.mock('@babylonjs/core/Materials/Textures/texture', () => mockTexture());
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => mockMmdWasmRuntime());
vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => mockVmdLoader());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation', () =>
    mockMmdWasmAnimation()
);
vi.mock('../scene/scene', () => mockSceneModule());
vi.mock('../core/i18n/t', () => mockT());
vi.mock('../core/toast', () => mockToast());

import { modelRegistry, setLibraryRoot } from '../core/config';
import { createBaseInstance, createMockMaterial, createMockMesh } from './outfit-helpers';

describe('resetOutfit', () => {
    let inst: any;
    const origDiffuse = {
        name: 'orig.png',
        url: 'orig.png',
        isReady: () => true,
        dispose: vi.fn(),
        onLoadObservable: { add: vi.fn(), remove: vi.fn() },
    };

    beforeEach(() => {
        modelRegistry.clear();
        setLibraryRoot('');
        vi.clearAllMocks();
        const sm = createMockMaterial('体', { diffuseTexture: origDiffuse });
        inst = createBaseInstance({
            meshes: [createMockMesh(sm)],
            rootMesh: createMockMesh(sm),
            outfitFile: null,
            activeVariant: '泳装',
            _origTextures: new Map([[0, { diffuse: origDiffuse }]]),
        });
        modelRegistry.set('m1', inst);
    });

    it('should clear outfit state', async () => {
        const { resetOutfit } = await import('@/scene/manager/outfit');
        await resetOutfit('m1');
        expect(inst.activeVariant).toBeUndefined();
        expect(inst.outfitFile).toBeUndefined();
        expect(inst._origTextures).toBeUndefined();
    });

    it('should be a no-op for unknown id', async () => {
        const { resetOutfit } = await import('@/scene/manager/outfit');
        await resetOutfit('nonexistent');
        // Should not throw
    });

    it('should clear _origParams if present', async () => {
        inst._origParams = new Map([
            [
                0,
                {
                    diffuseR: 1,
                    diffuseG: 1,
                    diffuseB: 1,
                    specularR: 1,
                    specularG: 1,
                    specularB: 1,
                    specularPower: 50,
                    ambientR: 1,
                    ambientG: 1,
                    ambientB: 1,
                },
            ],
        ]);
        const { resetOutfit } = await import('@/scene/manager/outfit');
        await resetOutfit('m1');
        expect(inst._origParams).toBeUndefined();
    });
});

describe('loadOutfits', () => {
    beforeEach(() => {
        modelRegistry.clear();
        setLibraryRoot('');
        vi.clearAllMocks();
    });

    it('returns null when no filePath', async () => {
        const inst = createBaseInstance({ filePath: '' });
        modelRegistry.set('m1', inst);
        const { loadOutfits } = await import('@/scene/manager/outfit');
        const result = await loadOutfits('m1');
        expect(result).toBeNull();
    });

    it('returns null when model not in registry', async () => {
        const { loadOutfits } = await import('@/scene/manager/outfit');
        const result = await loadOutfits('nonexistent');
        expect(result).toBeNull();
    });
});
