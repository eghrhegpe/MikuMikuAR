// [doc:adr-196] AiService 适配器接口契约
// 镜像 BackendService（ADR-176）双适配器模式，不引入新架构范式。

/** AI 后端能力描述 */
export interface AiCapabilities {
    available: boolean;
    provider: 'ollama' | 'openai-compat' | 'go-bridge' | 'none';
    streaming: boolean;
    models: string[];
}

/** 聊天消息角色 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** 流式聊天请求参数 */
export interface ChatRequest {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
}

/** 流式聊天响应块 */
export interface ChatChunk {
    type: 'text' | 'error' | 'done';
    content?: string;
    error?: string;
}

/** AI 服务统一抽象，镜像 BackendService 双适配器模式 */
export interface AiService {
    readonly kind: 'go' | 'browser';
    capabilities(): AiCapabilities;
    streamChat(req: ChatRequest): AsyncIterable<ChatChunk>;
}