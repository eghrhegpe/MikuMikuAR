// outfit-helpers.ts — 纯 fixture 构建助手（无 mock 依赖）
import type { ModelInstance } from '../core/config';
import { vi } from 'vitest';

export function makeColor(r: number, g: number, b: number) {
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

export function createMockMaterial(name: string, textures: Record<string, any>) {
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

export function createMockMesh(material: any) {
    return { material, _positions: null as Float32Array | null, name: 'mesh' };
}

export function createBaseInstance(overrides: Record<string, any> = {}) {
    return {
        id: 'm1',
        name: 'test',
        filePath: '/models/test.pmx',
        port: 12345,
        meshes: [] as ModelInstance['meshes'],
        rootMesh: null as ModelInstance['rootMesh'],
        scaling: 1,
        rotationY: 0,
        rotation: [0, 0, 0] as [number, number, number],
        visible: true,
        opacity: 1,
        wireframe: false,
        showBoneLines: false,
        showBoneJoints: false,
        physicsEnabled: false,
        kind: 'actor' as const,
        vmdData: null as ModelInstance['vmdData'],
        vmdName: '',
        vmdPath: null as ModelInstance['vmdPath'],
        animationDuration: 0,
        vmdLayers: [] as ModelInstance['vmdLayers'],
        boneOverrides: [] as ModelInstance['boneOverrides'],
        modelDir: '/models',
        outfitFile: undefined as ModelInstance['outfitFile'],
        activeVariant: undefined as ModelInstance['activeVariant'],
        _origTextures: undefined as ModelInstance['_origTextures'],
        _origParams: undefined as ModelInstance['_origParams'],
        ...overrides,
    };
}
