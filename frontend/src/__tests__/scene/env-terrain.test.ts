import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    hash2,
    valueNoise,
    fbm,
    generateTerrainHeightmapURL,
} from '../../scene/env/env-terrain';

// happy-dom 无真实 2D canvas；为 generateTerrainHeightmapURL 提供最小桩：
// createImageData 返回真实 Uint8ClampedArray（FBM 像素写入），putImageData 捕获它，
// toDataURL 返回像素缓冲的 FNV-1a 校验和 —— 从而锁定「FBM → 高度图像素」映射，
// 而不依赖真实 PNG 编码（该编码在 happy-dom 下不可用）。
let restoreCanvas: () => void;
beforeAll(() => {
    let captured: { data: Uint8ClampedArray } | null = null;
    const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            createImageData: (w: number, h: number) => {
                const data = new Uint8ClampedArray(w * h * 4);
                return { data, width: w, height: h };
            },
            putImageData: (img: { data: Uint8ClampedArray }) => {
                captured = img;
            },
        }),
        toDataURL: () => {
            const d = captured!.data;
            let h = 2166136261 >>> 0;
            for (let i = 0; i < d.length; i++) {
                h ^= d[i];
                h = Math.imul(h, 16777619) >>> 0;
            }
            return `data:image/png;base64,${h.toString(16)}`;
        },
    };
    const orig = document.createElement.bind(document);
    (document as any).createElement = (tag: string) =>
        tag === 'canvas' ? (fakeCanvas as any) : orig(tag);
    restoreCanvas = () => {
        (document as any).createElement = orig;
    };
});

afterAll(() => restoreCanvas());

describe('env-terrain FBM（确定性函数输出锁定）', () => {
    it('hash2：确定性、随坐标/种子变化、落在 [0,1)', () => {
        // 锁定精确值（重构 hash2 会改变 → 捕获回归）
        expect(hash2(0, 0, 1337)).toBe(0.34160740937609396);
        expect(hash2(0, 0, 1337)).toBe(0.34160740937609396); // 同输入复现
        expect(hash2(0, 0, 9999)).toBe(0.26923139469447344);
        // 不同坐标 → 不同值
        expect(hash2(1, 1, 1337)).not.toBe(hash2(0, 0, 1337));
        // 范围
        const v = hash2(3, 7, 42);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
    });

    it('valueNoise：确定性、落在 [0,1]', () => {
        const v = valueNoise(0.5, 0.5, 1337);
        expect(v).toBe(0.2547532315377037);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(valueNoise(0.5, 0.5, 1337)).toBe(v); // 复现
    });

    it('fbm：确定性、约 [-1,1]、octaves 影响结果', () => {
        const f = fbm(10, 10, 1337, 5, 0.06);
        expect(f).toBe(-0.4172433351084645);
        // octaves=1 退化为单倍频，仍在 [-1,1]
        const f1 = fbm(10, 10, 1337, 1, 0.06);
        expect(f1).toBeGreaterThanOrEqual(-1);
        expect(f1).toBeLessThanOrEqual(1);
        expect(f1).not.toBe(f); // 层数不同 → 地形不同
        expect(fbm(10, 10, 1337, 5, 0.06)).toBe(f); // 复现
    });

    it('generateTerrainHeightmapURL：输出 data URL、确定性可锁', () => {
        const url = generateTerrainHeightmapURL({
            height: 4,
            scale: 0.06,
            seed: 1337,
            octaves: 5,
        });
        expect(url.startsWith('data:image/png;base64,')).toBe(true);
        // 同参数 → 同校验和（锁定 FBM → 像素映射）
        const url2 = generateTerrainHeightmapURL({
            height: 4,
            scale: 0.06,
            seed: 1337,
            octaves: 5,
        });
        expect(url).toBe(url2);
        expect(url).toBe('data:image/png;base64,17e2571');
        // 不同种子 → 不同地形
        const urlSeed = generateTerrainHeightmapURL({
            height: 4,
            scale: 0.06,
            seed: 9999,
            octaves: 5,
        });
        expect(urlSeed).toBe('data:image/png;base64,5ecd5e91');
        expect(urlSeed).not.toBe(url);
    });
});
