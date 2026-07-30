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
    it('CORS 关键词识别', () => {
        expect(classifyAiError('CORS error', 'none')).toBe('cors');
        expect(classifyAiError('Access-Control-Allow-Origin', 'none')).toBe('cors');
        expect(classifyAiError('Failed to fetch', 'none')).toBe('cors');
    });

    it('401/unauthorized 识别', () => {
        expect(classifyAiError('401 Unauthorized', 'none')).toBe('unauthorized');
        expect(classifyAiError('invalid authentication credentials', 'none')).toBe('unauthorized');
        expect(classifyAiError('Incorrect API key', 'none')).toBe('unauthorized');
    });

    it('404/not found 识别', () => {
        expect(classifyAiError('404 Not Found', 'none')).toBe('notFound');
        expect(classifyAiError('model not found', 'none')).toBe('notFound');
    });

    it('429/rate limit 识别', () => {
        expect(classifyAiError('429 Too Many Requests', 'none')).toBe('rateLimit');
        expect(classifyAiError('rate limit exceeded', 'none')).toBe('rateLimit');
    });

    it('5xx/server error 识别', () => {
        expect(classifyAiError('500 Internal Server Error', 'none')).toBe('server');
        expect(classifyAiError('502 Bad Gateway', 'none')).toBe('server');
        expect(classifyAiError('503 Service Unavailable', 'none')).toBe('server');
    });

    it('network error 识别', () => {
        expect(classifyAiError('dial tcp 127.0.0.1:11434', 'none')).toBe('network');
        expect(classifyAiError('connection refused', 'none')).toBe('network');
        expect(classifyAiError('ERR_CONNECTION_REFUSED', 'none')).toBe('network');
        expect(classifyAiError('etimedout', 'none')).toBe('network');
    });

    it('corsRisk 非 none 时，fetch/typeerror 归类为 cors', () => {
        expect(classifyAiError('TypeError: fetch failed', 'possible')).toBe('cors');
        expect(classifyAiError('typeerror', 'high')).toBe('cors');
    });

    it('corsRisk=none 时，fetch 类错误不归为 cors', () => {
        expect(classifyAiError('TypeError: fetch failed', 'none')).toBe('unknown');
    });

    it('无匹配返回 unknown', () => {
        expect(classifyAiError('some random error', 'none')).toBe('unknown');
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