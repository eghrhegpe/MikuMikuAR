// [doc:adr-202] AI 助手多会话历史存储 —— IndexedDB 'chats' store 封装。
//
// 设计：
// - 桌面（WebView2）与网页统一走 IndexedDB（项目已共用 backend/idb），不新增 Go binding、
//   不落 config.json（避免与 LLM 配置混存、避免 Go 侧序列化对话历史）。
// - 每个会话拆两键：meta:<id>（元信息，供列表快速枚举，不含消息体）+ msgs:<id>（消息数组，
//   懒加载）。活动会话 id 存 meta store 的 chat:activeId。
// - 所有读操作对损坏/缺失数据降级（返回 undefined/空），不向上抛，避免污染 UI 流程。

import { idbGet, idbSet, idbBatchSet, idbDelete, idbKeys } from '../backend/idb';
import type { ChatMessage } from './types';

/** 会话模式，值与 settings-diagnostic 的 DiagMode 一致（此处独立定义以免 UI→存储反向依赖）。 */
export type ChatMode = 'diagnostic' | 'chat' | 'control' | 'dialogue';

/** 会话元信息（供列表展示，不含消息体）。 */
export interface ChatSession {
    id: string;
    title: string;
    mode: ChatMode;
    createdAt: number;
    updatedAt: number;
}

/** 完整会话（元信息 + 消息数组）。 */
export type ChatSessionFull = ChatSession & { messages: ChatMessage[] };

const _META_PREFIX = 'meta:';
const _MSGS_PREFIX = 'msgs:';
const _ACTIVE_KEY = 'chat:activeId';

const _metaKey = (id: string): string => `${_META_PREFIX}${id}`;
const _msgsKey = (id: string): string => `${_MSGS_PREFIX}${id}`;

/** 生成新会话 id。crypto.randomUUID 在 WebView2 / 现代浏览器均可用。 */
export function newSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 从消息派生标题：取首条 user 消息前 20 字；无则返回空串（调用方回退 i18n 未命名）。 */
export function deriveTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find((m) => m.role === 'user');
    const text = firstUser && typeof firstUser.content === 'string' ? firstUser.content.trim() : '';
    if (!text) {
        return '';
    }
    return text.length > 20 ? text.slice(0, 20) + '…' : text;
}

/** 列出全部会话元信息，按 updatedAt 倒序（最近的在前）。降级返回空数组。 */
export async function listSessions(): Promise<ChatSession[]> {
    try {
        const keys = await idbKeys('chats');
        const metaKeys = keys.filter((k) => k.startsWith(_META_PREFIX));
        const sessions: ChatSession[] = [];
        for (const k of metaKeys) {
            const meta = await idbGet<ChatSession>('chats', k);
            if (meta && meta.id) {
                sessions.push(meta);
            }
        }
        sessions.sort((a, b) => b.updatedAt - a.updatedAt);
        return sessions;
    } catch {
        return [];
    }
}

/** 加载完整会话（元信息 + 消息）。缺失或损坏返回 undefined。 */
export async function loadSession(id: string): Promise<ChatSessionFull | undefined> {
    try {
        const meta = await idbGet<ChatSession>('chats', _metaKey(id));
        if (!meta || !meta.id) {
            return undefined;
        }
        const messages = (await idbGet<ChatMessage[]>('chats', _msgsKey(id))) ?? [];
        return { ...meta, messages: Array.isArray(messages) ? messages : [] };
    } catch {
        return undefined;
    }
}

/** 保存完整会话（元信息 + 消息，单事务批量写）。降级静默失败。 */
export async function saveSession(session: ChatSessionFull): Promise<void> {
    try {
        const meta: ChatSession = {
            id: session.id,
            title: session.title,
            mode: session.mode,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
        };
        await idbBatchSet('chats', [
            [_metaKey(session.id), meta],
            [_msgsKey(session.id), session.messages],
        ]);
    } catch {
        /* 持久化失败不阻断 UI */
    }
}

/** 删除会话（元信息 + 消息两键）。 */
export async function deleteSession(id: string): Promise<void> {
    try {
        await idbDelete('chats', _metaKey(id));
        await idbDelete('chats', _msgsKey(id));
    } catch {
        /* 忽略 */
    }
}

/** 读当前活动会话 id。 */
export async function getActiveId(): Promise<string | undefined> {
    try {
        return await idbGet<string>('meta', _ACTIVE_KEY);
    } catch {
        return undefined;
    }
}

/** 写当前活动会话 id。 */
export async function setActiveId(id: string): Promise<void> {
    try {
        await idbSet('meta', _ACTIVE_KEY, id);
    } catch {
        /* 忽略 */
    }
}

/** 清除当前活动会话 id（清空会话 / 删除当前会话且无剩余时调用，避免陈旧指针）。 */
export async function clearActiveId(): Promise<void> {
    try {
        await idbDelete('meta', _ACTIVE_KEY);
    } catch {
        /* 忽略 */
    }
}
