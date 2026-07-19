// performance-reflection.test.ts — ADR-130 Phase 2.3: 性能降级 ↔ 反射质量联动测试
//
// 验证质量档位映射和桥接模块（避免导入 performance.ts 触发 Babylon 场景初始化）

import { describe, it, expect, vi } from 'vitest';

describe('ADR-130 Phase 2.3: 性能降级 ↔ 反射质量联动', () => {
    it('performance-env-bridge 导出函数', async () => {
        const bridge = await import('../../scene/render/performance-env-bridge');
        expect(typeof bridge.setAutoDegradingReflection).toBe('function');
        expect(typeof bridge.isAutoDegradingReflection).toBe('function');
        expect(typeof bridge.registerSetEnvState).toBe('function');
        expect(typeof bridge.setEnvStateForPerformance).toBe('function');
    });

    it('quality-profile 导出函数和正确的映射', async () => {
        const qp = await import('../../scene/render/quality-profile');
        expect(typeof qp.resolveQualityProfile).toBe('function');
        expect(typeof qp.inferQualityProfile).toBe('function');
        
        // 验证 qualityProfile 映射正确
        const high = qp.resolveQualityProfile('high');
        expect(high.reflectionQuality).toBe('high');
        expect(high.groundReflectionQuality).toBe('high');
        expect(high.cloudQuality).toBe('high');
        
        const medium = qp.resolveQualityProfile('medium');
        expect(medium.reflectionQuality).toBe('medium');
        expect(medium.groundReflectionQuality).toBe('medium');
        expect(medium.cloudQuality).toBe('high');
        
        const low = qp.resolveQualityProfile('low');
        expect(low.reflectionQuality).toBe('low');
        expect(low.groundReflectionQuality).toBe('low');
        expect(low.cloudQuality).toBe('standard');
    });

    it('setAutoDegradingReflection / isAutoDegradingReflection 工作正常', async () => {
        const bridge = await import('../../scene/render/performance-env-bridge');
        // 默认 false
        expect(bridge.isAutoDegradingReflection()).toBe(false);
        // 设置 true
        bridge.setAutoDegradingReflection(true);
        expect(bridge.isAutoDegradingReflection()).toBe(true);
        // 恢复 false
        bridge.setAutoDegradingReflection(false);
        expect(bridge.isAutoDegradingReflection()).toBe(false);
    });

    it('registerSetEnvState / setEnvStateForPerformance 延迟绑定工作正常', async () => {
        const bridge = await import('../../scene/render/performance-env-bridge');
        const mockFn = vi.fn();
        bridge.registerSetEnvState(mockFn);
        bridge.setEnvStateForPerformance({ reflectionQuality: 'medium' }, true);
        expect(mockFn).toHaveBeenCalledWith({ reflectionQuality: 'medium' }, true);
    });

    it('inferQualityProfile 从各域反推档位', async () => {
        const qp = await import('../../scene/render/quality-profile');
        // 全部 high → high
        expect(qp.inferQualityProfile('high', 'high', 'high')).toBe('high');
        // 全部 medium/high(maps to high for cloud) → medium
        expect(qp.inferQualityProfile('medium', 'medium', 'high')).toBe('medium');
        // 全部 low/standard → low
        expect(qp.inferQualityProfile('low', 'low', 'standard')).toBe('low');
        // 不一致 → 默认 high
        expect(qp.inferQualityProfile('high', 'low', 'standard')).toBe('high');
    });
});
