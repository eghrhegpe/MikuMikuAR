import type {
    AiService,
    AiCapabilities,
    ChatRequest,
    ChatChunk,
    AiConnectionResult,
} from './types';
import { events } from '../runtime-bridge';
import type * as AppBindings from '@bindings/mikumikuar/internal/app/app';
import type { LLMConfig } from '@bindings/mikumikuar/internal/app/models';
import type { ChatRequest as LLMChatRequest } from '@bindings/mikumikuar/internal/app/llm/models';

let _bindings: typeof AppBindings | null = null;
async function _getB(): Promise<typeof AppBindings> {
    if (!_bindings) {
        _bindings = await import('@bindings/mikumikuar/internal/app/app');
    }
    return _bindings;
}

class GoAiAdapter implements AiService {
    readonly kind = 'go' as const;

    private _capCache: AiCapabilities | null = null;
    private _capsPromise: Promise<void> | null = null;

    capabilities(): AiCapabilities {
        if (this._capCache) return this._capCache;
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
        if (this._capsPromise) return this._capsPromise;
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
        await this._capsPromise;
    }

    async testConnection(): Promise<AiConnectionResult> {
        const b = await _getB();
        try {
            const res = await b.AiTestLLMConnection();
            return {
                ok: res.ok,
                kind: (res.kind as AiConnectionResult['kind']) || 'unknown',
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

    async *streamChat(req: ChatRequest): AsyncIterable<ChatChunk> {
        const b = await _getB();

        const queue: ChatChunk[] = [];
        let done = false;
        let err: string | null = null;
        let resolveWaiter: (() => void) | null = null;
        let streamActive = true;

        const unsubChunk = events.on('ai:chunk', (data: unknown) => {
            const d = data as { delta?: string };
            if (d?.delta) {
                queue.push({ type: 'text', content: d.delta });
                resolveWaiter?.();
            }
        });
        const unsubDone = events.on('ai:done', () => {
            done = true;
            streamActive = false;
            resolveWaiter?.();
        });
        const unsubError = events.on('ai:error', (data: unknown) => {
            const d = data as { error?: string };
            err = d?.error ?? '未知错误';
            done = true;
            streamActive = false;
            resolveWaiter?.();
        });
        const unsubToolCall = events.on('ai:tool_call', (data: unknown) => {
            const d = data as { toolName?: string; toolArgs?: string; toolId?: string };
            if (d?.toolName) {
                queue.push({
                    type: 'tool_call',
                    toolName: d.toolName,
                    toolArgs: d.toolArgs ?? '',
                    toolId: d.toolId ?? '',
                });
                resolveWaiter?.();
            }
        });

        const onAbort = (): void => {
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
            await b.AiStreamChat(llmReq);

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
