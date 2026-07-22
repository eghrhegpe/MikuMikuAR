// performance-reflection.test.ts — ADR-130 Phase 2.3: 性能降级 ↔ 反射质量联动测试
//
// 验证质量档位映射和桥接模块（避免导入 performance.ts 触发 Babylon 场景初始化）
// ADR-174: 追加注册表完备性 + default 一致性测试

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
        expect(high.cloudQuality).toBe('high');

        const medium = qp.resolveQualityProfile('medium');
        expect(medium.reflectionQuality).toBe('medium');
        expect(medium.cloudQuality).toBe('high');

        const low = qp.resolveQualityProfile('low');
        expect(low.reflectionQuality).toBe('low');
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
        // 全部 medium/high(low→standard mapping for cloud) → medium
        expect(qp.inferQualityProfile('medium', 'high', 'medium')).toBe('medium');
        // 全部 low/standard/low → low
        expect(qp.inferQualityProfile('low', 'standard', 'low')).toBe('low');
        // 不一致 → 默认 high
        expect(qp.inferQualityProfile('high', 'standard', 'low')).toBe('high');
    });
});

describe('ADR-174: 质量维度注册表', () => {
    it('resolveQualityProfile 三档映射与 schema default 对齐', async () => {
        const qp = await import('../../scene/render/quality-profile');
        // 三档完整映射
        const high = qp.resolveQualityProfile('high');
        const medium = qp.resolveQualityProfile('medium');
        const low = qp.resolveQualityProfile('low');

        // reflectionQuality: high→high, medium→medium, low→low
        expect(high.reflectionQuality).toBe('high');
        expect(medium.reflectionQuality).toBe('medium');
        expect(low.reflectionQuality).toBe('low');

        // cloudQuality: high→high, medium→high, low→standard
        expect(high.cloudQuality).toBe('high');
        expect(medium.cloudQuality).toBe('high');
        expect(low.cloudQuality).toBe('standard');

        // particleQuality: high→high, medium→medium, low→low
        expect(high.particleQuality).toBe('high');
        expect(medium.particleQuality).toBe('medium');
        expect(low.particleQuality).toBe('low');
    });

    it('inferQualityProfile 三档正向匹配 + fallback', async () => {
        const qp = await import('../../scene/render/quality-profile');
        // 三档正向匹配
        expect(qp.inferQualityProfile('high', 'high', 'high')).toBe('high');
        expect(qp.inferQualityProfile('medium', 'high', 'medium')).toBe('medium');
        expect(qp.inferQualityProfile('low', 'standard', 'low')).toBe('low');
        // 不一致组合 → 'high' fallback
        expect(qp.inferQualityProfile('high', 'standard', 'low')).toBe('high');
        expect(qp.inferQualityProfile('off', 'high', 'high')).toBe('high');
    });

    it('QualityProfileSettings 字段集合与注册表维度一致', async () => {
        // 编译期：若注册表新增维度而 QualityProfileSettings 未扩展，下行类型检查报错
        const qp = await import('../../scene/render/quality-profile');
        const settings = qp.resolveQualityProfile('high');
        // 当前 3 个维度
        expect(Object.keys(settings).sort()).toEqual(
            ['cloudQuality', 'particleQuality', 'reflectionQuality'].sort()
        );
    });
});
