// @vitest-environment node
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
        const beforeMaterials = scene.materials.length;
        await createTestMesh(scene);
        expect(scene.meshes.length).toBeGreaterThan(before);
        // [fix:P2] 断言收紧：验证 e2e loadSeedModel 依赖的命名/材质契约，
        // 而非仅「多了一个 mesh」。
        const mesh = scene.getMeshByName(`${TEST_MESH_PREFIX}mesh`);
        expect(mesh).toBeTruthy();
        expect(mesh?.material?.name).toBe(`${TEST_MESH_PREFIX}mat`);
        // 每次 create 应且只应新增一个程序化 material；防止 material 泄漏。
        expect(scene.materials.length).toBe(beforeMaterials + 1);
        // [fix:P3] 子代理审核：diffuseColor 红色通道是 applyOutfit 换装断言的
        // 视觉锚点（指纹亮度变化依赖），补断言保护 Color3 构造不被意外破坏。
        const c = (mesh?.material as { diffuseColor?: { r: number } } | undefined)?.diffuseColor;
        expect(c?.r).toBe(1);
    });

    it('clearTestMeshes 移除 seed meshes（回到 before 计数）', async () => {
        const before = scene.meshes.length;
        const beforeMaterials = scene.materials.length;
        await createTestMesh(scene);
        const afterCreate = scene.meshes.length;
        expect(afterCreate).toBeGreaterThan(before);
        expect(scene.materials.length).toBe(beforeMaterials + 1);
        clearTestMeshes(scene);
        // [fix:P2] 断言回到初始计数（此前 toBeLessThan 抓不住「删过头/删错对象」）
        expect(scene.meshes.length).toBe(before);
        expect(scene.getMeshByName(`${TEST_MESH_PREFIX}mesh`)).toBeNull();
        // [fix:P2] 资源释放：clear 不仅要删 mesh，还要释放对应 material，
        // 否则长跑 E2E 反复 create/clear 会持续累积 scene.materials。
        expect(scene.materials.length).toBe(beforeMaterials);
    });

    it('幂等性：clear 后再 createTestMesh 仍正常（无残留 disposed mesh/material 干扰）', async () => {
        // [fix:P3] 子代理审核：createTestMesh 内部有「先清理旧 test mesh」逻辑，
        // clear 后若遗留 disposed mesh 在 scene.meshes 会污染下一次 create。
        const beforeMaterials = scene.materials.length;
        await createTestMesh(scene);
        expect(scene.materials.length).toBe(beforeMaterials + 1);
        clearTestMeshes(scene);
        expect(scene.materials.length).toBe(beforeMaterials);
        await createTestMesh(scene);
        expect(scene.getMeshByName(`${TEST_MESH_PREFIX}mesh`)).toBeTruthy();
        // create 自身清理也应释放旧 material，重复调用不得累积资源。
        expect(scene.meshes.filter((m) => m.name.startsWith(TEST_MESH_PREFIX)).length).toBe(1);
        expect(scene.materials.length).toBe(beforeMaterials + 1);
    });
});
