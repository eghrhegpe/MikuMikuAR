// [doc:adr-196] SSE 行解析器 — 纯函数，零依赖
// 解析 OpenAI 兼容 SSE 格式：data: {...}\n\n
// 支持 delta.tool_calls 增量聚合（ADR-197 Phase 1 补完）
// 终止符：data: [DONE]

import type { ChatChunk } from './types';
import { translateGoError } from '../i18n/goerr';

interface ToolCallAcc {
    id: string;
    name: string;
    arguments: string;
}

/**
 * 从 ReadableStream<Uint8Array> 中逐行解析 SSE，yield ChatChunk。
 * 兼容 OpenAI / Ollama / 任意 OpenAI 兼容端点。
 * v2: 支持 delta.tool_calls 增量聚合，finish_reason='tool_calls' 时 emit tool_call chunks。
 */
export async function* parseSseStream(
    body: ReadableStream<Uint8Array> | null,
    signal?: AbortSignal
): AsyncGenerator<ChatChunk> {
    if (!body) {
        yield { type: 'error', error: '响应体为空' };
        return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolAccums = new Map<number, ToolCallAcc>();

    try {
        while (true) {
            if (signal?.aborted) {
                yield { type: 'done' };
                return;
            }

            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':')) {
                    continue;
                }

                if (trimmed === 'data: [DONE]') {
                    yield { type: 'done' };
                    return;
                }

                if (trimmed.startsWith('data: ')) {
                    const json = trimmed.slice(6);
                    try {
                        const parsed = JSON.parse(json);
                        const choice = parsed?.choices?.[0];
                        const delta = choice?.delta ?? {};
                        const finishReason = choice?.finish_reason;

                        // Text content
                        const content =
                            delta?.content ??
                            parsed?.choices?.[0]?.text ??
                            parsed?.response ??
                            parsed?.message?.content;
                        if (content) {
                            yield { type: 'text', content };
                        }

                        // Tool calls (delta.tool_calls[]) — accumulate by index
                        const toolCalls = delta?.tool_calls;
                        if (toolCalls && Array.isArray(toolCalls)) {
                            for (const tc of toolCalls) {
                                const idx: number = tc.index ?? 0;
                                let acc = toolAccums.get(idx);
                                if (!acc) {
                                    acc = { id: '', name: '', arguments: '' };
                                    toolAccums.set(idx, acc);
                                }
                                if (tc.id) {
                                    acc.id = tc.id;
                                }
                                if (tc.function?.name) {
                                    acc.name = tc.function.name;
                                }
                                if (tc.function?.arguments) {
                                    acc.arguments += tc.function.arguments;
                                }
                            }
                        }

                        // finish_reason='tool_calls' — flush all accumulated tool calls
                        if (finishReason === 'tool_calls') {
                            for (const [, acc] of toolAccums) {
                                yield {
                                    type: 'tool_call',
                                    toolId: acc.id,
                                    toolName: acc.name,
                                    toolArgs: acc.arguments,
                                };
                            }
                            toolAccums.clear();
                            yield { type: 'done' };
                            return;
                        }
                    } catch {
                        if (json) {
                            yield { type: 'text', content: json };
                        }
                    }
                }
            }
        }
    } catch (err) {
        toolAccums.clear();
        if (err instanceof DOMException && err.name === 'AbortError') {
            yield { type: 'done' };
            return;
        }
        yield { type: 'error', error: translateGoError(err) };
        return;
    } finally {
        reader.releaseLock();
    }

    yield { type: 'done' };
}
