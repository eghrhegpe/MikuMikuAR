// @vitest-environment node
// lighting-headless.test.ts — NullEngine 下光照模块真实初始化/就绪/释放
//
// 覆盖：
//   1. 未初始化时 isLightingReady 为 false，主灯/舞台灯为空
//   2. initLighting 在 NullEngine 下真实创建 hemi/dir 主灯 + 默认主光舞台灯
//   3. isLightingReady 与 setLightState 可写、自动保存回调同口径
//   4. disposeLighting 释放主灯并复位就绪状态（无 Babylon 资源泄漏/状态残留）
//
// 不 mock 被测模块，使用真实 NullEngine + Scene + 真实 Babylon Light/StandardMaterial；
// 与 lighting-stage.test.ts / lighting-follow.test.ts 的生命周期测试互补。

// node 环境无 localStorage，补一个让 import 链上 transform-mode.ts 顶层可正常加载
vi.hoisted(() => {
    if (typeof localStorage === 'undefined') {
        const store: Record<string, string> = {};
        Object.defineProperty(globalThis, 'localStorage', {
            value: {
                getItem: (k: string) => store[k] ?? null,
                setItem: (k: string, v: string) => { store[k] = v; },
                removeItem: (k: string) => { delete store[k]; },
                clear: () => { for (const k in store) delete store[k]; },
            },
            writable: true,
            configurable: true,
        });
    }
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import {
    initLighting,
    disposeLighting,
    isLightingReady,
    getHemiLight,
    getDirLight,
    getLightState,
    getStageLights,
    setLightState,
} from '../scene/render/lighting';
import { lightingState } from '../scene/render/lighting-state';

describe('光照 headless/NullEngine 初始化与释放', () => {
    let engine: NullEngine;
    let scene: Scene;
    let saveCalls: number;

    beforeEach(() => {
        // node 环境无 requestAnimationFrame，补一个（用 setTimeout 调度，确保回调执行）
        if (typeof globalThis.requestAnimationFrame === 'undefined') {
            (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
                setTimeout(() => cb(0), 0);
        }
        // 防御性复位模块级单例，保证用例间无 lightingState 残留
        disposeLighting();
        engine = new NullEngine();
        scene = new Scene(engine);
        saveCalls = 0;
    });

    afterEach(() => {
        // 必须先释放灯光模块，再释放 Scene/Engine，避免 lightingState 持有已释放对象
        disposeLighting();
        scene.dispose();
        engine.dispose();
    });

    it('未初始化时 isLightingReady 为 false，且无主灯/舞台灯', () => {
        expect(isLightingReady()).toBe(false);
        expect(getHemiLight()).toBeNull();
        expect(getDirLight()).toBeNull();
        expect(getStageLights()).toHaveLength(0);
    });

    it('NullEngine 下 initLighting 后 isLightingReady 为 true 且主灯真实入场景', () => {
        initLighting(scene, { generator: null }, () => {
            saveCalls++;
        });

        expect(isLightingReady()).toBe(true);
        const hemi = getHemiLight();
        const dir = getDirLight();
        expect(hemi).not.toBeNull();
        expect(dir).not.toBeNull();
        expect(hemi!.isDisposed()).toBe(false);
        expect(dir!.isDisposed()).toBe(false);
        expect(scene.lights.some((l) => l.name === 'hemi')).toBe(true);
        expect(scene.lights.some((l) => l.name === 'dir')).toBe(true);

        // 默认主光舞台灯注册
        const stageLights = getStageLights();
        expect(stageLights).toHaveLength(1);
        expect(stageLights[0].id).toBe('light-1');
        expect(stageLights[0].name).toBe('主光');

        // getLightState 能读到主灯默认强度（envBrightness 默认 1）
        expect(getLightState().hemiIntensity).toBe(0.8);
        expect(getLightState().dirIntensity).toBe(0.4);
    });

    it('就绪后 setLightState 可写并触发自动保存回调', async () => {
        initLighting(scene, { generator: null }, () => {
            saveCalls++;
        });
        saveCalls = 0;

        const ok = setLightState({ hemiIntensity: 0.5, dirIntensity: 0.2 });

        expect(ok).toBe(true);
        expect(saveCalls).toBe(1);
        expect(getLightState().hemiIntensity).toBe(0.5);
        expect(getLightState().dirIntensity).toBe(0.2);

        // flush setLightState 内部 scheduleRefresh 排入的 rAF，避免用例结束后残留定时器
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    it('disposeLighting 释放主灯并复位 isLightingReady/stageLights', () => {
        initLighting(scene, { generator: null }, () => {
            saveCalls++;
        });
        const hemi = getHemiLight();
        const dir = getDirLight();
        expect(hemi).not.toBeNull();
        expect(dir).not.toBeNull();

        disposeLighting();

        expect(isLightingReady()).toBe(false);
        expect(getHemiLight()).toBeNull();
        expect(getDirLight()).toBeNull();
        expect(getStageLights()).toHaveLength(0);
        expect(hemi!.isDisposed()).toBe(true);
        expect(dir!.isDisposed()).toBe(true);
        // 模块级单例也应完全复位，避免残留已释放场景的外部引用
        expect(lightingState.scene).toBeNull();
        expect(lightingState.envSysShadow).toBeNull();
        expect(lightingState.triggerAutoSave).toBeNull();
    });
});
