import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';

// 隔离 env-impl，避免其重型依赖（clouds/particles/sky 等）干扰；
// getScene 通过 globalThis 懒返回测试场景，规避 vi.mock 工厂的 TDZ 问题。
vi.mock('../../scene/env/env-impl', () => {
    const _envSys = { water: { mesh: null as any, material: null as any } };
    return {
        _envSys,
        getScene: () => (globalThis as any).__waterTestScene as Scene,
        ensureEnvUpdateObserver: () => {},
    };
});

import { _envSys } from '../../scene/env/env-impl';
import { envState } from '../../core/config';
import {
    createWater,
    disposeWater,
    updateWaterAnimSpeed,
    _applyWaterLOD,
    selectWaterLOD,
    computeWaveDirs,
    getWaterPhase,
    WATER_PRESETS,
    buildWaterPresetEnvState,
} from '../../scene/env/env-water';

let engine: NullEngine;
let scene: Scene;
let camera: FreeCamera;

// happy-dom 无真实 2D canvas；为焦散纹理生成（canvas 2D）提供最小桩，
// 使 createWater 能走完整路径而不报错。
beforeAll(() => {
    const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            createImageData: (w: number, h: number) => ({
                data: new Uint8ClampedArray(w * h * 4),
                width: w,
                height: h,
            }),
            putImageData: () => {},
        }),
        toDataURL: () => 'data:image/png;base64,',
    };
    const origCreate = document.createElement.bind(document);
    (document as any).createElement = (tag: string) =>
        tag === 'canvas' ? (fakeCanvas as any) : origCreate(tag);
});

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    camera = new FreeCamera('cam', new Vector3(0, 5, 10), scene);
    scene.activeCamera = camera;
    (globalThis as any).__waterTestScene = scene;
    _envSys.water.mesh = null;
    _envSys.water.material = null;
    disposeWater(); // 重置模块级状态（_waterPhase/_waterWaveSpeed/observer）
});

afterEach(() => {
    disposeWater();
    scene.dispose();
    engine.dispose();
    (globalThis as any).__waterTestScene = null;
});

function makeWaterState(overrides: Partial<typeof envState> = {}) {
    return { ...envState, waterEnabled: true, waterSize: 120, ...overrides };
}

function setCameraDistance(z: number) {
    camera.position.set(0, 5, z);
    camera.computeWorldMatrix();
    const high = _envSys.water.mesh;
    if (high) {
        high.computeWorldMatrix();
    }
}

// ───────────────────────── LOD 可见性（修复 HIGH-1）─────────────────────────
describe('Water LOD — 仅一层可见', () => {
    it('创建后默认仅高精度层（high）可见', () => {
        createWater(makeWaterState({ waterLevel: 0 }));
        const high = _envSys.water.mesh!;
        const mid = scene.getMeshByName('envWater_LOD1')!;
        const low = scene.getMeshByName('envWater_LOD2')!;
        const enabled = [high, mid, low].filter((m) => m.isEnabled()).length;
        expect(enabled).toBe(1);
        expect(high.isEnabled()).toBe(true);
        expect(mid.isEnabled()).toBe(false);
        expect(low.isEnabled()).toBe(false);
    });

    it('相机拉远时精确切换层级，且任意距离都恰好一层可见', () => {
        createWater(makeWaterState({ waterLevel: 0 }));

        const high = _envSys.water.mesh!;
        const mid = scene.getMeshByName('envWater_LOD1')!;
        const low = scene.getMeshByName('envWater_LOD2')!;

        const assertExactlyOne = (which: 'high' | 'mid' | 'low') => {
            _applyWaterLOD(scene);
            const enabled = [high, mid, low].filter((m) => m.isEnabled()).length;
            expect(enabled).toBe(1);
            expect(high.isEnabled()).toBe(which === 'high');
            expect(mid.isEnabled()).toBe(which === 'mid');
            expect(low.isEnabled()).toBe(which === 'low');
        };

        setCameraDistance(10); // 近景 → high
        assertExactlyOne('high');

        setCameraDistance(50); // 中景 → mid
        assertExactlyOne('mid');

        setCameraDistance(150); // 远景 → low
        assertExactlyOne('low');

        setCameraDistance(10); // 回到近景 → high（验证可往返切换）
        assertExactlyOne('high');
    });

    it('selectWaterLOD 边界：30/80 为切换阈值', () => {
        expect(selectWaterLOD(0)).toBe(0);
        expect(selectWaterLOD(30)).toBe(0); // 等于阈值不切换
        expect(selectWaterLOD(30.001)).toBe(1);
        expect(selectWaterLOD(80)).toBe(1); // 等于阈值不切换
        expect(selectWaterLOD(80.001)).toBe(2);
        expect(selectWaterLOD(1000)).toBe(2);
    });
});

// ──────────────────── 波相位连续（修复 HIGH-2）────────────────────
describe('Water 波相位 — 调节波速不跳变', () => {
    it('相位逐帧累加，且改波速后绝对值连续（无跳帧）', () => {
        createWater(makeWaterState({ waterLevel: 0 }));
        scene.deltaTime = 16.67; // ~60fps

        const phases: number[] = [getWaterPhase()];
        for (let i = 0; i < 10; i++) {
            scene.onBeforeRenderObservable.notifyObservers(scene);
            phases.push(getWaterPhase());
        }
        // 波速=1：每帧增量 ≈ dt = 0.0167
        for (let i = 1; i < phases.length; i++) {
            expect(phases[i] - phases[i - 1]).toBeCloseTo(0.0167, 3);
        }

        // 改波速到 4：增量应变为 ≈ 0.0667，且相位绝对值不应跳变
        updateWaterAnimSpeed(4);
        const beforeSwitch = getWaterPhase();
        const afterPhases: number[] = [beforeSwitch];
        for (let i = 0; i < 10; i++) {
            scene.onBeforeRenderObservable.notifyObservers(scene);
            afterPhases.push(getWaterPhase());
        }
        for (let i = 1; i < afterPhases.length; i++) {
            expect(afterPhases[i] - afterPhases[i - 1]).toBeCloseTo(0.0667, 3);
        }

        // 连续性铁证：所有相邻增量均很小（<0.1），不存在旧公式 time*speed 的突变
        const allPhases = [...phases, ...afterPhases.slice(1)];
        let maxJump = 0;
        for (let i = 1; i < allPhases.length; i++) {
            maxJump = Math.max(maxJump, Math.abs(allPhases[i] - allPhases[i - 1]));
        }
        expect(maxJump).toBeLessThan(0.1);
        // 相位单调递增，永不为零重置
        for (let i = 1; i < allPhases.length; i++) {
            expect(allPhases[i]).toBeGreaterThanOrEqual(allPhases[i - 1]);
        }
    });
});

// ──────────────── 预设扩展参数回写 envState（修复 MED）────────────────
describe('Water 预设 — 扩展参数进入 envState', () => {
    it('buildWaterPresetEnvState 含基础与扩展参数', () => {
        for (const [_key, wp] of Object.entries(WATER_PRESETS)) {
            const s = buildWaterPresetEnvState(wp);
            expect(s.waterColor).toEqual(wp.waterColor);
            expect(s.waterTransparency).toBe(wp.waterTransparency);
            expect(s.waterWaveHeight).toBe(wp.waterWaveHeight);
            // 回归核心：扩展参数必须写入 envState，否则被后续 envState 变化还原
            expect(s.fresnelAlphaInfluence).toBe(wp.fresnelAlphaInfluence);
            expect(s.foamOpacity).toBe(wp.foamOpacity);
            expect(s).toHaveProperty('fresnelAlphaInfluence');
            expect(s).toHaveProperty('foamOpacity');
        }
    });
});

// ──────────────── 波方向（风向联动）────────────────
describe('Water 波方向 — 归一化', () => {
    it('无风向时回退到归一化均匀分布', () => {
        const d = computeWaveDirs([0, 0, 0]);
        expect(d.length).toBe(8);
        for (let i = 0; i < 4; i++) {
            const x = d[i * 2];
            const y = d[i * 2 + 1];
            expect(Math.hypot(x, y)).toBeCloseTo(1, 5);
        }
    });

    it('有风向时返回 4 个归一化方向', () => {
        const d = computeWaveDirs([1, 0, 0]);
        expect(d.length).toBe(8);
        for (let i = 0; i < 4; i++) {
            const x = d[i * 2];
            const y = d[i * 2 + 1];
            expect(Math.hypot(x, y)).toBeCloseTo(1, 5);
        }
    });
});
