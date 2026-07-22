import { describe, it, expect, beforeEach } from 'vitest';
import { envState } from '../core/config';
import type { EnvState } from '../core/config';

const defaultEnv: EnvState = {
    skyMode: 'color',
    skyColorTop: [0.3, 0.5, 0.8],
    skyColorMid: [0.8, 0.8, 0.9],
    skyColorBot: [0.2, 0.2, 0.25],
    skyTexture: '',
    skyRotationY: 0,
    skyRotationSpeed: 0,
    skyBrightness: 1,
    envIntensity: 1,
    envBrightness: 1,
    starsEnabled: false,
    starsTexture: '',
    groundVisible: true,
    groundType: 'flat',
    groundStyle: 'solid',
    groundDecoStyle: 'none',
    groundColor: [0.15, 0.15, 0.18],
    groundAlpha: 0.6,
    groundTexture: '',
    groundTextureEnabled: false,
    groundTextureScale: 1,
    groundTextureRotation: 0,
    groundGridSize: 1,
    groundLineColor: [0.5, 0.5, 0.55],
    groundTerrainHeight: 4,
    groundTerrainScale: 0.06,
    groundTerrainSeed: 1337,
    groundTerrainOctaves: 5,
    groundPitch: 0,
    groundRoll: 0,
    groundScrollSpeedX: 0,
    groundScrollSpeedZ: 0,
    groundPattern: 'checker',
    groundReflectionBlend: 0.3,
    groundReflectionQuality: 'medium',
    groundNormalTexture: '',
    groundNormalStrength: 1,
    groundElevationColoring: false,
    groundInfinite: false,
    groundPbrEnabled: false,
    groundProceduralTexture: 'none',
    groundProceduralSeed: 42,
    groundProceduralScale: 1.0,
    groundRoughness: 0.6,
    groundMetallic: 0.0,
    groundReflectionBlur: 0.0,
    groundReflectionDistort: 0.3,
    groundContactShadowEnabled: false,
    groundContactShadowIntensity: 0.5,
    groundContactShadowDistance: 0.5,
    windEnabled: false,
    windDirection: [0, 0, 1],
    windSpeed: 1,
    particleEnabled: false,
    particleType: 'none',
    particleEmitRate: 1,
    particleSize: 1,
    particleSpeed: 1,
    particleSplash: false,
    particleCustomTexture: '',
    particleQuality: 'high',
    groundLevel: 0,
    groundSize: 60,
    groundEdgeFade: 0,
    waterEnabled: false,
    waterLevel: 0,
    waterFlip: false,
    waterColor: [0.15, 0.4, 0.6],
    waterTransparency: 0.88,
    waterWaveHeight: 0.15,
    bigWaveHeight: 1.0,
    smallWaveHeight: 1.0,
    waterSize: 50,
    waterAnimSpeed: 0.2,
    fresnelBias: 0.02,
    fresnelPower: 3.0,
    diffuseStrength: 0.15,
    ambientStrength: 0.15,
    waterRippleSlots: 256,
    rippleNormalStrength: 0.15,
    rippleGlintStrength: 0.25,
    waterNormalStrength: 0.15,
    waterGlintStrength: 0,
    waterHorizonFade: 0,
    waterSkyColorBlend: 0,
    causticIntensity: 0.1,
    causticColor1: [1.0, 0.9, 0.6],
    causticColor2: [1.0, 1.0, 0.8],
    causticScrollX: 0.1,
    causticScrollY: 0.15,
    fresnelAlphaInfluence: 0.35,
    waterFogColor: [0.5, 0.52, 0.62],
    waterFogDensity: 0.006,
    waterFogOpacityInfluence: 0,
    underwaterFogDensity: 0.015,
    underwaterTintStrength: 0.5,
    underwaterChromaticAmount: 20,
    underwaterToneIntensity: 0.5,
    underwaterFogMultiplier: 2,
    cloudsEnabled: false,
    debugClouds: false,
    mirrorEnabled: false,
    cloudCover: 0.5,
    cloudScale: 1,
    cloudHeight: 100,
    cloudThickness: 40,
    cloudGap: 0.1,
    cloudVisibility: 2000,
    cloudErosion: 0.4,
    cloudWeatherStrength: 0.6,
    cloudBacklight: 0.5,
    cloudPowder: 0.8,
    cloudQuality: 'high',
    fogEnabled: false,
    fogColor: [0.5, 0.5, 0.6],
    fogDensity: 0.01,
    fogMode: 'exp2',
    fogStart: 10,
    fogEnd: 100,
    collisionEnabled: true,
    bodyCollisionEnabled: true,
    groundCollisionEnabled: true,
    sunAngle: 45,
    azimuth: -45,
    lightingPresetName: undefined,
    timeOfDayActive: false,
    timeOfDaySpeed: 3,

    // [adr-074] 平面反射孤儿字段（当前无消费方，仅满足 EnvState 类型约束）
    planarReflectBlend: 0.5,
    reflectionQuality: 'low',
    reflectionMode: 'planar',
    qualityProfile: 'high',
};

describe('EnvState defaults', () => {
    it('has all required fields', () => {
        const keys: (keyof EnvState)[] = [
            'skyMode',
            'skyColorTop',
            'skyColorMid',
            'skyColorBot',
            'skyTexture',
            'skyRotationY',
            'skyRotationSpeed',
            'skyBrightness',
            'starsEnabled',
            'envIntensity',
            'groundVisible',
            'groundType',
            'groundStyle',
            'groundColor',
            'groundAlpha',
            'groundTexture',
            'groundTextureEnabled',
            'groundTextureScale',
            'groundTextureRotation',
            'groundGridSize',
            'groundLineColor',
            'groundTerrainHeight',
            'groundTerrainScale',
            'groundTerrainSeed',
            'groundTerrainOctaves',
            'groundPitch',
            'groundRoll',
            'groundScrollSpeedX',
            'groundScrollSpeedZ',
            'groundPattern',
            'groundReflectionBlend',
            'groundReflectionQuality',
            'groundNormalTexture',
            'groundNormalStrength',
            'groundElevationColoring',
            'groundPbrEnabled',
            'groundProceduralTexture',
            'groundProceduralSeed',
            'groundProceduralScale',
            'groundRoughness',
            'groundMetallic',
            'groundReflectionBlur',
            'groundReflectionDistort',
            'groundContactShadowEnabled',
            'groundContactShadowIntensity',
            'groundContactShadowDistance',
            'windEnabled',
            'windDirection',
            'windSpeed',
            'particleEnabled',
            'particleType',
            'groundLevel',
            'groundSize',
            'groundEdgeFade',
            'waterEnabled',
            'waterLevel',
            'waterFlip',
            'waterColor',
            'waterTransparency',
            'waterWaveHeight',
            'waterSize',
            'waterAnimSpeed',
            'underwaterFogDensity',
            'underwaterChromaticAmount',
            'underwaterToneIntensity',
            'underwaterFogMultiplier',
            'underwaterTintStrength',
            'fresnelBias',
            'fresnelPower',
            'diffuseStrength',
            'ambientStrength',
            'rippleNormalStrength',
            'rippleGlintStrength',
            'causticColor1',
            'causticColor2',
            'causticScrollX',
            'causticScrollY',
            'fresnelAlphaInfluence',
            'waterFogColor',
            'waterFogDensity',
            'waterFogOpacityInfluence',
            'qualityProfile',
            'cloudsEnabled',
            'cloudCover',
            'cloudScale',
            'cloudHeight',
            'cloudThickness',
            'cloudGap',
            'cloudVisibility',
            'fogEnabled',
            'fogColor',
            'fogDensity',
            'fogMode',
            'fogStart',
            'fogEnd',
        ];
        for (const k of keys) {
            expect(k in defaultEnv).toBe(true);
        }
    });

    it("skyMode defaults to 'color'", () => {
        expect(defaultEnv.skyMode).toBe('color');
    });

    it('default sky colors are valid RGB arrays', () => {
        for (const c of [defaultEnv.skyColorTop, defaultEnv.skyColorMid, defaultEnv.skyColorBot]) {
            expect(c.length).toBe(3);
            for (const v of c) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            }
        }
    });

    it('wind direction is normalized', () => {
        const d = defaultEnv.windDirection;
        const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        expect(len).toBeCloseTo(1, 5);
    });

    it('cloud cover is between 0 and 1', () => {
        expect(defaultEnv.cloudCover).toBeGreaterThanOrEqual(0);
        expect(defaultEnv.cloudCover).toBeLessThanOrEqual(1);
    });
});

describe('setEnvState partial merge', () => {
    it('partial update preserves other fields', () => {
        const state = { ...defaultEnv };
        const updated = Object.assign(state, {
            skyMode: 'procedural' as const,
            skyBrightness: 1.5,
        });
        expect(updated.skyMode).toBe('procedural');
        expect(updated.skyBrightness).toBe(1.5);
        expect(updated.groundVisible).toBe(true);
        expect(updated.envIntensity).toBe(1);
    });
});

// ====================================================================
// EnvState 颜色字段隔离（env-state-integrity 合并）
// ====================================================================

function setColorField<K extends keyof typeof envState>(key: K, value: (typeof envState)[K]) {
    Object.assign(envState, { [key]: value });
}

describe('envState — color field isolation', () => {
    beforeEach(() => {
        envState.skyColorTop = [0.3, 0.5, 0.8];
        envState.skyColorBot = [0.2, 0.2, 0.25];
        envState.skyColorMid = [0.8, 0.8, 0.9];
    });

    it('skyColorTop does not leak into skyColorBot', () => {
        setColorField('skyColorTop', [0.8, 0.2, 0.2]);
        expect(envState.skyColorTop).toEqual([0.8, 0.2, 0.2]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it('skyColorBot does not leak into skyColorTop', () => {
        setColorField('skyColorBot', [0.1, 0.9, 0.3]);
        expect(envState.skyColorBot).toEqual([0.1, 0.9, 0.3]);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it('skyColorMid is independent', () => {
        setColorField('skyColorMid', [1, 0, 1]);
        expect(envState.skyColorMid).toEqual([1, 0, 1]);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it('rapid sequential calls preserve final values', () => {
        setColorField('skyColorTop', [0.5, 0.5, 0.5]);
        setColorField('skyColorBot', [0.7, 0.3, 0.7]);
        setColorField('skyColorTop', [0.9, 0.1, 0.9]);
        setColorField('skyColorBot', [0.2, 0.8, 0.2]);
        expect(envState.skyColorTop).toEqual([0.9, 0.1, 0.9]);
        expect(envState.skyColorBot).toEqual([0.2, 0.8, 0.2]);
    });

    it('envIntensity does not clobber sky colors', () => {
        setColorField('envIntensity', 0.5 as any);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it('skyBrightness does not clobber sky colors', () => {
        setColorField('skyBrightness', 2 as any);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it('mode switch to gradient does not mute color state', () => {
        setColorField('skyMode', 'gradient' as any);
        expect(envState.skyMode).toBe('gradient');
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it('rapid skyColorTop drags keep bot unchanged', () => {
        setColorField('skyColorTop', [1, 0, 0]);
        setColorField('skyColorTop', [1, 0.5, 0]);
        setColorField('skyColorTop', [1, 0.5, 0.8]);
        expect(envState.skyColorTop).toEqual([1, 0.5, 0.8]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it('rapid skyColorBot drags keep top unchanged', () => {
        setColorField('skyColorBot', [0, 1, 0]);
        setColorField('skyColorBot', [0, 0, 1]);
        setColorField('skyColorBot', [0.5, 0.5, 0.8]);
        expect(envState.skyColorBot).toEqual([0.5, 0.5, 0.8]);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it('never produces black from color manipulation', () => {
        for (let i = 0; i < 10; i++) {
            setColorField('skyColorTop', [0.3 + i * 0.05, 0.5, 0.8]);
            setColorField('skyColorBot', [0.2, 0.2 + i * 0.05, 0.25]);
        }
        expect(envState.skyColorTop[0]).toBeGreaterThan(0);
        expect(envState.skyColorTop[1]).toBeGreaterThan(0);
        expect(envState.skyColorTop[2]).toBeGreaterThan(0);
        expect(envState.skyColorBot[0]).toBeGreaterThan(0);
        expect(envState.skyColorBot[1]).toBeGreaterThan(0);
        expect(envState.skyColorBot[2]).toBeGreaterThan(0);
    });
});
