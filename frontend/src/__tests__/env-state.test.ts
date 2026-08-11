import { describe, it, expect, beforeEach } from 'vitest';
import { envState } from '../core/config';
import type { EnvState } from '../core/config';
import { deriveDefaultEnvState } from '../core/env-state-defaults';

// 真实默认值（单一事实源：ENV_STATE_SCHEMA 派生，替代原文件内手写字面量自证）
const defaultEnv: EnvState = deriveDefaultEnvState();

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
            'iblIntensity',
            'groundVisibleEnabled',
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
            'groundElevationColoringEnabled',
            'groundEmissiveColor',
            'groundEmissiveStrength',
            'groundEmissiveReflectMix',
            'groundEmissiveTexture',
            'groundPbrEnabled',
            'groundProceduralTexture',
            'groundProceduralSeed',
            'groundProceduralScale',
            'groundRoughness',
            'groundMetallic',
            'groundReflectionBlur',
            'groundReflectionDistort',
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
            'waterFlipEnabled',
            'waterColor',
            'waterTransparency',
            'waterWaveHeight',
            'waterAnimSpeed',
            'underwaterChromaticAmount',
            'underwaterToneIntensity',
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
            'foamEnabled',
            'foamThreshold',
            'foamIntensity',
            'foamOpacity',
            'foamTransitionRange',
            'foamColor',
            'foamNoiseStrength',
            'waterFogColor',
            'waterFogStart',
            'waterFogEnd',
            'waterFogOpacityInfluence',
            'qualityProfile',
            'cloudEnabled',
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
        expect(updated.groundVisibleEnabled).toBe(defaultEnv.groundVisibleEnabled);
        // 对比真实默认值（schema 派生），不硬编码——原断言 iblIntensity===1 是
        // 自证字面量错误（真实 schema 默认 2），改接真实默认值后暴露
        expect(updated.iblIntensity).toBe(defaultEnv.iblIntensity);
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

    it('iblIntensity does not clobber sky colors', () => {
        setColorField('iblIntensity', 0.5 as any);
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
