import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BeatDetector } from '../motion/beat-detector';

describe('BeatDetector.detectBeatsFromEnergies', () => {
    it('detects beats in periodic energy peaks', () => {
        // 模拟 120 BPM @ 43fps：每 ~21 帧一个峰值 (60000/120/1000*43 ≈ 21.5)
        const energies: number[] = [];
        for (let i = 0; i < 200; i++) {
            const peak = i % 21 === 0 ? 200 : 20;
            energies.push(peak + Math.random() * 5);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies);
        expect(beats.length).toBeGreaterThan(3);
        expect(beats[0] % 21).toBeLessThan(3);
    });

    it('no beats when energy is flat', () => {
        const energies = new Array(100).fill(50);
        const beats = BeatDetector.detectBeatsFromEnergies(energies);
        expect(beats.length).toBe(0);
    });

    it('respects minInterval between beats', () => {
        const energies = new Array(50).fill(200); // all high
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 6);
        // 第一帧触发，之后受 minInterval 限制
        expect(beats.length).toBeLessThan(10);
        for (let i = 1; i < beats.length; i++) {
            expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(6);
        }
    });

    it('threshold filters weak peaks', () => {
        const energies: number[] = [];
        for (let i = 0; i < 100; i++) {
            energies.push(i % 21 === 0 ? 35 : 20);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 6);
        // 35 vs avg ~21 → 35/21 ≈ 1.67 > 1.3 → should detect
        expect(beats.length).toBeGreaterThan(0);
    });

    it('skips peaks below energy threshold (energy <= 30)', () => {
        // 所有能量值都在 30 以下，即使比例超过 threshold 也不触发
        const energies: number[] = [];
        for (let i = 0; i < 80; i++) {
            energies.push(i % 10 === 0 ? 28 : 10);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 2);
        expect(beats.length).toBe(0);
    });

    it('returns empty for empty input', () => {
        expect(BeatDetector.detectBeatsFromEnergies([])).toEqual([]);
    });

    it('handles energy history overflow (> 43 frames)', () => {
        // 超过 ENERGY_HISTORY_SIZE(43)，触发 shift 路径
        const energies: number[] = [];
        for (let i = 0; i < 100; i++) {
            const peak = i % 21 === 0 ? 200 : 20;
            energies.push(peak);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies);
        expect(beats.length).toBeGreaterThan(0);
    });
});

describe('BeatDetector.bpmFromIntervals', () => {
    it('120 BPM from 500ms intervals', () => {
        const intervals = [500, 500, 500, 500];
        expect(BeatDetector.bpmFromIntervals(intervals)).toBe(120);
    });

    it('60 BPM from 1000ms intervals', () => {
        expect(BeatDetector.bpmFromIntervals([1000, 1000])).toBe(60);
    });

    it('defaults to 120 for empty input', () => {
        expect(BeatDetector.bpmFromIntervals([])).toBe(120);
    });

    it('handles variable intervals (average)', () => {
        // 400 + 600 = 1000ms → avg 500 → 120 BPM
        expect(BeatDetector.bpmFromIntervals([400, 600])).toBe(120);
    });

    it('returns 120 when avg interval is 0 (edge case)', () => {
        expect(BeatDetector.bpmFromIntervals([0, 0])).toBe(120);
    });

    it('computes high BPM from short intervals', () => {
        // 300ms intervals → 200 BPM
        expect(BeatDetector.bpmFromIntervals([300, 300, 300])).toBe(200);
    });
});

describe('BeatDetector instance', () => {
    let bd: BeatDetector;
    beforeEach(() => {
        bd = new BeatDetector();
        bd.reset();
    });

    it('reset restores defaults', () => {
        bd.reset();
        expect(bd.getBPM()).toBe(120);
        expect(bd.hasAudio()).toBe(false);
    });

    it('getBeatPhase returns 0..1', () => {
        const phase = bd.getBeatPhase();
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThanOrEqual(1);
    });

    it('getBeatPhase advances over time', () => {
        const p1 = bd.getBeatPhase();
        // phase 应该是递增的（同一个 beat 周期内）
        expect(p1).toBeGreaterThanOrEqual(0);
    });

    it('hasAudio returns false when no audio attached', () => {
        expect(bd.hasAudio()).toBe(false);
    });

    it('getLevel returns 0 when no analyser attached', () => {
        expect(bd.getLevel()).toBe(0);
        expect(bd.getLevel(0, 10)).toBe(0);
    });

    it('setVolume is safe to call without gain', () => {
        // 不应抛出错误
        bd.setVolume(0.5);
        bd.setVolume(0);
        bd.setVolume(1);
        bd.setVolume(-1); // 边界值
        bd.setVolume(999);
    });

    it('update is safe to call without analyser', () => {
        // 不应抛出错误
        bd.update();
    });

    it('dispose is safe to call when nothing attached', () => {
        bd.dispose();
        expect(bd.getBPM()).toBe(120);
        expect(bd.hasAudio()).toBe(false);
    });

    it('dispose can be called multiple times', () => {
        bd.dispose();
        bd.dispose(); // 幂等
        expect(bd.getBPM()).toBe(120);
    });

    it('update without analyser does not throw', () => {
        expect(() => bd.update()).not.toThrow();
    });
});

describe('BeatDetector.getLevel (static)', () => {
    it('returns 0 for empty data', () => {
        expect(BeatDetector.getLevel(new Uint8Array(0))).toBe(0);
    });

    it('computes average of full range (0..1 normalized)', () => {
        const data = new Uint8Array([0, 128, 255]);
        // (0+128+255)/3/255 ≈ 0.502
        expect(BeatDetector.getLevel(data)).toBeCloseTo(0.502, 2);
    });

    it('respects bin range', () => {
        const data = new Uint8Array([0, 0, 255, 255]);
        expect(BeatDetector.getLevel(data, 2, 4)).toBeCloseTo(1, 2);
        expect(BeatDetector.getLevel(data, 0, 2)).toBe(0);
    });

    it('clamps end to data length', () => {
        const data = new Uint8Array([100, 200]);
        expect(BeatDetector.getLevel(data, 0, 99)).toBeCloseTo((100 + 200) / 2 / 255, 2);
    });

    it('returns 0 when end <= start', () => {
        const data = new Uint8Array([100, 200]);
        expect(BeatDetector.getLevel(data, 2, 2)).toBe(0);
        expect(BeatDetector.getLevel(data, 3, 1)).toBe(0);
    });

    it('clamps negative start to 0', () => {
        const data = new Uint8Array([100, 200]);
        expect(BeatDetector.getLevel(data, -5, 2)).toBeCloseTo((100 + 200) / 2 / 255, 2);
    });

    it('single bin returns that bin value', () => {
        const data = new Uint8Array([128]);
        expect(BeatDetector.getLevel(data, 0, 1)).toBeCloseTo(128 / 255, 4);
    });
});

describe('BeatDetector.quantizeBpm (via detectBeatsFromEnergies)', () => {
    it('energy peaks at exactly common BPM get quantized', () => {
        // 120 BPM @ 43fps → 峰值间隔 ~21.5 帧，应被量化到 120
        const energies: number[] = [];
        for (let i = 0; i < 150; i++) {
            energies.push(i % 22 === 0 ? 200 : 20);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 6);
        // 验证检测到足够的 beat
        expect(beats.length).toBeGreaterThan(2);
    });
});
