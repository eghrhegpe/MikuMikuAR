// @vitest-environment node
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

    it('maxPairs=0 且无 system 时返回空数组', () => {
        expect(pruneHistory([msg('user', 'a'), msg('assistant', 'b')], 0)).toEqual([]);
    });

    it('裁剪点落在工具链中间时配对链完整、不以孤立 tool 开头', () => {
        const msgs: ChatMessage[] = [
            msg('user', 'u0'),
            msg('assistant', null, 'call_1'),
            msg('tool', 'out1', 'call_1'),
            msg('assistant', null, 'call_2'),
            msg('tool', 'out2', 'call_2'),
            msg('user', 'u1'),
        ];
        const pruned = pruneHistory(msgs, 1);
        expect(pruned.map((m) => m.role)).toEqual([
            'assistant',
            'tool',
            'assistant',
            'tool',
            'user',
        ]);
        expect(pruned[0]).toEqual(msg('assistant', null, 'call_1'));
    });

    it('assistant 多 tool 并行调用成对保留', () => {
        const asst: ChatMessage = {
            role: 'assistant',
            content: null,
            tool_calls: [
                { id: 'call_a', type: 'function', function: { name: 'a', arguments: '{}' } },
                { id: 'call_b', type: 'function', function: { name: 'b', arguments: '{}' } },
            ],
        };
        const msgs: ChatMessage[] = [
            msg('user', 'u0'),
            asst,
            msg('tool', 'ra', 'call_a'),
            msg('tool', 'rb', 'call_b'),
            msg('user', 'u1'),
        ];
        const pruned = pruneHistory(msgs, 1);
        expect(pruned.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
        expect(pruned.some((m) => m.content === 'rb')).toBe(true);
    });

    it('maxPairs 为负值时按 0 处理', () => {
        const msgs = [msg('system', 'x'), msg('user', 'a'), msg('assistant', 'b')];
        expect(pruneHistory(msgs, -5)).toEqual([msg('system', 'x')]);
    });

    it('maxPairs 为 NaN 时按 0 处理（防止意外全量保留）', () => {
        const msgs = [msg('system', 'x'), msg('user', 'a'), msg('assistant', 'b')];
        expect(pruneHistory(msgs, Number.NaN)).toEqual([msg('system', 'x')]);
    });

    it('maxPairs 非整数时向下取整', () => {
        const msgs = Array.from({ length: 25 }, (_, i) => msg('user', `msg${i}`));
        const pruned = pruneHistory(msgs, 10.9);
        expect(pruned.length).toBe(20);
        expect(pruned[0].content).toBe('msg5');
    });

    it('恰好等于限制时不修剪（含 system 偏移）', () => {
        const msgs = [
            msg('system', 's'),
            ...Array.from({ length: 20 }, (_, i) => msg('user', `m${i}`)),
        ];
        expect(pruneHistory(msgs, 10)).toEqual(msgs);
    });

    it('system 不在首位时按普通消息处理', () => {
        const msgs: ChatMessage[] = [
            msg('user', 'u0'),
            msg('system', 'mid'),
            ...Array.from({ length: 25 }, (_, i) => msg('user', `m${i}`)),
        ];
        const pruned = pruneHistory(msgs, 10);
        expect(pruned.length).toBe(20);
        expect(pruned[0].role).toBe('user');
        expect(pruned.some((m) => m.role === 'system')).toBe(false);
    });
});
