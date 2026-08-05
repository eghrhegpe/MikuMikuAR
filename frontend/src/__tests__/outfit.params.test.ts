// [doc:adr-204] outfit.test.ts 拆分：variant params / tint 集成
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

describe('outfit helper functions (via integration)', () => {
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
        const sm = createMockMaterial('顔', {
            diffuseTexture: origDiffuse,
            toonTexture: {
                name: 'toon.png',
                url: 'toon.png',
                isReady: () => true,
                dispose: vi.fn(),
                onLoadObservable: { add: vi.fn(), remove: vi.fn() },
            },
            sphereTexture: {
                name: 'spa.png',
                url: 'spa.png',
                isReady: () => true,
                dispose: vi.fn(),
                onLoadObservable: { add: vi.fn(), remove: vi.fn() },
            },
            bumpTexture: {
                name: 'normal.png',
                url: 'normal.png',
                isReady: () => true,
                dispose: vi.fn(),
                onLoadObservable: { add: vi.fn(), remove: vi.fn() },
            },
            emissiveTexture: {
                name: 'emissive.png',
                url: 'emissive.png',
                isReady: () => true,
                dispose: vi.fn(),
                onLoadObservable: { add: vi.fn(), remove: vi.fn() },
            },
        });
        inst = createBaseInstance({
            meshes: [createMockMesh(sm)],
            rootMesh: createMockMesh(sm),
            outfitFile: {
                version: 1,
                variants: [
                    {
                        name: 'test',
                        byMaterial: {
                            顔: {
                                diffuse: 'new_diffuse.png',
                                toon: 'new_toon.png',
                                spa: 'new_spa.png',
                                normal: 'new_normal.png',
                                emissive: 'new_emissive.png',
                                params: {
                                    diffuseMul: 0.8,
                                    specularMul: 0.5,
                                    shininess: 80,
                                    ambientMul: 0.6,
                                },
                                tint: [0.9, 1.0, 0.9],
                            },
                        },
                    },
                ],
            },
        });
        modelRegistry.set('m1', inst);
    });

    it('should apply params and tint from variant', async () => {
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        await applyOutfitVariant('m1', 'test');
        expect(inst.activeVariant).toBe('test');
    });

    it('should handle variant with byCategory params', async () => {
        inst.outfitFile.variants[0] = {
            name: 'catTest',
            byCategory: {
                顔: {
                    diffuse: 'cat_diffuse.png',
                    params: { diffuseMul: 1.2 },
                    tint: [1.0, 0.8, 0.8],
                },
            },
        };
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        await applyOutfitVariant('m1', 'catTest');
        expect(inst.activeVariant).toBe('catTest');
    });

    it('should handle variant with all params', async () => {
        inst.outfitFile.variants[0] = {
            name: 'allTest',
            all: {
                diffuse: 'all_diffuse.png',
                params: { diffuseMul: 0.5 },
                tint: [0.5, 0.5, 0.5],
            },
        };
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        await applyOutfitVariant('m1', 'allTest');
        expect(inst.activeVariant).toBe('allTest');
    });
});
