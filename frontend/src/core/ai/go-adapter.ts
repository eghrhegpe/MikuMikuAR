// [doc:adr-196] Go 侧 AI 适配器骨架
// 当前为占位实现：capabilities.available === false，
// 真正的实现需要 internal/app/llm/client.go（Go 侧 HTTP 客户端）+ Wails bindings 生成。
// 后续接入 resolveAi 时动态加载（同 go-adapter 的 _getGoAdapter 模式）。

import type { AiService, AiCapabilities, ChatRequest, ChatChunk } from './types';

class GoAiAdapter implements AiService {
    readonly kind = 'go' as const;

    capabilities(): AiCapabilities {
        return {
            available: false,
            provider: 'go-bridge',
            streaming: true,
            models: [],
            apiKeyConfigured: false, // go 侧密钥由 Go 持有，前端不可见，恒 false
            corsRisk: 'none', // 桌面走 Go 代理，无浏览器 CORS 问题
            endpointReachable: false,
        };
    }

    async *streamChat(_req: ChatRequest): AsyncIterable<ChatChunk> {
        yield {
            type: 'error',
            error: 'Go 侧 AI 适配器尚未实现。请使用浏览器适配器（Ollama / OpenAI 兼容端点）。',
        };
    }
}

export const goAiAdapter = new GoAiAdapter();