import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pre-load mock modules in vi.hoisted so require() doesn't interfere with Vite SSR transform
vi.hoisted(() => {
    const ids = ['renderCanvas', 'statusBar', 'loading', 'loadingText', 'btnMainAction'];
    for (const id of ids) {
        const el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
    // Pre-load mock modules — storing on globalThis avoids require() inside vi.mock factories,
    // which would trigger Vite SSR import ID variables (__vite_ssr_import_N__) and cause TDZ.
    globalThis.__BABYLON_MOCKS__ = require('./mocks/babylon-classes.ts');
    globalThis.__BABYLON_MMD_MOCKS__ = require('./mocks/babylon-mmd-mocks.ts');
});

// All vi.mock factories read from pre-loaded globalThis — no require() calls in factory body
const BM = () => globalThis.__BABYLON_MOCKS__ as any;
const MMD = () => globalThis.__BABYLON_MMD_MOCKS__ as any;

vi.mock('@babylonjs/core/Engines/engine', () => {
    const m = BM();
    return { Engine: m.MockEngine };
});

vi.mock('@babylonjs/core/scene', () => {
    const m = BM();
    return { Scene: m.MockScene };
});

vi.mock('@babylonjs/core/Lights/hemisphericLight', () => {
    const m = BM();
    return { HemisphericLight: m.MockHemisphericLight };
});

vi.mock('@babylonjs/core/Lights/directionalLight', () => {
    const m = BM();
    return { DirectionalLight: m.MockDirectionalLight };
});

vi.mock('@babylonjs/core/Lights/light', () => {
    const m = BM();
    return { Light: m.MockLight };
});

vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => {
    const m = BM();
    return { ArcRotateCamera: m.MockArcRotateCamera };
});

vi.mock('@babylonjs/core/Cameras/camera', () => {
    const m = BM();
    return { Camera: m.MockCamera };
});

vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () => {
    const m = BM();
    return { DefaultRenderingPipeline: m.MockDefaultRenderingPipeline };
});

vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => {
    const m = MMD();
    return { MmdCamera: m.MockMmdCamera };
});

// --- babylon-mmd 子模块桩（复用 material-editor 已验证集合）---
// 防止真实 babylon-mmd 在 scene.ts 加载期触发 mmdStandardMaterial 装饰器 / 静态初始化，
// 否则 scene.ts 初始化失败会使 outfit.ts 的 _catOf/scene live binding 永久卡在 TDZ。
vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () => ({}));

vi.mock('babylon-mmd/esm/Loader/dynamic', () => {
    const m = MMD();
    return { RegisterMmdModelLoaders: m.MockRegisterMmdModelLoaders };
});

vi.mock('babylon-mmd/esm/Loader/registerDxBmpTextureLoader', () => {
    const m = MMD();
    return { RegisterDxBmpTextureLoader: m.MockRegisterDxBmpTextureLoader };
});

vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance', () => {
    const m = MMD();
    return { GetMmdWasmInstance: m.MockGetMmdWasmInstance };
});

vi.mock('babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease', () => ({
    MmdWasmInstanceTypeSPR: class Mock {},
}));

vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => {
    const m = MMD();
    return { MmdWasmRuntime: m.MockMmdWasmRuntime };
});

vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => {
    const m = MMD();
    return { VmdLoader: m.MockVmdLoader };
});

vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation', () => {
    const m = MMD();
    return { MmdWasmAnimation: m.MockMmdWasmAnimation };
});

vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation', () => ({}));

vi.mock('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy', () => {
    const m = MMD();
    return { MmdStandardMaterialProxy: m.MockMmdStandardMaterialProxy };
});

vi.mock('babylon-mmd/esm/Runtime/mmdRuntimeShared', () => {
    const m = MMD();
    return { MmdRuntimeShared: m.MockMmdRuntimeShared };
});

vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.default', () => ({}));

vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex', () => ({}));

vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment', () => ({}));

vi.mock('@babylonjs/core/Materials/Textures/texture', () => {
    const m = BM();
    return { Texture: m.MockTexture };
});

// 拦截 outfit.ts 内 `await import('../scene/scene')` 的动态导入，避免加载真实 scene.ts
// 重依赖链（scene.ts → renderer/lighting/env/...）在全测并发下超 5s test timeout。
// timeout 后 _applyingVariant lock 不释放（finally 未执行），污染后续测试。
// 测试 variant 均无 meshFile，scene 仅传给 loadOverlay（不调用），空对象即可。
vi.mock('../scene/scene', () => ({ scene: {} }));

// 拦截 outfit.ts 内 `await import('../core/i18n/t')`，避免加载 i18n 资源
vi.mock('../core/i18n/t', () => ({ t: (key: string) => key }));

import { modelRegistry, setLibraryRoot } from '../core/config';
import { createDefaultFeetState } from '../core/state';

function makeColor(r: number, g: number, b: number) {
    return {
        r,
        g,
        b,
        set: function (sr: number, sg: number, sb: number) {
            this.r = sr;
            this.g = sg;
            this.b = sb;
        },
        multiplyInPlace: function (c: any) {
            this.r *= c.r;
            this.g *= c.g;
            this.b *= c.b;
        },
    };
}

function createMockMaterial(name: string, textures: Record<string, any>) {
    const mat: any = { name, isReady: true, clone: () => mat, dispose: vi.fn() };
    for (const [k, v] of Object.entries(textures)) {
        mat[k] = v;
    }
    mat.diffuseColor = makeColor(1, 1, 1);
    mat.specularColor = makeColor(1, 1, 1);
    mat.specularPower = 50;
    mat.ambientColor = makeColor(1, 1, 1);
    return mat;
}

function createMockMesh(material: any) {
    return { material, _positions: null, name: 'mesh' };
}

function createBaseInstance(overrides: Record<string, any> = {}) {
    return {
        id: 'm1',
        name: 'test',
        filePath: '/models/test.pmx',
        port: 12345,
        meshes: [],
        rootMesh: null,
        scaling: 1,
        rotationY: 0,
        visible: true,
        opacity: 1,
        wireframe: false,
        showBoneLines: false,
        showBoneJoints: false,
        physicsEnabled: false,
        kind: 'actor' as const,
        vmdData: null,
        vmdName: '',
        vmdPath: null,
        animationDuration: 0,
        vmdLayers: [],
        boneOverrides: [],
        feet: createDefaultFeetState(),
        modelDir: '/models',
        outfitFile: undefined,
        activeVariant: undefined,
        _origTextures: undefined,
        _origParams: undefined,
        ...overrides,
    };
}

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
        const { resetOutfit } = await import('../outfit/outfit');
        await resetOutfit('m1');
        expect(inst.activeVariant).toBeUndefined();
        expect(inst.outfitFile).toBeUndefined();
        expect(inst._origTextures).toBeUndefined();
    });

    it('should be a no-op for unknown id', async () => {
        const { resetOutfit } = await import('../outfit/outfit');
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
        const { resetOutfit } = await import('../outfit/outfit');
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
        const { loadOutfits } = await import('../outfit/outfit');
        const result = await loadOutfits('m1');
        expect(result).toBeNull();
    });

    it('returns null when model not in registry', async () => {
        const { loadOutfits } = await import('../outfit/outfit');
        const result = await loadOutfits('nonexistent');
        expect(result).toBeNull();
    });
});

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
        const { applyOutfitVariant } = await import('../outfit/outfit');
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
        const { applyOutfitVariant } = await import('../outfit/outfit');
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
        const { applyOutfitVariant } = await import('../outfit/outfit');
        await applyOutfitVariant('m1', 'allTest');
        expect(inst.activeVariant).toBe('allTest');
    });
});
