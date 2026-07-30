// [doc:adr-196] browser-adapter 守护测试：CORS 风险判定、模型缓存、连接测试、流式聊天。
// BrowserAiAdapter 的 capabilities() 是同步纯逻辑，可独立测试。
// streamChat / testConnection / fetchModels 依赖 fetch mock + parseSseStream mock。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserAiAdapter } from '../browser-adapter';
import type { ChatChunk } from '../types';

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

// ── mock sse (parseSseStream) ─────────────────────────────────────
const mockParseSseStream = vi.hoisted(() => vi.fn());
vi.mock('../sse', () => ({
    parseSseStream: mockParseSseStream,
}));

// ── mock fetch ────────────────────────────────────────────────────
// 在全局 mock fetch，在 beforeEach 中创建可控 mockFetch

describe('BrowserAiAdapter', () => {
    let adapter: BrowserAiAdapter;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        adapter = new BrowserAiAdapter();
        // 重置配置
        mockConfig.endpoint = '';
        mockConfig.model = 'llama3.2';
        mockConfig.apiKey = '';
        mockConfig.timeoutMs = 30000;

        // 创建并注册全局 fetch mock
        mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);

        // 重置 parseSseStream mock
        mockParseSseStream.mockReset();
        // 默认：解析成功并立即 done
        mockParseSseStream.mockImplementation(async function* () {
            yield { type: 'done' };
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
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

    // ── streamChat ──
    describe('streamChat()', () => {
        const req = {
            messages: [{ role: 'user' as const, content: '你好' }],
        };

        /** 收集 streamChat 全部产出的辅助函数（消除 8 次重复的 for-await）。 */
        async function collectStream(
            r: typeof req = req
        ): Promise<ChatChunk[]> {
            const chunks: ChatChunk[] = [];
            for await (const chunk of adapter.streamChat(r)) {
                chunks.push(chunk);
            }
            return chunks;
        }

        it('endpoint 为空 → 返回 error 块', async () => {
            mockConfig.endpoint = '';
            const chunks = await collectStream();
            expect(chunks).toHaveLength(1);
            expect(chunks[0].type).toBe('error');
            expect(chunks[0].error).toContain('AI 端点未配置');
            // parseSseStream 不应被调用
            expect(mockParseSseStream).not.toHaveBeenCalled();
        });

        it('HTTP 200 → 透传 parseSseStream 的输出', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: true,
                body: new ReadableStream(),
            });
            // parseSseStream 产出一条 text + done
            mockParseSseStream.mockImplementation(async function* () {
                yield { type: 'text', content: '你好' };
                yield { type: 'done' };
            });

            const chunks = await collectStream();
            expect(chunks).toHaveLength(2);
            expect(chunks[0]).toEqual({ type: 'text', content: '你好' });
            expect(chunks[1]).toEqual({ type: 'done' });
            // 验证 fetch 参数
            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [url, opts] = mockFetch.mock.calls[0];
            expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
            expect(opts.method).toBe('POST');
            const body = JSON.parse(opts.body);
            expect(body.stream).toBe(true);
            expect(body.messages).toEqual([{ role: 'user', content: '你好' }]);
            expect(body.tools).toBeUndefined();
        });

        it('HTTP 200 + tools 参数 → 请求体中包含 tools', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: true,
                body: new ReadableStream(),
            });
            mockParseSseStream.mockImplementation(async function* () {
                yield { type: 'done' };
            });

            const reqWithTools = {
                ...req,
                tools: [{ name: 'loadModel', description: '加载模型' }],
            };
            await collectStream(reqWithTools);
            const [, opts] = mockFetch.mock.calls[0];
            const body = JSON.parse(opts.body);
            expect(body.tools).toEqual([{ name: 'loadModel', description: '加载模型' }]);
        });

        it('HTTP 非 200 → 返回 HTTP 错误块', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: () => Promise.resolve('Invalid API key'),
            });

            const chunks = await collectStream();
            expect(chunks).toHaveLength(1);
            expect(chunks[0].type).toBe('error');
            expect(chunks[0].error).toContain('HTTP 401');
            expect(chunks[0].error).toContain('Invalid API key');
            // HTTP 错误分支不应调 parseSseStream
            expect(mockParseSseStream).not.toHaveBeenCalled();
        });

        it('HTTP 非 200 + text() 失败 → 兜底用 statusText', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                text: () => Promise.reject(new Error('stream error')),
            });

            const chunks = await collectStream();
            expect(chunks).toHaveLength(1);
            expect(chunks[0].type).toBe('error');
            expect(chunks[0].error).toContain('HTTP 503');
            expect(chunks[0].error).toContain('Service Unavailable');
        });

        it('fetch 抛出 AbortError → 返回 done 块', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
            const chunks = await collectStream();
            expect(chunks).toHaveLength(1);
            expect(chunks[0].type).toBe('done');
        });

        it('fetch 抛出 TypeError（网络异常）→ 返回友好错误块', async () => {
            mockConfig.endpoint = 'https://remote-api.example.com/v1/chat/completions';
            mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
            const chunks = await collectStream();
            expect(chunks).toHaveLength(1);
            expect(chunks[0].type).toBe('error');
            // TypeError 无 CORS 关键词时回退到通用友好提示
            expect(chunks[0].error).toContain('服务可能未启动');
        });

        it('fetch 抛出 ERR_CONNECTION_REFUSED → 返回友好错误块', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockRejectedValue(new TypeError('ERR_CONNECTION_REFUSED'));
            const chunks = await collectStream();
            expect(chunks).toHaveLength(1);
            expect(chunks[0].type).toBe('error');
            expect(chunks[0].error).toContain('连接被拒绝');
        });

        it('超时触发 AbortSignal.timeout → 返回 done', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockConfig.timeoutMs = 10; // 极短超时

            // fetch 正常返回，但 parseSseStream 检测到 signal aborted 后 yield done
            const abortController = new AbortController();
            mockFetch.mockImplementation((_url: string, opts: { signal?: AbortSignal }) => {
                // 把外部 signal 转发给内部 AbortController
                opts.signal?.addEventListener('abort', () => abortController.abort());
                return Promise.resolve({
                    ok: true,
                    body: new ReadableStream(),
                });
            });

            // parseSseStream 模拟检测到 signal.aborted
            mockParseSseStream.mockImplementation(async function* (
                _body: ReadableStream,
                signal?: AbortSignal
            ) {
                // 等待 signal abort
                await new Promise<void>((resolve) => {
                    if (signal?.aborted) {
                        resolve();
                    } else {
                        signal?.addEventListener('abort', () => resolve(), { once: true });
                    }
                });
                yield { type: 'done' };
            });

            const chunks = await collectStream();
            // 超时应产生 done
            expect(chunks.length).toBeGreaterThanOrEqual(1);
            expect(chunks[chunks.length - 1].type).toBe('done');
        }, 10_000); // 给超时留足时间

        it('finally 执行 ac.abort() 资源清理（外部 break 后）', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: true,
                body: new ReadableStream(),
            });
            // parseSseStream 产出一条后永久挂起
            let hangResolve: () => void;
            const hangPromise = new Promise<void>((r) => { hangResolve = r; });
            mockParseSseStream.mockImplementation(async function* () {
                yield { type: 'text', content: '开始' };
                await hangPromise; // 不 resolve → 永远不会 yield done
            });

            const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

            const gen = adapter.streamChat(req);
            const iter = gen[Symbol.asyncIterator]();
            // 取第一个 chunk 后 break
            const first = await iter.next();
            expect(first.value).toEqual({ type: 'text', content: '开始' });
            // 不消费剩余 → generator 进入 finally → 调用 ac.abort()
            await iter.return?.();

            expect(abortSpy).toHaveBeenCalled();
            abortSpy.mockRestore();
        });

        it('finally 执行 removeEventListener 清理', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: true,
                body: new ReadableStream(),
            });
            mockParseSseStream.mockImplementation(async function* () {
                yield { type: 'done' };
            });

            const externalAc = new AbortController();
            const removeSpy = vi.spyOn(externalAc.signal, 'removeEventListener');

            const reqWithSignal = { ...req, signal: externalAc.signal };
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of adapter.streamChat(reqWithSignal)) {
                // consume all
            }
            // 外部 signal 传入了 → finally 应调用 removeEventListener
            expect(removeSpy).toHaveBeenCalled();
            removeSpy.mockRestore();
        });

        it('req.signal 预中止 → 返回 done（AbortError 路径）', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            // fetch 检测到 internal signal 已中止时抛 AbortError
            mockFetch.mockImplementation(async (_url: string, opts: { signal?: AbortSignal }) => {
                // 等待微任务队列（让 onAbort 从预中止 signal 被调度执行）
                await new Promise((r) => setTimeout(r, 0));
                if (opts.signal?.aborted) {
                    throw new DOMException('The operation was aborted', 'AbortError');
                }
                return { ok: true, body: new ReadableStream() };
            });

            const preAborted = new AbortController();
            preAborted.abort();

            const reqWithAbortedSignal = { ...req, signal: preAborted.signal };
            const chunks: ChatChunk[] = [];
            for await (const chunk of adapter.streamChat(reqWithAbortedSignal)) {
                chunks.push(chunk);
            }
            expect(chunks).toHaveLength(1);
            expect(chunks[0].type).toBe('done');
        });
    });

    // ── testConnection ──
    describe('testConnection()', () => {
        it('endpoint 为空 → missingEndpoint', async () => {
            mockConfig.endpoint = '';
            const result = await adapter.testConnection();
            expect(result.ok).toBe(false);
            expect(result.kind).toBe('missingEndpoint');
            expect(result.message).toContain('未配置');
        });

        it('HTTP 200 → ok=true', async () => {
            mockConfig.endpoint = 'http://localhost:11434/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
            });

            const result = await adapter.testConnection();
            expect(result.ok).toBe(true);
        });

        it('HTTP 401 → ok=false + classifyAiError', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: () => Promise.resolve('Bad credentials'),
            });

            const result = await adapter.testConnection();
            expect(result.ok).toBe(false);
            expect(result.message).toContain('HTTP 401');
            expect(result.message).toContain('Bad credentials');
        });

        it('fetch 抛出 TypeError（网络错误）→ ok=false', async () => {
            mockConfig.endpoint = 'http://localhost:11434/v1/chat/completions';
            mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

            const result = await adapter.testConnection();
            expect(result.ok).toBe(false);
            expect(result.message).toContain('服务可能未启动');
        });
    });

    // ── fetchModels ──
    describe('fetchModels()', () => {
        it('endpoint 为空 → 返回空数组', async () => {
            mockConfig.endpoint = '';
            const models = await adapter.fetchModels();
            expect(models).toEqual([]);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('OpenAI 兼容格式 → 解析并排序', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    data: [
                        { id: 'deepseek-chat' },
                        { id: 'deepseek-reasoner' },
                    ],
                }),
            });

            const models = await adapter.fetchModels();
            expect(models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
            // 应请求 {base}/models（method 为隐式的 GET）
            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.deepseek.com/v1/models',
                expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) })
            );
        });

        it('Ollama /api/tags 格式 → 解析并排序', async () => {
            mockConfig.endpoint = 'http://localhost:11434/v1/chat/completions';
            mockFetch.mockImplementation(async (url: string) => {
                if (url.includes('/api/tags')) {
                    return {
                        ok: true,
                        json: () => Promise.resolve({
                            models: [
                                { name: 'llama3.2:3b' },
                                { name: 'mistral:7b' },
                            ],
                        }),
                    };
                }
                return { ok: false, status: 404 };
            });

            const models = await adapter.fetchModels();
            expect(models).toEqual(['llama3.2:3b', 'mistral:7b']);
            // 应尝试过 /api/tags（method 为隐式的 GET）
            // 第三轮调用 URL 应为 /api/tags
            expect(mockFetch).toHaveBeenNthCalledWith(
                3,
                'http://localhost:11434/api/tags',
                expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) })
            );
        });

        it('全部候选端点失败 → 返回空数组', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
            });

            const models = await adapter.fetchModels();
            expect(models).toEqual([]);
        });

        it('成功时缓存结果到 _fetchedModelsCache 并影响 capabilities()', async () => {
            mockConfig.endpoint = 'https://api.openai.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    data: [{ id: 'gpt-4' }, { id: 'gpt-3.5' }],
                }),
            });

            await adapter.fetchModels();
            // 访问私有属性验证缓存
            const cached = (adapter as unknown as { _fetchedModelsCache: string[] | null })._fetchedModelsCache;
            expect(cached).toEqual(['gpt-3.5', 'gpt-4']);

            // capabilities() 优先使用缓存而非配置单模型
            const caps = adapter.capabilities();
            expect(caps.models).toEqual(['gpt-3.5', 'gpt-4']);
        });

        it('fetchModels 失败时缓存不变，capabilities 回退配置模型', async () => {
            mockConfig.endpoint = 'https://api.openai.com/v1/chat/completions';
            mockConfig.model = 'fallback-model';
            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
            });

            await adapter.fetchModels();
            const cached = (adapter as unknown as { _fetchedModelsCache: string[] | null })._fetchedModelsCache;
            expect(cached).toBeNull();

            // capabilities 回退配置单模型
            const caps = adapter.capabilities();
            expect(caps.models).toEqual(['fallback-model']);
        });

        it('携带 apiKey 时请求头带 Authorization', async () => {
            mockConfig.apiKey = 'sk-test-key';
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [{ id: 'model-1' }] }),
            });

            await adapter.fetchModels();
            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer sk-test-key',
                    }),
                })
            );
        });

        it('fetch 使用 AbortSignal.timeout(5000) 防挂起', async () => {
            mockConfig.endpoint = 'https://api.deepseek.com/v1/chat/completions';
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [{ id: 'm' }] }),
            });

            const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
            await adapter.fetchModels();

            expect(timeoutSpy).toHaveBeenCalledWith(5000);
            // 且每个 fetch 调用都携带了 signal
            for (const call of mockFetch.mock.calls) {
                const opts = call[1] as { signal?: AbortSignal };
                expect(opts.signal).toBeInstanceOf(AbortSignal);
            }
            timeoutSpy.mockRestore();
        });
    });
});
