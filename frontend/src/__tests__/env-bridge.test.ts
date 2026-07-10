// env-bridge.test.ts — 综合测试覆盖 env-bridge.ts
// 使用 vi.mock 完全模拟所有依赖（Babylon.js + 内部模块 + Wails 绑定）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ====================================================================
// 1. vi.hoisted — 定义 vi.mock 工厂可用的共享变量/类
// ====================================================================
//
// NOTE: vi.mock specifiers must resolve to the same absolute path as the
// SUT's imports. For relative imports, use the path FROM the test file.

const {
    MmdWasmRuntimeMock,
    // — hoisted vi.fn() mocks (shared with vi.mock factories) —
    mockSetEnvState,
    mockSetLightState,
    mockGetLightState,
    mockSetSkipLightAutoSave,
    mockUpdateSunDisc,
    mockApplyLightingPresetFromEnv,
    mockRegisterSceneTickCallback,
    mockEnsureEnvUpdateObserver,
    mockImplApplySky,
    mockImplApplyGround,
    mockImplApplyFog,
    mockImplCreateWater,
    mockImplDisposeWater,
    mockImplCreateParticleEmitter,
    mockImplDisposeParticles,
    mockImplCreateClouds,
    mockImplDisposeClouds,
    mockImplUpdateWaterAnimSpeed,
    mockDeriveLighting,
    mockTIME_OF_DAY_PRESETS,
} = vi.hoisted(() => {
    // ── MmdWasmRuntime mock class (for instanceof check) ──
    class _MmdWasmRuntime {
        physics = { setGravity: vi.fn() };
    }

    // ── envState defaults (matches config.ts initial values) ──
    const defaults: Record<string, any> = {
        skyMode: 'color',
        skyColorTop: [0.3, 0.5, 0.8],
        skyColorMid: [0.8, 0.8, 0.9],
        skyColorBot: [0.2, 0.2, 0.25],
        skyTexture: '',
        skyRotationY: 0,
        skyRotationSpeed: 0,
        skyBrightness: 1,
        starsEnabled: false,
        envIntensity: 2,
        groundVisible: true,
        groundMode: 'solid',
        groundColor: [0.15, 0.15, 0.18],
        groundAlpha: 0.6,
        windEnabled: true,
        windDirection: [0, 0, 1],
        windSpeed: 5,
        particleEnabled: false,
        particleType: 'none',
        particleEmitRate: 1,
        particleSize: 1,
        particleSpeed: 1,
        groundLevel: 0,
        waterEnabled: false,
        waterLevel: 0,
        waterColor: [0.2, 0.4, 0.6],
        waterTransparency: 0.8,
        waterWaveHeight: 0.5,
        waterSize: 50,
        waterAnimSpeed: 1,
        foamThreshold: 0.1,
        foamIntensity: 0.5,
        fresnelBias: 0.02,
        fresnelPower: 3.0,
        diffuseStrength: 0.15,
        ambientStrength: 0.15,
        foamTransitionRange: 0.15,
        rippleNormalStrength: 0.15,
        rippleGlintStrength: 0.25,
        causticColor1: [1.0, 0.9, 0.6],
        causticColor2: [1.0, 1.0, 0.8],
        causticScrollX: 0.1,
        causticScrollY: 0.15,
        fresnelAlphaInfluence: 0.5,
        underwaterFogDensity: 0.015,
        underwaterChromaticAmount: 20,
        cloudsEnabled: false,
        debugClouds: false,
        cloudCover: 0.5,
        cloudScale: 0.55,
        cloudHeight: 325,
        cloudThickness: 15,
        cloudVisibility: 3000,
        cloudGap: 0.5,
        fogEnabled: false,
        fogColor: [0.5, 0.5, 0.6],
        fogDensity: 0.01,
        sunAngle: 45,
        azimuth: -45,
        lightingPresetName: undefined,
    };

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
    const presets: Record<string, any> = {
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

    return {
        MmdWasmRuntimeMock: _MmdWasmRuntime,
        mockSetEnvState: vi.fn().mockResolvedValue(undefined),
        mockSetLightState: vi.fn(),
        mockGetLightState: vi.fn(() => ({ ...defaultLightState })),
        mockSetSkipLightAutoSave: vi.fn(),
        mockUpdateSunDisc: vi.fn(),
        mockApplyLightingPresetFromEnv: vi.fn(),
        mockRegisterSceneTickCallback: vi.fn(() => vi.fn()),
        mockEnsureEnvUpdateObserver: vi.fn(),
        mockImplApplySky: vi.fn(),
        mockImplApplyGround: vi.fn(),
        mockImplApplyFog: vi.fn(),
        mockImplCreateWater: vi.fn(),
        mockImplDisposeWater: vi.fn(),
        mockImplCreateParticleEmitter: vi.fn(),
        mockImplDisposeParticles: vi.fn(),
        mockImplCreateClouds: vi.fn(),
        mockImplDisposeClouds: vi.fn(),
        mockImplUpdateWaterAnimSpeed: vi.fn(),
        mockDeriveLighting: vi.fn(
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
        ),
        mockTIME_OF_DAY_PRESETS: presets,
    };
});

// ====================================================================
// 2. vi.mock 调用（vitest 自动提升至模块顶部）
// ====================================================================

vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => ({
    MmdWasmRuntime: MmdWasmRuntimeMock,
}));

vi.mock('../core/wails-bindings', () => ({
    SetEnvState: mockSetEnvState,
}));

vi.mock('@babylonjs/core/Maths/math.vector', () => {
    class Vec3 {
        x = 0;
        y = 0;
        z = 0;
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        clone() {
            return new Vec3(this.x, this.y, this.z);
        }
        set(x: number, y: number, z: number) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
        setAll(v: number) {
            this.x = this.y = this.z = v;
            return this;
        }
        static Zero() {
            return new Vec3(0, 0, 0);
        }
    }
    return { Vector3: Vec3 };
});
vi.mock('@babylonjs/core/Maths/math.color', () => {
    class Col3 {
        r = 0;
        g = 0;
        b = 0;
        constructor(r = 0, g = 0, b = 0) {
            this.r = r;
            this.g = g;
            this.b = b;
        }
        set(r: number, g: number, b: number) {
            this.r = r;
            this.g = g;
            this.b = b;
            return this;
        }
        clone() {
            return new Col3(this.r, this.g, this.b);
        }
    }
    return { Color3: Col3 };
});

vi.mock('../core/config', () => {
    const tas = vi.fn();
    const MockMmdWR = class {
        physics = { setGravity: vi.fn() };
    };
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
        groundMode: 'solid',
        groundAlpha: 0.6,
        windDirection: [0, 0, 1],
        windSpeed: 5,
        groundLevel: 0,
        waterLevel: 0,
        waterColor: [0.2, 0.4, 0.6],
        waterTransparency: 0.8,
        waterWaveHeight: 0.5,
        waterSize: 50,
        waterAnimSpeed: 1,
        skyTexture: '',
        skyRotationY: 0,
        skyRotationSpeed: 0,
        skyBrightness: 1,
        starsEnabled: false,
        lightingPresetName: undefined,
    };
    return {
        envState: es,
        triggerAutoSave: tas,
        mmdRuntime: new MockMmdWR(),
        EnvState: class {},
    };
});

vi.mock('../scene/env/env-lighting', () => ({
    deriveLighting: mockDeriveLighting,
    TIME_OF_DAY_PRESETS: mockTIME_OF_DAY_PRESETS,
}));

vi.mock('../scene/env/env-impl', () => ({
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
}));

vi.mock('../scene/render/lighting', () => {
    const hemiLight = {
        intensity: 0.8,
        diffuse: { r: 1, g: 1, b: 1 },
        groundColor: { r: 0.3, g: 0.3, b: 0.4 },
    };
    return {
        setLightState: mockSetLightState,
        getLightState: mockGetLightState,
        setSkipLightAutoSave: mockSetSkipLightAutoSave,
        hemiLight,
        _updateSunDisc: mockUpdateSunDisc,
        applyLightingPresetFromEnv: mockApplyLightingPresetFromEnv,
    };
});

vi.mock('../scene/scene', () => {
    const scene = {
        ambientColor: { r: 0, g: 0, b: 0 },
        getAnimationRatio: () => 60,
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
    return {
        scene,
        setRenderState: vi.fn(),
    };
});

// ====================================================================
// 3. 导入测试对象 + 被模拟模块引用
// ====================================================================

// Import the mocked config/lighting/scene modules to access their actual instances
// (These are the mock exports from the vi.mock factories above)
import {
    envState as mockConfigEnvState,
    triggerAutoSave as mockConfigTriggerAutoSave,
} from '../core/config';
import { hemiLight as mockLightingHemiLight } from '../scene/render/lighting';
import { scene as mockSceneInstance } from '../scene/scene';

import {
    setGravityStrength,
    getGravityStrength,
    setEnvSunAngle,
    getEnvSunAngle,
    startTimeOfDay,
    stopTimeOfDay,
    isTimeOfDayActive,
    getTimeOfDaySpeed,
    setTimeOfDaySpeed,
    applyEnvPreset,
    applyEnvPresetObject,
    setEnvState,
} from '../scene/env/env-bridge';

// ====================================================================
// 4. 测试用例
// ====================================================================

// ──── Gravity ──────────────────────────────────────────────────

describe('Gravity', () => {
    beforeEach(() => {
        setGravityStrength(1.0);
        vi.clearAllMocks();
        // Clear refs triggerAutoSave too since vi.clearAllMocks clears vi.fn() instances
    });

    it('default gravity strength is 1.0', () => {
        expect(getGravityStrength()).toBeCloseTo(1.0);
    });

    it('setGravityStrength/getGravityStrength roundtrip', () => {
        setGravityStrength(0.5);
        expect(getGravityStrength()).toBeCloseTo(0.5);
        setGravityStrength(1.5);
        expect(getGravityStrength()).toBeCloseTo(1.5);
    });

    it('clamps to [0, 2]', () => {
        setGravityStrength(-1);
        expect(getGravityStrength()).toBe(0);
        setGravityStrength(5);
        expect(getGravityStrength()).toBe(2);
    });

    it('roundtrips state correctly', () => {
        setGravityStrength(0.5);
        expect(getGravityStrength()).toBeCloseTo(0.5);
    });

    it('calls triggerAutoSave', () => {
        setGravityStrength(0.8);
        expect(mockConfigTriggerAutoSave).toHaveBeenCalledTimes(1);
    });
});

// ──── Sun Angle ────────────────────────────────────────────────

describe('Sun Angle', () => {
    beforeEach(() => {
        setEnvSunAngle(45);
    });

    it('default is 45', () => {
        expect(getEnvSunAngle()).toBe(45);
    });

    it('setEnvSunAngle/getEnvSunAngle roundtrip', () => {
        setEnvSunAngle(30);
        expect(getEnvSunAngle()).toBe(30);
        setEnvSunAngle(0);
        expect(getEnvSunAngle()).toBe(0);
    });

    it('clamps to [-15, 90]', () => {
        setEnvSunAngle(-30);
        expect(getEnvSunAngle()).toBe(-15);
        setEnvSunAngle(100);
        expect(getEnvSunAngle()).toBe(90);
    });

    it('boundary values are accepted', () => {
        setEnvSunAngle(-15);
        expect(getEnvSunAngle()).toBe(-15);
        setEnvSunAngle(90);
        expect(getEnvSunAngle()).toBe(90);
    });
});

// ──── envState facade (via setEnvState) ────────────────────────

describe('_applyEnvStateFacade (via setEnvState)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset envState defaults
        Object.assign(mockConfigEnvState, {
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
        });
    });

    it('calls only the relevant subsystems for changed keys', () => {
        setEnvState({ skyMode: 'procedural' });
        expect(mockImplApplySky).toHaveBeenCalled();
        expect(mockImplApplyGround).not.toHaveBeenCalled();
        expect(mockImplApplyFog).not.toHaveBeenCalled();
    });

    it('calls all subsystems when keys from all groups change', () => {
        setEnvState({ skyMode: 'procedural', groundMode: 'solid', fogEnabled: true });
        expect(mockImplApplySky).toHaveBeenCalled();
        expect(mockImplApplyGround).toHaveBeenCalled();
        expect(mockImplApplyFog).toHaveBeenCalled();
    });

    it('creates water when waterEnabled is true', () => {
        mockConfigEnvState.waterEnabled = true;
        setEnvState({ waterEnabled: true });
        expect(mockImplCreateWater).toHaveBeenCalled();
        expect(mockImplDisposeWater).not.toHaveBeenCalled();
    });

    it('disposes water when waterEnabled is false', () => {
        setEnvState({ waterEnabled: false });
        expect(mockImplDisposeWater).toHaveBeenCalled();
        expect(mockImplCreateWater).not.toHaveBeenCalled();
    });

    it('creates particles when enabled with valid type', () => {
        mockConfigEnvState.particleEnabled = true;
        mockConfigEnvState.particleType = 'sakura';
        setEnvState({ particleEnabled: true, particleType: 'sakura' });
        expect(mockImplCreateParticleEmitter).toHaveBeenCalledWith('sakura', true);
        expect(mockImplDisposeParticles).not.toHaveBeenCalled();
    });

    it('disposes particles when particleType is none', () => {
        setEnvState({ particleEnabled: false });
        expect(mockImplDisposeParticles).toHaveBeenCalled();
        expect(mockImplCreateParticleEmitter).not.toHaveBeenCalled();
    });

    it('creates clouds when cloudsEnabled is true', () => {
        mockConfigEnvState.cloudsEnabled = true;
        setEnvState({ cloudsEnabled: true });
        expect(mockImplCreateClouds).toHaveBeenCalled();
        expect(mockImplDisposeClouds).not.toHaveBeenCalled();
    });

    it('disposes clouds when cloudsEnabled is false', () => {
        setEnvState({ cloudsEnabled: false });
        expect(mockImplDisposeClouds).toHaveBeenCalled();
        expect(mockImplCreateClouds).not.toHaveBeenCalled();
    });

    it('updates hemiLight intensity from getLightState()', () => {
        mockGetLightState.mockReturnValueOnce({
            hemiIntensity: 0.6,
            dirIntensity: 0.4,
            dirX: 0,
            dirY: 1,
            dirZ: 0,
            dirColor: [1, 1, 1],
            hemiColor: [1, 1, 1],
            groundColor: [0.3, 0.3, 0.4],
            shadowEnabled: false,
            shadowType: 'soft',
            shadowCascades: 2,
            shadowResolution: 1024,
            shadowBias: 0.0001,
        });
        setEnvState({ skyMode: 'procedural' });
        expect(mockLightingHemiLight.intensity).toBe(0.6);
    });

    it('sets hemiLight.diffuse from skyColorMid when present', () => {
        mockConfigEnvState.skyColorMid = [0.7, 0.7, 0.8];
        setEnvState({ skyMode: 'procedural' });
        expect(mockLightingHemiLight.diffuse.r).toBe(0.7);
        expect(mockLightingHemiLight.diffuse.g).toBe(0.7);
        expect(mockLightingHemiLight.diffuse.b).toBe(0.8);
    });

    it('computes hemiLight.diffuse as average of top/bot when skyColorMid absent', () => {
        delete mockConfigEnvState.skyColorMid;
        mockConfigEnvState.skyColorTop = [0.4, 0.6, 0.9];
        mockConfigEnvState.skyColorBot = [0.2, 0.4, 0.7];
        setEnvState({});
        const avgR = (0.4 + 0.2) / 2;
        const avgG = (0.6 + 0.4) / 2;
        const avgB = (0.9 + 0.7) / 2;
        expect(mockLightingHemiLight.diffuse.r).toBeCloseTo(avgR);
        expect(mockLightingHemiLight.diffuse.g).toBeCloseTo(avgG);
        expect(mockLightingHemiLight.diffuse.b).toBeCloseTo(avgB);
    });

    it('sets hemiLight.groundColor scaled by 0.5', () => {
        setEnvState({});
        expect(mockLightingHemiLight.groundColor.r).toBeCloseTo(0.15 * 0.5);
        expect(mockLightingHemiLight.groundColor.g).toBeCloseTo(0.15 * 0.5);
        expect(mockLightingHemiLight.groundColor.b).toBeCloseTo(0.18 * 0.5);
    });

    it('sets scene.ambientColor based on envIntensity (capped at 0.5)', () => {
        mockConfigEnvState.envIntensity = 2;
        mockConfigEnvState.skyColorMid = [0.8, 0.8, 0.9];
        setEnvState({});
        expect(mockSceneInstance.ambientColor.r).toBeGreaterThan(0);
        expect(mockSceneInstance.ambientColor.g).toBeGreaterThan(0);
        expect(mockSceneInstance.ambientColor.b).toBeGreaterThan(0);
        expect(mockSceneInstance.ambientColor.r).toBeLessThanOrEqual(0.5);
    });
});

// ──── applyEnvPreset ───────────────────────────────────────────

describe('applyEnvPreset', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns true for a valid preset name', () => {
        const result = applyEnvPreset('noon');
        expect(result).toBe(true);
    });

    it('returns false for an invalid preset name', () => {
        const result = applyEnvPreset('nonexistent');
        expect(result).toBe(false);
    });

    it('returns false for empty preset name', () => {
        const result = applyEnvPreset('');
        expect(result).toBe(false);
    });

    it('calls setSkipLightAutoSave(true) at start', () => {
        applyEnvPreset('noon');
        expect(mockSetSkipLightAutoSave).toHaveBeenCalledWith(true);
    });
});

// ──── applyEnvPresetObject ─────────────────────────────────────

describe('applyEnvPresetObject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        Object.assign(mockConfigEnvState, {
            skyColorTop: [0.3, 0.5, 0.8],
            skyColorMid: [0.8, 0.8, 0.9],
            skyColorBot: [0.2, 0.2, 0.25],
            sunAngle: 45,
            azimuth: -45,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sets envSunAngle from preset', () => {
        applyEnvPresetObject({
            label: 'test',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });
        expect(getEnvSunAngle()).toBe(30);
    });

    it('returns true', () => {
        const result = applyEnvPresetObject({
            label: 'test',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });
        expect(result).toBe(true);
    });

    it('uses deriveLighting when dirDirection is not provided', () => {
        applyEnvPresetObject({
            label: 'sunset',
            skyColorTop: [0.9, 0.45, 0.2],
            skyColorBot: [0.6, 0.2, 0.1],
            sunAngle: 15,
            azimuth: 90,
        });
        expect(mockDeriveLighting).toHaveBeenCalledWith([0.9, 0.45, 0.2], 15, 90);
    });

    it('skips deriveLighting when dirDirection is provided', () => {
        applyEnvPresetObject({
            label: 'noon',
            skyColorTop: [0.53, 0.71, 0.91],
            skyColorBot: [0.3, 0.5, 0.8],
            sunAngle: 75,
            azimuth: -45,
            dirDiffuse: [0.95, 0.95, 0.95],
            dirDirection: [0.3, 0.9, -0.3],
            dirIntensity: 0.9,
            hemiIntensity: 0.5,
        });
        expect(mockDeriveLighting).not.toHaveBeenCalled();
    });

    it('calls setSkipLightAutoSave(true) at start and (false) on completion', () => {
        applyEnvPresetObject({
            label: 'test',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });
        expect(mockSetSkipLightAutoSave).toHaveBeenCalledWith(true);

        vi.advanceTimersByTime(2500);
        const falseCalls = mockSetSkipLightAutoSave.mock.calls.filter(
            (call: any[]) => call[0] === false
        );
        expect(falseCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('calls setLightState during animation', () => {
        applyEnvPresetObject({
            label: 'test',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });
        vi.advanceTimersByTime(100);
        expect(mockSetLightState).toHaveBeenCalled();
    });
});

// ──── setEnvState (central entry) ──────────────────────────────

describe('setEnvState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(globalThis, 'setTimeout');
        vi.spyOn(globalThis, 'clearTimeout');
        Object.assign(mockConfigEnvState, {
            skyMode: 'color',
            skyColorTop: [0.3, 0.5, 0.8],
            skyColorMid: [0.8, 0.8, 0.9],
            skyColorBot: [0.2, 0.2, 0.25],
            sunAngle: 45,
            azimuth: -45,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('merges partial state into envState', () => {
        setEnvState({ sunAngle: 60 });
        expect(mockConfigEnvState.sunAngle).toBe(60);
    });

    it('calls _applyEnvStateFacade (applySky)', () => {
        setEnvState({ skyMode: 'procedural' });
        expect(mockImplApplySky).toHaveBeenCalled();
    });

    it('calls updateWaterAnimSpeed when waterAnimSpeed provided', () => {
        setEnvState({ waterAnimSpeed: 2 });
        expect(mockImplUpdateWaterAnimSpeed).toHaveBeenCalledWith(2);
    });

    it('does NOT call updateWaterAnimSpeed when waterAnimSpeed is undefined', () => {
        setEnvState({ skyMode: 'color' });
        expect(mockImplUpdateWaterAnimSpeed).not.toHaveBeenCalled();
    });

    it('calls applyLightingPresetFromEnv when lightingPresetName provided', () => {
        setEnvState({ lightingPresetName: 'dramatic' });
        expect(mockApplyLightingPresetFromEnv).toHaveBeenCalledWith('dramatic');
    });

    it('does NOT call applyLightingPresetFromEnv when lightingPresetName is undefined', () => {
        setEnvState({ skyMode: 'color' });
        expect(mockApplyLightingPresetFromEnv).not.toHaveBeenCalled();
    });

    it('sets a persistent timer (calls setTimeout)', () => {
        setEnvState({ sunAngle: 50 });
        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);
    });

    it('debounces persistent timer (calls clearTimeout on consecutive calls)', () => {
        setEnvState({ sunAngle: 50 });
        setEnvState({ sunAngle: 55 });
        expect(clearTimeout).toHaveBeenCalled();
        expect((setTimeout as any).mock.calls.length).toBe(2);
    });

    it('fires SetEnvState via timer callback', () => {
        setEnvState({ sunAngle: 50 });
        const callback = (setTimeout as any).mock.calls[0][0];
        expect(callback).toBeInstanceOf(Function);
        callback();
        expect(mockSetEnvState).toHaveBeenCalled();
    });

    it('calls triggerAutoSave by default', () => {
        setEnvState({ sunAngle: 50 });
        expect(mockConfigTriggerAutoSave).toHaveBeenCalledTimes(1);
    });

    it('skips triggerAutoSave when skipAutoSave=true', () => {
        setEnvState({ sunAngle: 50 }, true);
        expect(mockConfigTriggerAutoSave).not.toHaveBeenCalled();
    });

    it('still sets persistent timer when skipAutoSave=true', () => {
        setEnvState({ sunAngle: 50 }, true);
        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);
    });

    it('clears previous timer when setting new one (debounce)', () => {
        setEnvState({ sunAngle: 50 });
        setEnvState({ sunAngle: 55 });
        // clearTimeout is called because _envPersistTimer was non-null from first call
        expect(clearTimeout).toHaveBeenCalled();
        // setTimeout should be called twice (once per setEnvState call)
        expect(setTimeout).toHaveBeenCalledTimes(2);
    });
});

// ──── Time of Day ──────────────────────────────────────────────

describe('Time of Day', () => {
    let registeredTickCallback: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        registeredTickCallback = null;

        mockRegisterSceneTickCallback.mockImplementation((cb?: () => void) => {
            registeredTickCallback = cb;
            return vi.fn();
        });

        setEnvSunAngle(45);
        if (isTimeOfDayActive()) {
            stopTimeOfDay();
        }
    });

    describe('startTimeOfDay', () => {
        afterEach(() => {
            if (isTimeOfDayActive()) {
                stopTimeOfDay();
            }
        });

        it('starts time-of-day and sets active flag', () => {
            startTimeOfDay();
            expect(isTimeOfDayActive()).toBe(true);
        });

        it('calls ensureEnvUpdateObserver', () => {
            startTimeOfDay();
            expect(mockEnsureEnvUpdateObserver).toHaveBeenCalled();
        });

        it('registers tick callback via registerSceneTickCallback', () => {
            startTimeOfDay();
            expect(mockRegisterSceneTickCallback).toHaveBeenCalled();
            expect(registeredTickCallback).not.toBeNull();
        });

        it('uses provided speed parameter', () => {
            startTimeOfDay(10);
            expect(getTimeOfDaySpeed()).toBe(10);
        });

        it('keeps existing speed when no parameter given', () => {
            setTimeOfDaySpeed(5);
            startTimeOfDay();
            expect(getTimeOfDaySpeed()).toBe(5);
        });

        it('is idempotent when already active', () => {
            startTimeOfDay();
            mockRegisterSceneTickCallback.mockClear();
            startTimeOfDay();
            expect(mockRegisterSceneTickCallback).not.toHaveBeenCalled();
        });
    });

    describe('stopTimeOfDay', () => {
        it('clears active flag', () => {
            startTimeOfDay();
            stopTimeOfDay();
            expect(isTimeOfDayActive()).toBe(false);
        });

        it('calls unregister function', () => {
            const unregister = vi.fn();
            mockRegisterSceneTickCallback.mockImplementationOnce(() => unregister);
            startTimeOfDay();
            stopTimeOfDay();
            expect(unregister).toHaveBeenCalled();
        });

        it('calls SetEnvState to persist', () => {
            vi.spyOn(globalThis, 'setTimeout');
            startTimeOfDay();
            mockSetEnvState.mockClear();
            stopTimeOfDay();
            expect(mockSetEnvState).toHaveBeenCalled();
        });
    });

    describe('isTimeOfDayActive', () => {
        it('returns false when not active', () => {
            expect(isTimeOfDayActive()).toBe(false);
        });

        it('returns true after start', () => {
            startTimeOfDay();
            expect(isTimeOfDayActive()).toBe(true);
        });

        it('returns false after stop', () => {
            startTimeOfDay();
            stopTimeOfDay();
            expect(isTimeOfDayActive()).toBe(false);
        });
    });

    describe('speed controls', () => {
        beforeEach(() => {
            setTimeOfDaySpeed(3);
        });

        it('getTimeOfDaySpeed returns 3 initially', () => {
            expect(getTimeOfDaySpeed()).toBe(3);
        });

        it('setTimeOfDaySpeed updates speed', () => {
            setTimeOfDaySpeed(10);
            expect(getTimeOfDaySpeed()).toBe(10);
        });

        it('setTimeOfDaySpeed accepts zero', () => {
            setTimeOfDaySpeed(0);
            expect(getTimeOfDaySpeed()).toBe(0);
        });
    });

    describe('_timeOfDayTick (via registered callback)', () => {
        beforeEach(() => {
            setTimeOfDaySpeed(3);
        });

        afterEach(() => {
            if (isTimeOfDayActive()) {
                stopTimeOfDay();
            }
        });

        it('does nothing when time-of-day is not active', () => {
            startTimeOfDay();
            stopTimeOfDay();
            const prevAngle = getEnvSunAngle();
            expect(isTimeOfDayActive()).toBe(false);

            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(getEnvSunAngle()).toBeCloseTo(prevAngle);
        });

        it('increments envSunAngle by speed * dt when active', () => {
            startTimeOfDay(3);
            const prevAngle = getEnvSunAngle();
            const dt = mockSceneInstance.getAnimationRatio() * (1 / 60);

            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(getEnvSunAngle()).toBeCloseTo(prevAngle + 3 * dt);
        });

        it('wraps sun angle > 90 to -15', () => {
            setEnvSunAngle(89);
            startTimeOfDay(10);
            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(getEnvSunAngle()).toBe(-15);
        });

        it('wraps sun angle < -15 to 90', () => {
            setEnvSunAngle(-14);
            startTimeOfDay(-10);
            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(getEnvSunAngle()).toBe(90);
        });

        it('calls _updateSunDisc every tick', () => {
            startTimeOfDay(3);
            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(mockUpdateSunDisc).toHaveBeenCalled();
        });

        it('calls _applyEnvStateFacade when angle diff >= AUTO_LINK_THRESHOLD_DEG (0.5)', () => {
            startTimeOfDay(3);
            if (registeredTickCallback) {
                registeredTickCallback();
            }
            // sunAngle 属于 skyKeys，只触发 sky 重建，不触发 ground/fog/water（F1 优化：传 partial 避免全量重建）
            expect(mockImplApplySky).toHaveBeenCalled();
            expect(mockImplApplyGround).not.toHaveBeenCalled();
            expect(mockImplApplyFog).not.toHaveBeenCalled();
        });

        it('does NOT call _applyEnvStateFacade for tiny angle changes below threshold', () => {
            mockImplApplySky.mockClear();
            mockImplApplyGround.mockClear();
            mockImplApplyFog.mockClear();

            startTimeOfDay(0.4);
            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(mockImplApplyGround).not.toHaveBeenCalled();
        });

        it('calls impl.applySky when skyMode=procedural and angle diff >= 0.4', () => {
            mockConfigEnvState.skyMode = 'procedural';
            startTimeOfDay(0.5);
            mockImplApplySky.mockClear();

            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(mockImplApplySky).toHaveBeenCalled();
            const arg = mockImplApplySky.mock.calls[0][0];
            expect(arg.skyMode).toBe('procedural');
        });

        it('does NOT call the sky-mode-specific applySky (only from _applyEnvStateFacade) when skyMode is not procedural', () => {
            mockConfigEnvState.skyMode = 'color';
            startTimeOfDay(0.5);
            mockImplApplySky.mockClear();

            if (registeredTickCallback) {
                registeredTickCallback();
            }
            // _applyEnvStateFacade calls applySky unconditionally, so there's 1 call.
            // The skyMode-specific check inside _timeOfDayTick would add a 2nd call.
            // With skyMode='color', only 1 call happens (from _applyEnvStateFacade).
            expect(mockImplApplySky).toHaveBeenCalledTimes(1);
        });
    });
});

// ──── _presetAnimId cancellation ───────────────────────────────

describe('_presetAnimId cancellation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        Object.assign(mockConfigEnvState, {
            skyColorTop: [0.3, 0.5, 0.8],
            skyColorMid: [0.8, 0.8, 0.9],
            skyColorBot: [0.2, 0.2, 0.25],
            sunAngle: 45,
            azimuth: -45,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('second preset cancels first: only one completion fires setSkipLightAutoSave(false)', () => {
        // Start first animation
        applyEnvPresetObject({
            label: 'first',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });

        // Start second animation (cancels first via _presetAnimId)
        applyEnvPresetObject({
            label: 'second',
            skyColorTop: [0.5, 0.6, 0.7],
            skyColorBot: [0.8, 0.9, 1.0],
            sunAngle: 60,
        });

        mockSetSkipLightAutoSave.mockClear();
        vi.advanceTimersByTime(3000);

        // setSkipLightAutoSave(false) fires only once:
        // Cancellation does NOT reset flag (new animation has taken over)
        expect(mockSetSkipLightAutoSave).toHaveBeenLastCalledWith(false);
        const falseCalls = mockSetSkipLightAutoSave.mock.calls.filter(
            (call: any[]) => call[0] === false
        );
        expect(falseCalls.length).toBe(1);
    });

    it('completing second preset calls setLightState at completion', () => {
        applyEnvPresetObject({
            label: 'first',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });

        mockSetLightState.mockClear();

        applyEnvPresetObject({
            label: 'second',
            skyColorTop: [0.5, 0.6, 0.7],
            skyColorBot: [0.8, 0.9, 1.0],
            sunAngle: 60,
        });

        vi.advanceTimersByTime(3000);
        expect(mockSetLightState).toHaveBeenCalled();
    });
});

// ──── Edge cases ───────────────────────────────────────────────

describe('Module-level edge cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('setEnvState catches errors in applySky', () => {
        mockImplApplySky.mockImplementationOnce(() => {
            throw new Error('sky error');
        });
        expect(() => {
            setEnvState({ skyMode: 'procedural', groundColor: [0.5, 0.5, 0.5] });
        }).not.toThrow();
        expect(mockImplApplyGround).toHaveBeenCalled();
    });
});
