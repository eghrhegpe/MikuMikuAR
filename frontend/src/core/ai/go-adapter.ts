import type {
    AiService,
    AiCapabilities,
    ChatRequest,
    ChatChunk,
    AiConnectionResult,
    AiPersistedConfig,
    AiErrorKind,
} from './types';
import { AI_ERROR_KINDS } from './types';
import { makeLazyLoader } from '../async';
import { logInfo, logWarn } from '../logger';
import type { LLMConfig } from '@bindings/mikumikuar/internal/app/models';
import type { ChatRequest as LLMChatRequest } from '@bindings/mikumikuar/internal/app/llm/models';

// 直接惰性加载 @wailsio/runtime 的 Events：Events.On 是纯静态函数（模块 import 即注册
// 全局 dispatchWailsEvent），无需实例初始化。此前经 core/runtime-bridge 的 events Proxy
// 订阅，因 WailsRuntimeBridge 惰性 _load 时序问题会静默回落到 no-op WebEvents，导致 Go
// 后端事件（ai:chunk/done/error）全部收不到、流式永久超时。go-adapter 仅在桌面 go 模式
// 加载，直接依赖 @wailsio/runtime 安全且可靠。
const _getEvents = makeLazyLoader(async () => (await import('@wailsio/runtime')).Events);


const _getB = makeLazyLoader(async () => import('@bindings/mikumikuar/internal/app/app'));

// [doc:adr-199] 首字节看门狗：streamChat 发起后若长时间无任何事件（chunk/done/error），
// 主动注入一条 error 让流收尾，避免前端按钮永久卡在 streaming、用户干等黑盒。
const _FIRST_EVENT_TIMEOUT_MS = 30000;


class GoAiAdapter implements AiService {
    readonly kind = 'go' as const;

    private _capCache: AiCapabilities | null = null;
    private _capsPromise: Promise<void> | null = null;

    capabilities(): AiCapabilities {
        if (this._capCache) {
            return this._capCache;
        }
        if (!this._capsPromise) {
            this._refreshCapabilities().catch(() => undefined);
        }
        return {
            available: false,
            adapter: 'go-bridge',
            streaming: true,
            models: [],
            apiKeyConfigured: false,
            corsRisk: 'none',
            endpointReachable: 'pending',
        };
    }

    refreshCapabilities(): Promise<void> {
        return this._refreshCapabilities();
    }

    private async _refreshCapabilities(): Promise<void> {
        if (this._capsPromise) {
            return this._capsPromise;
        }
        this._capsPromise = (async () => {
            try {
                const b = await _getB();
                const cfg: LLMConfig = await b.AiGetLLMConfig();
                const baseUrl = cfg.baseUrl?.trim() ?? '';
                const available = baseUrl.length > 0;
                let corsRisk: AiCapabilities['corsRisk'] = 'none';
                if (baseUrl) {
                    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl);
                    if (isLocal) {
                        corsRisk = 'none';
                    } else if (/^https:\/\//i.test(baseUrl)) {
                        corsRisk = 'possible';
                    } else if (/^http:\/\//i.test(baseUrl)) {
                        corsRisk = 'high';
                    }
                }
                this._capCache = {
                    available,
                    adapter: 'go-bridge',
                    streaming: true,
                    models: cfg.model ? [cfg.model] : [],
                    apiKeyConfigured: false,
                    corsRisk,
                    endpointReachable: 'pending',
                };
            } catch {
                this._capCache = {
                    available: false,
                    adapter: 'go-bridge',
                    streaming: true,
                    models: [],
                    apiKeyConfigured: false,
                    corsRisk: 'none',
                    endpointReachable: 'pending',
                };
            }
        })();
        try {
            await this._capsPromise;
        } finally {
            this._capsPromise = null;
        }
    }

    async testConnection(): Promise<AiConnectionResult> {
        const b = await _getB();
        try {
            const res = await b.AiTestLLMConnection();
            return {
                ok: res.ok,
                kind: (AI_ERROR_KINDS as readonly string[]).includes(res.kind)
                    ? (res.kind as AiErrorKind)
                    : 'unknown',
                message: res.message,
            };
        } catch (err) {
            return {
                ok: false,
                kind: 'unknown',
                message: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async fetchModels(): Promise<string[]> {
        // 桌面端联网发现模型：调 Go binding 真正请求 {baseUrl}/models（带 key）。
        // 先前仅回显 _capCache.models（配置里的单个 model），并非真实发现。
        try {
            const b = await _getB();
            const models = await b.AiFetchModels();
            if (Array.isArray(models) && models.length > 0) {
                return [...models].sort();
            }
        } catch {
            /* 网络/鉴权失败静默回退缓存 */
        }
        if (this._capCache?.models && this._capCache.models.length > 0) {
            return [...this._capCache.models];
        }
        return [];
    }

    async loadConfig(): Promise<AiPersistedConfig> {
        try {
            const b = await _getB();
            const cfg: LLMConfig = await b.AiGetLLMConfig();
            return {
                endpoint: cfg.baseUrl?.trim() ?? '',
                model: cfg.model?.trim() ?? '',
                // Go 侧为安全不回读 key 明文，仅用 aiKeyConfigured 布尔标志
                keyConfigured: cfg.aiKeyConfigured === true,
            };
        } catch {
            return { endpoint: '', model: '', keyConfigured: false };
        }
    }

    async *streamChat(req: ChatRequest): AsyncIterable<ChatChunk> {
        const b = await _getB();
        const evt = await _getEvents();

        const queue: ChatChunk[] = [];
        let done = false;
        let err: string | null = null;
        let resolveWaiter: (() => void) | null = null;
        let streamActive = true;
        // 可观测性：记录首事件到达耗时、累计事件数，便于定位"发出请求后长时间无响应"卡点。
        const t0 = Date.now();
        let firstEventSeen = false;
        let eventCount = 0;
        let watchdog: ReturnType<typeof setTimeout> | null = null;

        const markFirstEvent = (kind: string): void => {
            eventCount++;
            if (!firstEventSeen) {
                firstEventSeen = true;
                logInfo('ai-stream', `首事件到达 kind=${kind} 耗时=${Date.now() - t0}ms`);
                if (watchdog) {
                    clearTimeout(watchdog);
                    watchdog = null;
                }
            }
        };

        // @wailsio/runtime 的 On 回调收到 WailsEvent，实际数据在 ev.data（Go 端 Emit 的 map）。
        const unsubChunk = evt.On('ai:chunk', (ev) => {
            const d = ev.data as { delta?: string } | undefined;
            if (d?.delta) {
                markFirstEvent('chunk');
                queue.push({ type: 'text', content: d.delta });
                resolveWaiter?.();
            }
        });
        const unsubDone = evt.On('ai:done', () => {
            markFirstEvent('done');
            logInfo('ai-stream', `收到 done 总耗时=${Date.now() - t0}ms 事件数=${eventCount}`);
            done = true;
            streamActive = false;
            resolveWaiter?.();
        });
        const unsubError = evt.On('ai:error', (ev) => {
            const d = ev.data as { error?: string } | undefined;
            markFirstEvent('error');
            err = d?.error ?? '未知错误';
            logWarn('ai-stream', `收到 error 事件 耗时=${Date.now() - t0}ms: ${err}`);
            done = true;
            streamActive = false;
            resolveWaiter?.();
        });
        const unsubToolCall = evt.On('ai:tool_call', (ev) => {
            const d = ev.data as { toolName?: string; toolArgs?: string; toolId?: string } | undefined;
            if (d?.toolName) {
                markFirstEvent('tool_call');
                queue.push({
                    type: 'tool_call',
                    toolName: d.toolName,
                    toolArgs: d.toolArgs ?? '',
                    toolId: d.toolId ?? '',
                });
                resolveWaiter?.();
            }
        });

        // 首事件看门狗：超时未收到任何事件 → 注入 error 让流收尾（防永久挂起黑盒）。
        watchdog = setTimeout(() => {
            if (!firstEventSeen && !done) {
                logWarn(
                    'ai-stream',
                    `${_FIRST_EVENT_TIMEOUT_MS}ms 内未收到任何后端事件，判定超时并收尾`
                );
                err = `等待响应超时（${Math.round(_FIRST_EVENT_TIMEOUT_MS / 1000)}s 无任何数据）`;
                done = true;
                streamActive = false;
                b.AiCancelStream().catch(() => undefined);
                resolveWaiter?.();
            }
        }, _FIRST_EVENT_TIMEOUT_MS);

        const onAbort = (): void => {
            logInfo('ai-stream', `用户中断 abort 耗时=${Date.now() - t0}ms`);
            streamActive = false;
            done = true;
            b.AiCancelStream().catch(() => undefined);
            resolveWaiter?.();
        };
        req.signal?.addEventListener('abort', onAbort);


        try {
            const tools = req.tools?.length
                ? req.tools.map((t) => ({
                      type: t.type,
                      function: {
                          name: t.function.name,
                          description: t.function.description,
                          parameters: t.function.parameters,
                      },
                  }))
                : undefined;
            const llmReq: LLMChatRequest = {
                model: req.model ?? '',
                messages: req.messages.map((m) => {
                    if (m.role === 'tool') {
                        return {
                            role: m.role,
                            content: m.content,
                            tool_call_id: m.tool_call_id,
                        };
                    }
                    if (m.role === 'assistant' && m.tool_calls) {
                        return {
                            role: m.role,
                            content: m.content,
                            tool_calls: m.tool_calls.map((tc) => ({
                                id: tc.id,
                                type: tc.type,
                                function: {
                                    name: tc.function.name,
                                    arguments: tc.function.arguments,
                                },
                            })),
                        };
                    }
                    return { role: m.role, content: m.content as string };
                }),
                temperature: req.temperature ?? 0.7,
                max_tokens: req.maxTokens ?? 2048,
                ...(tools ? { tools } : {}),
            };
            logInfo(
                'ai-stream',
                `发起 AiStreamChat model=${llmReq.model || '(默认)'} 消息数=${llmReq.messages.length} tools=${tools?.length ?? 0}`
            );
            try {
                await b.AiStreamChat(llmReq);
                logInfo('ai-stream', `AiStreamChat 已提交，等待后端事件… 耗时=${Date.now() - t0}ms`);
            } catch (submitErr) {
                // binding 调用本身失败（IPC/序列化）：直接注入 error 收尾，不干等看门狗。
                const msg = submitErr instanceof Error ? submitErr.message : String(submitErr);
                logWarn('ai-stream', `AiStreamChat 提交失败: ${msg}`);
                err = `请求提交失败：${msg}`;
                done = true;
                streamActive = false;
                resolveWaiter?.();
            }

            while (!done || queue.length > 0) {
                if (queue.length > 0) {
                    yield queue.shift()!;
                } else if (!done) {
                    await new Promise<void>((r) => {
                        resolveWaiter = r;
                    });
                }
            }
            if (err) {
                yield { type: 'error', error: err };
            }
        } finally {
            if (watchdog) {
                clearTimeout(watchdog);
                watchdog = null;
            }
            unsubChunk();
            unsubDone();
            unsubError();
            unsubToolCall();
            req.signal?.removeEventListener('abort', onAbort);
            if (streamActive) {
                b.AiCancelStream().catch(() => undefined);
            }
        }

        yield { type: 'done' };
    }
}

export const goAiAdapter = new GoAiAdapter();
