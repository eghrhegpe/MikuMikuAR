// [doc:adr-203] chat-store 守护测试 —— 多会话 CRUD + 排序 + 标题派生 + 降级。
// 用内存 Map mock backend/idb，隔离真实 IndexedDB。

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 内存版 idb：按 store 分桶的 Map。
const _stores: Record<string, Map<string, unknown>> = {};
function _bucket(store: string): Map<string, unknown> {
    _stores[store] ??= new Map();
    return _stores[store];
}

vi.mock('../../backend/idb', () => ({
    idbGet: vi.fn(async (store: string, key: string) => _bucket(store).get(key)),
    idbSet: vi.fn(async (store: string, key: string, value: unknown) => {
        _bucket(store).set(key, value);
    }),
    idbBatchSet: vi.fn(async (store: string, entries: [string, unknown][]) => {
        for (const [k, v] of entries) {
            _bucket(store).set(k, v);
        }
    }),
    idbDelete: vi.fn(async (store: string, key: string) => {
        _bucket(store).delete(key);
    }),
    idbKeys: vi.fn(async (store: string) => Array.from(_bucket(store).keys())),
}));

import {
    listSessions,
    loadSession,
    saveSession,
    deleteSession,
    getActiveId,
    setActiveId,
    clearActiveId,
    newSessionId,
    deriveTitle,
    type ChatSessionFull,
} from '../chat-store';
import { idbSet } from '../../backend/idb';
import type { ChatMessage } from '../types';

function mkSession(id: string, updatedAt: number, msgs: ChatMessage[] = []): ChatSessionFull {
    return {
        id,
        title: `会话${id}`,
        dialogueMode: false,
        createdAt: updatedAt,
        updatedAt,
        messages: msgs,
    };
}

describe('chat-store', () => {
    beforeEach(() => {
        for (const k of Object.keys(_stores)) {
            _stores[k].clear();
        }
    });

    it('saveSession + loadSession 往返', async () => {
        const msgs: ChatMessage[] = [{ role: 'user', content: '你好' }];
        await saveSession(mkSession('a', 100, msgs));
        const loaded = await loadSession('a');
        expect(loaded?.id).toBe('a');
        expect(loaded?.messages).toEqual(msgs);
        expect(loaded?.dialogueMode).toBe(false);
    });

    it('listSessions 按 updatedAt 倒序', async () => {
        await saveSession(mkSession('old', 100));
        await saveSession(mkSession('new', 300));
        await saveSession(mkSession('mid', 200));
        const list = await listSessions();
        expect(list.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
    });

    it('deleteSession 删除元信息与消息', async () => {
        await saveSession(mkSession('x', 100, [{ role: 'user', content: 'hi' }]));
        await deleteSession('x');
        expect(await loadSession('x')).toBeUndefined();
        expect(await listSessions()).toEqual([]);
    });

    it('loadSession 对不存在的 id 返回 undefined', async () => {
        expect(await loadSession('nope')).toBeUndefined();
    });

    it('getActiveId / setActiveId 往返', async () => {
        expect(await getActiveId()).toBeUndefined();
        await setActiveId('sess-1');
        expect(await getActiveId()).toBe('sess-1');
    });

    it('newSessionId 生成唯一 id', () => {
        const a = newSessionId();
        const b = newSessionId();
        expect(a).not.toBe(b);
        expect(a.length).toBeGreaterThan(0);
    });

    it('deriveTitle 取首条 user 前 20 字', () => {
        expect(deriveTitle([{ role: 'user', content: '短问题' }])).toBe('短问题');
        const long = 'a'.repeat(30);
        expect(deriveTitle([{ role: 'user', content: long }])).toBe('a'.repeat(20) + '…');
    });

    it('deriveTitle 无 user 消息返回空串', () => {
        expect(deriveTitle([{ role: 'assistant', content: '你好' }])).toBe('');
        expect(deriveTitle([])).toBe('');
    });

    it('listSessions 跳过缺少 id 的腐败 meta 记录', async () => {
        // 直接写入不含 id 的腐败 meta，模拟磁盘损坏/旧版残留
        await idbSet('chats', 'meta:bad', { title: '无 id 的鬼影' });
        await saveSession(mkSession('good', 100));
        const list = await listSessions();
        expect(list.map((s) => s.id)).toEqual(['good']);
    });

    it('loadSession 对 messages 非数组降级为空数组', async () => {
        // meta 合法但 msgs 损坏为字符串（旧版/磁盘错误）
        await idbSet('chats', 'meta:x', {
            id: 'x',
            title: '坏消息',
            mode: 'chat',
            createdAt: 1,
            updatedAt: 2,
        });
        await idbSet('chats', 'msgs:x', 'not-an-array');
        const loaded = await loadSession('x');
        expect(loaded?.id).toBe('x');
        expect(loaded?.messages).toEqual([]);
    });

    it('clearActiveId 清除 setActiveId 写入的指针', async () => {
        await setActiveId('sess-1');
        expect(await getActiveId()).toBe('sess-1');
        await clearActiveId();
        expect(await getActiveId()).toBeUndefined();
    });
});
