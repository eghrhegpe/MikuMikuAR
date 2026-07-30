// [doc:adr-196] config-store 守护测试：配置校验、错误分类、端点归一、超时裁剪。
// 纯函数测试，不依赖 IndexedDB（mock idb 避免 hydrate 副作用）。

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock idb 兜底：确保 loadAiConfig 的 _hydrate 不会实际访问 IndexedDB
vi.mock('../../backend/idb', () => ({
    idbGet: vi.fn(async () => null),
    idbSet: vi.fn(async () => {}),
}));

import {
    validateAiConfig,
    classifyAiError,
    normalizeEndpoint,
    normalizeTimeout,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    PROVIDER_PRESETS,
    DEFAULT_AI_CONFIG,
    type AiConfig,
} from '../config-store';

/** 完整有效配置（DeepSeek，带 key）。 */
const VALID: AiConfig = {
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: 'sk-xxx',
    model: 'deepseek-chat',
    timeoutMs: 30000,
};

describe('validateAiConfig', () => {
    it('有效配置返回 ok', () => {
        const r = validateAiConfig(VALID);
        expect(r.ok).toBe(true);
        expect(r.message).toBe('ai.validation.ok');
    });

    it('缺 endpoint 返回 missingEndpoint', () => {
        const r = validateAiConfig({ ...VALID, endpoint: '' });
        expect(r.ok).toBe(false);
        expect(r.kind).toBe('missingEndpoint');
    });

    it('缺 key（needsKey=true 的 provider）返回 missingKey', () => {
        const r = validateAiConfig({ ...VALID, apiKey: '' });
        expect(r.ok).toBe(false);
        expect(r.kind).toBe('missingKey');
    });

    it('Ollama 缺 key 不报错（needsKey=false）', () => {
        const r = validateAiConfig({
            provider: 'ollama',
            endpoint: 'http://localhost:11434/v1/chat/completions',
            apiKey: '',
            model: 'llama3.2',
            timeoutMs: 30000,
        });
        expect(r.ok).toBe(true);
    });

    it('缺 model 返回 missingModel', () => {
        const r = validateAiConfig({ ...VALID, model: '' });
        expect(r.ok).toBe(false);
        expect(r.kind).toBe('missingModel');
    });

    it('同时缺 key+endpoint 返回第一个错误（missingEndpoint）', () => {
        const r = validateAiConfig({ ...VALID, endpoint: '', apiKey: '' });
        expect(r.ok).toBe(false);
        expect(r.kind).toBe('missingEndpoint');
        expect(r.errors).toHaveLength(2);
    });

    it('全缺时 errors 数组包含 3 个错误', () => {
        const r = validateAiConfig({ ...VALID, endpoint: '', apiKey: '', model: '' });
        expect(r.errors).toHaveLength(3);
        expect(r.errors!.map((e) => e.kind)).toEqual([
            'missingEndpoint',
            'missingKey',
            'missingModel',
        ]);
    });
});

describe('classifyAiError', () => {
    it.each([
        // [message, corsRisk, expected]
        ['CORS error',              'none',     'cors'],
        ['Access-Control-Allow-Origin', 'none', 'cors'],
        ['Failed to fetch',         'none',     'cors'],
        ['401 Unauthorized',        'none',     'unauthorized'],
        ['invalid authentication',  'none',     'unauthorized'],
        ['Incorrect API key',       'none',     'unauthorized'],
        ['404 Not Found',           'none',     'notFound'],
        ['model not found',         'none',     'notFound'],
        ['429 Too Many Requests',   'none',     'rateLimit'],
        ['rate limit exceeded',     'none',     'rateLimit'],
        ['500 Internal Server Error', 'none',  'server'],
        ['502 Bad Gateway',         'none',     'server'],
        ['503 Service Unavailable', 'none',     'server'],
        ['dial tcp 127.0.0.1:11434','none',     'network'],
        ['connection refused',      'none',     'network'],
        ['ERR_CONNECTION_REFUSED',  'none',     'network'],
        ['etimedout',               'none',     'network'],
        ['some random error',       'none',     'unknown'],
    ])('消息 "%s" corsRisk=%s → %s', (msg, risk, expected) => {
        expect(classifyAiError(msg, risk as 'none' | 'possible' | 'high')).toBe(expected);
    });

    it('corsRisk=possible 时 fetch 类错误归为 cors', () => {
        expect(classifyAiError('TypeError: fetch failed', 'possible')).toBe('cors');
        expect(classifyAiError('typeerror', 'high')).toBe('cors');
    });

    it('corsRisk=none 时 fetch 类错误不归为 cors', () => {
        expect(classifyAiError('TypeError: fetch failed', 'none')).toBe('unknown');
    });
});

describe('normalizeEndpoint', () => {
    it('已完整路径原样返回', () => {
        expect(normalizeEndpoint('https://api.openai.com/v1/chat/completions')).toBe(
            'https://api.openai.com/v1/chat/completions'
        );
    });

    it('补全 /chat/completions 后缀', () => {
        expect(normalizeEndpoint('https://api.deepseek.com/v1')).toBe(
            'https://api.deepseek.com/v1/chat/completions'
        );
    });

    it('去掉尾部斜杠再补全', () => {
        expect(normalizeEndpoint('http://localhost:11434/v1/')).toBe(
            'http://localhost:11434/v1/chat/completions'
        );
    });

    it('空字符串返回空', () => {
        expect(normalizeEndpoint('')).toBe('');
        expect(normalizeEndpoint('   ')).toBe('');
    });
});

describe('normalizeTimeout', () => {
    it('合法值原样返回', () => {
        expect(normalizeTimeout(30000)).toBe(30000);
    });

    it('低于下限裁剪到 MIN_TIMEOUT_MS', () => {
        expect(normalizeTimeout(100)).toBe(MIN_TIMEOUT_MS);
    });

    it('高于上限裁剪到 MAX_TIMEOUT_MS', () => {
        expect(normalizeTimeout(999999)).toBe(MAX_TIMEOUT_MS);
    });

    it('非法/缺失回落 DEFAULT_TIMEOUT_MS', () => {
        expect(normalizeTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
        expect(normalizeTimeout(null)).toBe(DEFAULT_TIMEOUT_MS);
        expect(normalizeTimeout('abc')).toBe(DEFAULT_TIMEOUT_MS);
        expect(normalizeTimeout(Infinity)).toBe(DEFAULT_TIMEOUT_MS);
        expect(normalizeTimeout(NaN)).toBe(DEFAULT_TIMEOUT_MS);
    });
});

describe('PROVIDER_PRESETS', () => {
    it('预设有 5 个服务商', () => {
        expect(Object.keys(PROVIDER_PRESETS)).toEqual([
            'ollama',
            'deepseek',
            'openai',
            'openrouter',
            'custom',
        ]);
    });

    it('Ollama needsKey=false', () => {
        expect(PROVIDER_PRESETS.ollama.needsKey).toBe(false);
        expect(PROVIDER_PRESETS.ollama.endpoint).toContain('localhost');
    });

    it('DeepSeek needsKey=true', () => {
        expect(PROVIDER_PRESETS.deepseek.needsKey).toBe(true);
    });

    it('custom 端点和模型为空', () => {
        expect(PROVIDER_PRESETS.custom.endpoint).toBe('');
        expect(PROVIDER_PRESETS.custom.model).toBe('');
    });
});

describe('DEFAULT_AI_CONFIG', () => {
    it('默认 provider 为 ollama', () => {
        expect(DEFAULT_AI_CONFIG.provider).toBe('ollama');
        expect(DEFAULT_AI_CONFIG.apiKey).toBe('');
        expect(DEFAULT_AI_CONFIG.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    });
});