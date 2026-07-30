// [doc:adr-196] go-adapter 守护测试：capabilities、testConnection、fetchModels、loadConfig、streamChat。
// 桌面端 Go 适配器，依赖 @wailsio/runtime Events + @bindings Go 绑定，通过 vi.mock 隔离。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── 可控制的 mock 状态 ─────────────────────────────────────────────
interface GoMockState {
    llmConfig: { baseUrl: string; model: string; aiKeyConfigured: boolean };
    testResult: { ok: boolean; kind: string; message: string };
    fetchModelsResult: string[];
    aiStreamChatReject: boolean;
    aiStreamChatError: string | null;
}

const mockState = vi.hoisted(() => ({
    llmConfig: { baseUrl: 'http://localhost:11434', model: 'llama3.2', aiKeyConfigured: false },
    testResult: { ok: true, kind: 'unknown', message: 'ok' },
    fetchModelsResult: ['llama3.2', 'mistral'],
    aiStreamChatReject: false,
    aiStreamChatError: null as string | null,
} satisfies GoMockState));

/** 事件订阅注册表：事件名 → Set<回调>，供测试触发模拟事件。 */
const eventHandlers = vi.hoisted(() => new Map<string, Set<(...args: unknown[]) => void>>());

vi.mock('@wailsio/runtime', () => ({
    Events: {
        On: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
            if (!eventHandlers.has(event)) {
                eventHandlers.set(event, new Set());
            }
            eventHandlers.get(event)!.add(cb);
            return () => {
                eventHandlers.get(event)?.delete(cb);
            };
        }),
        Off: vi.fn(),
    },
}));

vi.mock('@bindings/mikumikuar/internal/app/app', () => ({
    AiGetLLMConfig: vi.fn(async () => ({
        baseUrl: (mockState as GoMockState).llmConfig.baseUrl,
        model: (mockState as GoMockState).llmConfig.model,
        aiKeyConfigured: (mockState as GoMockState).llmConfig.aiKeyConfigured,
    })),
    AiTestLLMConnection: vi.fn(async () => (mockState as GoMockState).testResult),
    AiFetchModels: vi.fn(async () => (mockState as GoMockState).fetchModelsResult),
    AiStreamChat: vi.fn(async () => {
        if ((mockState as GoMockState).aiStreamChatReject) {
            throw new Error((mockState as GoMockState).aiStreamChatError ?? 'stream error');
        }
    }),
    AiCancelStream: vi.fn(async () => {}),
}));

import { GoAiAdapter, goAiAdapter } from '../go-adapter';
import type { ChatChunk } from '../types';

/** 触发一次 Wails 事件（模拟 Go 后端回发）。 */
function fireEvent(event: string, data: unknown): void {
    const handlers = eventHandlers.get(event);
    if (handlers) {
        for (const cb of handlers) {
            cb({ data });
        }
    }
}

/** 收集 streamChat 全部产出。 */
async function collectStream(adapter: GoAiAdapter, req?: Parameters<GoAiAdapter['streamChat']>[0]): Promise<ChatChunk[]> {
    const chunks: ChatChunk[] = [];
    const defaultReq = { messages: [{ role: 'user' as const, content: 'hi' }] };
    for await (const chunk of adapter.streamChat(req ?? defaultReq)) {
        chunks.push(chunk);
    }
    return chunks;
}

describe('GoAiAdapter', () => {
    let adapter: GoAiAdapter;

    beforeEach(() => {
        adapter = new GoAiAdapter();
        // 重置 mock 状态
        mockState.llmConfig = { baseUrl: 'http://localhost:11434', model: 'llama3.2', aiKeyConfigured: false };
        mockState.testResult = { ok: true, kind: 'unknown', message: 'ok' };
        mockState.fetchModelsResult = ['llama3.2', 'mistral'];
        mockState.aiStreamChatReject = false;
        mockState.aiStreamChatError = null;
        eventHandlers.clear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── capabilities ──
    describe('capabilities()', () => {
        it('未刷新时返回 fallback（available=false）', () => {
            const caps = adapter.capabilities();
            expect(caps.available).toBe(false);
            expect(caps.adapter).toBe('go-bridge');
            expect(caps.models).toEqual([]);
            expect(caps.streaming).toBe(true);
        });

        it('_refreshCapabilities 成功后更新', async () => {
            await adapter.refreshCapabilities();
            const caps = adapter.capabilities();
            expect(caps.available).toBe(true);
            expect(caps.models).toEqual(['llama3.2']);
        });

        it('baseUrl 为空时 available=false', async () => {
            mockState.llmConfig.baseUrl = '';
            await adapter.refreshCapabilities();
            const caps = adapter.capabilities();
            expect(caps.available).toBe(false);
        });

        it('baseUrl 含 localhost → corsRisk=none', async () => {
            mockState.llmConfig.baseUrl = 'http://localhost:11434';
            await adapter.refreshCapabilities();
            expect(adapter.capabilities().corsRisk).toBe('none');
        });

        it('baseUrl https 远程 → corsRisk=possible', async () => {
            mockState.llmConfig.baseUrl = 'https://api.deepseek.com';
            await adapter.refreshCapabilities();
            expect(adapter.capabilities().corsRisk).toBe('possible');
        });

        it('baseUrl http 远程 → corsRisk=high', async () => {
            mockState.llmConfig.baseUrl = 'http://example.com';
            await adapter.refreshCapabilities();
            expect(adapter.capabilities().corsRisk).toBe('high');
        });

        it('刷新失败时 available=false', async () => {
            mockState.llmConfig = { baseUrl: '', model: '', aiKeyConfigured: false };
            // 让 AiGetLLMConfig 抛出异常
            const app = await import('@bindings/mikumikuar/internal/app/app');
            vi.mocked(app.AiGetLLMConfig).mockRejectedValueOnce(new Error('IPC error'));
            await adapter.refreshCapabilities();
            const caps = adapter.capabilities();
            expect(caps.available).toBe(false);
        });

        it('apiKeyConfigured 恒为 false（Go 侧不暴露 key）', async () => {
            mockState.llmConfig.aiKeyConfigured = true;
            await adapter.refreshCapabilities();
            const caps = adapter.capabilities();
            // adapter 返回 false（go-adapter 硬编码为 false，因为 key 不可回读）
            expect(caps.apiKeyConfigured).toBe(false);
        });
    });

    // ── testConnection ──
    describe('testConnection()', () => {
        it('ok 结果透传', async () => {
            const r = await adapter.testConnection();
            expect(r.ok).toBe(true);
            expect(r.kind).toBe('unknown');
        });

        it('失败结果透传', async () => {
            mockState.testResult = { ok: false, kind: 'network', message: '连接失败' };
            const r = await adapter.testConnection();
            expect(r.ok).toBe(false);
            expect(r.kind).toBe('network');
        });

        it('无效 kind 归一为 unknown', async () => {
            mockState.testResult = { ok: false, kind: 'bogus_kind', message: 'x' };
            const r = await adapter.testConnection();
            expect(r.kind).toBe('unknown');
        });

        it('binding 抛出异常时返回可操作提示', async () => {
            const app = await import('@bindings/mikumikuar/internal/app/app');
            vi.mocked(app.AiTestLLMConnection).mockRejectedValueOnce(new Error('connection refused'));
            const r = await adapter.testConnection();
            expect(r.ok).toBe(false);
            expect(r.message).toContain('桌面端 AI 桥接不可用');
        });

        it('非 connection 异常的 binding 错误', async () => {
            const app = await import('@bindings/mikumikuar/internal/app/app');
            vi.mocked(app.AiTestLLMConnection).mockRejectedValueOnce(new Error('serialization failed'));
            const r = await adapter.testConnection();
            expect(r.ok).toBe(false);
            expect(r.message).toContain('桥接调用失败');
        });
    });

    // ── fetchModels ──
    describe('fetchModels()', () => {
        it('返回排序后的模型列表', async () => {
            mockState.fetchModelsResult = ['z-model', 'a-model'];
            const models = await adapter.fetchModels();
            expect(models).toEqual(['a-model', 'z-model']);
        });

        it('bindings 返回空数组 → 回退 _discoveredModels', async () => {
            // 先成功一次写入 _discoveredModels
            mockState.fetchModelsResult = ['cached-model'];
            await adapter.fetchModels();
            // 第二次返回空
            mockState.fetchModelsResult = [];
            const models = await adapter.fetchModels();
            expect(models).toEqual(['cached-model']);
        });

        it('bindings 出错 → 回退 _discoveredModels', async () => {
            mockState.fetchModelsResult = ['fallback-model'];
            await adapter.fetchModels();
            const app = await import('@bindings/mikumikuar/internal/app/app');
            vi.mocked(app.AiFetchModels).mockRejectedValueOnce(new Error('network err'));
            const models = await adapter.fetchModels();
            expect(models).toEqual(['fallback-model']);
        });

        it('无缓存时返回空数组', async () => {
            mockState.fetchModelsResult = [];
            const models = await adapter.fetchModels();
            expect(models).toEqual([]);
        });

        it('成功时更新 _capCache.models', async () => {
            mockState.fetchModelsResult = ['gpt-4', 'gpt-3.5'];
            // 先刷新 capabilities 让 _capCache 存在
            await adapter.refreshCapabilities();
            await adapter.fetchModels();
            const caps = adapter.capabilities();
            expect(caps.models).toEqual(['gpt-3.5', 'gpt-4']);
        });
    });

    // ── loadConfig ──
    describe('loadConfig()', () => {
        it('返回 Go 后端配置', async () => {
            const cfg = await adapter.loadConfig();
            expect(cfg.endpoint).toBe('http://localhost:11434');
            expect(cfg.model).toBe('llama3.2');
            expect(cfg.keyConfigured).toBe(false);
        });

        it('aiKeyConfigured 透传', async () => {
            mockState.llmConfig.aiKeyConfigured = true;
            const cfg = await adapter.loadConfig();
            expect(cfg.keyConfigured).toBe(true);
        });

        it('binding 异常时返回空配置', async () => {
            const app = await import('@bindings/mikumikuar/internal/app/app');
            vi.mocked(app.AiGetLLMConfig).mockRejectedValueOnce(new Error('IPC disconnect'));
            const cfg = await adapter.loadConfig();
            expect(cfg).toEqual({ endpoint: '', model: '', keyConfigured: false });
        });
    });

    // ── streamChat ──
    describe('streamChat()', () => {
        it('收到 text 块后 yield text + done', async () => {
            const gen = adapter.streamChat({ messages: [{ role: 'user', content: 'hi' }] });
            const iter = gen[Symbol.asyncIterator]();
            // 模拟 Go 后端回发事件
            setTimeout(() => {
                fireEvent('ai:chunk', { delta: '你好' });
                fireEvent('ai:done', {});
            }, 0);
            const first = await iter.next();
            expect(first.value).toEqual({ type: 'text', content: '你好', reasoning: false });
            const second = await iter.next();
            expect(second.value).toEqual({ type: 'done' });
            const third = await iter.next();
            expect(third.done).toBe(true);
        });

        it('收到 tool_call 块', async () => {
            const gen = adapter.streamChat({ messages: [{ role: 'user', content: '天气' }] });
            const iter = gen[Symbol.asyncIterator]();
            setTimeout(() => {
                fireEvent('ai:tool_call', { toolName: 'get_weather', toolArgs: '{"city":"北京"}', toolId: 'call_1' });
                fireEvent('ai:done', {});
            }, 0);
            const first = await iter.next();
            expect(first.value).toEqual({
                type: 'tool_call',
                toolName: 'get_weather',
                toolArgs: '{"city":"北京"}',
                toolId: 'call_1',
            });
            const second = await iter.next();
            expect(second.value).toEqual({ type: 'done' });
        });

        it('收到 error 事件 → yield error + done', async () => {
            const gen = adapter.streamChat({ messages: [{ role: 'user', content: 'x' }] });
            const iter = gen[Symbol.asyncIterator]();
            setTimeout(() => {
                fireEvent('ai:error', { error: '模型响应超时' });
            }, 0);
            const first = await iter.next();
            expect(first.value).toEqual({ type: 'error', error: '模型响应超时' });
            const second = await iter.next();
            expect(second.value).toEqual({ type: 'done' });
        });

        it('AiStreamChat 提交失败 → yield error', async () => {
            mockState.aiStreamChatReject = true;
            mockState.aiStreamChatError = 'IPC serialization failed';
            const chunks = await collectStream(adapter);
            expect(chunks.length).toBeGreaterThanOrEqual(1);
            expect(chunks[0].type).toBe('error');
            expect(chunks[0].error).toContain('请求提交失败');
            expect(chunks[chunks.length - 1].type).toBe('done');
        });

        it('外部 AbortSignal 中断 → yield done', async () => {
            const ac = new AbortController();
            const gen = adapter.streamChat({
                messages: [{ role: 'user', content: 'hi' }],
                signal: ac.signal,
            });
            const iter = gen[Symbol.asyncIterator]();
            // 在流开始前中止
            setTimeout(() => ac.abort(), 0);
            const first = await iter.next();
            expect(first.value?.type).toBe('done');
        });

        it('预中止 signal → AiStreamChat 调用后以 done 收尾', async () => {
            const ac = new AbortController();
            ac.abort();
            const gen = adapter.streamChat({
                messages: [{ role: 'user', content: 'hi' }],
                signal: ac.signal,
            });
            const iter = gen[Symbol.asyncIterator]();
            // 生成器体开始执行 → AiStreamChat 被调用（mock 返回成功）
            // 预中止 signal 的 abort 回调不会自动触发，故 while 等待 waiter。
            // 释放：模拟 done 事件
            setTimeout(() => fireEvent('ai:done', {}), 0);
            const first = await iter.next();
            expect(first.value?.type).toBe('done');
            const second = await iter.next();
            expect(second.done).toBe(true);
        });

        it('无事件时最终 yield done（看门狗 _FIRST_EVENT_TIMEOUT_MS=30s 跳过）', async () => {
            // _FIRST_EVENT_TIMEOUT_MS 为 30s，测试无法等待。
            // 仅验证 AiStreamChat 成功调用、finally 清理不抛异常。
            const gen = adapter.streamChat({ messages: [{ role: 'user', content: 'x' }] });
            const iter = gen[Symbol.asyncIterator]();
            // 手动送 done 释放 while 循环
            setTimeout(() => fireEvent('ai:done', {}), 0);
            await iter.next();
            const remaining = await iter.next();
            expect(remaining.done).toBe(true);
        });

        it('finally 清理事件订阅和 signal listener', async () => {
            const ac = new AbortController();
            const removeSpy = vi.spyOn(ac.signal, 'removeEventListener');
            const gen = adapter.streamChat({
                messages: [{ role: 'user', content: 'hi' }],
                signal: ac.signal,
            });
            const iter = gen[Symbol.asyncIterator]();
            setTimeout(() => {
                fireEvent('ai:done', {});
            }, 0);
            await iter.next();
            // 消费完毕 → finally 应清理
            const next = await iter.next();
            expect(next.done).toBe(true);
            expect(removeSpy).toHaveBeenCalled();
            removeSpy.mockRestore();
        });
    });
});
