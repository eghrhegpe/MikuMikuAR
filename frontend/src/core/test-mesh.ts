// test-mesh.ts — 程序化测试 mesh 工厂（E2E / 单测共用）
// [fix:P1] 子代理审核：mesh-lifecycle-headless.test.ts 此前复制 dev-hooks 的
// createTestMesh/clearTestMeshes 实现，生产代码真回归（前缀改名/dispose 逻辑变化）
// 测试抓不到——「等价迁移」名不副实。提取为共享模块，dev-hooks.ts __scene.driver
// 与单测同源调用，消灭双份实现。
// 注意：Babylon 实现在函数内动态 import（对齐 dev-hooks 原语义，避免模块加载即拉
// 渲染器链）；本模块仅 type-only import Scene，静态依赖面为零。
import type { Scene } from '@babylonjs/core/scene';

export const TEST_MESH_PREFIX = 'e2e-test-';

/** 创建程序化测试 mesh（先清理旧 e2e-test- 网格；与 dev-hooks driver 行为对齐）。 */
export async function createTestMesh(scene: Scene): Promise<void> {
    const { MeshBuilder } = await import('@babylonjs/core/Meshes/meshBuilder');
    const { StandardMaterial } = await import('@babylonjs/core/Materials/standardMaterial');
    const { Color3 } = await import('@babylonjs/core/Maths/math.color');
    // Dispose any previous test meshes first
    for (const m of [...scene.meshes]) {
        if (m.name.startsWith(TEST_MESH_PREFIX)) {
            m.dispose();
        }
    }
    const box = MeshBuilder.CreateBox(`${TEST_MESH_PREFIX}mesh`, { size: 0.5 }, scene);
    const mat = new StandardMaterial(`${TEST_MESH_PREFIX}mat`, scene);
    mat.diffuseColor = new Color3(1, 0, 0);
    box.material = mat;
}

/** 清除所有程序化测试 mesh。 */
export function clearTestMeshes(scene: Scene): void {
    for (const m of [...scene.meshes]) {
        if (m.name.startsWith(TEST_MESH_PREFIX)) {
            m.dispose();
        }
    }
}
