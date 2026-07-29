// outfit-helpers.ts — 纯 fixture 构建助手（无 mock 依赖）
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
    return { material, _positions: null, name: 'mesh' };
}

export function createBaseInstance(overrides: Record<string, any> = {}) {
    return {
        id: 'm1',
        name: 'test',
        filePath: '/models/test.pmx',
        port: 12345,
        meshes: [],
        rootMesh: null,
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
        vmdData: null,
        vmdName: '',
        vmdPath: null,
        animationDuration: 0,
        vmdLayers: [],
        boneOverrides: [],
        modelDir: '/models',
        outfitFile: undefined,
        activeVariant: undefined,
        _origTextures: undefined,
        _origParams: undefined,
        ...overrides,
    };
}
