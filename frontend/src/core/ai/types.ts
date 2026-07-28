// [doc:adr-196] AiService 适配器接口契约
// 镜像 BackendService（ADR-176）双适配器模式，不引入新架构范式。

/** AI 后端能力描述 */
export interface AiCapabilities {
    available: boolean;
    adapter: 'ollama' | 'openai-compat' | 'go-bridge' | 'none';
    streaming: boolean;
    models: string[];
    /** 是否已配置 API key（浏览器端 IndexedDB 配置非空即 true；go 侧由 Go 持有恒 false 前端不可见） */
    apiKeyConfigured: boolean;
    /** CORS 风险等级：localhost/127.0.0.1 为 none，https 远程为 possible，http 远程为 high */
    corsRisk: 'none' | 'possible' | 'high';
    /** 端点连通性：仅能力探测时返回 'pending'（真实连通性在 streamChat 时由 fetch 结果判定） */
    endpointReachable: boolean | 'pending';
}

/** 工具调用（assistant 消息中） */
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/** 聊天消息角色 */
export type ChatMessage =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
    | { role: 'tool'; content: string; tool_call_id: string };

/** JSON Schema 工具定义（OpenAI function_calling 格式） */
export interface ToolSchema {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

/** 流式聊天请求参数 */
export interface ChatRequest {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    /** 工具定义（函数调用），仅 browser-adapter 直接传递；go-adapter 走 prompt 约束 */
    tools?: ToolSchema[];
}

/** 流式聊天响应块 */
export interface ChatChunk {
    type: 'text' | 'error' | 'done' | 'tool_call';
    content?: string;
    error?: string;
    /** function_call 名称（tool_call 类型时） */
    toolName?: string;
    /** function_call 参数 JSON 字符串（tool_call 类型时） */
    toolArgs?: string;
    /** function_call id */
    toolId?: string;
}

/** AI 连接测试结果，镜像 Go LLMConnectionResult 结构 */
export interface AiConnectionResult {
    ok: boolean;
    kind: AiErrorKind;
    message: string;
}

/**
 * 持久化配置的回读结构，供诊断面板初始化时回填输入框。
 * 桌面端配置由 Go 持有，key 出于安全不回读（keyConfigured 仅告知是否已配置）。
 */
export interface AiPersistedConfig {
    endpoint: string;
    model: string;
    /** key 是否已配置（浏览器端可直接给出明文长度>0；go 端仅布尔标志，不含明文） */
    keyConfigured: boolean;
    /** 浏览器端可回读明文 key；go 端恒为空（不暴露） */
    apiKey?: string;
}

/** AI 服务统一抽象，镜像 BackendService 双适配器模式 */
export interface AiService {
    readonly kind: 'go' | 'browser';
    capabilities(): AiCapabilities;
    streamChat(req: ChatRequest): AsyncIterable<ChatChunk>;
    testConnection(): Promise<AiConnectionResult>;
    /** 异步刷新能力探测（go 适配器需调用 Go binding 获取配置后更新缓存） */
    refreshCapabilities?(): Promise<void>;
    /** 从当前端点发现可用模型列表；浏览器适配器直接 HTTP GET /models 或 /api/tags；Go 适配器返回 capabilities 缓存 */
    fetchModels?(): Promise<string[]>;
    /** 回读持久化配置以初始化 UI（go 端从 Go 后端读，browser 端从 IndexedDB 读）。 */
    loadConfig?(): Promise<AiPersistedConfig>;
}

/** 用户选择的服务商配置项 */
export type AiConfigProvider = 'ollama' | 'deepseek' | 'openai' | 'openrouter' | 'custom';

/** 错误分类，用于面板给出可操作建议 */
export type AiErrorKind =
    | 'missingEndpoint'
    | 'missingKey'
    | 'missingModel'
    | 'network'
    | 'cors'
    | 'unauthorized'
    | 'notFound'
    | 'rateLimit'
    | 'server'
    | 'unknown';

/** 校验错误条目（全量收集用） */
export interface AiValidationError {
    kind: AiErrorKind;
    message: string;
}

/** 配置校验结果 */
export interface AiValidationResult {
    ok: boolean;
    kind?: AiErrorKind;
    message: string;
    /** 全部校验错误（非 undefined 表示有多个错误；undefined 表示无或单错误） */
    errors?: AiValidationError[];
}
