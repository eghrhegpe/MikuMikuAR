// lighting-follow.test.ts — 覆盖 fix P2 变更行：
//   tickPersonalLights 中个人灯锥每帧同步相机位置：
//     const cam = lightingState.scene?.activeCamera;
//     if (cam) { entry.cone.material.setVector3('u_cameraPos', cam.position); }
//   此前个人灯锥的 Fresnel 永远用默认 (0,0,0) 相机位置，边缘辉光方向恒定指向世界原点。
//
// 复用 scene/lighting-follow.test.ts 已验证的 NullEngine + 真实 Scene 范式（attachPersonalLight
// 真实建灯/锥），仅将 light-cone 的 createLightCone 改为返回带 material.setVector3 的锥对象，
// 并注入 scene.activeCamera 让变更分支命中。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';

// 个人灯锥：返回带 material.setVector3 的 LightConeEntry 桩，使变更分支 entry.cone 为真
const mockCone = { material: { setVector3: vi.fn() } };

vi.mock('../scene/render/performance', () => ({
    resetPerformanceSnapshot: () => {},
    isSnapshotResetSuppressed: () => false,
}));
vi.mock('../scene/render/transform-gizmo', () => ({
    initTransformGizmo: () => {},
}));
vi.mock('../scene/transform/transform-adapter', () => ({
    registerTransformAdapter: () => {},
    attachGizmoForKind: () => {},
    isGizmoActive: () => false,
    isGizmoDragging: () => false,
    getGizmoTargetId: () => null,
}));
vi.mock('@/scene/physics/physics-bridge', () => ({
    getBoneWorldPosition: () => null,
}));
vi.mock('../scene/render/light-cone', () => ({
    createLightCone: () => mockCone,
    updateLightConeTransform: vi.fn(),
    updateLightConeUniforms: () => {},
    rebuildLightConeGeometry: () => {},
    setLightConeEnabled: () => {},
    disposeLightCone: () => {},
}));

import { initLighting, disposeLighting } from '../scene/render/lighting';
import {
    attachPersonalLight,
    detachPersonalLight,
    tickPersonalLights,
} from '../scene/render/lighting-follow';
import { lightingState } from '../scene/render/lighting-state';
import { modelRegistry } from '@/core/config';

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    initLighting(scene, { generator: null }, () => {});
    mockCone.material.setVector3.mockClear();
});

afterEach(() => {
    disposeLighting();
    scene.dispose();
    engine.dispose();
});

describe('tickPersonalLights — 个人灯锥 u_cameraPos 同步 (fix P2)', () => {
    it('存在 activeCamera 时，每帧将相机位置写入个人灯锥 material.u_cameraPos', () => {
        const modelId = 'pl-cone-cam';
        (modelRegistry as Map<string, unknown>).set(modelId, {
            rootMesh: new Mesh(`root_${modelId}`, scene),
            meshes: [new Mesh(`m_${modelId}`, scene)],
            mmdModel: undefined,
        });

        // 注入活动相机，使变更分支 cam 为真（真实 FreeCamera 自带 dispose，避免 scene.dispose 崩溃）
        scene.activeCamera = new FreeCamera('test-cam', new Vector3(3, 4, 5), scene);

        attachPersonalLight(modelId);
        tickPersonalLights();

        expect(mockCone.material.setVector3).toHaveBeenCalledWith(
            'u_cameraPos',
            expect.objectContaining({ x: 3, y: 4, z: 5 })
        );

        detachPersonalLight(modelId);
        (modelRegistry as Map<string, unknown>).delete(modelId);
    });

    it('无 activeCamera 时不抛错、不写 u_cameraPos（覆盖 if(cam) 假分支）', () => {
        const modelId = 'pl-cone-nocam';
        (modelRegistry as Map<string, unknown>).set(modelId, {
            rootMesh: new Mesh(`root_${modelId}`, scene),
            meshes: [new Mesh(`m_${modelId}`, scene)],
            mmdModel: undefined,
        });

        // 显式置空，强制 lightingState.scene?.activeCamera 为 undefined
        (lightingState.scene as Scene).activeCamera = null;

        attachPersonalLight(modelId);
        expect(() => tickPersonalLights()).not.toThrow();
        expect(mockCone.material.setVector3).not.toHaveBeenCalled();

        detachPersonalLight(modelId);
        (modelRegistry as Map<string, unknown>).delete(modelId);
    });
});
