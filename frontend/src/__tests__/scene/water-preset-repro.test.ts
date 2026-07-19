import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';

// 隔离 env-impl，避免其重型依赖（clouds/particles/sky 等）干扰；
// getScene 通过 globalThis 懒返回测试场景，规避 vi.mock 工厂的 TDZ 问题。
// _envSys 通过 globalThis 共享同对象，与 env-context mock 一致。
vi.mock('../../scene/env/env-impl', () => {
    if (!(globalThis as any).__waterTestEnvSys) {
        (globalThis as any).__waterTestEnvSys = {
            water: { mesh: null as any, material: null as any },
        };
    }
    return {
        _envSys: (globalThis as any).__waterTestEnvSys,
        getScene: () => (globalThis as any).__waterTestScene as Scene,
        ensureEnvUpdateObserver: () => {},
    };
});
// env-water.ts 从 env-context 而非 env-impl 获取 getScene，故需额外 mock
vi.mock('../../scene/env/env-context', () => {
    if (!(globalThis as any).__waterTestEnvSys) {
        (globalThis as any).__waterTestEnvSys = {
            water: { mesh: null as any, material: null as any },
        };
    }
    return {
        _envSys: (globalThis as any).__waterTestEnvSys,
        getScene: () => (globalThis as any).__waterTestScene as Scene,
        initEnvImpl: () => {},
        isInitialized: () => true,
        getPipeline: () => null,
    };
});

import { _envSys } from '../../scene/env/env-impl';
import { envState } from '../../core/config';
import {
    createWater,
    disposeWater,
    WATER_PRESETS,
    buildWaterPresetEnvState,
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

describe('water preset repro (ADR-env water preset NaN-uniform regression)', () => {
    it('回归核心：buildWaterPresetEnvState 对所有预设不产生 undefined 字段', () => {
        // 真实 bug：WATER_PRESETS 未定义 waterHorizonFade / waterSkyColorBlend，
        // 而 buildWaterPresetEnvState 原样写入 → Object.assign(envState, {…: undefined})
        // 污染 envState；_syncWaterUniforms 的 setFloat(undefined) 在真实引擎写 NaN
        // → 水面渲染消失且不可逆（开关/滑条复用污染态都无效，重新进入用默认非 undefined 故正常）。
        for (const [name, wp] of Object.entries(WATER_PRESETS)) {
            const mapped = buildWaterPresetEnvState(wp);
            for (const [k, v] of Object.entries(mapped)) {
                expect(v, `preset "${name}": field "${k}" is undefined`).not.toBeUndefined();
            }
        }
    });

    it('点击水面预设（携带 waterEnabled:true）后水面被创建且材质非空', () => {
        const preset = WATER_PRESETS[Object.keys(WATER_PRESETS)[0]];
        const applied = { ...envState, ...buildWaterPresetEnvState(preset), waterEnabled: true };
        createWater(applied);
        expect(_envSys.water.material).not.toBeNull();
        expect(_envSys.water.mesh).not.toBeNull();

        // 扩展 uniform 应用不应清空已建立的材质
        applyWaterPresetToCurrent(preset);
        expect(_envSys.water.material).not.toBeNull();
    });

    it('关闭→再开（预设）循环，材质稳定不丢', () => {
        const preset = WATER_PRESETS[Object.keys(WATER_PRESETS)[0]];
        const applied = { ...envState, ...buildWaterPresetEnvState(preset), waterEnabled: true };
        createWater(applied);
        expect(_envSys.water.material).not.toBeNull();

        // 模拟关闭水面开关
        createWater({ ...applied, waterEnabled: false });
        expect(_envSys.water.material).toBeNull();

        // 模拟再次点击预设（应重新建立水面）
        createWater({ ...applied, waterEnabled: true });
        expect(_envSys.water.material).not.toBeNull();
        expect(_envSys.water.mesh).not.toBeNull();
    });
});
