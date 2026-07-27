// [doc:adr-196] AiService 适配器接口契约
// 镜像 BackendService（ADR-176）双适配器模式，不引入新架构范式。

/** AI 后端能力描述 */
export interface AiCapabilities {
    available: boolean;
    provider: 'ollama' | 'openai-compat' | 'go-bridge' | 'none';
    streaming: boolean;
    models: string[];
    /** 是否已配置 API key（浏览器端 IndexedDB 配置非空即 true；go 侧由 Go 持有恒 false 前端不可见） */
    apiKeyConfigured: boolean;
    /** CORS 风险等级：localhost/127.0.0.1 为 none，https 远程为 possible，http 远程为 high */
    corsRisk: 'none' | 'possible' | 'high';
    /** 端点连通性：仅能力探测时返回 'pending'（真实连通性在 streamChat 时由 fetch 结果判定） */
    endpointReachable: boolean | 'pending';
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
    testConnection(): Promise<{ ok: boolean; message: string }>;
    /** 异步刷新能力探测（go 适配器需调用 Go binding 获取配置后更新缓存） */
    refreshCapabilities?(): Promise<void>;
}