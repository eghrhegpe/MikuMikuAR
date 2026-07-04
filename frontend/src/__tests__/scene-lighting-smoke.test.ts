import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as sceneLighting from '../scene/render/lighting';

// Mock Babylon.js modules
vi.mock('@babylonjs/core/Lights/hemisphericLight', () => ({
    HemisphericLight: vi.fn(),
}));
vi.mock('@babylonjs/core/Lights/directionalLight', () => ({
    DirectionalLight: vi.fn(),
}));
vi.mock('@babylonjs/core/Maths/math.vector', () => ({
    Vector3: class {
        constructor(
            public x: number,
            public y: number,
            public z: number
        ) {}
        static Down = new (this as any)(0, -1, 0);
        static Right() { return new (this as any)(1, 0, 0); }
        static Up() { return new (this as any)(0, 1, 0); }
        static Forward() { return new (this as any)(0, 0, 1); }
    },
    Quaternion: class {
        constructor(
            public x: number,
            public y: number,
            public z: number,
            public w: number = 1
        ) {}
        static Identity() { return new (this as any)(0, 0, 0, 1); }
    },
}));
vi.mock('@babylonjs/core/Maths/math.color', () => ({
    Color3: vi.fn(),
    Color4: vi.fn(),
}));
vi.mock('@babylonjs/core/Meshes/mesh', () => ({
    Mesh: vi.fn(),
}));
vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({
    MeshBuilder: { CreateSphere: vi.fn() },
}));
vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({
    StandardMaterial: vi.fn(),
}));
vi.mock('@babylonjs/core/Lights/Shadows/shadowGenerator', () => ({
    ShadowGenerator: vi.fn(),
}));

describe('scene-lighting — deriveLighting', () => {
    // deriveLighting 是纯函数，已在 env-lighting.test.ts 覆盖
    // 这里只做 smoke test 确认模块可导入
    it('模块可导入', () => {
        expect(sceneLighting.transitionLighting).toBeTypeOf('function');
        expect(sceneLighting.initLighting).toBeTypeOf('function');
    });
});

describe('scene-lighting — transitionLighting smoke', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('transitionLighting 在缺少 Babylon 对象时提前返回（不抛异常）', () => {
        // 未调用 initLighting 时，hemiLight / dirLight 为 undefined
        expect(() => {
            sceneLighting.transitionLighting({ dirIntensity: 0.5 }, 2000);
        }).not.toThrow();
    });
});
