// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { safeDispose, detachSharedTextures } from '../dispose-helpers';
import type { Material } from '@babylonjs/core/Materials/material';

class FakeDisposable {
    disposed = false;
    dispose(...args: any[]): void {
        this.disposed = true;
        this.lastArgs = args;
    }
    lastArgs: any[] = [];
}

describe('safeDispose', () => {
    it('disposes a non-null object and returns null', () => {
        const obj = new FakeDisposable();
        const result = safeDispose(obj);
        expect(obj.disposed).toBe(true);
        expect(result).toBeNull();
    });

    it('is a no-op and returns null when given null', () => {
        const result = safeDispose<FakeDisposable>(null);
        expect(result).toBeNull();
    });

    it('passes through dispose arguments (e.g. mesh.dispose(true))', () => {
        const obj = new FakeDisposable();
        safeDispose(obj, true);
        expect(obj.lastArgs).toEqual([true]);
    });

    it('passes through multiple dispose arguments (e.g. mat.dispose(false, true))', () => {
        const obj = new FakeDisposable();
        safeDispose(obj, false, true);
        expect(obj.lastArgs).toEqual([false, true]);
    });

    it('can be assigned back to the caller reference to null it out', () => {
        let ref: FakeDisposable | null = new FakeDisposable();
        ref = safeDispose(ref);
        expect(ref).toBeNull();
    });
});

// —— detachSharedTextures ——
// 场景还原：babylon-mmd 的 MMD 共享 toon（toon01–10）是全局单例，多个模型共用同一
// Texture 实例；MmdPluginMaterial.dispose 无引用计数，卸载模型 A 会销毁 B 仍在用的 toon。

/** 最小 Material 替身：只实现 detachSharedTextures 依赖的 3 个接口点。 */
class FakeMaterial {
    toonTexture: object | null = null;
    sphereTexture: object | null = null;
    diffuseTexture: object | null = null;
    emissiveTexture: object | null = null;
    constructor(private readonly scene: { materials: FakeMaterial[] }) {}
    getScene() {
        return this.scene;
    }
    getActiveTextures(): object[] {
        return [
            this.toonTexture,
            this.sphereTexture,
            this.diffuseTexture,
            this.emissiveTexture,
        ].filter((t): t is object => t !== null);
    }
    hasTexture(tex: object): boolean {
        return this.getActiveTextures().includes(tex);
    }
}

/** 构造 scene + 材质，返回按 FakeMaterial 操作、按 Material 传参的双视图。 */
function makeScene(count: number) {
    const scene = { materials: [] as FakeMaterial[] };
    const mats = Array.from({ length: count }, () => new FakeMaterial(scene));
    scene.materials.push(...mats);
    return { scene, mats };
}

const asSet = (mats: FakeMaterial[]) => new Set(mats as unknown as Material[]);

describe('detachSharedTextures', () => {
    it('摘除仍被存活材质引用的共享 toon（模型 A 卸载不再殃及模型 B）', () => {
        const { mats } = makeScene(2);
        const [matA, matB] = mats;
        const sharedToon = { name: 'file:shared_toon_texture_1' };
        matA.toonTexture = sharedToon;
        matB.toonTexture = sharedToon;

        detachSharedTextures(asSet([matA]));

        expect(matA.toonTexture).toBeNull(); // A 已摘除 → 后续 dispose 不会误杀
        expect(matB.toonTexture).toBe(sharedToon); // B 仍持有，渲染不受影响
    });

    it('独占纹理保持挂载，交由 dispose 释放（不退化为 GPU 泄漏）', () => {
        const { mats } = makeScene(2);
        const [matA, matB] = mats;
        const ownTex = { name: 'file:3_face.png' };
        matA.diffuseTexture = ownTex;
        matB.diffuseTexture = { name: 'file:4_face.png' };

        detachSharedTextures(asSet([matA]));

        expect(matA.diffuseTexture).toBe(ownTex);
    });

    it('整组一起卸载时不摘除——无幸存者引用，共享纹理应被正常回收', () => {
        const { mats } = makeScene(2);
        const [matA, matB] = mats;
        const sharedToon = { name: 'file:shared_toon_texture_1' };
        matA.toonTexture = sharedToon;
        matB.toonTexture = sharedToon;

        detachSharedTextures(asSet([matA, matB]));

        expect(matA.toonTexture).toBe(sharedToon);
        expect(matB.toonTexture).toBe(sharedToon);
    });

    it('同时摘除多个共享槽位（toon + sphere）', () => {
        const { mats } = makeScene(2);
        const [matA, matB] = mats;
        const toon = { name: 'toon' };
        const sphere = { name: 'sphere' };
        matA.toonTexture = toon;
        matA.sphereTexture = sphere;
        matB.toonTexture = toon;
        matB.sphereTexture = sphere;

        detachSharedTextures(asSet([matA]));

        expect(matA.toonTexture).toBeNull();
        expect(matA.sphereTexture).toBeNull();
    });

    it('空集合安全返回（无材质可卸载）', () => {
        expect(() => detachSharedTextures(new Set())).not.toThrow();
    });
});
