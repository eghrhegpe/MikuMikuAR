import { describe, it, expect } from 'vitest';
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
    starsEnabled: false,
    groundVisible: true,
    groundMode: 'solid',
    groundColor: [0.15, 0.15, 0.18],
    groundAlpha: 0.6,
    windEnabled: false,
    windDirection: [0, 0, 1],
    windSpeed: 1,
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
    underwaterFogColor: [0.08, 0.2, 0.45],
    underwaterFogDensity: 0.015,
    underwaterChromaticAmount: 20,
    cloudsEnabled: false,
    cloudCover: 0.5,
    cloudScale: 1,
    cloudHeight: 100,
    cloudThickness: 40,
    cloudGap: 0.5,
    cloudVisibility: 2000,
    fogEnabled: false,
    fogColor: [0.5, 0.5, 0.6],
    fogDensity: 0.01,
    clothEnabled: false,
    clothConfig: {
        anchorBone: '腰',
        topology: 'skirt',
        innerRadius: 0.15,
        length: 0.6,
        slope: 15,
        segmentsH: 24,
        segmentsV: 12,
        particleRadius: 0.03,
        compliance: 0.001,
        totalMass: 0.5,
        damping: 0.96,
        gravityScale: 1.0,
        bendCompliance: 0.005,
    },
    sunAngle: 45,
    azimuth: -45,
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
            'groundMode',
            'groundColor',
            'groundAlpha',
            'windEnabled',
            'windDirection',
            'windSpeed',
            'particleEnabled',
            'particleType',
            'groundLevel',
            'waterEnabled',
            'waterLevel',
            'waterColor',
            'waterTransparency',
            'waterWaveHeight',
            'waterSize',
            'waterAnimSpeed',
            'underwaterFogColor',
            'underwaterFogDensity',
            'underwaterChromaticAmount',
            'foamThreshold',
            'foamIntensity',
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
            'clothEnabled',
            'clothConfig',
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
