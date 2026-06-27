import { describe, it, expect } from "vitest";
import { BeatDetector } from "../beat-detector";

describe("BeatDetector.detectBeatsFromEnergies", () => {
    it("detects beats in periodic energy peaks", () => {
        // 模拟 120 BPM @ 43fps：每 ~21 帧一个峰值 (60000/120/1000*43 ≈ 21.5)
        const energies: number[] = [];
        for (let i = 0; i < 200; i++) {
            const peak = (i % 21 === 0) ? 200 : 20;
            energies.push(peak + Math.random() * 5);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies);
        expect(beats.length).toBeGreaterThan(3);
        expect(beats[0] % 21).toBeLessThan(3);
    });

    it("no beats when energy is flat", () => {
        const energies = new Array(100).fill(50);
        const beats = BeatDetector.detectBeatsFromEnergies(energies);
        expect(beats.length).toBe(0);
    });

    it("respects minInterval between beats", () => {
        const energies = new Array(50).fill(200); // all high
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 6);
        // 第一帧触发，之后受 minInterval 限制
        expect(beats.length).toBeLessThan(10);
        for (let i = 1; i < beats.length; i++) {
            expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(6);
        }
    });

    it("threshold filters weak peaks", () => {
        const energies: number[] = [];
        for (let i = 0; i < 100; i++) {
            energies.push((i % 21 === 0) ? 35 : 20);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 6);
        // 35 vs avg ~21 → 35/21 ≈ 1.67 > 1.3 → should detect
        expect(beats.length).toBeGreaterThan(0);
    });
});

describe("BeatDetector.bpmFromIntervals", () => {
    it("120 BPM from 500ms intervals", () => {
        const intervals = [500, 500, 500, 500];
        expect(BeatDetector.bpmFromIntervals(intervals)).toBe(120);
    });

    it("60 BPM from 1000ms intervals", () => {
        expect(BeatDetector.bpmFromIntervals([1000, 1000])).toBe(60);
    });

    it("defaults to 120 for empty input", () => {
        expect(BeatDetector.bpmFromIntervals([])).toBe(120);
    });

    it("handles variable intervals (average)", () => {
        // 400 + 600 = 1000ms → avg 500 → 120 BPM
        expect(BeatDetector.bpmFromIntervals([400, 600])).toBe(120);
    });
});

describe("BeatDetector instance", () => {
    it("reset restores defaults", () => {
        const bd = new BeatDetector();
        bd.reset();
        expect(bd.getBPM()).toBe(120);
        expect(bd.hasAudio()).toBe(false);
    });

    it("getBeatPhase returns 0..1", () => {
        const bd = new BeatDetector();
        bd.reset();
        const phase = bd.getBeatPhase();
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThanOrEqual(1);
    });
});

describe("BeatDetector.getLevel (static)", () => {
    it("returns 0 for empty data", () => {
        expect(BeatDetector.getLevel(new Uint8Array(0))).toBe(0);
    });

    it("computes average of full range (0..1 normalized)", () => {
        const data = new Uint8Array([0, 128, 255]);
        // (0+128+255)/3/255 ≈ 0.502
        expect(BeatDetector.getLevel(data)).toBeCloseTo(0.502, 2);
    });

    it("respects bin range", () => {
        const data = new Uint8Array([0, 0, 255, 255]);
        expect(BeatDetector.getLevel(data, 2, 4)).toBeCloseTo(1, 2);
        expect(BeatDetector.getLevel(data, 0, 2)).toBe(0);
    });

    it("clamps end to data length", () => {
        const data = new Uint8Array([100, 200]);
        expect(BeatDetector.getLevel(data, 0, 99)).toBeCloseTo((100 + 200) / 2 / 255, 2);
    });

    it("returns 0 when end <= start", () => {
        const data = new Uint8Array([100, 200]);
        expect(BeatDetector.getLevel(data, 2, 2)).toBe(0);
        expect(BeatDetector.getLevel(data, 3, 1)).toBe(0);
    });
});
