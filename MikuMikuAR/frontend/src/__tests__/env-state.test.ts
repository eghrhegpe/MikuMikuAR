import { describe, it, expect } from "vitest";
import type { EnvState } from "../config";

const defaultEnv: EnvState = {
    skyMode: "color",
    skyColorTop: [0.3, 0.5, 0.8],
    skyColorMid: [0.8, 0.8, 0.9],
    skyColorBot: [0.2, 0.2, 0.25],
    skyTexture: "",
    skyRotationY: 0,
    skyBrightness: 1,
    envIntensity: 1,
    groundVisible: true,
    groundMode: "solid",
    groundColor: [0.15, 0.15, 0.18],
    groundAlpha: 0.6,
    windEnabled: false,
    windDirection: [0, 0, 1],
    windSpeed: 1,
    particleEnabled: false,
    particleType: "none",
    cloudsEnabled: false,
    cloudCover: 0.5,
    cloudScale: 1,
    fogEnabled: false,
    fogColor: [0.5, 0.5, 0.6],
    fogDensity: 0.01,
};

describe("EnvState defaults", () => {
    it("has all required fields", () => {
        const keys: (keyof EnvState)[] = [
            "skyMode", "skyColorTop", "skyColorMid", "skyColorBot",
            "skyTexture", "skyRotationY", "skyBrightness", "envIntensity",
            "groundVisible", "groundMode", "groundColor", "groundAlpha",
            "windEnabled", "windDirection", "windSpeed",
            "particleEnabled", "particleType",
            "cloudsEnabled", "cloudCover", "cloudScale",
            "fogEnabled", "fogColor", "fogDensity",
        ];
        for (const k of keys) {
            expect(k in defaultEnv).toBe(true);
        }
    });

    it("skyMode defaults to 'color'", () => {
        expect(defaultEnv.skyMode).toBe("color");
    });

    it("default sky colors are valid RGB arrays", () => {
        for (const c of [defaultEnv.skyColorTop, defaultEnv.skyColorMid, defaultEnv.skyColorBot]) {
            expect(c.length).toBe(3);
            for (const v of c) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            }
        }
    });

    it("wind direction is normalized", () => {
        const d = defaultEnv.windDirection;
        const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        expect(len).toBeCloseTo(1, 5);
    });

    it("cloud cover is between 0 and 1", () => {
        expect(defaultEnv.cloudCover).toBeGreaterThanOrEqual(0);
        expect(defaultEnv.cloudCover).toBeLessThanOrEqual(1);
    });
});

describe("setEnvState partial merge", () => {
    it("partial update preserves other fields", () => {
        const state = { ...defaultEnv };
        const updated = Object.assign(state, { skyMode: "gradient" as const, skyBrightness: 1.5 });
        expect(updated.skyMode).toBe("gradient");
        expect(updated.skyBrightness).toBe(1.5);
        expect(updated.groundVisible).toBe(true);
        expect(updated.envIntensity).toBe(1);
    });
});
