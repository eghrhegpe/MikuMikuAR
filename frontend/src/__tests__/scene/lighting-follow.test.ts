// lighting-follow.test.ts — ADR-168 个人灯 + 舞台灯追光核心逻辑测试
//
// 覆盖：
//   1. DEFAULT_PERSONAL_LIGHT 默认值完整性（含 boneName）
//   2. PersonalLightSettings.boneName 字段存在性
//   3. getAllPersonalLights / restorePersonalLights 序列化往返
//   4. tickStageLightFollow 对 followTarget 的平滑插值
//   5. StageLightState.followTarget 默认 null（向后兼容）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';

vi.mock('../../scene/render/performance', () => ({
    resetPerformanceSnapshot: () => {},
    isSnapshotResetSuppressed: () => false,
}));
vi.mock('../../scene/render/transform-gizmo', () => ({
    initTransformGizmo: () => {},
}));
vi.mock('../../scene/transform/transform-adapter', () => ({
    registerTransformAdapter: () => {},
    attachGizmoForKind: () => {},
    isGizmoActive: () => false,
    isGizmoDragging: () => false,
    getGizmoTargetId: () => null,
}));
vi.mock('../../physics/physics-bridge', () => ({
    getBoneWorldPosition: () => null,
}));
vi.mock('../../scene/render/light-cone', () => ({
    createLightCone: () => null,
    updateLightConeTransform: () => {},
    updateLightConeUniforms: () => {},
    rebuildLightConeGeometry: () => {},
    setLightConeEnabled: () => {},
    disposeLightCone: () => {},
}));

import {
    initLighting,
    disposeLighting,
    getStageLights,
    _defaultStageLightState,
} from '../../scene/render/lighting';
import {
    DEFAULT_PERSONAL_LIGHT,
    attachPersonalLight,
    detachPersonalLight,
    setPersonalLightState,
    getPersonalLightState,
    getAllPersonalLights,
    restorePersonalLights,
    tickStageLightFollow,
    type PersonalLightSettings,
} from '../../scene/render/lighting-follow';
import { lightingState } from '../../scene/render/lighting-state';
import { modelRegistry } from '@/core/config';

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    initLighting(scene, { generator: null }, () => {});
});

afterEach(() => {
    disposeLighting();
    scene.dispose();
    engine.dispose();
});

describe('PersonalLightSettings 默认值', () => {
    it('DEFAULT_PERSONAL_LIGHT 包含 boneName: null', () => {
        expect(DEFAULT_PERSONAL_LIGHT.boneName).toBeNull();
    });

    it('DEFAULT_PERSONAL_LIGHT 包含所有必要字段', () => {
        const keys: (keyof PersonalLightSettings)[] = [
            'enabled',
            'intensity',
            'color',
            'angle',
            'height',
            'offsetX',
            'offsetZ',
            'coneEnabled',
            'coneIntensity',
            'coneLength',
            'coneSoftness',
            'boneName',
            'shadowEnabled',
            'shadowResolution',
        ];
        for (const k of keys) {
            expect(DEFAULT_PERSONAL_LIGHT).toHaveProperty(k);
        }
    });
});

describe('StageLightState.followTarget 向后兼容', () => {
    it('_defaultStageLightState 返回 followTarget: null', () => {
        const def = _defaultStageLightState('test-light', '测试灯');
        expect(def.followTarget).toBeNull();
    });

    it('getStageLights 返回的灯光 followTarget 默认为 null', () => {
        const lights = getStageLights();
        expect(lights.length).toBeGreaterThan(0);
        for (const l of lights) {
            expect(l.followTarget).toBeNull();
        }
    });
});

describe('getAllPersonalLights / restorePersonalLights', () => {
    it('无个人灯时 getAllPersonalLights 返回空数组', () => {
        const result = getAllPersonalLights();
        expect(result).toEqual([]);
    });

    it('restorePersonalLights 对不存在的 modelId 静默跳过', () => {
        // 不应抛异常
        expect(() => {
            restorePersonalLights([{ modelId: 'nonexistent', settings: { intensity: 2 } }]);
        }).not.toThrow();
    });
});

describe('tickStageLightFollow', () => {
    it('无 followTarget 时 tick 不修改 target', () => {
        const before = getStageLights()[0];
        const tx = before.targetX;
        const ty = before.targetY;
        const tz = before.targetZ;
        tickStageLightFollow();
        const after = getStageLights()[0];
        expect(after.targetX).toBe(tx);
        expect(after.targetY).toBe(ty);
        expect(after.targetZ).toBe(tz);
    });

    it('followTarget 指向不存在的模型时静默跳过', () => {
        const lights = getStageLights();
        const id = lights[0].id;
        // 直接修改内部 state 设置 followTarget
        const entry = lightingState.stageLights.get(id);
        if (entry) {
            entry.state.followTarget = {
                modelId: 'ghost-model',
                boneName: null,
                offset: [0, 0, 0],
                smoothing: 0.15,
                moveWithTarget: false,
                cachedWaistBone: null,
            };
        }
        const before = getStageLights()[0];
        const tx = before.targetX;
        // 不应抛异常，target 不变
        expect(() => tickStageLightFollow()).not.toThrow();
        const after = getStageLights()[0];
        expect(after.targetX).toBe(tx);
    });
});

describe('PersonalLight 阴影开关', () => {
    function _fakeModel(id: string) {
        return {
            rootMesh: new Mesh(`root_${id}`, scene),
            meshes: [new Mesh(`m_${id}`, scene)],
            mmdModel: undefined,
        };
    }

    it('DEFAULT_PERSONAL_LIGHT 默认 shadowEnabled=true / shadowResolution=512', () => {
        expect(DEFAULT_PERSONAL_LIGHT.shadowEnabled).toBe(true);
        expect(DEFAULT_PERSONAL_LIGHT.shadowResolution).toBe(512);
    });

    it('attach 默认开启阴影；切换 shadowEnabled 不抛错且 settings 同步', () => {
        const modelId = 'test-pl-shadow';
        (modelRegistry as Map<string, unknown>).set(modelId, _fakeModel(modelId));

        attachPersonalLight(modelId);
        expect(getPersonalLightState(modelId)?.shadowEnabled).toBe(true);

        expect(() => setPersonalLightState(modelId, { shadowEnabled: false })).not.toThrow();
        expect(getPersonalLightState(modelId)?.shadowEnabled).toBe(false);

        expect(() => setPersonalLightState(modelId, { shadowEnabled: true })).not.toThrow();
        expect(getPersonalLightState(modelId)?.shadowEnabled).toBe(true);

        detachPersonalLight(modelId);
        (modelRegistry as Map<string, unknown>).delete(modelId);
    });

    it('shadowResolution 变化触发重建且不抛错', () => {
        const modelId = 'test-pl-res';
        (modelRegistry as Map<string, unknown>).set(modelId, _fakeModel(modelId));

        attachPersonalLight(modelId);
        expect(() => setPersonalLightState(modelId, { shadowResolution: 1024 })).not.toThrow();
        expect(getPersonalLightState(modelId)?.shadowResolution).toBe(1024);

        detachPersonalLight(modelId);
        (modelRegistry as Map<string, unknown>).delete(modelId);
    });
});
