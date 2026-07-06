// [doc:adr-049] 球面坐标轨道控制 — 纯函数与边界保护单元测试
// 覆盖 ADR §6 验证标准 #1（orbit→cartesian 正确坐标）#2（模式往返无跳变）及边界保护。

import { describe, it, expect } from 'vitest';
import {
    orbitToCartesian,
    cartesianToOrbit,
    normalizeOrbit,
    MIN_ORBIT_DISTANCE,
} from '../core/orbit';

/** 断言三元组每个分量都有限 */
function expectFiniteTriplet(t: [number, number, number]): void {
    expect(Number.isFinite(t[0])).toBe(true);
    expect(Number.isFinite(t[1])).toBe(true);
    expect(Number.isFinite(t[2])).toBe(true);
}

describe('orbitToCartesian — 已知坐标 (ADR §6 #1)', () => {
    it('azimuth=45, elevation=30, distance=10 返回正确笛卡尔坐标', () => {
        const [x, y, z] = orbitToCartesian(45, 30, 10);
        expect(x).toBeCloseTo(10 * Math.cos(Math.PI / 6) * Math.sin(Math.PI / 4), 6);
        expect(y).toBeCloseTo(5, 6);
        expect(z).toBeCloseTo(10 * Math.cos(Math.PI / 6) * Math.cos(Math.PI / 4), 6);
        // 精确数值基线
        expect(x).toBeCloseTo(6.12372, 4);
        expect(z).toBeCloseTo(6.12372, 4);
    });

    it('azimuth=0, elevation=0, distance=5 落在 +Z 轴', () => {
        const [x, y, z] = orbitToCartesian(0, 0, 5);
        expect(x).toBeCloseTo(0, 6);
        expect(y).toBeCloseTo(0, 6);
        expect(z).toBeCloseTo(5, 6);
    });

    it('elevation=90, distance=5 落在 +Y 轴（正上方）', () => {
        const [x, y, z] = orbitToCartesian(123, 90, 5);
        expect(x).toBeCloseTo(0, 6);
        expect(y).toBeCloseTo(5, 6);
        expect(z).toBeCloseTo(0, 6);
    });
});

describe('笛卡尔 ↔ 球面 往返一致性 (ADR §6 #2)', () => {
    // 注：原点 [0,0,0] 距离为 0 属退化特例（钳制到 MIN_ORBIT_DISTANCE），不在此往返用例内，
    // 已由「cartesianToOrbit 对原点与非有限输入安全」单独覆盖。
    const cases: Array<[number, number, number]> = [
        [1, 0, 0],
        [3, 4, 0],
        [6.1237, 5, 6.1237],
        [-2, 3, -4],
        [0, 10, 0],
    ];

    it('cartesianToOrbit(orbitToCartesian(a,e,d)) 还原原始轨道参数', () => {
        const orbits: Array<[number, number, number]> = [
            [45, 30, 10],
            [0, 0, 5],
            [120, -45, 8],
            [-90, 89, 3],
        ];
        for (const [a, e, d] of orbits) {
            const cart = orbitToCartesian(a, e, d);
            const back = cartesianToOrbit(cart[0], cart[1], cart[2]);
            expect(back.azimuth).toBeCloseTo(a, 5);
            expect(back.elevation).toBeCloseTo(e, 5);
            expect(back.distance).toBeCloseTo(d, 5);
        }
    });

    it('orbit→cartesian→orbit 对笛卡尔坐标无跳变（模式切换安全）', () => {
        for (const [x, y, z] of cases) {
            const o = cartesianToOrbit(x, y, z);
            const back = orbitToCartesian(o.azimuth, o.elevation, o.distance);
            expect(back[0]).toBeCloseTo(x, 5);
            expect(back[1]).toBeCloseTo(y, 5);
            expect(back[2]).toBeCloseTo(z, 5);
        }
    });
});

describe('边界保护 — orbitToCartesian 绝不产生 NaN/退化', () => {
    it('distance=0 钳制到最小值，返回有限且非零坐标', () => {
        const t = orbitToCartesian(45, 30, 0);
        expectFiniteTriplet(t);
        const len = Math.sqrt(t[0] ** 2 + t[1] ** 2 + t[2] ** 2);
        expect(len).toBeGreaterThan(0);
        expect(len).toBeCloseTo(MIN_ORBIT_DISTANCE, 6);
    });

    it('elevation 越界收敛到 [-90,90]，不产生翻转位置', () => {
        const over = orbitToCartesian(30, 100, 10);
        const capped = orbitToCartesian(30, 90, 10);
        expect(over[0]).toBeCloseTo(capped[0], 6);
        expect(over[1]).toBeCloseTo(capped[1], 6);
        expect(over[2]).toBeCloseTo(capped[2], 6);

        const under = orbitToCartesian(30, -100, 10);
        const cappedUnder = orbitToCartesian(30, -90, 10);
        expect(under[0]).toBeCloseTo(cappedUnder[0], 6);
        expect(under[1]).toBeCloseTo(cappedUnder[1], 6);
        expect(under[2]).toBeCloseTo(cappedUnder[2], 6);
    });

    it('NaN / Infinity 输入返回有限坐标', () => {
        expectFiniteTriplet(orbitToCartesian(NaN, 30, 10));
        expectFiniteTriplet(orbitToCartesian(45, NaN, 10));
        expectFiniteTriplet(orbitToCartesian(45, 30, NaN));
        expectFiniteTriplet(orbitToCartesian(Infinity, 30, 10));
        expectFiniteTriplet(orbitToCartesian(45, -Infinity, 10));
        expectFiniteTriplet(orbitToCartesian(45, 30, Infinity));
        expectFiniteTriplet(orbitToCartesian(NaN, NaN, NaN));
    });
});

describe('边界保护 — cartesianToOrbit 对原点与非有限输入安全', () => {
    it('原点 (0,0,0) 返回有限轨道坐标（不 NaN）', () => {
        const o = cartesianToOrbit(0, 0, 0);
        expect(Number.isFinite(o.azimuth)).toBe(true);
        expect(Number.isFinite(o.elevation)).toBe(true);
        expect(Number.isFinite(o.distance)).toBe(true);
        expect(o.distance).toBe(0);
    });

    it('非有限输入返回原点轨道坐标（有限值）', () => {
        const o = cartesianToOrbit(NaN, Infinity, -Infinity);
        expect(Number.isFinite(o.azimuth)).toBe(true);
        expect(Number.isFinite(o.elevation)).toBe(true);
        expect(Number.isFinite(o.distance)).toBe(true);
    });
});

describe('normalizeOrbit — 钳制存储值', () => {
    it('合法输入原样返回', () => {
        expect(normalizeOrbit(45, 30, 10)).toEqual({ azimuth: 45, elevation: 30, distance: 10 });
    });

    it('distance<=0 或非有限 → MIN_ORBIT_DISTANCE', () => {
        expect(normalizeOrbit(45, 30, 0).distance).toBe(MIN_ORBIT_DISTANCE);
        expect(normalizeOrbit(45, 30, -5).distance).toBe(MIN_ORBIT_DISTANCE);
        expect(normalizeOrbit(45, 30, NaN).distance).toBe(MIN_ORBIT_DISTANCE);
        expect(normalizeOrbit(45, 30, Infinity).distance).toBe(MIN_ORBIT_DISTANCE);
    });

    it('elevation 收敛到 [-90,90]', () => {
        expect(normalizeOrbit(0, 100, 10).elevation).toBe(90);
        expect(normalizeOrbit(0, -100, 10).elevation).toBe(-90);
        expect(normalizeOrbit(0, NaN, 10).elevation).toBe(0);
    });

    it('azimuth 非有限 → 0', () => {
        expect(normalizeOrbit(NaN, 30, 10).azimuth).toBe(0);
        expect(normalizeOrbit(Infinity, 30, 10).azimuth).toBe(0);
    });
});
