// @vitest-environment node
// [doc:adr-196] sse 解析器测试 — 中止信号语义（FR-10）

import { describe, it, expect } from 'vitest';
import { parseSseStream } from '../ai/sse';

describe('parseSseStream', () => {
    it('signal 已 abort 时立即 yield done 而非 error', async () => {
        const ac = new AbortController();
        ac.abort();
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')
                );
                controller.close();
            },
        });

        const gen = parseSseStream(stream, ac.signal);
        const first = await gen.next();
        expect(first.done).toBe(false);
        expect(first.value?.type).toBe('done');
    });

    it('reader.read() 抛 AbortError 时 yield done 而非 error', async () => {
        const ac = new AbortController();
        const stream = new ReadableStream<Uint8Array>({
            async pull() {
                // 模拟底层 fetch 因 signal abort 而 reject
                throw new DOMException('The operation was aborted', 'AbortError');
            },
        });

        const gen = parseSseStream(stream, ac.signal);
        const first = await gen.next();
        expect(first.value?.type).toBe('done');
    });

    it('tool_calls 增量聚合后以 finish_reason=tool_calls 结束', async () => {
        const chunks = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"setLightIntensity","arguments":"{\\"dir"}}]}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Intensity\\":0.5}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        ];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const c of chunks) {
                    controller.enqueue(new TextEncoder().encode(c));
                }
                controller.close();
            },
        });

        const gen = parseSseStream(stream);
        const out: string[] = [];
        let type = '';
        for await (const chunk of gen) {
            if (chunk.type === 'text') {
                out.push(chunk.content ?? '');
            } else if (chunk.type === 'tool_call') {
                out.push(`tool:${chunk.toolName}(${chunk.toolArgs})`);
            } else if (chunk.type === 'done') {
                type = 'done';
            }
        }
        expect(out).toEqual(['tool:setLightIntensity({"dirIntensity":0.5})']);
        expect(type).toBe('done');
    });

    it('多个 tool_calls 索引各自聚合', async () => {
        const chunks = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"a","arguments":"{\\"x\\":1}"}}]}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"b","arguments":"{\\"y\\":2}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        ];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const c of chunks) {
                    controller.enqueue(new TextEncoder().encode(c));
                }
                controller.close();
            },
        });

        const gen = parseSseStream(stream);
        const calls: string[] = [];
        for await (const chunk of gen) {
            if (chunk.type === 'tool_call') {
                calls.push(`${chunk.toolId}:${chunk.toolName}(${chunk.toolArgs})`);
            }
        }
        expect(calls).toEqual(['c1:a({"x":1})', 'c2:b({"y":2})']);
    });

    it('空响应体 yield error', async () => {
        const gen = parseSseStream(null);
        const first = await gen.next();
        expect(first.value?.type).toBe('error');
    });

    it('JSON 解析失败时回退到原始文本', async () => {
        const chunks = [
            'data: {invalid-json}\n\n',
            'data: {"choices":[{"delta":{"content":"修复后"}}]}\n\n',
            'data: [DONE]\n\n',
        ];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const c of chunks) {
                    controller.enqueue(new TextEncoder().encode(c));
                }
                controller.close();
            },
        });

        const gen = parseSseStream(stream);
        const texts: string[] = [];
        for await (const chunk of gen) {
            if (chunk.type === 'text') {
                texts.push(chunk.content ?? '');
            }
        }
        expect(texts).toEqual(['{invalid-json}', '修复后']);
    });

    it('Ollama 兼容响应 (no choices[].delta)', async () => {
        const chunks = ['data: {"response":"Hello"}\n\n', 'data: [DONE]\n\n'];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const c of chunks) {
                    controller.enqueue(new TextEncoder().encode(c));
                }
                controller.close();
            },
        });

        const gen = parseSseStream(stream);
        const texts: string[] = [];
        for await (const chunk of gen) {
            if (chunk.type === 'text') {
                texts.push(chunk.content ?? '');
            }
        }
        expect(texts).toEqual(['Hello']);
    });

    it('解析 OpenAI SSE 正常 yield text 并以 [DONE] 结束', async () => {
        const chunks = [
            'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
            'data: [DONE]\n\n',
        ];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const c of chunks) {
                    controller.enqueue(new TextEncoder().encode(c));
                }
                controller.close();
            },
        });

        const gen = parseSseStream(stream);
        const out: string[] = [];
        let type = '';
        for await (const chunk of gen) {
            if (chunk.type === 'text') {
                out.push(chunk.content ?? '');
            } else if (chunk.type === 'done') {
                type = 'done';
            }
        }
        expect(out.join('')).toBe('你好');
        expect(type).toBe('done');
    });
});
