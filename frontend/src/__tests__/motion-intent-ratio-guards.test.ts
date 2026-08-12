// @vitest-environment node
// motion-intent: resolveCompatibility Infinity ratio 兜底测试
// 直接 import resolveCompatibility 验证新增的 Number.isFinite 守卫。

import { describe, it, expect } from 'vitest';
import { resolveCompatibility } from '../scene/motion/motion-intent';

describe('resolveCompatibility ratio 兜底', () => {
    it('vmdBoneNames 非空且命中率低 → compatible=false，reason 不含 Infinity/NaN', () => {
        const result = resolveCompatibility(
            ['頭', '左足IK'],
            { kind: 'vmd', vmdPath: '/test.vmd' },
            ['頭', '左足IK', '右足IK', '左腕', '右腕', 'センター']
        );
        expect(result.compatible).toBe(false);
        expect(result.reason).toContain('33%');
        expect(result.reason).not.toContain('Infinity');
        expect(result.reason).not.toContain('NaN');
    });

    it('vmdBoneNames 非空且命中率高 → compatible=true', () => {
        const result = resolveCompatibility(
            ['頭', '左足IK', '右足IK', '左腕', '右腕', 'センター'],
            { kind: 'vmd', vmdPath: '/test.vmd' },
            ['頭', '左足IK', '右足IK', '左腕', '右腕', 'センター']
        );
        expect(result.compatible).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it('vmdBoneNames 为空数组 → 走 STANDARD_MMD_BONES 分支 → 少量骨骼不兼容', () => {
        const result = resolveCompatibility(
            ['頭'],
            { kind: 'vmd', vmdPath: '/test.vmd' },
            []
        );
        // '頭' 单个骨骼不足以通过 STANDARD_MMD_BONES 检查
        expect(result.compatible).toBe(false);
    });

    it('intent=null → 直接兼容', () => {
        const result = resolveCompatibility(['頭'], null, ['頭']);
        expect(result.compatible).toBe(true);
    });

    it('actualBones 为空 → compatible=false，reason 不含 Infinity/NaN', () => {
        const result = resolveCompatibility([], { kind: 'vmd', vmdPath: '/test.vmd' }, ['頭']);
        expect(result.compatible).toBe(false);
        expect(result.reason).toContain('无骨骼数据');
    });
});
