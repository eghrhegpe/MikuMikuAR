import type { AiService, AiCapabilities, ChatRequest, ChatChunk } from './types';
import { events } from '../runtime-bridge';

let _bindings: typeof import('@bindings/mikumikuar/internal/app/app') | null = null;
async function _getB(): Promise<typeof import('@bindings/mikumikuar/internal/app/app')> {
    if (!_bindings) {
        _bindings = await import('@bindings/mikumikuar/internal/app/app');
    }
    return _bindings;
}

class GoAiAdapter implements AiService {
    readonly kind = 'go' as const;

    capabilities(): AiCapabilities {
        return {
            available: true,
            provider: 'go-bridge',
            streaming: true,
            models: [],
            apiKeyConfigured: false,
            corsRisk: 'none',
            endpointReachable: 'pending',
        };
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

        const onAbort = (): void => {
            streamActive = false;
            done = true;
            b.AiCancelStream().catch(() => undefined);
            resolveWaiter?.();
        };
        req.signal?.addEventListener('abort', onAbort);

        try {
            await b.AiStreamChat({
                model: req.model ?? '',
                messages: req.messages as any,
                temperature: req.temperature ?? 0.7,
                max_tokens: req.maxTokens ?? 2048,
            });

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
            req.signal?.removeEventListener('abort', onAbort);
            if (streamActive) {
                b.AiCancelStream().catch(() => undefined);
            }
        }

        yield { type: 'done' };
    }
}

export const goAiAdapter = new GoAiAdapter();
