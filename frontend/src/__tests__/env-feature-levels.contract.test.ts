// env-feature-levels.contract.test.ts — 导出函数存在性 + 签名契约
//
// 拆分前锁住 8 个 build*Level 函数的签名与返回值形状。
// 拆分后该测试必须仍绿，确保搬迁不破坏接口契约。
//
// 注意：env-*-levels.ts 在模块加载时触发 new Scene(engine)，
// 必须 mock 掉 Babylon.js 引擎和 scene 模块。

import { describe, it, expect, vi, beforeAll } from 'vitest';

// ── Mock 重依赖链 ────────────────────────────────────────────────
// 用 importOriginal 模式保留原始模块的大部分导出，仅覆盖特定字段

// env-sky/cloud/ground/water/wind-levels.ts → scene/scene.ts → new Scene(engine)
vi.mock('../scene/scene', () => ({
    setEnvState: vi.fn(),
    scene: { onBeforeRenderObservable: { add: vi.fn(), remove: vi.fn() } },
}));

// env-sky/shadow-levels.ts → scene/render/lighting
vi.mock('../scene/render/lighting', () => ({
    getLightState: vi.fn(() => ({ shadowResolution: 1024 })),
    setLightState: vi.fn(),
}));

// env-water-levels.ts → scene/env/env-water
vi.mock('../scene/env/env-water', () => ({
    WATER_PRESETS: {},
    applyWaterPresetToCurrent: vi.fn(),
    buildWaterPresetEnvState: vi.fn(() => ({})),
    disposeWater: vi.fn(),
    createWater: vi.fn(),
}));

// env-ground-levels.ts → scene/env/env-ground
vi.mock('../scene/env/env-ground', () => ({
    GROUND_PRESETS: {},
    buildGroundPresetEnvState: vi.fn(() => ({})),
}));

// env-sky-levels.ts → scene/env/env-lighting
vi.mock('../scene/env/env-lighting', () => ({
    TIME_OF_DAY_PRESETS: {},
}));

// env-sky-levels.ts → scene/env/env-bridge
vi.mock('../scene/env/env-bridge', () => ({
    applyEnvPreset: vi.fn(),
}));

// env-level-helpers/ground/water-levels.ts → ./env-menu-state（env-menu.ts barrel re-export）
vi.mock('../menus/env-menu', () => ({
    getEnvMenu: vi.fn(() => ({ reRender: vi.fn() })),
    setEnvTextureBindingTarget: vi.fn(),
    EnvTextureBindingTarget: {},
}));

// env-ground-levels.ts → ./scene-menu-state（scene-menu-state.ts 默认返回 null，无需显式 mock）
// 保留 scene-menu mock 防止 importActual 链意外加载真实 scene-menu 模块触发 side-effect
vi.mock('../menus/scene-menu', () => ({
    getSceneMenu: vi.fn(() => null),
}));

// 全部 env-*-levels.ts → ./render-menu
vi.mock('../menus/render-menu', () => ({
    renderMenu: vi.fn(),
}));

// env-sky-levels.ts → ../core/state — 保留原始导出，只覆盖 activeTimeOfDayPreset/setActiveTimeOfDayPreset
vi.mock('../core/state', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as any),
        activeTimeOfDayPreset: 'day',
        setActiveTimeOfDayPreset: vi.fn(),
    };
});

// env-level-helpers.ts → ../core/utils
vi.mock('../core/utils', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as any),
        closeAllOverlays: vi.fn(),
    };
});

// 全部 env-*-levels.ts + env-level-helpers.ts → ../core/config — 覆盖 envState 和 cardContainer 等
vi.mock('../core/config', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as any),
        envState: {
            skyMode: 'color',
            skyColorTop: '#ffffff',
            skyColorBot: '#000000',
            skyRotationY: 0,
            skyRotationSpeed: 0,
            skyTexture: '',
            starsTexture: '',
            starsEnabled: false,
            skyBrightness: 1,
            envIntensity: 0.5,
            groundColor: '#808080',
            groundAlpha: 1,
            groundLevel: 0,
            groundSize: 100,
            groundEdgeFade: 0.1,
            groundInfinite: false,
            groundTextureEnabled: false,
            groundTexture: '',
            groundTextureScale: 1,
            groundProceduralTexture: 'none',
            groundOverlay: 'none',
            groundGridSize: 1,
            groundLineColor: '#ffffff',
            groundPattern: 'checker',
            groundType: 'flat',
            groundTerrainHeight: 1,
            groundTerrainScale: 1,
            groundTerrainSeed: 0,
            groundTerrainOctaves: 4,
            groundPitch: 0,
            groundRoll: 0,
            groundScrollSpeedX: 0,
            groundScrollSpeedZ: 0,
            groundPbrEnabled: false,
            groundMetallic: 0,
            groundRoughness: 0.5,
            groundReflectionBlur: 0.5,
            groundReflectionDistort: 0,
            groundReflectionBlend: 0.5,
            groundNormalStrength: 1,
            groundContactShadowEnabled: false,
            groundContactShadowIntensity: 0.5,
            groundContactShadowDistance: 0.5,
            groundElevationColoring: false,
            reflectionQuality: 'medium',
            waterLevel: 0,
            waterSize: 50,
            bigWaveHeight: 0.5,
            smallWaveHeight: 0.3,
            waterAnimSpeed: 1,
            waterColor: '#4a90d9',
            waterTransparency: 0.6,
            waterFogColor: '#1a3a5c',
            waterFogDensity: 0.01,
            waterSkyColorBlend: 0.3,
            fresnelBias: 0.02,
            fresnelPower: 1.5,
            fresnelAlphaInfluence: 0.5,
            diffuseStrength: 0.5,
            ambientStrength: 0.3,
            rippleNormalStrength: 0.5,
            rippleGlintStrength: 0.3,
            waterNormalStrength: 0.5,
            waterGlintStrength: 0.3,
            waterHorizonFade: 0.3,
            causticIntensity: 0.1,
            causticColor1: '#ffffff',
            causticColor2: '#00aaff',
            causticScrollX: 0,
            causticScrollY: 0,
            waterFogOpacityInfluence: 0.5,
            waterFlip: false,
            underwaterFogDensity: 0.02,
            underwaterToneIntensity: 0.5,
            underwaterTintStrength: 0.5,
            waterEnabled: false,
            qualityProfile: 'high',
            planarReflectBlend: 0.5,
            windDirection: [1, 0, 0] as [number, number, number],
            windSpeed: 1,
            cloudCover: 0.5,
            cloudGap: 0.1,
            cloudErosion: 0.4,
            cloudWeatherStrength: 0.6,
            cloudHeight: 500,
            cloudScale: 0.5,
            cloudThickness: 60,
            cloudVisibility: 8000,
            cloudBacklight: 0.5,
            cloudPowder: 0.8,
            cloudsEnabled: false,
            fogMode: 'exp2',
            fogColor: '#cccccc',
            fogDensity: 0.01,
            fogStart: 10,
            fogEnd: 100,
            fogEnabled: false,
            toneMapping: 'ACES',
            exposure: 1,
            timeOfDayActive: false,
            timeOfDaySpeed: 3,
            groundVisible: true,
            groundStyle: 'solid',
            waterScrollSpeed: 0,
            waterDistortion: 0,
            waterReflectionEnabled: false,
            waterReflectionBlend: 0.5,
        },
        cardContainer: vi.fn(),
        setStatus: vi.fn(),
        getBrowseDir: vi.fn(() => 'environment'),
    };
});

// 动态 import 目标模块，拆分后只需改这一个 import 路径
import type { PopupLevel } from '../core/types';

describe('env-feature-levels 导出契约', () => {
    let mod: {
        buildSkyLevel: () => any;
        buildGroundLevel: () => any;
        buildWaterLevel: () => any;
        buildWindLevel: () => any;
        buildCloudLevel: () => any;
        buildFogLevel: () => any;
        buildShadowLevel: () => any;
        buildExperimentalLevel: () => any;
        _buildLevel: (...args: any[]) => any;
        _openTexturePicker: (...args: any[]) => void;
    };

    beforeAll(async () => {
        // 拆分后各函数分布在独立文件中，分别 import 再合并验证
        const [sky, ground, water, wind, cloud, fog, shadow, exp, helpers] = await Promise.all([
            vi.importActual('../menus/env-sky-levels') as any,
            vi.importActual('../menus/env-ground-levels') as any,
            vi.importActual('../menus/env-water-levels') as any,
            vi.importActual('../menus/env-wind-levels') as any,
            vi.importActual('../menus/env-cloud-levels') as any,
            vi.importActual('../menus/env-fog-levels') as any,
            vi.importActual('../menus/env-shadow-levels') as any,
            vi.importActual('../menus/env-experimental-levels') as any,
            vi.importActual('../menus/env-level-helpers') as any,
        ]);
        mod = {
            ...sky,
            ...ground,
            ...water,
            ...wind,
            ...cloud,
            ...fog,
            ...shadow,
            ...exp,
            ...helpers,
        } as any;
    });

    describe('8 个 build*Level 函数存在性', () => {
        const funcNames = [
            'buildSkyLevel',
            'buildGroundLevel',
            'buildWaterLevel',
            'buildWindLevel',
            'buildCloudLevel',
            'buildFogLevel',
            'buildShadowLevel',
            'buildExperimentalLevel',
        ] as const;

        for (const name of funcNames) {
            it(`${name} 是函数`, () => {
                expect(typeof mod[name]).toBe('function');
            });

            it(`${name} 返回 PopupLevel 形状`, () => {
                const fn = mod[name] as () => PopupLevel;
                const level = fn();
                expect(level).toBeDefined();
                expect(level).toHaveProperty('label');
                expect(typeof level.label).toBe('string');
                expect(level).toHaveProperty('dir');
                expect(typeof level.dir).toBe('string');
                expect(level).toHaveProperty('items');
                expect(Array.isArray(level.items)).toBe(true);
                expect(level).toHaveProperty('renderCustom');
                expect(typeof level.renderCustom).toBe('function');
            });
        }
    });

    describe('公共辅助函数存在性', () => {
        it('_buildLevel 是函数', () => {
            expect(typeof mod._buildLevel).toBe('function');
        });

        it('_buildLevel 返回 PopupLevel', () => {
            const level = (mod._buildLevel as any)('test', () => {});
            expect(level).toHaveProperty('label', 'test');
            expect(level).toHaveProperty('dir');
            expect(level).toHaveProperty('items');
            expect(level).toHaveProperty('renderCustom');
        });

        it('_openTexturePicker 是函数', () => {
            expect(typeof mod._openTexturePicker).toBe('function');
        });
    });
});
