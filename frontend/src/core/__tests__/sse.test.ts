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

    it('解析 OpenAI SSE 正常 yield text 并以 [DONE] 结束', async () => {
        const chunks = [
            'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
            'data: [DONE]\n\n',
        ];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
                controller.close();
            },
        });

        const gen = parseSseStream(stream);
        const out: string[] = [];
        let type = '';
        for await (const chunk of gen) {
            if (chunk.type === 'text') out.push(chunk.content ?? '');
            else if (chunk.type === 'done') type = 'done';
        }
        expect(out.join('')).toBe('你好');
        expect(type).toBe('done');
    });
});
