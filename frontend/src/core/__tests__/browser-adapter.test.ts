// [doc:adr-196] browser-adapter 测试 — capabilities / corsRisk 判定（不涉及网络）

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../backend/idb', () => ({
    idbGet: vi.fn(() => Promise.resolve(undefined)),
    idbSet: vi.fn(() => Promise.resolve(undefined)),
}));

describe('BrowserAiAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('corsRisk 判定：localhost→none / https→possible / http远程→high', async () => {
        vi.resetModules();
        vi.mocked((await import('../backend/idb')).idbGet).mockResolvedValue(undefined);
        const { BrowserAiAdapter } = await import('../ai/browser-adapter');
        const { saveAiConfig } = await import('../ai/config-store');
        const a = new BrowserAiAdapter();

        await saveAiConfig({ endpoint: 'http://localhost:11434/v1/chat/completions' });
        expect(a.capabilities().corsRisk).toBe('none');

        await saveAiConfig({ endpoint: 'https://api.openai.com/v1/chat/completions' });
        expect(a.capabilities().corsRisk).toBe('possible');

        await saveAiConfig({ endpoint: 'http://example.com/v1/chat/completions' });
        expect(a.capabilities().corsRisk).toBe('high');
    });

    it('未配置端点时 available=false', async () => {
        vi.resetModules();
        const { BrowserAiAdapter } = await import('../ai/browser-adapter');
        const { saveAiConfig } = await import('../ai/config-store');
        const a = new BrowserAiAdapter();

        await saveAiConfig({ endpoint: '' });
        expect(a.capabilities().available).toBe(false);
        expect(a.capabilities().apiKeyConfigured).toBe(false);
    });

    it('已配置 apiKey 时 apiKeyConfigured=true', async () => {
        vi.resetModules();
        const { BrowserAiAdapter } = await import('../ai/browser-adapter');
        const { saveAiConfig } = await import('../ai/config-store');
        const a = new BrowserAiAdapter();

        await saveAiConfig({
            endpoint: 'http://localhost:11434/v1/chat/completions',
            apiKey: 'sk-x',
        });
        expect(a.capabilities().apiKeyConfigured).toBe(true);
    });
});
