import { describe, it, expect } from "vitest";
import { deriveLighting, calcLuminance, ENV_PRESETS } from "../scene/env-lighting";

describe("calcLuminance", () => {
    it("white is 1.0", () => {
        expect(calcLuminance([1, 1, 1])).toBeCloseTo(1, 3);
    });
    it("black is 0", () => {
        expect(calcLuminance([0, 0, 0])).toBe(0);
    });
    it("mid gray ~0.5", () => {
        expect(calcLuminance([0.5, 0.5, 0.5])).toBeCloseTo(0.5, 3);
    });
});

describe("deriveLighting", () => {
    it("noon: bright warm-white light", () => {
        const l = deriveLighting([0.53, 0.71, 0.91], 75);
        expect(l.dirIntensity).toBeGreaterThan(0.8);
        expect(l.hemiIntensity).toBeLessThan(0.6);
        expect(l.dirDiffuse[0]).toBeGreaterThan(0.8);
    });

    it("night: dim cool light, below-horizon direction", () => {
        const l = deriveLighting([0.05, 0.05, 0.15], -15);
        expect(l.dirIntensity).toBeCloseTo(0.15, 2);
        expect(l.hemiIntensity).toBeGreaterThan(0.8);
        expect(l.dirDirection[1]).toBeLessThan(0);
    });

    it("sunset: warm light, low angle", () => {
        const l = deriveLighting([0.9, 0.45, 0.2], 15);
        expect(l.dirDiffuse[0]).toBeGreaterThan(l.dirDiffuse[2]);
        expect(l.dirDirection[1]).toBeGreaterThan(0);
        expect(l.dirDirection[1]).toBeLessThan(0.5);
    });
});

describe("ENV_PRESETS", () => {
    it("has all 7 presets", () => {
        expect(Object.keys(ENV_PRESETS)).toEqual(["noon", "sunset", "night", "overcast", "dawn", "dusk", "midnight"]);
    });

    it("each preset has all required fields", () => {
        for (const [key, p] of Object.entries(ENV_PRESETS)) {
            expect(p.label).toBeTruthy();
            expect(p.dirDiffuse).toHaveLength(3);
            expect(p.dirDirection).toHaveLength(3);
            expect(p.dirIntensity).toBeGreaterThan(0);
            expect(p.hemiIntensity).toBeGreaterThan(0);
        }
    });
});
