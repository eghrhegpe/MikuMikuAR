// env-bridge/env-mocks.ts — env-bridge 系测试共享桩（ADR-204 P2，上抬自旧 env-bridge.test.ts 前导）
//
// 用法（每个拆分测试文件统一 10 连 vi.mock，工厂经动态 import 取本模块导出）：
//   vi.mock('../../core/config', async () => (await import('./env-mocks')).configModule);
// 断言句柄（mockImplApplySky 等）从本模块正常 import。
// vitest 按测试文件隔离模块图：每个测试文件拿到独立的本模块实例，envState 等状态不跨文件串扰。
//
// NOTE: vi.mock specifier 必须与 SUT 导入解析到同一绝对路径；
// 拆分文件位于 src/__tests__/env-bridge/，相对前缀为 '../../'。

import { vi } from 'vitest';
import { MockVector3, MockColor3 } from '../mocks/babylon-classes';
import { makeMockBackend } from '../fixtures/backend';

// ── MmdWasmRuntime mock class (for instanceof check) ──
export class MmdWasmRuntimeMock {
    physics = { setGravity: vi.fn() };
}

const defaultLightState = {
    hemiIntensity: 0.8,
    dirIntensity: 0.4,
    dirX: 0,
    dirY: 1,
    dirZ: 0,
    dirColor: [1, 1, 1] as [number, number, number],
    hemiColor: [1, 1, 1] as [number, number, number],
    groundColor: [0.3, 0.3, 0.4] as [number, number, number],
    shadowEnabled: false,
    shadowType: 'soft' as const,
    shadowCascades: 2,
    shadowResolution: 1024,
    shadowBias: 0.0001,
};

// ── TIME_OF_DAY_PRESETS mock ──
export const mockTIME_OF_DAY_PRESETS: Record<string, any> = {
    noon: {
        label: '正午',
        skyColorTop: [0.53, 0.71, 0.91] as [number, number, number],
        skyColorBot: [0.3, 0.5, 0.8] as [number, number, number],
        sunAngle: 75,
        azimuth: -45,
        dirDiffuse: [0.95, 0.95, 0.95] as [number, number, number],
        dirDirection: [0.3, 0.9, -0.3] as [number, number, number],
        dirIntensity: 0.9,
        hemiIntensity: 0.5,
    },
    night: {
        label: '夜景',
        skyColorTop: [0.05, 0.05, 0.15] as [number, number, number],
        skyColorBot: [0.02, 0.02, 0.08] as [number, number, number],
        sunAngle: -6,
        azimuth: 0,
    },
    sunset: {
        label: '夕阳',
        skyColorTop: [0.9, 0.45, 0.2] as [number, number, number],
        skyColorBot: [0.6, 0.2, 0.1] as [number, number, number],
        sunAngle: 15,
        azimuth: 90,
    },
};

// ── 断言句柄（供拆分文件 import 使用）──
export const mockSetEnvState = vi.fn().mockResolvedValue(undefined);
export const mockSetUIState = vi.fn().mockResolvedValue(undefined);
export const mockSetLightState = vi.fn();
export const mockGetLightState = vi.fn(() => ({ ...defaultLightState }));
export const mockSetSkipLightAutoSave = vi.fn();
export const mockUpdateSunDisc = vi.fn();
export const mockApplyLightingPresetFromEnv = vi.fn();
export const mockRegisterSceneTickCallback = vi.fn(() => vi.fn());
export const mockEnsureEnvUpdateObserver = vi.fn();
export const mockImplApplySky = vi.fn();
export const mockImplApplyGround = vi.fn();
export const mockImplApplyFog = vi.fn();
export const mockImplCreateWater = vi.fn();
export const mockImplDisposeWater = vi.fn();
export const mockImplCreateParticleEmitter = vi.fn();
export const mockImplDisposeParticles = vi.fn();
export const mockImplCreateClouds = vi.fn();
export const mockImplDisposeClouds = vi.fn();
export const mockImplUpdateWaterAnimSpeed = vi.fn();
export const mockDeriveLighting = vi.fn(
    (skyColor: [number, number, number], _sunAngle: number, _azimuth: number) => ({
        dirDiffuse: [
            Math.min(skyColor[0] * 1.2, 1.0),
            Math.min(skyColor[1] * 1.2, 1.0),
            Math.min(skyColor[2] * 1.2, 1.0),
        ] as [number, number, number],
        dirDirection: [0.3, 0.9, -0.3] as [number, number, number],
        dirIntensity: Math.max(0.15, Math.max(...skyColor) * 1.2),
        hemiIntensity: 0.6,
    })
);

// ====================================================================
// 模块桩工厂对象（供各拆分文件的 vi.mock 工厂返回）
// ====================================================================

export const mmdWasmRuntimeModule = { MmdWasmRuntime: MmdWasmRuntimeMock };

// [ADR-176] env-bridge 经 resolveBackend() 路由调用 SetEnvState/SetUIState，
// 桩基于 fixtures/backend 的 makeMockBackend（ADR-204 P2 共享设施）。
export const backendModule = {
    resolveBackend: () =>
        Promise.resolve(
            makeMockBackend({ SetEnvState: mockSetEnvState, SetUIState: mockSetUIState })
        ),
};

export const babylonVectorModule = { Vector3: MockVector3 };

export const babylonColorModule = { Color3: MockColor3 };

// Create envState as a plain mutable object so Object.assign in setEnvState works
const es: Record<string, any> = {
    sunAngle: 45,
    azimuth: -45,
    skyMode: 'color',
    skyColorTop: [0.3, 0.5, 0.8],
    skyColorMid: [0.8, 0.8, 0.9],
    skyColorBot: [0.2, 0.2, 0.25],
    envIntensity: 2,
    groundColor: [0.15, 0.15, 0.18],
    waterEnabled: false,
    particleEnabled: false,
    particleType: 'none',
    cloudsEnabled: false,
    windEnabled: true,
    fogEnabled: false,
    groundVisible: true,
    groundType: 'flat',
    groundStyle: 'solid',
    groundAlpha: 0.6,
    windDirection: [0, 0, 1],
    windSpeed: 5,
    groundLevel: 0,
    waterLevel: 0,
    waterColor: [0.15, 0.4, 0.6],
    waterTransparency: 0.88,
    waterWaveHeight: 0.15,
    bigWaveHeight: 1.0,
    smallWaveHeight: 1.0,
    waterAnimSpeed: 0.2,
    skyTexture: '',
    skyRotationY: 0,
    skyRotationSpeed: 0,
    skyBrightness: 1,
    starsEnabled: false,
    lightingPresetName: undefined,
};

export const configModule = {
    envState: es,
    triggerAutoSave: vi.fn(),
    mmdRuntime: new MmdWasmRuntimeMock(),
    EnvState: class {},
};
export const mockConfigEnvState = configModule.envState;
export const mockConfigTriggerAutoSave = configModule.triggerAutoSave;

export const envLightingModule = {
    deriveLighting: mockDeriveLighting,
    TIME_OF_DAY_PRESETS: mockTIME_OF_DAY_PRESETS,
};

export const envImplModule = {
    applySky: mockImplApplySky,
    applyGround: mockImplApplyGround,
    applyFog: mockImplApplyFog,
    createWater: mockImplCreateWater,
    disposeWater: mockImplDisposeWater,
    createParticleEmitter: mockImplCreateParticleEmitter,
    disposeParticles: mockImplDisposeParticles,
    createClouds: mockImplCreateClouds,
    disposeClouds: mockImplDisposeClouds,
    ensureEnvUpdateObserver: mockEnsureEnvUpdateObserver,
    registerSceneTickCallback: mockRegisterSceneTickCallback,
    updateWaterAnimSpeed: mockImplUpdateWaterAnimSpeed,
};

// [ADR-138] mock env-dispatcher: dispatchEnvChange delegates to impl mocks
const _SKY_KEYS_M = [
    'skyMode',
    'skyColorTop',
    'skyColorMid',
    'skyColorBot',
    'skyTexture',
    'skyRotationY',
    'skyRotationSpeed',
    'skyBrightness',
    'starsEnabled',
    'starsTexture',
    'envIntensity',
    'sunAngle',
    'azimuth',
];
const _GROUND_KEYS_M = [
    'groundType',
    'groundStyle',
    'groundColor',
    'groundColor2',
    'groundTexture',
    'groundLevel',
    'groundPitch',
    'groundRoll',
    'groundScrollSpeedX',
    'groundScrollSpeedZ',
    'groundTileScale',
    'groundReflectionEnabled',
    'groundReflectionQuality',
    'groundEdgeFadeStart',
    'groundEdgeFadeEnd',
    'terrainHeight',
    'terrainScale',
    'terrainSeed',
    'terrainOctaves',
    'groundGradient',
    'groundFade',
    'groundCheckerColor1',
    'groundCheckerColor2',
    'groundMode',
    'groundVisible',
    'groundAlpha',
    'groundTextureEnabled',
    'groundTextureScale',
    'groundTextureRotation',
    'groundTerrainHeight',
    'groundTerrainScale',
    'groundTerrainSeed',
    'groundTerrainOctaves',
    'groundSize',
    'groundGridSize',
    'groundLineColor',
    'groundEdgeFade',
    'groundPattern',
    'groundReflectionBlend',
    'groundNormalTexture',
    'groundNormalStrength',
    'groundElevationColoring',
];
const _FOG_KEYS_M = ['fogEnabled', 'fogColor', 'fogDensity', 'fogMode', 'fogStart', 'fogEnd'];
const _WATER_KEYS_M = [
    'waterEnabled',
    'waterColor',
    'waterOpacity',
    'waterLevel',
    'waterWaveSpeed',
    'waterWaveHeight',
    'waterWaveLength',
    'waterReflectionEnabled',
    'waterReflectionQuality',
    'waterRefraction',
    'waterRefractionIndex',
    'waterFoamEnabled',
    'waterFoamIntensity',
    'waterCausticsEnabled',
    'waterCausticsIntensity',
    'underwaterStrength',
    'waterPresetName',
    'waterAnimSpeed',
    'environmentPreset',
];
const _PARTICLE_KEYS_M = [
    'particleEnabled',
    'particleType',
    'particleDensity',
    'particleSize',
    'particleSpeed',
    'particleEmitRate',
    'particleSplash',
    'particleCustomTexture',
    'windEnabled',
    'windStrength',
    'windDirection',
];
const _CLOUD_KEYS_M = [
    'cloudsEnabled',
    'cloudCover',
    'cloudSpeed',
    'cloudHeight',
    'cloudDensity',
    'cloudLightAttenuation',
];

export const envDispatcherModule = {
    dispatchEnvChange: vi.fn((changed: string[] | null | undefined, state: any) => {
        const c = changed ? [...changed] : null;
        try {
            if (!c || _SKY_KEYS_M.some((k) => c.includes(k))) {
                mockImplApplySky(state);
            }
        } catch (_) {}
        try {
            if (!c || _GROUND_KEYS_M.some((k) => c.includes(k))) {
                mockImplApplyGround(state);
            }
        } catch (_) {}
        try {
            if (!c || _FOG_KEYS_M.some((k) => c.includes(k))) {
                mockImplApplyFog(state);
            }
        } catch (_) {}
        try {
            if (!c || _WATER_KEYS_M.some((k) => c.includes(k))) {
                if (state.waterEnabled) {
                    mockImplCreateWater(state);
                } else {
                    mockImplDisposeWater();
                }
            }
        } catch (_) {}
        try {
            if (!c || _PARTICLE_KEYS_M.some((k) => c.includes(k))) {
                if (state.particleEnabled && state.particleType && state.particleType !== 'none') {
                    mockImplCreateParticleEmitter(state.particleType, state.windEnabled);
                } else {
                    mockImplDisposeParticles();
                }
            }
        } catch (_) {}
        try {
            if (!c || _CLOUD_KEYS_M.some((k) => c.includes(k))) {
                if (state.cloudsEnabled) {
                    mockImplCreateClouds(state);
                } else {
                    mockImplDisposeClouds();
                }
            }
        } catch (_) {}
    }),
    registerEnvCallback: vi.fn(() => vi.fn()),
    registerSceneTickCallback: mockRegisterSceneTickCallback,
    clearSceneTickCallbacks: vi.fn(),
    runSceneTickCallbacks: vi.fn(),
    clearAllEnvCallbacks: vi.fn(),
};

const hemiLight = {
    intensity: 0.8,
    diffuse: { r: 1, g: 1, b: 1 },
    groundColor: { r: 0.3, g: 0.3, b: 0.4 },
};
export const lightingModule = {
    setLightState: mockSetLightState,
    getLightState: mockGetLightState,
    setSkipLightAutoSave: mockSetSkipLightAutoSave,
    getHemiLight: () => hemiLight,
    _updateSunDisc: mockUpdateSunDisc,
    applyLightingPresetFromEnv: mockApplyLightingPresetFromEnv,
};
export const mockGetHemiLight = lightingModule.getHemiLight;

const scene = {
    ambientColor: { r: 0, g: 0, b: 0 },
    getAnimationRatio: () => 60,
    deltaTime: 1000, // 1s/tick，与旧版 getAnimationRatio()=60 的 dt=1s 保持一致
    onBeforeRenderObservable: {
        _callbacks: new Map<number, { cb: () => void; timerId: ReturnType<typeof setTimeout> }>(),
        _nextId: 1,
        add: (cb: () => void) => {
            const id = scene.onBeforeRenderObservable._nextId++;
            const fire = () => {
                cb();
                // Re-schedule if still registered (simulates per-frame observable)
                if (scene.onBeforeRenderObservable._callbacks.has(id)) {
                    const timerId = setTimeout(fire, 16);
                    scene.onBeforeRenderObservable._callbacks.set(id, { cb, timerId });
                }
            };
            const timerId = setTimeout(fire, 16);
            scene.onBeforeRenderObservable._callbacks.set(id, { cb, timerId });
            return id;
        },
        remove: (id: number) => {
            const entry = scene.onBeforeRenderObservable._callbacks.get(id);
            if (entry) {
                clearTimeout(entry.timerId);
                scene.onBeforeRenderObservable._callbacks.delete(id);
            }
        },
        addOnce: (cb: () => void) => {
            setTimeout(cb, 16);
        },
    },
};
export const sceneModule = {
    scene,
    setRenderState: vi.fn(),
};
export const mockSceneInstance = sceneModule.scene;
