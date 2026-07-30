import { describe, it, expect } from 'vitest';
import { validateAiConfig, type AiConfig } from '../core/ai/config-store';
import { goKeyAllowsProceed } from '../core/ai/go-key-allows-proceed';

/** 完整有效配置（DeepSeek，带 key），作为测试的基线。 */
const VALID: AiConfig = {
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: 'sk-xxx',
    model: 'deepseek-chat',
    timeoutMs: 30000,
};

/**
 * goKeyAllowsProceed 的纯函数边界测试在 core/ai/__tests__/go-key-allows-proceed.test.ts 中覆盖。
 * 本集成测试只验证「validateAiConfig + goKeyAllowsProceed」联合路径，不重复纯函数边界。
 */
describe('goKeyAllowsProceed (integration)', () => {
    it('Go 模式 + keyConfigured + 仅缺 key → 放行', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '' });
        expect(goKeyAllowsProceed(v, true, true)).toBe(true);
    });

    it('Go 模式 + keyConfigured=false，缺 key → 不放行', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '' });
        expect(goKeyAllowsProceed(v, true, false)).toBe(false);
    });

    it('浏览器模式缺 key → 不放行', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '' });
        expect(goKeyAllowsProceed(v, false, false)).toBe(false);
    });

    it('缺 key + 其他缺失（非 key 错误优先）→ Go 模式不放行', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '', endpoint: '' });
        expect(v.kind).toBe('missingEndpoint');
        expect(goKeyAllowsProceed(v, true, true)).toBe(false);
    });

    it('不缺 key 但缺其他字段 → 不放行', () => {
        const v = validateAiConfig({ ...VALID, model: '' });
        expect(goKeyAllowsProceed(v, false, false)).toBe(false);
        expect(goKeyAllowsProceed(v, true, true)).toBe(false);
    });
});
