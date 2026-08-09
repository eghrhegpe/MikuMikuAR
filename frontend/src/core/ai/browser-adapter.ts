// [doc:adr-196] 浏览器 AI 适配器 — 直接 fetch OpenAI 兼容端点
// 零 key 默认路径：Ollama localhost:11434（大模型零 key，小模型零成本）
// 配置经 config-store（IndexedDB）持久化，不再使用 Web Storage（FR-9 / AC-5）
//
// [doc:relay] 网页端远程 API 通过自建 Cloudflare Worker relay 转发以绕过 CORS。
// relay 逻辑：当 isWebPlatform() && 端点非 localhost && relayUrl 已配置时，
// 请求发往 relayUrl，带 X-Target-Url 头指向真实端点，由 Worker 补齐 CORS 头后转发。

import type {
    AiService,
    AiCapabilities,
    ChatRequest,
    ChatChunk,
    AiConnectionResult,
    AiPersistedConfig,
} from './types';
import { parseSseStream } from './sse';
import { loadAiConfig, classifyAiError } from './config-store';
import { logWarn } from '../logger';
import { translateGoError } from '../i18n/goerr';
import { relayTarget, isRemoteEndpoint } from './relay';

export class BrowserAiAdapter implements AiService {
    readonly kind = 'browser' as const;

    // P2-3: fetchModels 成功后缓存真实列表，让 capabilities() 不再只返回 [cfg.model]
    private _fetchedModelsCache: string[] | null = null;

    capabilities(): AiCapabilities {
        const cfg = loadAiConfig();
        const endpoint = cfg.endpoint.trim();
        const available = endpoint.length > 0;
        // CORS 风险判定：localhost/127.0.0.1 → none；https 远程 → possible；http 远程 → high
        // [doc:relay] 若 relay 已配置且网页端+远程端点，则 corsRisk 降为 none（relay 负责 CORS）
        let corsRisk: 'none' | 'possible' | 'high' = 'none';
        const relayActive = relayTarget(cfg.relayUrl, endpoint) !== null;
        if (relayActive) {
            corsRisk = 'none';
        } else if (endpoint) {
            if (!isRemoteEndpoint(endpoint)) {
                corsRisk = 'none';
            } else if (/^https:\/\//i.test(endpoint)) {
                corsRisk = 'possible';
            } else if (/^http:\/\//i.test(endpoint)) {
                corsRisk = 'high';
            }
        }
        // 优先用 fetchModels 缓存的真实列表，否则回退配置单模型
        const models = this._fetchedModelsCache ?? (cfg.model ? [cfg.model] : []);
        return {
            available,
            adapter: /localhost|127\.0\.0\.1/i.test(endpoint) ? 'ollama' : 'openai-compat',
            streaming: true,
            models,
            apiKeyConfigured: !!cfg.apiKey,
            corsRisk,
            endpointReachable: 'pending',
        };
    }

    async testConnection(): Promise<AiConnectionResult> {
        const cfg = loadAiConfig();
        const corsRisk = this.capabilities().corsRisk;
        if (!cfg.endpoint) {
            return {
                ok: false,
                kind: 'missingEndpoint',
                message: 'AI 端点未配置，请在诊断面板中设置',
            };
        }
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (cfg.apiKey) {
                headers['Authorization'] = `Bearer ${cfg.apiKey}`;
            }
            // [doc:relay] 网页端远程 API 经 relay 转发以绕过 CORS
            const relayUrl = relayTarget(cfg.relayUrl, cfg.endpoint);
            const fetchUrl = relayUrl ?? cfg.endpoint;
            if (relayUrl) {
                headers['X-Target-Url'] = cfg.endpoint;
            }
            const response = await fetch(fetchUrl, {
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
                // ok=true 时 kind 不被消费方读取，'unknown' 仅占位
                return { ok: true, kind: 'unknown', message: '连接成功' };
            }
            const errText = await response.text().catch(() => '');
            const message = `HTTP ${response.status}: ${errText || response.statusText}`;
            return {
                ok: false,
                kind: classifyAiError(message, corsRisk),
                message,
            };
        } catch (err) {
            const message = _friendlyError(err);
            return {
                ok: false,
                kind: classifyAiError(message, corsRisk),
                message,
            };
        }
    }

    async fetchModels(): Promise<string[]> {
        const cfg = loadAiConfig();
        const endpoint = cfg.endpoint.trim();
        if (!endpoint) {
            return [];
        }
        // 从聊天端点推导 API 基础路径
        const base = endpoint.replace('/chat/completions', '');
        const candidates: string[] = [];

        // OpenAI 兼容格式：{base}/models
        candidates.push(`${base}/models`);

        // 若 base 以 /v1 结尾，也尝试去 /v1 的 /models
        if (base.endsWith('/v1')) {
            candidates.push(`${base.slice(0, -3)}/models`);
        }

        // Ollama 原生 API：{origin}/api/tags（仅限 localhost）
        if (/localhost|127\.0\.0\.1/i.test(base)) {
            try {
                const u = new URL(base);
                candidates.push(`${u.origin}/api/tags`);
            } catch {
                /* ignore */
            }
        }

        const headers: Record<string, string> = { Accept: 'application/json' };
        if (cfg.apiKey) {
            headers['Authorization'] = `Bearer ${cfg.apiKey}`;
        }

        let lastErr: unknown = null;
        // [doc:relay] 网页端远程 API 经 relay 转发以绕过 CORS
        const relayUrl = relayTarget(cfg.relayUrl, cfg.endpoint);
        for (const url of candidates) {
            try {
                // relay 模式下所有候选 URL 发往 relayUrl，带 X-Target-Url 头
                const fetchUrl = relayUrl ?? url;
                const reqHeaders: Record<string, string> = { ...headers };
                if (relayUrl) {
                    reqHeaders['X-Target-Url'] = url;
                }
                const res = await fetch(fetchUrl, {
                    headers: reqHeaders,
                    signal: AbortSignal.timeout(5000),
                });
                if (!res.ok) {
                    lastErr = new Error(`HTTP ${res.status}: ${url}`);
                    continue;
                }
                const data = await res.json();
                // OpenAI 兼容：{ data: [{ id: string }] }
                if (data?.data && Array.isArray(data.data)) {
                    const models = data.data
                        .map((m: { id?: string }) => m.id)
                        .filter(Boolean)
                        .sort();
                    if (models.length > 0) {
                        this._fetchedModelsCache = models;
                        return models;
                    }
                }
                // Ollama：{ models: [{ name: string }] }
                if (data?.models && Array.isArray(data.models)) {
                    const models = data.models
                        .map((m: { name?: string }) => m.name)
                        .filter(Boolean)
                        .sort();
                    if (models.length > 0) {
                        this._fetchedModelsCache = models;
                        return models;
                    }
                }
            } catch (err) {
                lastErr = err;
                continue;
            }
        }
        logWarn('ai-config', `fetchModels 全部候选失败 endpoint=${endpoint}`, lastErr);
        return [];
    }

    async loadConfig(): Promise<AiPersistedConfig> {
        const cfg = loadAiConfig();
        return {
            endpoint: cfg.endpoint,
            model: cfg.model,
            keyConfigured: cfg.apiKey.length > 0,
            apiKey: cfg.apiKey,
            relayUrl: cfg.relayUrl,
        };
    }

    async *streamChat(req: ChatRequest): AsyncIterable<ChatChunk> {
        const cfg = loadAiConfig();
        if (!cfg.endpoint) {
            yield { type: 'error', error: 'AI 端点未配置，请在诊断面板中设置' };
            return;
        }

        // [doc:relay] 网页端远程 API 通过 relay 转发以绕过 CORS
        const relayUrl = relayTarget(cfg.relayUrl, cfg.endpoint);
        const fetchUrl = relayUrl ?? cfg.endpoint;

        const body: Record<string, unknown> = {
            model: req.model ?? cfg.model,
            messages: req.messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 2048,
            stream: true,
        };
        if (req.tools && req.tools.length > 0) {
            body.tools = req.tools;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (cfg.apiKey) {
            headers['Authorization'] = `Bearer ${cfg.apiKey}`;
        }
        // relay 模式下通知 Worker 转发目标
        if (relayUrl) {
            headers['X-Target-Url'] = cfg.endpoint;
        }

        // 内部 AbortController：转发 req.signal + 可配超时（[doc:adr-199 P2-3]，先前硬编码 30s），并在 generator 退出（break/return）时强制中止底层 fetch（FR-10 / AC-6）
        const ac = new AbortController();
        const onAbort = (): void => ac.abort();
        req.signal?.addEventListener('abort', onAbort);
        const timeoutId = setTimeout(() => ac.abort(), cfg.timeoutMs);

        try {
            const response = await fetch(fetchUrl, {
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
            clearTimeout(timeoutId);
            req.signal?.removeEventListener('abort', onAbort);
            ac.abort(); // 确保外部 break/return 时底层请求被中止
        }
    }
}

/** CORS / 网络错误友好提示（FR-13）：本地 Ollama 需 OLLAMA_ORIGINS=*；远程 API 建议自建同源 relay。 */
function _friendlyError(err: unknown): string {
    const msg = translateGoError(err);
    const isTypeError = err instanceof TypeError;
    const isNetwork = isTypeError || /Failed to fetch|NetworkError/i.test(msg);
    if (!isNetwork) {
        return msg;
    }

    // CORS 关键词判定
    if (/CORS|Access-Control/i.test(msg)) {
        return '连接端点失败（CORS 限制）。本地 Ollama 请设置环境变量 OLLAMA_ORIGINS=* 后重启；远程 API 建议自建同源 relay 代理。';
    }
    // Chromium 网络错误代码细分
    if (/ERR_NAME_NOT_RESOLVED/i.test(msg)) {
        return 'DNS 解析失败，域名不存在或无法访问。请检查端点地址拼写。';
    }
    if (/ERR_CONNECTION_REFUSED/i.test(msg)) {
        return '连接被拒绝，服务可能未启动或端口未监听。请确认服务已运行。';
    }
    if (/ERR_CONNECTION_TIMED_OUT|ERR_CONNECTION_RESET/i.test(msg)) {
        return '连接超时，网络不通或服务无响应。请检查网络连接与防火墙设置。';
    }
    if (/ERR_CERT/i.test(msg)) {
        return 'TLS 证书验证失败。请检查服务器证书配置，或在局域网内使用 HTTP。';
    }
    return '连接端点失败（服务可能未启动或网络不通）。请检查端点地址与服务状态；本地服务确认端口已监听，远程服务确认 DNS 可解析。';
}

export const browserAiAdapter = new BrowserAiAdapter();
