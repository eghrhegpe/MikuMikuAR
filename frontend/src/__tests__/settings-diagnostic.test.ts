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

describe('goKeyAllowsProceed', () => {
    // ── 验证通过时总是放行 ────────────────────────────
    it('validation.ok → 一律放行（不论 isGo/keyConfigured）', () => {
        const v = validateAiConfig(VALID);
        expect(v.ok).toBe(true);
        expect(goKeyAllowsProceed(v, false, false)).toBe(true);
        expect(goKeyAllowsProceed(v, true, true)).toBe(true);
        expect(goKeyAllowsProceed(v, true, false)).toBe(true);
    });

    // ── Go 模式缺 key ────────────────────────────────
    it('Go 模式 + keyConfigured=true，仅缺 key → 放行', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '' });
        expect(v.kind).toBe('missingKey');
        expect(goKeyAllowsProceed(v, true, true)).toBe(true);
    });

    it('Go 模式 + keyConfigured=false，缺 key → 不放行', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '' });
        expect(goKeyAllowsProceed(v, true, false)).toBe(false);
    });

    // ── 浏览器模式缺 key ────────────────────────────────
    it('浏览器模式（isGo=false），缺 key → 不放行', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '' });
        expect(goKeyAllowsProceed(v, false, false)).toBe(false);
    });

    it('浏览器模式，即使 keyConfigured=true 也不能跳过 key 校验', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '' });
        // isGo=false 时 keyConfigured 参数被忽略，业务上不应出现这种组合
        expect(goKeyAllowsProceed(v, false, true)).toBe(false);
    });

    // ── 缺 key + 其他字段（即使 Go 模式也不放行） ──────
    it('缺 key + 缺 endpoint，Go 模式 → 不放行', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '', endpoint: '' });
        expect(goKeyAllowsProceed(v, true, true)).toBe(false);
    });

    it('缺 key + 缺 model，Go 模式 → 不放行', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '', model: '' });
        expect(goKeyAllowsProceed(v, true, true)).toBe(false);
    });

    it('缺 key + endpoint + model 全缺，Go 模式 → 不放行', () => {
        const v = validateAiConfig({ ...VALID, apiKey: '', endpoint: '', model: '' });
        expect(goKeyAllowsProceed(v, true, true)).toBe(false);
    });

    // ── 不缺 key 但缺其他字段 ────────────────────────────
    it('key 已填，缺 model → 不放行（无论模式）', () => {
        const v = validateAiConfig({ ...VALID, model: '' });
        expect(v.kind).toBe('missingModel');
        expect(goKeyAllowsProceed(v, false, false)).toBe(false);
        expect(goKeyAllowsProceed(v, true, true)).toBe(false);
    });

    it('key 已填，缺 endpoint → 不放行（无论模式）', () => {
        const v = validateAiConfig({ ...VALID, endpoint: '' });
        expect(v.kind).toBe('missingEndpoint');
        expect(goKeyAllowsProceed(v, false, false)).toBe(false);
        expect(goKeyAllowsProceed(v, true, true)).toBe(false);
    });
});
