// planar-reflection.test.ts — 统一平面反射引擎互斥测试（ADR-092）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

import {
    PlanarReflection,
    PlanarReflectionConfig,
    registerReflectionSurface,
    resetReflectionSurfaces,
} from '../../scene/env/planar-reflection';
import type { EnvState } from '../../core/config';

// 最小 envState 桩
function makeState(overrides: Partial<EnvState> = {}): EnvState {
    return {
        groundReflectionQuality: 'high',
        groundLevel: 0,
        planarReflectBlend: 1,
        reflectionQuality: 'high',
        waterLevel: 0,
        ...overrides,
    } as EnvState;
}

describe('PlanarReflection — 互斥协调', () => {
    let engine: NullEngine;
    let scene: Scene;
    let camera: FreeCamera;

    /** 创建简单 mock 配置（screenSpace 模式，避免 MirrorTexture 引擎依赖） */
    function makeConfig(
        name: string,
        overrides: Partial<PlanarReflectionConfig> = {}
    ): PlanarReflectionConfig {
        return {
            name,
            mode: 'screenSpace',
            resolutionMap: { high: 64, medium: 32, low: 16, off: 0 },
            getQuality: (s) => s.reflectionQuality,
            getBlend: (s) => s.planarReflectBlend,
            getSurfaceLevel: (s) => s.waterLevel,
            getMirrorCameraMatrix: (_s, _sc) => null,
            predicate: (_mesh: AbstractMesh, _level: number) => true,
            getMaterial: () => null,
            mount: () => {},
            setBlend: () => {},
            ...overrides,
        };
    }

    beforeEach(() => {
        engine = new NullEngine();
        scene = new Scene(engine);
        camera = new FreeCamera('cam', new Vector3(0, 5, 10), scene);
        scene.activeCamera = camera;
        resetReflectionSurfaces();
    });

    afterEach(() => {
        scene.dispose();
        engine.dispose();
    });

    it('创建后 isEnabled 为 true', () => {
        const ref = new PlanarReflection(makeConfig('testA'));
        ref.update(makeState({ reflectionQuality: 'high', planarReflectBlend: 1 }), scene);
        expect(ref.isEnabled).toBe(true);
    });

    it('shouldEnable=false 时 disable，isEnabled 为 false', () => {
        const ref = new PlanarReflection(makeConfig('testB'));
        ref.update(makeState({ reflectionQuality: 'high', planarReflectBlend: 1 }), scene);
        expect(ref.isEnabled).toBe(true);

        // 关闭 blend → shouldEnable=false
        ref.update(makeState({ reflectionQuality: 'high', planarReflectBlend: 0 }), scene);
        expect(ref.isEnabled).toBe(false);
    });

    it('quality=off 时 disable', () => {
        const ref = new PlanarReflection(makeConfig('testC'));
        ref.update(makeState({ reflectionQuality: 'off', planarReflectBlend: 1 }), scene);
        expect(ref.isEnabled).toBe(false);
    });

    it('两 surface 同时 shouldEnable=true 时仅一面活跃（互斥）', () => {
        const refA = new PlanarReflection(makeConfig('mutexA'));
        const refB = new PlanarReflection(makeConfig('mutexB'));
        const state = makeState({ reflectionQuality: 'high', planarReflectBlend: 1 });

        // 注册两 surface，onReleased 模拟另一面的恢复（调用 update）
        registerReflectionSurface('mutexA', refA, () => refA.update(state, scene));
        registerReflectionSurface('mutexB', refB, () => refB.update(state, scene));

        // 先激活 A
        refA.update(state, scene);
        expect(refA.isEnabled).toBe(true);
        expect(refB.isEnabled).toBe(false);

        // 激活 B → B 应获取独占，A 被停用
        refB.update(state, scene);
        expect(refB.isEnabled).toBe(true);
        expect(refA.isEnabled).toBe(false);
    });

    it('停用活跃面后另一面恢复（可恢复互斥）', () => {
        const refA = new PlanarReflection(makeConfig('recoverA'));
        const refB = new PlanarReflection(makeConfig('recoverB'));
        const state = makeState({ reflectionQuality: 'high', planarReflectBlend: 1 });

        // 注册；onReleased 调用另一面的 update() 来完成恢复
        registerReflectionSurface('recoverA', refA, () => refA.update(state, scene));
        registerReflectionSurface('recoverB', refB, () => refB.update(state, scene));

        // 激活 A
        refA.update(state, scene);
        expect(refA.isEnabled).toBe(true);

        // 激活 B → B 活跃，A 停用
        refB.update(state, scene);
        expect(refB.isEnabled).toBe(true);
        expect(refA.isEnabled).toBe(false);

        // 调试：记录 A 的状态
        const updateSpy = vi.spyOn(refA, 'update');

        // 关闭 B（shouldEnable=false）→ onReleased 应直接恢复 A
        refB.update(makeState({ reflectionQuality: 'high', planarReflectBlend: 0 }), scene);
        expect(refB.isEnabled).toBe(false);

        // 验证 spy：update 被 onReleased 调用过
        expect(updateSpy).toHaveBeenCalled();
        // onReleased 中的 refA.update() 已同步恢复
        expect(refA.isEnabled).toBe(true);

        updateSpy.mockRestore();

        // 重复调用 A.update() 确认稳定
        refA.update(state, scene);
        expect(refA.isEnabled).toBe(true);
    });

    it('setBlend 被 update 调用时传递正确的 blend 值', () => {
        const setBlendSpy = vi.fn();
        const ref = new PlanarReflection(makeConfig('blendTest', { setBlend: setBlendSpy }));
        ref.update(makeState({ reflectionQuality: 'high', planarReflectBlend: 0.7 }), scene);
        expect(setBlendSpy).toHaveBeenCalledWith(0.7);
    });

    it('blend 变化时 setBlend 收到新值', () => {
        const setBlendSpy = vi.fn();
        const ref = new PlanarReflection(makeConfig('blendChange', { setBlend: setBlendSpy }));
        ref.update(makeState({ reflectionQuality: 'high', planarReflectBlend: 1 }), scene);
        expect(setBlendSpy).toHaveBeenCalledWith(1);
        // 模拟滑块拖到 0.3
        ref.update(makeState({ reflectionQuality: 'high', planarReflectBlend: 0.3 }), scene);
        expect(setBlendSpy).toHaveBeenCalledWith(0.3);
    });

    it('setBlend 写入 reflectionTexture.level', () => {
        const mockLevel = { value: 0 };
        const mockReflectionTex = { level: 0 };
        const mockMat = {
            reflectionTexture: mockReflectionTex,
            specularColor: { r: 0, g: 0, b: 0 },
            reflectionFresnelParameters: { isEnabled: true },
        };
        const setBlendSpy = vi.fn((b: number) => {
            mockLevel.value = b;
            mockReflectionTex.level = b;
        });
        const ref = new PlanarReflection(
            makeConfig('levelTest', {
                setBlend: setBlendSpy,
                getMaterial: () => mockMat as any,
                mount: (rt: any) => {
                    (mockMat as any).reflectionTexture = rt ? mockReflectionTex : null;
                },
            })
        );
        // quality=high + blend=0.6 → 应该调用 setBlend(0.6)
        ref.update(makeState({ reflectionQuality: 'high', planarReflectBlend: 0.6 }), scene);
        expect(setBlendSpy).toHaveBeenCalledWith(0.6);
        expect(mockReflectionTex.level).toBe(0.6);
    });

    it('dispose 后 isEnabled 为 false', () => {
        const ref = new PlanarReflection(makeConfig('disposeTest'));
        ref.update(makeState({ reflectionQuality: 'high', planarReflectBlend: 1 }), scene);
        expect(ref.isEnabled).toBe(true);

        ref.dispose();
        expect(ref.isEnabled).toBe(false);
    });
});
