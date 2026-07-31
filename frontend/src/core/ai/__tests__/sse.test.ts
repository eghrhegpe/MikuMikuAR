// [doc:adr-196] SSE 行解析器守护测试：文本块、tool_calls 增量聚合、[DONE]、Abort、错误。
// 纯 async generator 测试，使用 ReadableStream 模拟服务端响应。

import { describe, it, expect } from 'vitest';
import { parseSseStream } from '../sse';

/** 辅助：将字符串编码为 ReadableStream。 */
function toStream(text: string, chunkSize = 1024): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    return new ReadableStream({
        start(controller) {
            for (let i = 0; i < bytes.length; i += chunkSize) {
                controller.enqueue(bytes.slice(i, i + chunkSize));
            }
            controller.close();
        },
    });
}

/** 辅助：收集 AsyncGenerator 全部产出为数组。 */
async function collect(
    gen: AsyncGenerator<import('../types').ChatChunk>
): Promise<import('../types').ChatChunk[]> {
    const result: import('../types').ChatChunk[] = [];
    for await (const chunk of gen) {
        result.push(chunk);
    }
    return result;
}

describe('parseSseStream', () => {
    // ── 基本文本流 ──

    it('解析单行文本 content', async () => {
        const stream = toStream('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
        const chunks = await collect(parseSseStream(stream));
        expect(chunks).toEqual([{ type: 'text', content: '你好' }, { type: 'done' }]);
    });

    it('多行文本块按序拼接', async () => {
        const stream = toStream(
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
                'data: {"choices":[{"delta":{"content":" World"}}]}\n\n'
        );
        const chunks = await collect(parseSseStream(stream));
        expect(chunks).toHaveLength(3);
        expect(chunks[0]).toEqual({ type: 'text', content: 'Hello' });
        expect(chunks[1]).toEqual({ type: 'text', content: ' World' });
        expect(chunks[2]).toEqual({ type: 'done' });
    });

    it('分块传输（chunk 边界不在行尾）', async () => {
        const encoder = new TextEncoder();
        const bytes = encoder.encode('data: {"choices":[{"delta":{"content":"Hello World"}}]}\n\n');
        const half = Math.ceil(bytes.length / 2);
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(bytes.slice(0, half));
                controller.enqueue(bytes.slice(half));
                controller.close();
            },
        });
        const chunks = await collect(parseSseStream(stream));
        expect(chunks).toHaveLength(2);
        expect(chunks[0].type).toBe('text');
        expect((chunks[0] as { type: 'text'; content: string }).content).toBe('Hello World');
    });

    // ── [DONE] 终止 ──

    it('data: [DONE] 终止流', async () => {
        const stream = toStream(
            'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' + 'data: [DONE]\n'
        );
        const chunks = await collect(parseSseStream(stream));
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({ type: 'text', content: 'Hi' });
        expect(chunks[1]).toEqual({ type: 'done' });
    });

    // ── tool_calls 增量聚合 ──

    it('tool_calls 增量聚合后 flush', async () => {
        const stream = toStream(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]}}]}\n\n' +
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"北京\\"}"}}]}}]}\n\n' +
                'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}\n\n'
        );
        const chunks = await collect(parseSseStream(stream));
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({
            type: 'tool_call',
            toolId: 'call_1',
            toolName: 'get_weather',
            toolArgs: '{"city":"北京"}',
        });
        expect(chunks[1]).toEqual({ type: 'done' });
    });

    it('多个 tool_calls 并行聚合', async () => {
        const stream = toStream(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"fn_a","arguments":""}}]}}]}\n\n' +
                'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"fn_b","arguments":""}}]}}]}\n\n' +
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\n' +
                'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"x\\":1}"}}]}}]}\n\n' +
                'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}\n\n'
        );
        const chunks = await collect(parseSseStream(stream));
        // 按 index 顺序 emit
        expect(chunks).toHaveLength(3);
        // index 0 的 tool_call
        const tc0 = chunks.find(
            (c) => c.type === 'tool_call' && (c as { toolName?: string }).toolName === 'fn_a'
        ) as { toolArgs?: string };
        expect(tc0).toBeDefined();
        // index 1 的 tool_call
        const tc1 = chunks.find(
            (c) => c.type === 'tool_call' && (c as { toolName?: string }).toolName === 'fn_b'
        ) as { toolArgs?: string };
        expect(tc1).toBeDefined();
        expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    });

    // ── 空响应体 ──

    it('null body 返回 error', async () => {
        const chunks = await collect(parseSseStream(null));
        expect(chunks).toEqual([{ type: 'error', error: '响应体为空' }]);
    });

    // ── 注释行（:）跳过 ──

    it('跳过注释行', async () => {
        const stream = toStream(
            ':comment line\n\n' + 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
        );
        const chunks = await collect(parseSseStream(stream));
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({ type: 'text', content: 'ok' });
    });

    // ── 空行跳过 ──

    it('空行/空白行跳过', async () => {
        const stream = toStream('\n   \n' + 'data: {"choices":[{"delta":{"content":"x"}}]}\n\n');
        const chunks = await collect(parseSseStream(stream));
        expect(chunks).toHaveLength(2);
    });

    // ── AbortSignal ──

    it('AbortSignal 中止时 yield done 并退出', async () => {
        const ac = new AbortController();
        const stream = toStream('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
        ac.abort();
        const chunks = await collect(parseSseStream(stream, ac.signal));
        expect(chunks).toEqual([{ type: 'done' }]);
    });

    // ── 畸形 JSON 回退 ──

    it('畸形 JSON 回退为文本（catch 降级）', async () => {
        const stream = toStream(
            'data: {invalid}\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
        );
        const chunks = await collect(parseSseStream(stream));
        // 第一条 JSON.parse 失败 → catch 降级为纯文本
        expect(chunks[0]).toEqual({ type: 'text', content: '{invalid}' });
        // 第二条正常解析
        expect(chunks[1]).toEqual({ type: 'text', content: 'ok' });
        expect(chunks[2]).toEqual({ type: 'done' });
    });

    it('空字符串 data 行跳过（json="" → catch 不 yield）', async () => {
        const stream = toStream('data: \n\n');
        const chunks = await collect(parseSseStream(stream));
        // data: 后是空串，slice(6) = ''，catch 中 `if (json)` 为 false，跳过
        expect(chunks).toEqual([{ type: 'done' }]);
    });

    it('data: 后有多余空白时 JSON.parse 容错', async () => {
        // slice(6) 后得到 ' {"choices":...}'，JSON.parse 会跳过前导空白
        const stream = toStream('data:  {"choices":[{"delta":{"content":"ok"}}]}\n\n');
        const chunks = await collect(parseSseStream(stream));
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({ type: 'text', content: 'ok' });
        expect(chunks[1]).toEqual({ type: 'done' });
    });

    // ── reader 异常 ──

    /** 创建一个 ReadableStream，当 pull 第二次时抛出给定错误。 */
    function streamThatThrowsAfterFirstChunk(err: unknown): ReadableStream<Uint8Array> {
        let readCount = 0;
        return new ReadableStream({
            pull(controller) {
                readCount++;
                if (readCount === 1) {
                    controller.enqueue(
                        new TextEncoder().encode(
                            'data: {"choices":[{"delta":{"content":"a"}}]}\n\n'
                        )
                    );
                } else {
                    throw err;
                }
            },
        });
    }

    it('reader.read() 抛出 DOMException AbortError → yield done', async () => {
        const stream = streamThatThrowsAfterFirstChunk(
            new DOMException('The operation was aborted', 'AbortError')
        );
        const chunks = await collect(parseSseStream(stream));
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({ type: 'text', content: 'a' });
        expect(chunks[1]).toEqual({ type: 'done' });
    });

    it('reader.read() 抛出普通 Error → yield error 块', async () => {
        const stream = streamThatThrowsAfterFirstChunk(new Error('stream corrupted'));
        const chunks = await collect(parseSseStream(stream));
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({ type: 'text', content: 'a' });
        expect(chunks[1]).toEqual({ type: 'error', error: 'stream corrupted' });
    });
});
