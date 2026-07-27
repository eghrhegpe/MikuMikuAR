// [doc:adr-196] SSE 行解析器 — 纯函数，零依赖
// 解析 OpenAI 兼容 SSE 格式：data: {...}\n\n
// 终止符：data: [DONE]

import type { ChatChunk } from './types';

/**
 * 从 ReadableStream<Uint8Array> 中逐行解析 SSE，yield ChatChunk。
 * 兼容 OpenAI / Ollama / 任意 OpenAI 兼容端点。
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

    try {
        while (true) {
            if (signal?.aborted) {
                yield { type: 'done' };
                return;
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // 保留最后一段不完整行
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':')) continue; // 注释行 / 空行

                if (trimmed === 'data: [DONE]') {
                    yield { type: 'done' };
                    return;
                }

                if (trimmed.startsWith('data: ')) {
                    const json = trimmed.slice(6);
                    try {
                        const parsed = JSON.parse(json);
                        // OpenAI 格式: { choices: [{ delta: { content: string } }] }
                        const content =
                            parsed?.choices?.[0]?.delta?.content ??
                            parsed?.choices?.[0]?.text ??
                            parsed?.response ??
                            parsed?.message?.content;
                        if (content) {
                            yield { type: 'text', content };
                        }
                    } catch {
                        // 非 JSON 行（如 Ollama 的纯文本流），直接产出
                        if (json) {
                            yield { type: 'text', content: json };
                        }
                    }
                }
            }
        }
    } catch (err) {
        // 中止信号（底层 fetch/reader 被 abort）统一归并为 done，不渲染为 error（FR-10）
        if (err instanceof DOMException && err.name === 'AbortError') {
            yield { type: 'done' };
            return;
        }
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
        return;
    } finally {
        reader.releaseLock();
    }

    yield { type: 'done' };
}
