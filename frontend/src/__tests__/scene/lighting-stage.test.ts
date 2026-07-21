// lighting-stage.test.ts — 舞台灯生命周期单测（NullEngine 真实驱动）
//
// 覆盖收口后的 `_registerStageLight` / `_disposeStageLightEntry`：
//   1. addStageLight 真实创建 Babylon 灯并注册进场景（_registerStageLight）
//   2. removeStageLight 真实释放该灯（_disposeStageLightEntry），无 Babylon 泄漏
//   3. removeStageLight 拒绝删除最后一盏灯（防空状态）
//   4. loadStageLights 清空旧灯后精确重建（复用两个 helper）
//   5. disposeLighting 级联释放全部舞台灯
//
// lighting.ts L36 从 './performance' 导入（经 '../scene' 触发模块级 new Scene），
// 故 mock './performance' 断链；gizmo/transform-adapter 桩为 no-op 聚焦舞台灯生命周期。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';

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
    getGizmoTargetId: () => null,
}));

import {
    initLighting,
    addStageLight,
    removeStageLight,
    loadStageLights,
    disposeLighting,
    getStageLights,
    getActiveStageLightId,
} from '../../scene/render/lighting';

let engine: NullEngine;
let scene: Scene;
let saveCalls: number;

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    saveCalls = 0;
    initLighting(scene, { generator: null }, () => {
        saveCalls++;
    });
});

afterEach(() => {
    disposeLighting();
    scene.dispose();
    engine.dispose();
});

describe('舞台灯生命周期（_registerStageLight / _disposeStageLightEntry 收口）', () => {
    it('初始化后存在 1 盏默认主光', () => {
        expect(getStageLights()).toHaveLength(1);
        expect(getActiveStageLightId()).toBeTruthy();
    });

    it('addStageLight 真实创建 Babylon 灯并注册进场景', () => {
        const lightsBefore = scene.lights.length; // hemi + dir + 默认主光
        saveCalls = 0;
        const id = addStageLight('spot');

        expect(getStageLights()).toHaveLength(2);
        // 新增的 SpotLight 真实进入场景
        expect(scene.lights.length).toBe(lightsBefore + 1);
        expect(scene.lights.some((l) => !l.isDisposed() && l.name === id)).toBe(true);
        // 变更触发自动保存回调
        expect(saveCalls).toBeGreaterThan(0);
    });

    it('removeStageLight 真实释放该灯，无 Babylon 泄漏', () => {
        const id = addStageLight('spot');
        const target = scene.lights.find((l) => l.name === id);
        expect(target).toBeTruthy();
        const lightsBefore = scene.lights.length;

        const ok = removeStageLight(id);

        expect(ok).toBe(true);
        expect(getStageLights()).toHaveLength(1);
        // _disposeStageLightEntry 必须真实 dispose 灯对象（释放配对）
        expect(target!.isDisposed()).toBe(true);
        expect(scene.lights.length).toBe(lightsBefore - 1);
        expect(scene.lights.some((l) => l.name === id)).toBe(false);
    });

    it('removeStageLight 拒绝删除最后一盏灯（防空状态）', () => {
        // 当前仅 1 盏默认主光
        const only = getStageLights()[0];
        const ok = removeStageLight(only.id);

        expect(ok).toBe(false);
        expect(getStageLights()).toHaveLength(1);
    });

    it('loadStageLights 清空旧灯后精确重建，旧灯被释放', () => {
        // 先加两盏，凑成 3 盏
        addStageLight('spot');
        addStageLight('point');
        const oldLights = scene.lights.filter((l) => l.name.startsWith('light-'));
        expect(getStageLights()).toHaveLength(3);

        // 重建为 2 盏
        loadStageLights([
            { ...getStageLights()[0], id: 'light-1', name: 'A' },
            { ...getStageLights()[0], id: 'light-2', name: 'B' },
        ]);

        expect(getStageLights()).toHaveLength(2);
        // 旧灯对象已全部释放（_disposeStageLightEntry 级联）
        for (const l of oldLights) {
            expect(l.isDisposed()).toBe(true);
        }
    });

    it('disposeLighting 级联释放全部舞台灯', () => {
        addStageLight('spot');
        const stageLightObjs = scene.lights.filter((l) => l.name.startsWith('light-'));
        expect(stageLightObjs.length).toBeGreaterThanOrEqual(2);

        disposeLighting();

        // 所有舞台灯对象已释放，注册表清空
        for (const l of stageLightObjs) {
            expect(l.isDisposed()).toBe(true);
        }
        expect(getStageLights()).toHaveLength(0);
    });
});
