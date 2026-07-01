import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
    const ids = ['renderCanvas', 'statusBar', 'loading', 'loadingText', 'btnMainAction'];
    for (const id of ids) {
        const el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
});

vi.mock('@babylonjs/core/Engines/engine', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Engine: m.MockEngine };
});

vi.mock('@babylonjs/core/scene', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Scene: m.MockScene };
});

vi.mock('@babylonjs/core/Lights/hemisphericLight', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { HemisphericLight: m.MockHemisphericLight };
});

vi.mock('@babylonjs/core/Lights/directionalLight', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { DirectionalLight: m.MockDirectionalLight };
});

vi.mock('@babylonjs/core/Lights/light', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Light: m.MockLight };
});

vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { ArcRotateCamera: m.MockArcRotateCamera };
});

vi.mock('@babylonjs/core/Cameras/camera', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Camera: m.MockCamera };
});

vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { DefaultRenderingPipeline: m.MockDefaultRenderingPipeline };
});

vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { MmdCamera: m.MockMmdCamera };
});

vi.mock('@babylonjs/core/Materials/Textures/texture', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Texture: m.MockTexture };
});

// Setup minimal model registry
import { modelRegistry, setLibraryRoot } from '../core/config';

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
    const mat: any = { name, isReady: true, clone: () => mat, dispose: () => {} };
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
        const sm = createMockMaterial('顔', { diffuseTexture: origDiffuse, toonTexture: origToon });
        inst = {
            id: 'm1',
            name: 'test',
            filePath: '/models/test.pmx',
            port: 12345,
            meshes: [createMockMesh(sm)],
            rootMesh: createMockMesh(sm),
            scaling: 1,
            rotationY: 0,
            visible: true,
            opacity: 1,
            wireframe: false,
            showBoneLines: false,
            showBoneJoints: false,
            physicsEnabled: false,
            kind: 'actor',
            vmdData: null,
            vmdName: '',
            vmdPath: null,
            animationDuration: 0,
            modelDir: '/models',
            outfitFile: {
                version: 1,
                variants: [
                    {
                        name: '泳装',
                        byCategory: { 服装: { diffuse: 'swim.png', toon: 'swim_toon.png' } },
                    },
                    { name: '校服', byMaterial: { 顔: { diffuse: 'school.png' } } },
                ],
            },
            activeVariant: undefined,
            _origTextures: undefined,
        };
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
        // "顔" material: byMaterial has "school.png" for diffuse → should win
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
        const sm = createMockMaterial('体', { diffuseTexture: origDiffuse });
        inst = {
            id: 'm1',
            name: 'test',
            filePath: '/models/test.pmx',
            port: 12345,
            meshes: [createMockMesh(sm)],
            rootMesh: createMockMesh(sm),
            scaling: 1,
            rotationY: 0,
            visible: true,
            opacity: 1,
            wireframe: false,
            showBoneLines: false,
            showBoneJoints: false,
            physicsEnabled: false,
            kind: 'actor',
            vmdData: null,
            vmdName: '',
            vmdPath: null,
            animationDuration: 0,
            modelDir: '/models',
            outfitFile: null,
            activeVariant: '泳装',
            _origTextures: new Map([[0, { diffuse: origDiffuse }]]),
        };
        modelRegistry.set('m1', inst);
    });

    it('should clear outfit state', async () => {
        const { resetOutfit } = await import('../outfit/outfit');
        resetOutfit('m1');
        expect(inst.activeVariant).toBeUndefined();
        expect(inst.outfitFile).toBeUndefined();
        expect(inst._origTextures).toBeUndefined();
    });
});
