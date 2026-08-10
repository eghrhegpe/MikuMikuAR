import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
// [fix:P1] 子代理审核：此前复制 dev-hooks 的 createTestMesh/clearTestMeshes 实现，
// 生产代码真回归抓不到。改为 import 共享模块（core/test-mesh.ts），与
// dev-hooks.ts __scene.driver 同源调用。
import { createTestMesh, clearTestMeshes, TEST_MESH_PREFIX } from '../core/test-mesh';

// ─── 程序化 mesh 生命周期（happy-dom 试点）─────────────────────────
// [fix:P1] e2e model-load.spec.ts @dom 两个测试的 vitest 等价迁移：
//   createTestMesh → meshCount 增 → clearTestMeshes → meshCount 减。
// e2e 版本走 vitePage + window.__scene.driver 全链（fixture 初始化 + NullEngine 场景），
// 本测试用真实 NullEngine + Scene 直测等价行为——证明程序化 3D 断言无浏览器可测，
// 且无 vitePage fixture 的 init()/守卫开销（~20ms vs e2e ~50s）。
// 注意：本测试是「可行性冒烟 + 共享实现回归保护」，不替代 e2e @dom（driver 桥、
// app boot、fixture 初始化等 e2e 独有环节不在此覆盖）。

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

    it('createTestMesh 增加 meshCount 且命名/材质符合契约', async () => {
        const before = scene.meshes.length;
        await createTestMesh(scene);
        expect(scene.meshes.length).toBeGreaterThan(before);
        // [fix:P2] 断言收紧：验证 e2e loadSeedModel 依赖的命名/材质契约，
        // 而非仅「多了一个 mesh」。
        const mesh = scene.getMeshByName(`${TEST_MESH_PREFIX}mesh`);
        expect(mesh).toBeTruthy();
        expect(mesh?.material?.name).toBe(`${TEST_MESH_PREFIX}mat`);
    });

    it('clearTestMeshes 移除 seed meshes（回到 before 计数）', async () => {
        const before = scene.meshes.length;
        await createTestMesh(scene);
        const afterCreate = scene.meshes.length;
        expect(afterCreate).toBeGreaterThan(before);
        clearTestMeshes(scene);
        // [fix:P2] 断言回到初始计数（此前 toBeLessThan 抓不住「删过头/删错对象」）
        expect(scene.meshes.length).toBe(before);
        expect(scene.getMeshByName(`${TEST_MESH_PREFIX}mesh`)).toBeNull();
    });
});
