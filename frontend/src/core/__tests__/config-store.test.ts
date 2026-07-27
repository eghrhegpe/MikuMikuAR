// [doc:adr-196] config-store 测试 — IndexedDB 持久化（内存缓存 + 异步回源）

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../backend/idb', () => ({
    idbGet: vi.fn(() => Promise.resolve(undefined)),
    idbSet: vi.fn(() => Promise.resolve(undefined)),
}));

import { idbGet, idbSet } from '../backend/idb';

describe('config-store（IndexedDB 持久化）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('saveAiConfig 后 loadAiConfig 返回合并配置（内存优先）', async () => {
        vi.resetModules();
        vi.mocked(idbGet).mockResolvedValue(undefined);
        const { loadAiConfig, saveAiConfig, DEFAULT_AI_CONFIG } = await import('../ai/config-store');

        // 首次读取回退默认并触发（未阻塞的）异步回源
        expect(loadAiConfig()).toEqual(DEFAULT_AI_CONFIG);

        const saved = saveAiConfig({
            endpoint: 'https://api.example.com/v1/chat/completions',
            apiKey: 'sk-x',
            model: 'gpt-4o',
        });
        expect(saved.apiKey).toBe('sk-x');
        expect(saved.model).toBe('gpt-4o');

        // 再次读取命中内存缓存
        expect(loadAiConfig()).toEqual(saved);
        expect(idbSet).toHaveBeenCalledWith('config', 'ai', saved);
    });

    it('ensureAiConfigLoaded 从 IndexedDB 回源并补默认缺失字段', async () => {
        vi.resetModules();
        vi.mocked(idbGet).mockResolvedValue({
            endpoint: 'https://x/v1/chat/completions',
            apiKey: 'k',
        });
        const { loadAiConfig, ensureAiConfigLoaded, DEFAULT_AI_CONFIG } = await import('../ai/config-store');

        await ensureAiConfigLoaded();
        const cfg = loadAiConfig();
        expect(cfg.endpoint).toBe('https://x/v1/chat/completions');
        expect(cfg.apiKey).toBe('k');
        expect(cfg.model).toBe(DEFAULT_AI_CONFIG.model); // 缺失 model 补默认
    });

    it('IndexedDB 不可用时静默回退默认，不抛错', async () => {
        vi.resetModules();
        vi.mocked(idbGet).mockRejectedValue(new Error('IndexedDB 不可用'));
        const { ensureAiConfigLoaded, loadAiConfig, DEFAULT_AI_CONFIG } = await import('../ai/config-store');

        await expect(ensureAiConfigLoaded()).resolves.toBeUndefined();
        expect(loadAiConfig()).toEqual(DEFAULT_AI_CONFIG);
    });
});
