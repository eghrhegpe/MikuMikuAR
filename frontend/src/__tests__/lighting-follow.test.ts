// @vitest-environment node
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
import { SpotLight } from '@babylonjs/core/Lights/spotLight';

// 个人灯锥：返回带 material.setVector3 的 LightConeEntry 桩，使变更分支 entry.cone 为真
const mockCone = { material: { setVector3: vi.fn() } };

// gizmo 拖拽态需在用例内切换 → vi.hoisted 暴露可变 mock
const transformMocks = vi.hoisted(() => ({
    isGizmoDragging: vi.fn(() => false),
    getGizmoTargetId: vi.fn(() => null),
}));

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
    isGizmoDragging: transformMocks.isGizmoDragging,
    getGizmoTargetId: transformMocks.getGizmoTargetId,
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
    setPersonalLightState,
    getPersonalLightState,
    disposeAllPersonalLights,
    tickStageLightFollow,
    setPersonalLightDefault,
    getPersonalLightDefault,
    resetPersonalLightDefault,
    getAllPersonalLights,
    restorePersonalLights,
    DEFAULT_PERSONAL_LIGHT,
} from '../scene/render/lighting-follow';
import { updateLightConeTransform } from '../scene/render/light-cone';
import { lightingState } from '../scene/render/lighting-state';
import type { StageLightEntry } from '../scene/render/lighting-state';
import { modelRegistry } from '@/core/config';

let engine: NullEngine;
let scene: Scene;

/** 注册最小模型桩到 registry，返回 rootMesh */
function registerModel(modelId: string, opts?: { mmdModel?: unknown }): Mesh {
    const root = new Mesh(`root_${modelId}`, scene);
    (modelRegistry as Map<string, unknown>).set(modelId, {
        rootMesh: root,
        meshes: [new Mesh(`m_${modelId}`, scene)],
        mmdModel: opts?.mmdModel,
    });
    return root;
}

function unregisterModel(modelId: string): void {
    (modelRegistry as Map<string, unknown>).delete(modelId);
}

function findPersonalLight(modelId: string): SpotLight {
    const light = scene.lights.find((l) => l.name === `personalLight_${modelId}`);
    expect(light).toBeDefined();
    return light as SpotLight;
}

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    initLighting(scene, { generator: null }, () => {});
    vi.clearAllMocks();
    transformMocks.isGizmoDragging.mockReturnValue(false);
    transformMocks.getGizmoTargetId.mockReturnValue(null);
});

afterEach(() => {
    disposeLighting();
    scene.dispose();
    engine.dispose();
});

describe('tickPersonalLights — 个人灯锥 u_cameraPos 同步 (fix P2)', () => {
    it('存在 activeCamera 时，每帧将相机位置写入个人灯锥 material.u_cameraPos', () => {
        const modelId = 'pl-cone-cam';
        registerModel(modelId);

        // 注入活动相机，使变更分支 cam 为真（真实 FreeCamera 自带 dispose，避免 scene.dispose 崩溃）
        scene.activeCamera = new FreeCamera('test-cam', new Vector3(3, 4, 5), scene);

        attachPersonalLight(modelId);
        tickPersonalLights();

        expect(mockCone.material.setVector3).toHaveBeenCalledWith(
            'u_cameraPos',
            expect.objectContaining({ x: 3, y: 4, z: 5 })
        );

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });

    it('无 activeCamera 时不抛错、不写 u_cameraPos（覆盖 if(cam) 假分支）', () => {
        const modelId = 'pl-cone-nocam';
        registerModel(modelId);

        // 显式置空，强制 lightingState.scene?.activeCamera 为 undefined
        (lightingState.scene as Scene).activeCamera = null;

        attachPersonalLight(modelId);
        expect(() => tickPersonalLights()).not.toThrow();
        expect(mockCone.material.setVector3).not.toHaveBeenCalled();

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });
});

describe('attachPersonalLight — 幂等与守卫', () => {
    it('重复 attach 同一 modelId 幂等，不重复创建灯', () => {
        const modelId = 'pl-idem';
        registerModel(modelId);

        attachPersonalLight(modelId);
        attachPersonalLight(modelId);

        const lights = scene.lights.filter((l) => l.name === `personalLight_${modelId}`);
        expect(lights).toHaveLength(1);

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });

    it('model 不存在于 registry 时静默返回，不创建灯', () => {
        attachPersonalLight('pl-ghost');

        expect(scene.lights.some((l) => l.name === 'personalLight_pl-ghost')).toBe(false);
        expect(getPersonalLightState('pl-ghost')).toBeNull();
    });

    it('overrides 合并到默认设置（intensity / height / coneEnabled=false）', () => {
        const modelId = 'pl-override';
        registerModel(modelId);

        attachPersonalLight(modelId, { intensity: 3, height: 20, coneEnabled: false });

        const light = findPersonalLight(modelId);
        expect(light.intensity).toBe(3);
        expect(light.position.y).toBeCloseTo(20, 5); // startPos = basePos(0) + height

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });

    it('mmdModel 带腰骨候选时解析 waistName，基准点取骨骼世界坐标而非根节点原点', () => {
        const modelId = 'pl-waist';
        // 构造一个列主序单位矩阵，平移列 (x=30, y=10, z=0) → 即腰骨世界坐标
        const wm = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            30, 10, 0, 1,
        ]);
        registerModel(modelId, {
            mmdModel: { runtimeBones: [{ name: 'Waist', worldMatrix: wm }] },
        });

        attachPersonalLight(modelId); // boneName=null → 自动匹配 Waist

        // 基准点 = 腰骨 (30,10,0) + height 35 → 灯在 (30, 45, 0)
        const light = findPersonalLight(modelId);
        expect(light.position.x).toBeCloseTo(30, 5);
        expect(light.position.y).toBeCloseTo(45, 5);
        expect(light.position.z).toBeCloseTo(0, 5);

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });
});

describe('tickPersonalLights — 跟随与跳过分支', () => {
    it('settings.enabled=false 时跳过该灯（不写 u_cameraPos、不动位置）', () => {
        const modelId = 'pl-disabled';
        registerModel(modelId);
        scene.activeCamera = new FreeCamera('test-cam', new Vector3(1, 2, 3), scene);

        attachPersonalLight(modelId, { enabled: false });
        expect(findPersonalLight(modelId).intensity).toBe(0);

        tickPersonalLights();
        expect(mockCone.material.setVector3).not.toHaveBeenCalled();
        expect(updateLightConeTransform).not.toHaveBeenCalled();

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });

    it('gizmo 拖拽该灯时跳过 tick（不写 u_cameraPos），拖拽结束恢复跟随', () => {
        const modelId = 'pl-gizmo';
        registerModel(modelId);
        scene.activeCamera = new FreeCamera('test-cam', new Vector3(1, 2, 3), scene);

        attachPersonalLight(modelId);

        transformMocks.isGizmoDragging.mockReturnValue(true);
        transformMocks.getGizmoTargetId.mockReturnValue(modelId);
        tickPersonalLights();
        expect(mockCone.material.setVector3).not.toHaveBeenCalled();

        transformMocks.isGizmoDragging.mockReturnValue(false);
        transformMocks.getGizmoTargetId.mockReturnValue(null);
        tickPersonalLights();
        expect(mockCone.material.setVector3).toHaveBeenCalledWith(
            'u_cameraPos',
            expect.objectContaining({ x: 1, y: 2, z: 3 })
        );

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });

    it('模型从 registry 移除后 tick 不抛错（continue 分支）', () => {
        const modelId = 'pl-gone';
        registerModel(modelId);
        attachPersonalLight(modelId);
        unregisterModel(modelId); // attach 之后模型被卸载

        expect(() => tickPersonalLights()).not.toThrow();
        expect(mockCone.material.setVector3).not.toHaveBeenCalled();

        detachPersonalLight(modelId);
    });

    it('灯位置每帧朝目标平滑插值（LerpToRef 收敛，不会瞬移）', () => {
        const modelId = 'pl-lerp';
        const root = registerModel(modelId);
        scene.activeCamera = new FreeCamera('test-cam', new Vector3(0, 0, 0), scene);

        attachPersonalLight(modelId); // height=35 → 目标 (0,35,0)，currentPos 初始即目标
        const light = findPersonalLight(modelId);
        expect(light.position.y).toBeCloseTo(35, 5);

        // 根节点瞬移到 x=100：目标变为 (100,35,0)，灯应逐帧逼近而非跳变
        root.position = new Vector3(100, 0, 0);
        tickPersonalLights();
        expect(light.position.x).toBeCloseTo(15, 5); // 100 * 0.15
        tickPersonalLights();
        expect(light.position.x).toBeCloseTo(15 + 85 * 0.15, 5); // 27.75
        expect(light.position.x).toBeLessThan(100);

        // light.setDirectionToTarget(basePos) 仍指向根节点
        expect(light.direction.x).toBeGreaterThan(0);

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });

    it('cone 为 null（coneEnabled=false）时 tick 不抛错', () => {
        const modelId = 'pl-nocone';
        registerModel(modelId);
        scene.activeCamera = new FreeCamera('test-cam', new Vector3(1, 1, 1), scene);

        attachPersonalLight(modelId, { coneEnabled: false });
        expect(() => tickPersonalLights()).not.toThrow();
        expect(mockCone.material.setVector3).not.toHaveBeenCalled();

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });
});

describe('setPersonalLightState / getPersonalLightState', () => {
    it('setPersonalLightState 同步 intensity/color/angle/range 到灯', () => {
        const modelId = 'pl-setstate';
        registerModel(modelId);

        attachPersonalLight(modelId, { intensity: 1, color: [1, 1, 1], angle: 0.7, height: 35 });
        const light = findPersonalLight(modelId);

        setPersonalLightState(modelId, { intensity: 2.5, color: [1, 0, 0], angle: 0.3, height: 40 });
        expect(light.intensity).toBe(2.5);
        expect(light.diffuse.r).toBeCloseTo(1, 5);
        expect(light.diffuse.g).toBeCloseTo(0, 5);
        expect(light.angle).toBeCloseTo(0.3, 5);
        expect(light.range).toBeCloseTo(120, 5); // height*3

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });

    it('setPersonalLightState 对不存在的 modelId 静默', () => {
        expect(() => setPersonalLightState('pl-nope', { intensity: 9 })).not.toThrow();
        expect(getPersonalLightState('pl-nope')).toBeNull();
    });

    it('getPersonalLightState 返回当前设置副本，detach 后为 null', () => {
        const modelId = 'pl-get';
        registerModel(modelId);
        attachPersonalLight(modelId, { intensity: 2 });

        const state = getPersonalLightState(modelId);
        expect(state?.intensity).toBe(2);

        detachPersonalLight(modelId);
        expect(getPersonalLightState(modelId)).toBeNull();
        unregisterModel(modelId);
    });

    it('getPersonalLightState 返回副本，修改返回值不影响内部状态（避免绕过 setPersonalLightState 同步）', () => {
        const modelId = 'pl-get-copy';
        registerModel(modelId);
        attachPersonalLight(modelId, { intensity: 2, height: 20 });

        const snapshot = getPersonalLightState(modelId)!;
        snapshot.intensity = 999;
        snapshot.height = 999;
        snapshot.color = [0, 0, 0];

        // 内部状态不受外部误改影响
        const fresh = getPersonalLightState(modelId)!;
        expect(fresh.intensity).toBe(2);
        expect(fresh.height).toBe(20);
        expect(fresh.color).toEqual([1, 1, 1]);

        // 灯对象也未受影响（未走 setPersonalLightState 的同步）
        const light = findPersonalLight(modelId);
        expect(light.intensity).toBe(2);

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });

    it('boneName 变更后重新解析 waistName，基准点切换到新骨骼（含改回 null 重匹配腰骨）', () => {
        const modelId = 'pl-bonechange';
        const wmWaist = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 5, 0, 1]);
        const wmHead = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 50, 0, 1]);
        registerModel(modelId, {
            mmdModel: {
                runtimeBones: [
                    { name: 'Waist', worldMatrix: wmWaist },
                    { name: 'Head', worldMatrix: wmHead },
                ],
            },
        });

        // boneName=null → attach 时自动匹配腰骨候选 Waist，灯在 (10, 5+35, 0)
        attachPersonalLight(modelId);
        expect(findPersonalLight(modelId).position.y).toBeCloseTo(40, 5);

        // 指定跟随 Head → 重新解析 waistName，indicator 直接跳到新基准点 (10, 85, 0)
        setPersonalLightState(modelId, { boneName: 'Head' });
        const indicator = scene.getMeshByName('personalLightIndicator')!;
        expect(indicator.position.y).toBeCloseTo(85, 5);

        // tick 一帧：灯从 (10,40) 朝 (10,85) 平滑移动（0.15 → y=46.75），未瞬移
        tickPersonalLights();
        const light = findPersonalLight(modelId);
        expect(light.position.y).toBeCloseTo(40 + 45 * 0.15, 5);
        expect(light.position.y).toBeLessThan(85);

        // boneName 改回 null → 重新匹配腰骨候选 Waist，灯朝 (10,40) 收敛
        setPersonalLightState(modelId, { boneName: null });
        tickPersonalLights();
        expect(light.position.y).toBeLessThan(46.75);
        expect(light.position.y).toBeGreaterThan(40);

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });
});

describe('detachPersonalLight / disposeAllPersonalLights — 释放', () => {
    it('detach 释放灯，scene.lights 中不再有该灯', () => {
        const modelId = 'pl-detach';
        registerModel(modelId);
        attachPersonalLight(modelId);
        expect(findPersonalLight(modelId)).toBeDefined();

        detachPersonalLight(modelId);
        expect(scene.lights.some((l) => l.name === `personalLight_${modelId}`)).toBe(false);

        // 重复 detach 幂等
        expect(() => detachPersonalLight(modelId)).not.toThrow();
        unregisterModel(modelId);
    });

    it('disposeAllPersonalLights 清空全部个人灯', () => {
        registerModel('pl-a');
        registerModel('pl-b');
        attachPersonalLight('pl-a');
        attachPersonalLight('pl-b');
        expect(scene.lights.filter((l) => l.name.startsWith('personalLight_')).length).toBe(2);

        disposeAllPersonalLights();
        expect(scene.lights.filter((l) => l.name.startsWith('personalLight_')).length).toBe(0);

        unregisterModel('pl-a');
        unregisterModel('pl-b');
    });
});

describe('tickStageLightFollow — 舞台灯追光 (ADR-168)', () => {
    function makeStageEntry(
        id: string,
        followTarget: StageLightEntry['state']['followTarget']
    ): { entry: StageLightEntry; light: SpotLight } {
        const light = new SpotLight(
            `stage_${id}`,
            new Vector3(0, 35, 0),
            new Vector3(0, -1, 0),
            0.8,
            2,
            scene
        );
        const state = {
            id,
            name: id,
            enabled: true,
            type: 'spot' as const,
            intensity: 1,
            color: [1, 1, 1] as [number, number, number],
            angle: 0.8,
            exponent: 2,
            range: 50,
            shadowEnabled: false,
            shadowType: 'soft' as const,
            shadowResolution: 512,
            shadowBias: 0.001,
            posX: 0,
            posY: 35,
            posZ: 0,
            targetX: 0,
            targetY: 0,
            targetZ: 0,
            orbitAzimuth: 0,
            orbitElevation: 0,
            orbitDistance: 35,
            indicatorScale: 1,
            indicatorOpacity: 1,
            coneEnabled: false,
            coneIntensity: 0.5,
            coneLength: 30,
            coneSoftness: 0.5,
            followTarget,
        };
        const entry: StageLightEntry = { state, light, indicator: null, dirLine: null };
        lightingState.stageLights.set(id, entry);
        return { entry, light };
    }

    it('moveWithTarget=true 时灯位置按 smoothed 帧间位移移动（不飞向 target）', () => {
        const modelId = 'st-follow';
        registerModel(modelId);
        const root = scene.getMeshByName(`root_${modelId}`)!;
        root.position = new Vector3(100, 0, 0);

        const { light } = makeStageEntry('st-follow-1', {
            modelId,
            boneName: null,
            offset: [0, 0, 0],
            smoothing: 0.15,
            moveWithTarget: true,
            cachedWaistBone: null,
        });

        tickStageLightFollow();
        // smoothed target = 100*0.15 = 15；灯位置 = 原位置(0,35,0) + (15-0) = (15,35,0)
        expect(light.position.x).toBeCloseTo(15, 5);

        tickStageLightFollow();
        // smoothed = 15 + 85*0.15 = 27.75；灯位置 += (27.75-15)
        expect(light.position.x).toBeCloseTo(27.75, 5);
        // 关键：不飞向 target（老 bug 会一帧飞到 100）
        expect(light.position.x).toBeLessThan(100);

        lightingState.stageLights.delete('st-follow-1');
        light.dispose();
        unregisterModel(modelId);
    });

    it('boneName=null 且 mmdModel 匹配腰骨时，缓存 cachedWaistBone 供后续帧复用', () => {
        const modelId = 'st-waist';
        const wm = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            30, 10, 0, 1,
        ]);
        registerModel(modelId, {
            mmdModel: { runtimeBones: [{ name: 'Waist', worldMatrix: wm }] },
        });

        const { entry, light } = makeStageEntry('st-waist-1', {
            modelId,
            boneName: null,
            offset: [0, 0, 0],
            smoothing: 1, // 1 = 一帧到位，便于断言目标点
            moveWithTarget: false,
            cachedWaistBone: null,
        });

        tickStageLightFollow();
        // 首次 tick 应自动匹配并缓存 Waist
        expect(entry.state.followTarget?.cachedWaistBone).toBe('Waist');
        // 灯在 (0,35,0) 上方，方向指向腰骨世界坐标 (30,10,0)：x 正向、y 向下（负）
        expect(light.direction.x).toBeGreaterThan(0.5);
        expect(light.direction.y).toBeLessThan(0);

        lightingState.stageLights.delete('st-waist-1');
        light.dispose();
        unregisterModel(modelId);
    });

    it('followTarget=null 或 model 不存在时跳过，不抛错', () => {
        const modelId = 'st-ghost';
        registerModel(modelId);

        // followTarget=null
        const { light: l1 } = makeStageEntry('st-null', null);
        // model 不存在
        const { light: l2 } = makeStageEntry('st-missing', {
            modelId: 'pl-not-exist',
            boneName: null,
            offset: [0, 0, 0],
            smoothing: 0.15,
            moveWithTarget: false,
            cachedWaistBone: null,
        });

        expect(() => tickStageLightFollow()).not.toThrow();
        expect(l1.position.x).toBe(0);
        expect(l2.position.x).toBe(0);

        lightingState.stageLights.delete('st-null');
        lightingState.stageLights.delete('st-missing');
        l1.dispose();
        l2.dispose();
        unregisterModel(modelId);
    });
});

describe('个人灯默认值持久化 (localStorage)', () => {
    afterEach(() => resetPersonalLightDefault());

    it('set/get/reset 默认值往返，reset 后回 null 并清除 localStorage', () => {
        setPersonalLightDefault({ ...DEFAULT_PERSONAL_LIGHT, intensity: 5 });
        expect(getPersonalLightDefault()?.intensity).toBe(5);
        expect(localStorage.getItem('miku.personalLightDefault')).not.toBeNull();

        resetPersonalLightDefault();
        expect(getPersonalLightDefault()).toBeNull();
        expect(localStorage.getItem('miku.personalLightDefault')).toBeNull();
    });

    it('getPersonalLightDefault 返回副本，修改返回值不影响内部状态', () => {
        setPersonalLightDefault({ ...DEFAULT_PERSONAL_LIGHT, intensity: 5 });
        const snapshot = getPersonalLightDefault()!;
        snapshot.intensity = 999;
        expect(getPersonalLightDefault()?.intensity).toBe(5);
    });

    it('attach 新灯使用用户保存的默认值（无 overrides 时）', () => {
        const modelId = 'pl-default-user';
        registerModel(modelId);
        setPersonalLightDefault({ ...DEFAULT_PERSONAL_LIGHT, intensity: 7, height: 20 });

        attachPersonalLight(modelId);
        const light = findPersonalLight(modelId);
        expect(light.intensity).toBe(7);
        expect(light.position.y).toBeCloseTo(20, 5); // basePos(0) + height 20

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });
});

describe('getAllPersonalLights / restorePersonalLights — 序列化往返 (ADR-168)', () => {
    it('attach 的设置可导出，重挂丢失后 restore 恢复（含 intensity/height/color）', () => {
        const modelId = 'pl-serialize';
        registerModel(modelId);
        attachPersonalLight(modelId, { intensity: 3, height: 20, color: [1, 0, 0] });

        const snapshot = getAllPersonalLights();
        expect(snapshot).toHaveLength(1);
        expect(snapshot[0].modelId).toBe(modelId);
        expect(snapshot[0].settings.intensity).toBe(3);

        // 卸载重挂：设置回默认（intensity 1.2）
        detachPersonalLight(modelId);
        attachPersonalLight(modelId);
        expect(findPersonalLight(modelId).intensity).not.toBe(3);

        // restore 仅覆盖已有条目：intensity / range(height*3) / color 全部恢复
        restorePersonalLights(snapshot);
        const light = findPersonalLight(modelId);
        expect(light.intensity).toBe(3);
        expect(light.range).toBeCloseTo(60, 5);
        expect(light.diffuse.g).toBeCloseTo(0, 5); // [1,0,0] 覆盖默认 [1,1,1]

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });

    it('restorePersonalLights 对未 attach 的 modelId 静默跳过', () => {
        restorePersonalLights([{ modelId: 'pl-never-attached', settings: { intensity: 9 } }]);
        expect(getPersonalLightState('pl-never-attached')).toBeNull();
    });

    it('getAllPersonalLights 返回浅拷贝，修改导出值不影响内部状态', () => {
        const modelId = 'pl-serialize-copy';
        registerModel(modelId);
        attachPersonalLight(modelId, { intensity: 3 });

        const snapshot = getAllPersonalLights();
        snapshot[0].settings.intensity = 999;
        expect(getPersonalLightState(modelId)?.intensity).toBe(3);

        detachPersonalLight(modelId);
        unregisterModel(modelId);
    });
});
