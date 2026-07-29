import { describe, it, expect } from 'vitest';
import { pruneHistory } from '../menus/diagnostic-chat';
import type { ChatMessage } from '../core/ai/types';

function msg(role: ChatMessage['role'], content?: string, toolId?: string): ChatMessage {
    if (role === 'tool' && toolId) {
        return { role: 'tool', content: content ?? '', tool_call_id: toolId } as ChatMessage;
    }
    if (role === 'assistant' && toolId) {
        return {
            role: 'assistant',
            content: content ?? null,
            tool_calls: [
                { id: toolId, type: 'function', function: { name: 'test', arguments: '{}' } },
            ],
        } as ChatMessage;
    }
    return { role, content: content ?? null } as ChatMessage;
}

describe('pruneHistory', () => {
    it('保持空数组不变', () => {
        expect(pruneHistory([])).toEqual([]);
    });

    it('不超过限制时不修剪', () => {
        const msgs = Array.from({ length: 5 }, (_, i) => msg('user', `msg${i}`));
        expect(pruneHistory(msgs, 10)).toEqual(msgs);
    });

    it('超过限制时删除最早 user 消息', () => {
        const msgs = Array.from({ length: 25 }, (_, i) => msg('user', `msg${i}`));
        const pruned = pruneHistory(msgs, 10);
        expect(pruned.length).toBe(20);
        expect(pruned[0].content).toBe('msg5');
    });

    it('保留 system 消息', () => {
        const msgs = [
            msg('system', 'you are'),
            ...Array.from({ length: 25 }, (_, i) => msg('user', `msg${i}`)),
        ];
        const pruned = pruneHistory(msgs, 10);
        expect(pruned[0].role).toBe('system');
        expect(pruned[0].content).toBe('you are');
    });

    it('tool + assistant 成对保留', () => {
        const msgs: ChatMessage[] = [
            msg('user', 'msg0'),
            msg('assistant', null, 'call_1'),
            msg('tool', 'result', 'call_1'),
            msg('user', 'msg1'),
            msg('assistant', 'ok'),
        ];
        const big = Array.from({ length: 25 }, (_, i) => msg('user', `filler${i}`));
        const pruned = pruneHistory([...big, ...msgs], 10);
        const contents = pruned.map((m) => m.content);
        expect(contents).toContain('result');
        expect(contents).toContain('msg1');
        expect(contents).toContain('ok');
    });

    it('system + tool/assistant 混合修剪正确', () => {
        const sys = msg('system', 'rules');
        const old = Array.from({ length: 20 }, (_, i) => msg('user', `old${i}`));
        const recent: ChatMessage[] = [
            msg('user', 'recent q'),
            msg('assistant', null, 'call_x'),
            msg('tool', 'tool_out', 'call_x'),
            msg('user', 'final'),
        ];
        const pruned = pruneHistory([sys, ...old, ...recent], 10);
        expect(pruned[0].role).toBe('system');
        expect(pruned.some((m) => m.content === 'tool_out')).toBe(true);
        expect(pruned.some((m) => m.content === 'final')).toBe(true);
        expect(pruned.length).toBeLessThanOrEqual(21);
    });

    it('maxPairs=0 只保留 system', () => {
        const msgs = [msg('system', 'x'), msg('user', 'a'), msg('assistant', 'b')];
        const pruned = pruneHistory(msgs, 0);
        expect(pruned).toEqual([msg('system', 'x')]);
    });
});
