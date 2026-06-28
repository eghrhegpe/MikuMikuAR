import { describe, it, expect, beforeEach } from "vitest";
import { envState } from "../core/config";

/**
 * Tests envState color field integrity.
 * These are pure state tests — they verify that setting one color field
 * never corrupts another, which is the root cause of "slider cross-wiring".
 *
 * WARNING: Do NOT import from scene.ts here (needs WebGL).
 * setEnvState from scene.ts also applies Babylon side effects;
 * this test verifies the envState object remains correct regardless.
 */

function setColorField<K extends keyof typeof envState>(
    key: K,
    value: typeof envState[K],
) {
    // Simulates what setEnvState does internally
    Object.assign(envState, { [key]: value });
}

describe("envState — color field isolation", () => {
    beforeEach(() => {
        // Reset to known base state before each test
        envState.skyColorTop = [0.3, 0.5, 0.8];
        envState.skyColorBot = [0.2, 0.2, 0.25];
        envState.skyColorMid = [0.8, 0.8, 0.9];
    });

    it("skyColorTop does not leak into skyColorBot", () => {
        setColorField("skyColorTop", [0.8, 0.2, 0.2]);
        expect(envState.skyColorTop).toEqual([0.8, 0.2, 0.2]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it("skyColorBot does not leak into skyColorTop", () => {
        setColorField("skyColorBot", [0.1, 0.9, 0.3]);
        expect(envState.skyColorBot).toEqual([0.1, 0.9, 0.3]);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it("skyColorMid is independent", () => {
        setColorField("skyColorMid", [1, 0, 1]);
        expect(envState.skyColorMid).toEqual([1, 0, 1]);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it("rapid sequential calls preserve final values", () => {
        setColorField("skyColorTop", [0.5, 0.5, 0.5]);
        setColorField("skyColorBot", [0.7, 0.3, 0.7]);
        setColorField("skyColorTop", [0.9, 0.1, 0.9]);
        setColorField("skyColorBot", [0.2, 0.8, 0.2]);

        expect(envState.skyColorTop).toEqual([0.9, 0.1, 0.9]);
        expect(envState.skyColorBot).toEqual([0.2, 0.8, 0.2]);
    });

    it("envIntensity does not clobber sky colors", () => {
        setColorField("envIntensity", 0.5 as any);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it("skyBrightness does not clobber sky colors", () => {
        setColorField("skyBrightness", 2 as any);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it("mode switch to gradient does not mute color state", () => {
        setColorField("skyMode", "gradient" as any);
        expect(envState.skyMode).toBe("gradient");
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it("rapid skyColorTop drags keep bot unchanged", () => {
        setColorField("skyColorTop", [1, 0, 0]);
        setColorField("skyColorTop", [1, 0.5, 0]);
        setColorField("skyColorTop", [1, 0.5, 0.8]);

        expect(envState.skyColorTop).toEqual([1, 0.5, 0.8]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it("rapid skyColorBot drags keep top unchanged", () => {
        setColorField("skyColorBot", [0, 1, 0]);
        setColorField("skyColorBot", [0, 0, 1]);
        setColorField("skyColorBot", [0.5, 0.5, 0.8]);

        expect(envState.skyColorBot).toEqual([0.5, 0.5, 0.8]);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it("never produces black from color manipulation", () => {
        // Simulate the real slider interaction pattern
        for (let i = 0; i < 10; i++) {
            setColorField("skyColorTop", [0.3 + i * 0.05, 0.5, 0.8]);
            setColorField("skyColorBot", [0.2, 0.2 + i * 0.05, 0.25]);
        }
        expect(envState.skyColorTop[0]).toBeGreaterThan(0);
        expect(envState.skyColorTop[1]).toBeGreaterThan(0);
        expect(envState.skyColorTop[2]).toBeGreaterThan(0);
        expect(envState.skyColorBot[0]).toBeGreaterThan(0);
        expect(envState.skyColorBot[1]).toBeGreaterThan(0);
        expect(envState.skyColorBot[2]).toBeGreaterThan(0);
    });
});
