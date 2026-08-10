// outfit 系列合并（params/reset-load/variant 3 文件 → 1）
// [2026-08] 同系列合并以省 isolate 单文件 import 成本（vitest.config 同款先例）。
// 3 文件结构完全同构：相同 24 条 Babylon/babylon-mmd vi.mock + 相同 hoisted DOM
// 预建 + 共享 outfit-mocks 工厂 / outfit-helpers fixture，共享样板原在 3 文件
// 重复 3 份，现收敛为一份。各 describe 按原主题分区保留，行为不变。
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

// ======== variant params / tint 集成（原 outfit.params.test.ts） ========
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

// ======== resetOutfit + loadOutfits（原 outfit.reset-load.test.ts） ========
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

// ======== applyOutfitVariant（原 outfit.variant.test.ts） ========
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
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        await applyOutfitVariant('m1', '泳装');
        expect(inst.activeVariant).toBeUndefined();
    });

    it('should capture _origTextures on first apply', async () => {
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        expect(inst._origTextures).toBeUndefined();
        await applyOutfitVariant('m1', '泳装');
        expect(inst._origTextures).toBeDefined();
        expect(inst._origTextures!.size).toBe(1);
        const orig = inst._origTextures!.get(0);
        expect(orig?.diffuse).toBe(origDiffuse);
        expect(orig?.toon).toBe(origToon);
    });

    it('should set activeVariant after apply', async () => {
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        await applyOutfitVariant('m1', '校服');
        expect(inst.activeVariant).toBe('校服');
    });

    it('should apply byMaterial override over byCategory', async () => {
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        await applyOutfitVariant('m1', '校服');
        expect(inst.activeVariant).toBe('校服');
    });

    it("should restore originals on '默认'", async () => {
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        await applyOutfitVariant('m1', '泳装');
        expect(inst.activeVariant).toBe('泳装');
        await applyOutfitVariant('m1', '默认');
        expect(inst.activeVariant).toBe('默认');
    });

    it('should be a no-op for unknown variant', async () => {
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        inst.activeVariant = '泳装';
        await applyOutfitVariant('m1', '不存在');
        expect(inst.activeVariant).toBe('泳装');
    });

    it('should apply "all" slot fallback', async () => {
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        await applyOutfitVariant('m1', '演出服');
        expect(inst.activeVariant).toBe('演出服');
    });

    it('should not re-capture _origTextures on second apply', async () => {
        const { applyOutfitVariant } = await import('@/scene/manager/outfit');
        await applyOutfitVariant('m1', '泳装');
        const firstCapture = inst._origTextures;
        await applyOutfitVariant('m1', '校服');
        expect(inst._origTextures).toBe(firstCapture);
    });
});
