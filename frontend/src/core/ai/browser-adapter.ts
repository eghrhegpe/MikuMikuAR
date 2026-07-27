// [doc:adr-196] 浏览器 AI 适配器 — 直接 fetch OpenAI 兼容端点
// 零 key 默认路径：Ollama localhost:11434（大模型零 key，小模型零成本）
// 配置经 config-store（IndexedDB）持久化，不再使用 Web Storage（FR-9 / AC-5）

import type { AiService, AiCapabilities, ChatRequest, ChatChunk } from './types';
import { parseSseStream } from './sse';
import { loadAiConfig } from './config-store';

export class BrowserAiAdapter implements AiService {
    readonly kind = 'browser' as const;

    capabilities(): AiCapabilities {
        const cfg = loadAiConfig();
        const endpoint = cfg.endpoint.trim();
        const available = endpoint.length > 0;
        // CORS 风险判定：localhost/127.0.0.1 → none；https 远程 → possible；http 远程 → high
        let corsRisk: 'none' | 'possible' | 'high' = 'none';
        if (endpoint) {
            const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(endpoint);
            if (isLocal) {
                corsRisk = 'none';
            } else if (/^https:\/\//i.test(endpoint)) {
                corsRisk = 'possible';
            } else if (/^http:\/\//i.test(endpoint)) {
                corsRisk = 'high';
            }
        }
        return {
            available,
            provider: /localhost|127\.0\.0\.1/i.test(endpoint) ? 'ollama' : 'openai-compat',
            streaming: true,
            models: [cfg.model],
            apiKeyConfigured: !!cfg.apiKey,
            corsRisk,
            endpointReachable: 'pending',
        };
    }

    async testConnection(): Promise<{ ok: boolean; message: string }> {
        const cfg = loadAiConfig();
        if (!cfg.endpoint) {
            return { ok: false, message: 'AI 端点未配置，请在诊断面板中设置' };
        }
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (cfg.apiKey) {
                headers['Authorization'] = `Bearer ${cfg.apiKey}`;
            }
            const response = await fetch(cfg.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: cfg.model,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 1,
                    stream: false,
                }),
            });
            if (response.ok) {
                return { ok: true, message: '连接成功' };
            }
            const errText = await response.text().catch(() => '');
            return { ok: false, message: `HTTP ${response.status}: ${errText || response.statusText}` };
        } catch (err) {
            return { ok: false, message: _friendlyError(err) };
        }
    }

    async *streamChat(req: ChatRequest): AsyncIterable<ChatChunk> {
        const cfg = loadAiConfig();
        if (!cfg.endpoint) {
            yield { type: 'error', error: 'AI 端点未配置，请在诊断面板中设置' };
            return;
        }

        const body = {
            model: req.model ?? cfg.model,
            messages: req.messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 2048,
            stream: true,
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (cfg.apiKey) {
            headers['Authorization'] = `Bearer ${cfg.apiKey}`;
        }

        // 内部 AbortController：转发 req.signal，并在 generator 退出（break/return）时强制中止底层 fetch（FR-10 / AC-6）
        const ac = new AbortController();
        const onAbort = (): void => ac.abort();
        req.signal?.addEventListener('abort', onAbort);

        try {
            const response = await fetch(cfg.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: ac.signal,
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                yield {
                    type: 'error',
                    error: `HTTP ${response.status}: ${errText || response.statusText}`,
                };
                return;
            }

            yield* parseSseStream(response.body, ac.signal);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                yield { type: 'done' };
                return;
            }
            // CORS / 网络错误友好提示（FR-13）
            yield { type: 'error', error: _friendlyError(err) };
        } finally {
            req.signal?.removeEventListener('abort', onAbort);
            ac.abort(); // 确保外部 break/return 时底层请求被中止
        }
    }
}

/** CORS / 网络错误友好提示（FR-13）：本地 Ollama 需 OLLAMA_ORIGINS=*；远程 API 建议自建同源 relay。 */
function _friendlyError(err: unknown): string {
    const isNetwork =
        err instanceof TypeError ||
        (err instanceof Error && /Failed to fetch|NetworkError|CORS/i.test(err.message));
    if (isNetwork) {
        return '连接端点失败（可能为 CORS/网络限制）。本地 Ollama 请设置环境变量 OLLAMA_ORIGINS=* 后重启；远程 API 建议自建同源 relay 代理。';
    }
    return err instanceof Error ? err.message : String(err);
}

export const browserAiAdapter = new BrowserAiAdapter();
