// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { guardNum } from '../guards';

describe('guardNum', () => {
    describe('正常数值 → 原值返回', () => {
        it('正整数', () => {
            expect(guardNum(42)).toBe(42);
        });

        it('负数', () => {
            expect(guardNum(-3.14)).toBe(-3.14);
        });

        it('浮点数', () => {
            expect(guardNum(0.75)).toBeCloseTo(0.75);
        });

        it('零', () => {
            expect(guardNum(0)).toBe(0);
        });

        it('自定义 fallback', () => {
            expect(guardNum(100, 999)).toBe(100);
        });
    });

    describe('NaN → fallback', () => {
        it('NaN 使用默认 fallback 0', () => {
            expect(guardNum(NaN)).toBe(0);
        });

        it('NaN 使用自定义 fallback', () => {
            expect(guardNum(NaN, 42)).toBe(42);
        });
    });

    describe('Infinity / -Infinity → fallback', () => {
        it('Infinity 回退到默认 0', () => {
            expect(guardNum(Infinity)).toBe(0);
        });

        it('-Infinity 回退到自定义 fallback', () => {
            expect(guardNum(-Infinity, -1)).toBe(-1);
        });
    });

    describe('undefined / null → fallback', () => {
        it('undefined 回退到默认 0', () => {
            expect(guardNum(undefined)).toBe(0);
        });

        it('undefined 使用自定义 fallback', () => {
            expect(guardNum(undefined, 7)).toBe(7);
        });

        it('null 回退到默认 0', () => {
            expect(guardNum(null)).toBe(0);
        });
    });

    describe('非数字类型 → fallback', () => {
        it('字符串 "42" 回退', () => {
            expect(guardNum('42')).toBe(0);
        });

        it('空字符串回退', () => {
            expect(guardNum('')).toBe(0);
        });

        it('布尔值 true 回退', () => {
            expect(guardNum(true)).toBe(0);
        });

        it('布尔值 false 回退', () => {
            expect(guardNum(false, 1)).toBe(1);
        });

        it('对象回退', () => {
            expect(guardNum({})).toBe(0);
        });

        it('数组回退', () => {
            expect(guardNum([1, 2, 3])).toBe(0);
        });
    });
});
