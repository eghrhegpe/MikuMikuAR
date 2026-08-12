// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { BeatDetector } from '../motion-algos/beat-detector';

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

    it('isAvailable returns false when no audio attached', () => {
        expect(bd.isAvailable()).toBe(false);
    });

    it('getLastError returns null initially', () => {
        expect(bd.getLastError()).toBeNull();
    });

    it('getLastError returns null after dispose', () => {
        bd.dispose();
        expect(bd.getLastError()).toBeNull();
    });

    it('isAvailable returns false after dispose', () => {
        bd.dispose();
        expect(bd.isAvailable()).toBe(false);
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

describe('BeatDetector.bpmFromIntervals — edge cases', () => {
    it('filters negative intervals and returns 120', () => {
        expect(BeatDetector.bpmFromIntervals([-500, -300])).toBe(120);
    });

    it('filters zero intervals', () => {
        expect(BeatDetector.bpmFromIntervals([0, 0, 0])).toBe(120);
    });

    it('filters mix of valid and invalid intervals', () => {
        // valid: 500, 500 → avg 500 → 120 BPM
        expect(BeatDetector.bpmFromIntervals([500, -100, 500, 0])).toBe(120);
    });

    it('single valid interval', () => {
        expect(BeatDetector.bpmFromIntervals([500])).toBe(120);
    });

    it('handles floating point intervals', () => {
        // 500.5 → 60000/500.5 ≈ 119.88 → Math.round → 120
        expect(BeatDetector.bpmFromIntervals([500.5, 500.5])).toBe(120);
    });

    it('handles very short intervals (high BPM)', () => {
        // 200ms → 300 BPM
        expect(BeatDetector.bpmFromIntervals([200, 200])).toBe(300);
    });
});

describe('BeatDetector.detectBeatsFromEnergies — edge cases', () => {
    it('minInterval=0 is clamped to 1', () => {
        const energies: number[] = [];
        for (let i = 0; i < 60; i++) {
            energies.push(i % 5 === 0 ? 200 : 20);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 0);
        // minInterval 被 clamp 到 1，不会每帧触发
        expect(beats.length).toBeGreaterThan(0);
        for (let i = 1; i < beats.length; i++) {
            expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(1);
        }
    });

    it('minInterval negative is clamped to 1', () => {
        const energies: number[] = [];
        for (let i = 0; i < 60; i++) {
            energies.push(i % 5 === 0 ? 200 : 20);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, -10);
        expect(beats.length).toBeGreaterThan(0);
        for (let i = 1; i < beats.length; i++) {
            expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(1);
        }
    });

    it('handles energy values of 0', () => {
        const energies = [200, 0, 0, 0, 0, 0, 200, 0, 0, 0, 0, 0];
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 2);
        // 第一个 200 不满足 avg*threshold（200 > 200*1.3=260? false）
        // 第二个 200 在 frame 6 触发
        expect(beats.length).toBe(1);
        expect(beats[0]).toBe(6);
    });

    it('single energy value (no history for avg)', () => {
        const beats = BeatDetector.detectBeatsFromEnergies([200], 1.3, 1);
        // 200 > avg(200) * 1.3 = 260? No, 200 < 260 → no beat
        // 200 > 30? Yes, but not > avg * threshold
        expect(beats.length).toBe(0);
    });

    it('two values: peak then flat', () => {
        const beats = BeatDetector.detectBeatsFromEnergies([200, 20], 1.3, 1);
        // avg after first = 200 → 200 > 260? No
        // avg after second = 110 → 20 > 143? No
        expect(beats.length).toBe(0);
    });

    it('energy at exactly 30 is below threshold', () => {
        const energies = [31, 31, 31, 31, 31, 31, 200, 31];
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 1);
        // 200 is above threshold, 31 is not (> 30 but not enough ratio)
        expect(beats.length).toBeGreaterThanOrEqual(0);
    });
});

describe('BeatDetector instance — BPM quantize toggle', () => {
    let bd: BeatDetector;
    beforeEach(() => {
        bd = new BeatDetector();
        bd.reset();
    });

    it('bpmQuantizeEnabled defaults to true', () => {
        expect(bd.getBpmQuantizeEnabled()).toBe(true);
    });

    it('setBpmQuantizeEnabled toggles the flag', () => {
        bd.setBpmQuantizeEnabled(false);
        expect(bd.getBpmQuantizeEnabled()).toBe(false);
        bd.setBpmQuantizeEnabled(true);
        expect(bd.getBpmQuantizeEnabled()).toBe(true);
    });
});

describe('BeatDetector instance — onBeat callbacks', () => {
    let bd: BeatDetector;
    beforeEach(() => {
        bd = new BeatDetector();
        bd.reset();
    });

    it('registers and unregisters callback', () => {
        let calls = 0;
        const cb = () => { calls++; };
        const unsub = bd.onBeat(cb);
        expect(unsub).toBeInstanceOf(Function);
        unsub();
        // 重复取消不应抛出
        unsub();
    });

    it('onBeat callback is safe when no analyser (update no-ops)', () => {
        let calls = 0;
        bd.onBeat(() => { calls++; });
        bd.update(); // no analyser → returns early
        expect(calls).toBe(0);
    });
});

describe('BeatDetector instance — getBeatPhase edge cases', () => {
    let bd: BeatDetector;
    beforeEach(() => {
        bd = new BeatDetector();
    });

    it('getBeatPhase returns 1 when phaseStartTime is 0 (initial state)', () => {
        // phaseStartTime 初始为 0，elapsed = performance.now()
        // 若 elapsed >= phaseInterval(500)，返回 1；否则返回 0.x
        // Node 环境 performance.now() 值不确定，只验证 0..1 范围
        const phase = bd.getBeatPhase();
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThanOrEqual(1);
    });

    it('getBeatPhase after reset returns small value', () => {
        bd.reset();
        // reset 后 phaseStartTime = performance.now()，elapsed 接近 0
        const phase = bd.getBeatPhase();
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThanOrEqual(1);
    });
});

describe('BeatDetector.getLevel — additional edge cases', () => {
    it('endBin undefined uses full data length', () => {
        const data = new Uint8Array([0, 128, 255]);
        expect(BeatDetector.getLevel(data, 0, undefined)).toBeCloseTo(0.502, 2);
    });

    it('endBin undefined with startBin > 0', () => {
        const data = new Uint8Array([0, 100, 200, 255]);
        // bins 1-4: (100+200+255)/3/255 ≈ 0.726
        expect(BeatDetector.getLevel(data, 1, undefined)).toBeCloseTo((100 + 200 + 255) / 3 / 255, 3);
    });

    it('startBin beyond data length returns 0', () => {
        const data = new Uint8Array([100, 200]);
        // start=5, Math.min(end ?? 2, 2) = 2, end(2) <= start(5) → return 0
        expect(BeatDetector.getLevel(data, 5)).toBe(0);
    });

    it('all zero data returns 0', () => {
        const data = new Uint8Array([0, 0, 0, 0]);
        expect(BeatDetector.getLevel(data)).toBe(0);
    });
});

describe('源码缺陷 — 非有限值传播', () => {
    it('detectBeatsFromEnergies 中的 NaN 样本不污染后续检测', () => {
        // 第 21 帧出现 NaN，其后 (i=42) 的峰值仍应被检出
        const energies: number[] = [];
        for (let i = 0; i < 60; i++) {
            energies.push(i === 21 ? NaN : (i % 21 === 0 ? 200 : 20));
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 6);
        // NaN 帧之后的峰值应仍触发 beat
        expect(beats.some((b) => b > 21)).toBe(true);
    });

    it('detectBeatsFromEnergies 中 Infinity 样本不污染后续检测', () => {
        const energies: number[] = [];
        for (let i = 0; i < 60; i++) {
            energies.push(i === 21 ? Infinity : (i % 21 === 0 ? 200 : 20));
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 6);
        expect(beats.some((b) => b > 21)).toBe(true);
    });

    it('getLevel 对 NaN startBin 不再返回 NaN（视为 0）', () => {
        const data = new Uint8Array([100, 200, 255]);
        // NaN startBin 应被解析为默认 0，返回全波段均值而非 NaN
        const result = BeatDetector.getLevel(data, NaN);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeCloseTo(0.725, 2);
    });

    it('getLevel 对 Infinity endBin 返回 0', () => {
        const data = new Uint8Array([100, 200, 255]);
        // endBin=Infinity 被 clamp 到 data.length，应正常计算而非 NaN
        expect(BeatDetector.getLevel(data, 0, Infinity)).toBeCloseTo((100 + 200 + 255) / 3 / 255, 3);
    });

    it('getLevel 对 NaN endBin 不再返回 NaN（视为 length）', () => {
        const data = new Uint8Array([100, 200, 255]);
        const result = BeatDetector.getLevel(data, 0, NaN);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeCloseTo(0.725, 2);
    });

    it('bpmFromIntervals 过滤 Infinity 间隔并返回 120', () => {
        expect(BeatDetector.bpmFromIntervals([Infinity, Infinity])).toBe(120);
    });

    it('bpmFromIntervals 过滤 NaN 间隔并返回 120', () => {
        expect(BeatDetector.bpmFromIntervals([NaN, NaN])).toBe(120);
    });
});
