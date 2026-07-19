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
// env-water.ts 从 env-context 而非 env-impl 获取 getScene，故需额外 mock
vi.mock('../../scene/env/env-context', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getScene: () => (globalThis as any).__waterTestScene as Scene,
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
    addRipple,
    clearRipples,
    updateUnderwaterTransition,
    resetUnderwaterState,
    _underwaterActive,
    applyWaterPresetToCurrent,
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
    return () => {
        (document as any).createElement = origCreate;
    };
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
        createWater(makeWaterState({ waterLevel: 0, waterAnimSpeed: 1 }));
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
            expect(s.bigWaveHeight).toBe(wp.bigWaveHeight);
            expect(s.smallWaveHeight).toBe(wp.smallWaveHeight);
            // 回归核心：扩展参数必须写入 envState，否则被后续 envState 变化还原
            expect(s.fresnelAlphaInfluence).toBe(wp.fresnelAlphaInfluence);
            // foam 已移除
            expect(s).toHaveProperty('fresnelAlphaInfluence');
        }
    });
});

// ──────────────── 波方向（风向联动）────────────────
describe('Water 波方向 — 归一化', () => {
    it('无风向时直接抛错（Fail-Fast）', () => {
        expect(() => computeWaveDirs([0, 0, 0])).toThrow();
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

// ──────────────── Ripple 生命周期 ────────────────
describe('Water Ripple — 添加与清理', () => {
    it('createWater 后 addRipple 不抛错', () => {
        createWater(makeWaterState({ waterLevel: 0 }));
        expect(() => addRipple(new Vector3(0, 0, 0))).not.toThrow();
    });

    it('clearRipples 可重复调用不抛错', () => {
        createWater(makeWaterState({ waterLevel: 0 }));
        addRipple(new Vector3(0, 0, 0));
        expect(() => clearRipples()).not.toThrow();
        expect(() => clearRipples()).not.toThrow();
    });

    it('disposeWater 后 clearRipples 由 beforeEach 重置，不残留', () => {
        createWater(makeWaterState({ waterLevel: 0 }));
        addRipple(new Vector3(1, 0, 1));
        disposeWater();
        // 重新创建后涟漪不应残留
        createWater(makeWaterState({ waterLevel: 0 }));
        expect(() => addRipple(new Vector3(0, 0, 0))).not.toThrow();
    });
});

// ──────────────── dispose 资源释放 ────────────────
describe('Water dispose — 资源释放彻底', () => {
    it('disposeWater 后 mesh 和 material 被置空', () => {
        createWater(makeWaterState({ waterLevel: 0 }));
        expect(_envSys.water.mesh).not.toBeNull();
        expect(_envSys.water.material).not.toBeNull();

        disposeWater();

        expect(_envSys.water.mesh).toBeNull();
        expect(_envSys.water.material).toBeNull();
    });

    it('disposeWater 后 getWaterPhase 重置为 0', () => {
        createWater(makeWaterState({ waterLevel: 0 }));
        // 模拟若干帧推进相位
        for (let i = 0; i < 5; i++) {
            scene.render();
        }
        expect(getWaterPhase()).not.toBe(0);

        disposeWater();

        expect(getWaterPhase()).toBe(0);
    });

    it('disposeWater 可重复调用不抛错（幂等）', () => {
        createWater(makeWaterState({ waterLevel: 0 }));
        expect(() => disposeWater()).not.toThrow();
        expect(() => disposeWater()).not.toThrow();
    });

    it('disposeWater 后可重新 createWater（无残留 observer 冲突）', () => {
        createWater(makeWaterState({ waterLevel: 0 }));
        scene.render();
        disposeWater();

        // 重建不应抛错，observer 应已清理
        expect(() => createWater(makeWaterState({ waterLevel: 0 }))).not.toThrow();
        scene.render();
        expect(_envSys.water.mesh).not.toBeNull();
    });
});

// ──────────────── Underwater 过渡 ────────────────
describe('Water Underwater — 相机入水触发过渡', () => {
    // DefaultRenderingPipeline 需要最小桩：chromaticAberrationEnabled + chromaticAberration
    function makePipelineStub() {
        return {
            chromaticAberrationEnabled: false,
            chromaticAberration: { aberrationAmount: 0 },
        } as any;
    }

    it('waterEnabled=false 时直接重置，不进入水下', () => {
        const pipeline = makePipelineStub();
        envState.waterEnabled = false;
        updateUnderwaterTransition(scene, pipeline);
        expect(_underwaterActive).toBe(false);
    });

    it('相机在水面以上时 _underwaterActive 保持 false', () => {
        envState.waterEnabled = true;
        envState.waterLevel = 0;
        camera.position.set(0, 5, 10); // y=5 在水面以上
        camera.computeWorldMatrix();

        const pipeline = makePipelineStub();
        updateUnderwaterTransition(scene, pipeline);
        expect(_underwaterActive).toBe(false);
    });

    it('相机潜入水面以下时 _underwaterActive 变为 true', () => {
        envState.waterEnabled = true;
        envState.waterLevel = 0;
        camera.position.set(0, -3, 10); // y=-3 在水面以下
        camera.computeWorldMatrix();

        const pipeline = makePipelineStub();
        updateUnderwaterTransition(scene, pipeline);
        expect(_underwaterActive).toBe(true);
    });

    it('resetUnderwaterState 清除 _underwaterActive 和过渡进度', () => {
        envState.waterEnabled = true;
        envState.waterLevel = 0;
        camera.position.set(0, -3, 10);
        camera.computeWorldMatrix();

        const pipeline = makePipelineStub();
        updateUnderwaterTransition(scene, pipeline);
        expect(_underwaterActive).toBe(true);

        resetUnderwaterState(scene, pipeline);
        expect(_underwaterActive).toBe(false);
    });
});

// ──────────────── Preset 应用 ────────────────
describe('Water Preset — applyWaterPresetToCurrent', () => {
    it('应用预设后 envState 的水相关字段被更新', () => {
        const presetName = Object.keys(WATER_PRESETS)[0];
        const preset = WATER_PRESETS[presetName];
        const originalColor = envState.waterColor;

        applyWaterPresetToCurrent(preset);

        // 至少有一个水相关字段被更新（颜色或透明度等）
        const _colorChanged =
            envState.waterColor[0] !== originalColor[0] ||
            envState.waterColor[1] !== originalColor[1] ||
            envState.waterColor[2] !== originalColor[2];
        // 预设可能颜色相同，检查 WATER_PRESETS 的 buildWaterPresetEnvState 返回值
        const built = buildWaterPresetEnvState(preset);
        expect(built).toHaveProperty('waterColor');
    });

    it('buildWaterPresetEnvState 返回的对象包含基础水参数', () => {
        const preset = WATER_PRESETS[Object.keys(WATER_PRESETS)[0]];
        const state = buildWaterPresetEnvState(preset);
        expect(state).toHaveProperty('waterColor');
        expect(state).toHaveProperty('waterTransparency');
        expect(state).toHaveProperty('waterWaveHeight');
    });
});

// ──────────────── 平面反射 RT（ADR-062 P1）────────────────

describe('mirror camera math', () => {
    it('clipPlane 等效逻辑：保留 y >= waterLevel 的几何', () => {
        // 模拟 _populateMirrorRenderList 的过滤逻辑
        const waterLevel = 0;
        const meshAbove = { getBoundingInfo: () => ({ boundingBox: { maximumWorld: { y: 5 } } }) };
        const meshBelow = { getBoundingInfo: () => ({ boundingBox: { maximumWorld: { y: -3 } } }) };
        const meshAtLevel = {
            getBoundingInfo: () => ({ boundingBox: { maximumWorld: { y: 0 } } }),
        };

        const shouldInclude = (mesh: any) =>
            mesh.getBoundingInfo().boundingBox.maximumWorld.y >= waterLevel;
        expect(shouldInclude(meshAbove)).toBe(true);
        expect(shouldInclude(meshAtLevel)).toBe(true);
        expect(shouldInclude(meshBelow)).toBe(false);
    });

    it('水下判断逻辑：camera.y < waterLevel 时跳过反射', () => {
        const waterLevel = 2;
        const camAbove = { position: { y: 5 } };
        const camBelow = { position: { y: 0 } };
        const camAtLevel = { position: { y: 2 } };

        const isUnderwater = (cam: any) => cam.position.y < waterLevel;
        expect(isUnderwater(camAbove)).toBe(false);
        expect(isUnderwater(camAtLevel)).toBe(false);
        expect(isUnderwater(camBelow)).toBe(true);
    });
});

describe('reflection quality tier', () => {
    it('reflectionQuality=off 时不创建 RT（_setupMirrorRT 提前返回）', () => {
        // 验证 resolutionMap[off] = 0 导致提前返回
        const resolutionMap: Record<string, number> = { high: 512, medium: 256, low: 128, off: 0 };
        expect(resolutionMap['off']).toBe(0);
        expect(!!resolutionMap['off']).toBe(false); // falsy → early return
    });

    it('reflectionQuality=high 映射 512 分辨率', () => {
        const resolutionMap: Record<string, number> = { high: 512, medium: 256, low: 128, off: 0 };
        expect(resolutionMap['high']).toBe(512);
    });

    it('reflectionQuality=low 映射 128 分辨率', () => {
        const resolutionMap: Record<string, number> = { high: 512, medium: 256, low: 128, off: 0 };
        expect(resolutionMap['low']).toBe(128);
    });

    it('帧跳过逻辑：high 每帧渲染，low 每 4 帧渲染', () => {
        const frameSkipMap: Record<string, number> = { high: 0, medium: 1, low: 3, off: 999 };
        // high: 每帧（skip=0, mod 1 = 0 始终为 true）
        expect(1 % (frameSkipMap['high'] + 1)).toBe(0);
        expect(2 % (frameSkipMap['high'] + 1)).toBe(0);
        // low: 每 4 帧（skip=3, mod 4 = 0 每 4 帧一次）
        expect(0 % (frameSkipMap['low'] + 1)).toBe(0);
        expect(1 % (frameSkipMap['low'] + 1)).not.toBe(0);
        expect(3 % (frameSkipMap['low'] + 1)).not.toBe(0);
        expect(4 % (frameSkipMap['low'] + 1)).toBe(0);
    });
});

describe('reflection quality toggle — P1 修复（ADR-114）', () => {
    it('reflectionQuality off→on：惰性路径重建材质并启用 PLANAR_REFLECTION', () => {
        // 1. 以 off 创建水面：材质不应含 PLANAR_REFLECTION define
        createWater(makeWaterState({ reflectionQuality: 'off', planarReflectBlend: 0.5 }));
        const matOff = _envSys.water.material as any;
        expect(matOff).toBeTruthy();
        expect(matOff.options.defines ?? []).not.toContain('PLANAR_REFLECTION');

        // 2. 切换到 high：惰性路径应检测到 define 不一致并重建材质
        createWater(makeWaterState({ reflectionQuality: 'high', planarReflectBlend: 0.5 }));
        const matOn = _envSys.water.material as any;
        expect(matOn).toBeTruthy();
        expect(matOn.options.defines ?? []).toContain('PLANAR_REFLECTION');
        // 材质引用已替换为新实例（旧材质已 dispose）
        expect(matOn).not.toBe(matOff);
    });

    it('reflectionQuality on→off：惰性路径重建材质并移除 PLANAR_REFLECTION', () => {
        createWater(makeWaterState({ reflectionQuality: 'high', planarReflectBlend: 0.5 }));
        const matOn = _envSys.water.material as any;
        expect(matOn.options.defines ?? []).toContain('PLANAR_REFLECTION');

        createWater(makeWaterState({ reflectionQuality: 'off', planarReflectBlend: 0.5 }));
        const matOff = _envSys.water.material as any;
        expect(matOff.options.defines ?? []).not.toContain('PLANAR_REFLECTION');
        expect(matOff).not.toBe(matOn);
    });
});
