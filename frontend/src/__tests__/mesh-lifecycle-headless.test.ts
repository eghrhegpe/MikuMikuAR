import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

// ─── 程序化 mesh 生命周期（happy-dom 试点）─────────────────────────
// [fix:P1] e2e model-load.spec.ts @dom 两个测试的 vitest 等价迁移：
//   createTestMesh → meshCount 增 → clearTestMeshes → meshCount 减。
// e2e 版本走 vitePage + window.__scene.driver 全链（fixture 初始化 + NullEngine 场景），
// 本测试用真实 NullEngine + Scene 直测等价行为——证明程序化 3D 断言无浏览器可测，
// 且无 vitePage fixture 的 init()/守卫开销（9ms vs e2e ~50s）。
// 与 dev-hooks.ts driver.createTestMesh/clearTestMeshes 行为对齐（同名 mesh 前缀 e2e-test-）。

function createTestMesh(scene: Scene): void {
    for (const m of [...scene.meshes]) {
        if (m.name.startsWith('e2e-test-')) {
            m.dispose();
        }
    }
    const box = MeshBuilder.CreateBox('e2e-test-mesh', { size: 0.5 }, scene);
    const mat = new StandardMaterial('e2e-test-mat', scene);
    mat.diffuseColor = new Color3(1, 0, 0);
    box.material = mat;
}

function clearTestMeshes(scene: Scene): void {
    for (const m of [...scene.meshes]) {
        if (m.name.startsWith('e2e-test-')) {
            m.dispose();
        }
    }
}

describe('程序化 mesh 生命周期（happy-dom，无渲染器）', () => {
    let engine: NullEngine;
    let scene: Scene;

    beforeEach(() => {
        engine = new NullEngine();
        scene = new Scene(engine);
    });

    afterEach(() => {
        scene.dispose();
        engine.dispose();
    });

    it('createTestMesh 增加 meshCount', () => {
        const before = scene.meshes.length;
        createTestMesh(scene);
        expect(scene.meshes.length).toBeGreaterThan(before);
    });

    it('clearTestMeshes 移除 seed meshes（meshCount 回落）', () => {
        createTestMesh(scene);
        const afterCreate = scene.meshes.length;
        expect(afterCreate).toBeGreaterThan(0);
        clearTestMeshes(scene);
        expect(scene.meshes.length).toBeLessThan(afterCreate);
    });
});
