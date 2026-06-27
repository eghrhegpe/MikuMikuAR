import { describe, it, expect } from "vitest";
import { DEFAULT_LIPSYNC_STATE, findLipMorph, amplitudeToWeight } from "../lipsync";

describe("findLipMorph", () => {
    it("prefers あ first", () => {
        expect(findLipMorph(["まばたき", "あ", "A"])).toBe("あ");
    });

    it("falls back to A when no あ", () => {
        expect(findLipMorph(["まばたき", "A"])).toBe("A");
    });

    it("falls back to mouth/open", () => {
        expect(findLipMorph(["mouth"])).toBe("mouth");
        expect(findLipMorph(["open"])).toBe("open");
    });

    it("returns null when no candidate matches", () => {
        expect(findLipMorph(["まばたき", "笑い"])).toBeNull();
    });

    it("returns null for empty list", () => {
        expect(findLipMorph([])).toBeNull();
    });
});

describe("amplitudeToWeight", () => {
    it("returns 0 below sensitivity threshold", () => {
        expect(amplitudeToWeight(0.1, 0.2, 0.8)).toBe(0);
        expect(amplitudeToWeight(0.19, 0.2, 0.8)).toBe(0);
    });

    it("returns 0 at exactly threshold (strict less-than)", () => {
        expect(amplitudeToWeight(0.2, 0.2, 0.8)).toBe(0);
    });

    it("maps linearly above threshold", () => {
        // sensitivity=0.2, intensity=0.8, range=0.8
        // amp=0.6 → (0.6-0.2)/0.8 = 0.5 → 0.5*0.8 = 0.4
        expect(amplitudeToWeight(0.6, 0.2, 0.8)).toBeCloseTo(0.4, 3);
    });

    it("scales by intensity at full amplitude", () => {
        expect(amplitudeToWeight(1.0, 0.2, 0.5)).toBeCloseTo(0.5, 3);
        expect(amplitudeToWeight(1.0, 0.2, 1.0)).toBeCloseTo(1.0, 3);
    });

    it("clamps amplitude > 1 to intensity", () => {
        expect(amplitudeToWeight(1.5, 0.2, 0.8)).toBeCloseTo(0.8, 3);
    });

    it("handles sensitivity=0 (full range)", () => {
        expect(amplitudeToWeight(0.5, 0, 1.0)).toBeCloseTo(0.5, 3);
    });

    it("handles sensitivity=1 (deadband edge)", () => {
        // range = 0 → amp >= 1 returns intensity; amp < 1 returns 0
        expect(amplitudeToWeight(0.9, 1, 0.8)).toBe(0);
        expect(amplitudeToWeight(1.0, 1, 0.8)).toBeCloseTo(0.8, 3);
    });
});

describe("DEFAULT_LIPSYNC_STATE", () => {
    it("starts disabled", () => {
        expect(DEFAULT_LIPSYNC_STATE.enabled).toBe(false);
    });

    it("has sensible defaults", () => {
        expect(DEFAULT_LIPSYNC_STATE.sensitivity).toBeGreaterThan(0);
        expect(DEFAULT_LIPSYNC_STATE.sensitivity).toBeLessThan(1);
        expect(DEFAULT_LIPSYNC_STATE.intensity).toBeGreaterThan(0);
        expect(DEFAULT_LIPSYNC_STATE.intensity).toBeLessThanOrEqual(1);
    });
});
