// [doc:adr-196] 浏览器 AI 适配器 — 直接 fetch OpenAI 兼容端点
// 零 key 默认路径：Ollama localhost:11434（大模型零 key，小模型零成本）
// 配置存储于 localStorage，用户可覆盖

import type { AiService, AiCapabilities, ChatRequest, ChatChunk } from './types';
import { parseSseStream } from './sse';

const STORAGE_KEY = 'ai.config';

interface AiConfig {
    endpoint: string;
    apiKey: string;
    model: string;
}

const DEFAULT_CONFIG: AiConfig = {
    endpoint: 'http://localhost:11434/v1/chat/completions',
    apiKey: '',
    model: 'llama3.2',
};

function loadConfig(): AiConfig {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<AiConfig>;
            return { ...DEFAULT_CONFIG, ...parsed };
        }
    } catch {
        // localStorage 不可用（隐私模式 / Android WebView 限制）
    }
    return { ...DEFAULT_CONFIG };
}

export function saveAiConfig(config: Partial<AiConfig>): void {
    const current = loadConfig();
    const merged = { ...current, ...config };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
        // 静默失败
    }
}

export class BrowserAiAdapter implements AiService {
    readonly kind = 'browser' as const;

    capabilities(): AiCapabilities {
        const cfg = loadConfig();
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

    async *streamChat(req: ChatRequest): AsyncIterable<ChatChunk> {
        const cfg = loadConfig();
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

        try {
            const response = await fetch(cfg.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: req.signal,
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                yield {
                    type: 'error',
                    error: `HTTP ${response.status}: ${errText || response.statusText}`,
                };
                return;
            }

            yield* parseSseStream(response.body, req.signal);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                yield { type: 'done' };
                return;
            }
            yield {
                type: 'error',
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
}

export const browserAiAdapter = new BrowserAiAdapter();