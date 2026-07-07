import { describe, it, expect } from 'vitest';
import { DEFAULT_LAYER_BONE_FILTER } from '../scene/motion/wasm-layers-config';

describe('wasm-layers-blender: DEFAULT_LAYER_BONE_FILTER', () => {
    it('应包含上半身/上肢核心骨骼', () => {
        expect(DEFAULT_LAYER_BONE_FILTER).toContain('上半身');
        expect(DEFAULT_LAYER_BONE_FILTER).toContain('首');
        expect(DEFAULT_LAYER_BONE_FILTER).toContain('頭');
        expect(DEFAULT_LAYER_BONE_FILTER).toContain('左腕');
        expect(DEFAULT_LAYER_BONE_FILTER).toContain('右腕');
        expect(DEFAULT_LAYER_BONE_FILTER.length).toBeGreaterThan(5);
    });

    it('应包含肘和手腕骨骼', () => {
        expect(DEFAULT_LAYER_BONE_FILTER).toContain('左ひじ');
        expect(DEFAULT_LAYER_BONE_FILTER).toContain('右ひじ');
        expect(DEFAULT_LAYER_BONE_FILTER).toContain('左手首');
        expect(DEFAULT_LAYER_BONE_FILTER).toContain('右手首');
    });
});

describe('wasm-layers-blender: 权重归一化', () => {
    function normalizeWeights(weights: number[]): number[] {
        const total = weights.reduce((a, b) => a + b, 0);
        if (total <= 0) return weights.map(() => 1 / weights.length);
        return weights.map((w) => w / total);
    }

    it('多图层权重应归一化到 1.0', () => {
        const weights = [0.8, 0.6];
        const normalized = normalizeWeights(weights);
        expect(normalized.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    });

    it('单图层权重为 1 时应完全覆盖', () => {
        const weights = [1];
        const normalized = normalizeWeights(weights);
        expect(normalized[0]).toBe(1);
    });

    it('所有权重为 0 时应均分', () => {
        const weights = [0, 0];
        const normalized = normalizeWeights(weights);
        expect(normalized[0]).toBe(0.5);
        expect(normalized[1]).toBe(0.5);
    });

    it('零权重应被忽略', () => {
        const weights = [0.5, 0, 0.5];
        const normalized = normalizeWeights(weights);
        expect(normalized.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
        expect(normalized[1]).toBe(0);
    });
});

describe('wasm-layers-blender: boneFilter 匹配', () => {
    function matchBoneFilter(boneName: string, filter: string[]): boolean {
        if (filter.includes('*')) return true;
        return filter.includes(boneName);
    }

    it('通配符 * 匹配所有骨骼', () => {
        expect(matchBoneFilter('任意骨骼', ['*'])).toBe(true);
        expect(matchBoneFilter('首', ['*'])).toBe(true);
    });

    it('精确匹配', () => {
        const filter = ['上半身', '首'];
        expect(matchBoneFilter('上半身', filter)).toBe(true);
        expect(matchBoneFilter('首', filter)).toBe(true);
        expect(matchBoneFilter('左腕', filter)).toBe(false);
    });
});
