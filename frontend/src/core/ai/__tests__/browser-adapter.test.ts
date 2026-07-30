// [doc:adr-196] browser-adapter 守护测试：CORS 风险判定、模型缓存、连接测试。
// BrowserAiAdapter 的 capabilities() 是同步纯逻辑，可独立测试。
// streamChat / testConnection 依赖 fetch mock。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserAiAdapter } from '../browser-adapter';

// ── mock config-store ─────────────────────────────────────────────
// 让 loadAiConfig() 返回可控配置
const mockConfig = vi.hoisted(() => ({
    endpoint: '',
    model: 'llama3.2',
    apiKey: '',
    timeoutMs: 30000,
}));

vi.mock('../config-store', () => ({
    loadAiConfig: vi.fn(() => ({ ...mockConfig })),
    classifyAiError: vi.fn((_msg: string) => 'unknown'),
    validateAiConfig: vi.fn(() => ({ ok: true, message: 'ok' })),
    normalizeEndpoint: vi.fn((e: string) => e),
    normalizeTimeout: vi.fn((t: number) => t),
    PROVIDER_PRESETS: {
        ollama: { needsKey: false, endpoint: 'http://localhost:11434/v1/chat/completions', model: '' },
        deepseek: { needsKey: true, endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
        openai: { needsKey: true, endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
        openrouter: { needsKey: true, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'auto' },
        custom: { needsKey: false, endpoint: '', model: '' },
    },
    DEFAULT_AI_CONFIG: { provider: 'ollama', endpoint: 'http://localhost:11434/v1/chat/completions', apiKey: '', model: '', timeoutMs: 30000 },
}));

describe('BrowserAiAdapter', () => {
    let adapter: BrowserAiAdapter;

    beforeEach(() => {
        adapter = new BrowserAiAdapter();
        // 重置配置
        mockConfig.endpoint = '';
        mockConfig.model = 'llama3.2';
        mockConfig.apiKey = '';
    });

    // ── capabilities ──
    describe('capabilities()', () => {
        it('endpoint 为空时 available=false', () => {
            mockConfig.endpoint = '';
            const caps = adapter.capabilities();
            expect(caps.available).toBe(false);
            // endpoint 为空时正则不匹配，回落 'openai-compat'（非 'none'，'none' 为接口类型未实际产出）
            expect(caps.adapter).toBe('openai-compat');
        });

        it('localhost endpoint → corsRisk=none', () => {
            mockConfig.endpoint = 'http://localhost:11434/v1/chat/completions';
            const caps = adapter.capabilities();
            expect(caps.corsRisk).toBe('none');
            expect(caps.available).toBe(true);
            expect(caps.adapter).toBe('ollama');
        });

        it('127.0.0.1 endpoint → corsRisk=none', () => {
            mockConfig.endpoint = 'http://127.0.0.1:11434/v1/chat/completions';
            const caps = adapter.capabilities();
            expect(caps.corsRisk).toBe('none');
        });

        it('https 远程 endpoint → corsRisk=possible', () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            const caps = adapter.capabilities();
            expect(caps.corsRisk).toBe('possible');
            expect(caps.adapter).toBe('openai-compat');
        });

        it('http 远程 endpoint → corsRisk=high', () => {
            mockConfig.endpoint = 'http://example.com/v1/chat/completions';
            const caps = adapter.capabilities();
            expect(caps.corsRisk).toBe('high');
        });

        it('apiKey 配置后 apiKeyConfigured=true', () => {
            mockConfig.apiKey = 'sk-xxx';
            const caps = adapter.capabilities();
            expect(caps.apiKeyConfigured).toBe(true);
        });

        it('无 apiKey 时 apiKeyConfigured=false', () => {
            mockConfig.apiKey = '';
            const caps = adapter.capabilities();
            expect(caps.apiKeyConfigured).toBe(false);
        });

        it('models 回退到配置单模型（无缓存）', () => {
            mockConfig.model = 'deepseek-chat';
            const caps = adapter.capabilities();
            expect(caps.models).toEqual(['deepseek-chat']);
        });

        it('models 优先使用 _fetchedModelsCache', () => {
            // 通过 fetchModels 失败后的缓存来验证
            // 直接访问私有属性来验证行为
            (adapter as unknown as { _fetchedModelsCache: string[] })._fetchedModelsCache = ['gpt-4', 'gpt-3.5'];
            const caps = adapter.capabilities();
            expect(caps.models).toEqual(['gpt-4', 'gpt-3.5']);
        });

        it('streaming 恒为 true', () => {
            const caps = adapter.capabilities();
            expect(caps.streaming).toBe(true);
        });

        it('endpointReachable 恒为 pending', () => {
            const caps = adapter.capabilities();
            expect(caps.endpointReachable).toBe('pending');
        });
    });
});