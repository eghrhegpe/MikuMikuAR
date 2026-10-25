// [audit:fix 2026-10] MikuMikuAR round75 P1 回归：诊断会话生命周期。
// ① switchSession/createSession 切换后，旧流 finally 稍后执行时若 partial push /
//    flushSession 仍写入新会话 → 幽灵消息。修复 = runStream 发起时快照
//    sessionId（settings-diagnostic.ts L129），finally 顶 guard（L264）
//    比对 diagState.activeSessionId，失配即丢弃。
// ② createSession 此前只 flush+清消息、不 abort 在途流，
//    修复 = 复用 switchSession 提取出的 stopStreamingForSessionChange()。
// 策略：mock 掉整条依赖链（chat-store/ai/config...），保留真实
// diagnostic-state + diagnostic-session + settings-diagnostic；
// 假 AiService 先吐 partial，abort-slow 模式下 abort 信号 50ms 后才
// reject AbortError，保证旧流 finally 必然落在会话切换之后（确定性时序）。

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/ai', () => ({
    resolveAi: vi.fn().mockRejectedValue(new Error('mock: resolveAi unavailable')),
}));
vi.mock('../core/ai/config-store', () => ({
    loadAiConfig: vi.fn(() => ({})),
    validateAiConfig: vi.fn(() => ({ ok: true, message: '' })),
}));
vi.mock('../core/ai/chat-store', () => ({
    listSessions: vi.fn(async () => []),
    loadSession: vi.fn(async () => undefined),
    saveSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    getActiveId: vi.fn(async () => undefined),
    setActiveId: vi.fn(async () => {}),
    clearActiveId: vi.fn(async () => {}),
    newSessionId: vi.fn(() => 'sess-NEW'),
    deriveTitle: vi.fn(() => 'T'),
}));
vi.mock('../core/ai/action-catalog', () => ({
    buildToolSchemas: vi.fn(() => []),
}));
vi.mock('../core/ai/action-registry-defs', () => ({
    registerAllActions: vi.fn(),
}));
vi.mock('../core/ai/error-buffer', () => ({
    captureError: vi.fn(),
}));
vi.mock('../core/ai/dialogue-speech', () => ({
    cancelSpeech: vi.fn(),
}));
vi.mock('../core/toast', () => ({
    showErrorToast: vi.fn(),
}));
vi.mock('../core/dialog', () => ({
    showConfirm: vi.fn(async () => false),
    showPrompt: vi.fn(async () => null),
}));
vi.mock('../core/logger', () => ({
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
}));
vi.mock('../core/action-registry', () => ({
    getAction: vi.fn(() => undefined),
}));
vi.mock('../core/action-executor', () => ({
    executeActionById: vi.fn(async () => ({ success: true, message: '' })),
}));
vi.mock('../core/config', () => ({
    cardContainer: vi.fn(),
}));
vi.mock('../core/ui-helpers', () => ({
    addSectionTitle: vi.fn(),
}));
vi.mock('../core/i18n/t', () => ({
    t: vi.fn((k: string) => k),
}));
vi.mock('../core/i18n/goerr', () => ({
    translateGoError: vi.fn((e: unknown) => String(e)),
}));
vi.mock('../menus/render-menu', () => ({
    renderMenu: vi.fn(() => () => {}),
}));
vi.mock('../menus/diagnostic-chat', () => ({
    renderChat: vi.fn(),
    showPendingBubble: vi.fn(),
    renderStreamingChunk: vi.fn(),
    finalizeStreamRow: vi.fn(),
    // 贴近真实 finalizeStream：完整回复进当前会话 messages，再调 after（持久化钩子）
    finalizeStream: vi.fn((fullText: string, after: () => void) => {
        const st = (globalThis as { __audit_diagState?: { messages: { role: string; content: string | null }[]; isStreaming: boolean; abortController: AbortController | null } }).__audit_diagState;
        if (fullText && st) {
            st.messages.push({ role: 'assistant', content: fullText });
            st.isStreaming = false;
            st.abortController = null;
        }
        after();
    }),
    pruneHistory: vi.fn((m: unknown[]) => m),
    buildSystemMessage: vi.fn(() => ({ role: 'system', content: 'sys' })),
    updateSendButton: vi.fn(),
    addAssistantMessage: vi.fn(),
    buildChatSchema: vi.fn(() => []),
}));
vi.mock('../menus/diagnostic-control', () => ({
    renderControlHint: vi.fn(),
    renderPendingAction: vi.fn(),
    handleControlFallback: vi.fn(() => false),
    applyPendingAction: vi.fn(),
    cancelPendingAction: vi.fn(),
    finalizePendingBatch: vi.fn(),
}));
vi.mock('../menus/diagnostic-config', () => ({
    refreshCaps: vi.fn(),
    persistConfig: vi.fn(),
    buildConfigSchema: vi.fn(() => []),
    updateStatusBadge: vi.fn(),
    goKeyAllowsProceed: vi.fn(() => true),
    loadInitialConfig: vi.fn(),
}));

import { diagState } from '../menus/diagnostic-state';
import { switchSession, createSession } from '../menus/diagnostic-session';
import { loadSession, saveSession } from '../core/ai/chat-store';
import { addAssistantMessage, finalizeStreamRow } from '../menus/diagnostic-chat';
// 触发 settings-diagnostic 模块顶层注册 continueStream 等回调（驱动 runStream）
import '../menus/settings-diagnostic';
import type { ChatSessionFull } from '../core/ai/chat-store';
import type { AiService, ChatChunk, ChatRequest } from '../core/ai/types';

// vi.mock 工厂在 hoist 时执行、拿不到测试模块的 diagState 绑定，
// 统一经 globalThis 约定键暴露
(globalThis as { __audit_diagState?: unknown }).__audit_diagState = diagState;

const PARTIAL = 'PARTIAL-';
const TAIL = 'DONE';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let streamMode: 'complete' | 'abort-slow' = 'complete';
const capturedSignals: AbortSignal[] = [];

function makeFakeAi(): AiService {
    return {
        kind: 'browser',
        capabilities: () => ({
            available: true,
            adapter: 'openai-compat',
            streaming: true,
            models: ['mock-model'],
            apiKeyConfigured: true,
            corsRisk: 'none',
            endpointReachable: true,
        }),
        streamChat(req: ChatRequest): AsyncIterable<ChatChunk> {
            const signal = req.signal ?? new AbortController().signal;
            capturedSignals.push(signal);
            return (async function* () {
                yield { type: 'text', content: PARTIAL } satisfies ChatChunk;
                if (streamMode === 'complete') {
                    yield { type: 'text', content: TAIL } satisfies ChatChunk;
                    yield { type: 'done' } satisfies ChatChunk;
                    return;
                }
                // abort-slow：模拟真实 fetch 流在 abort 后要等一小段才 reject，
                // 保证旧流 finally 一定晚于会话切换执行（确定性复现幽灵消息时序）
                await new Promise<void>((_, reject) => {
                    const onAbort = () => {
                        setTimeout(() => {
                            reject(new DOMException('aborted', 'AbortError'));
                        }, 50);
                    };
                    if (signal.aborted) {
                        onAbort();
                        return;
                    }
                    signal.addEventListener('abort', onAbort, { once: true });
                });
            })();
        },
        testConnection: async () => ({ ok: true, kind: 'unknown', message: 'mock' }),
    };
}

describe('诊断会话生命周期 P1 [audit:fix 2026-10]', () => {
    beforeEach(() => {
        // 只清调用记录，保留工厂实现（mock 工厂的 base 实现跨测试保持）
        vi.clearAllMocks();
        diagState.messages.length = 0;
        diagState.ai = null;
        diagState.aiResolved = false;
        diagState.isStreaming = false;
        diagState.abortController = null;
        diagState.activeSessionId = null;
        diagState.sessionCreatedAt = 0;
        diagState.sessionLoaded = true;
        diagState.dialogueMode = false;
        diagState.pendingAction = null;
        diagState.pendingQueue.length = 0;
        diagState.pendingToolResults.length = 0;
        diagState.controlRegistered = false;
        diagState.caps = null;
        diagState.persistTimer.cancel();
        streamMode = 'complete';
        capturedSignals.length = 0;
    });

    it('switchSession 后旧流 partial 不入新会话（guard 丢弃）', async () => {
        streamMode = 'abort-slow';
        diagState.ai = makeFakeAi();
        diagState.activeSessionId = 'sess-A';
        diagState.messages.push({ role: 'user', content: 'hello-A' });

        diagState.callbacks.continueStream?.();
        await vi.waitFor(() => {
            expect(diagState.isStreaming).toBe(true);
        });
        await vi.waitFor(() => {
            expect(capturedSignals.length).toBe(1);
        });
        // 让旧流已把 PARTIAL chunk 收进 fullResponse
        await sleep(30);

        const sessB: ChatSessionFull = {
            id: 'sess-B',
            title: 'B',
            dialogueMode: false,
            createdAt: 1000,
            updatedAt: 2000,
            messages: [{ role: 'user', content: 'hi-B' }],
        };
        vi.mocked(loadSession).mockResolvedValueOnce(sessB);

        await switchSession('sess-B');

        // 切换后：新会话内容，旧流被同步 abort
        expect(diagState.activeSessionId).toBe('sess-B');
        expect(diagState.messages.map((m) => m.content)).toEqual(['hi-B']);
        expect(diagState.isStreaming).toBe(false);
        expect(capturedSignals[0].aborted).toBe(true);

        // 旧流 finally 在切换后才执行（~50ms 延迟），应被快照 guard 丢弃
        await sleep(200);
        expect(diagState.messages.map((m) => m.content)).toEqual(['hi-B']);
        expect(diagState.messages.filter((m) => m.role === 'assistant')).toHaveLength(0);
        // 不得向新会话写持久化
        expect(vi.mocked(saveSession).mock.calls.every((c) => c[0].id !== 'sess-B')).toBe(true);
        expect(addAssistantMessage).not.toHaveBeenCalled();
        expect(finalizeStreamRow).not.toHaveBeenCalled();
    });

    it('同会话流正常完成照常持久化（guard 不过度丢弃）', async () => {
        streamMode = 'complete';
        diagState.ai = makeFakeAi();
        diagState.activeSessionId = 'sess-A';
        diagState.messages.push({ role: 'user', content: 'hello-A' });

        diagState.callbacks.continueStream?.();
        await vi.waitFor(() => {
            expect(
                diagState.messages.some((m) => m.role === 'assistant' && m.content === 'PARTIAL-DONE')
            ).toBe(true);
        });
        await vi.waitFor(() => {
            expect(
                vi.mocked(saveSession).mock.calls.some((c) => c[0].id === 'sess-A')
            ).toBe(true);
        });
        const saved = vi.mocked(saveSession).mock.calls.find((c) => c[0].id === 'sess-A')![0];
        expect(saved.messages.some((m) => m.role === 'assistant' && m.content === 'PARTIAL-DONE')).toBe(true);
        expect(diagState.isStreaming).toBe(false);
    });

    it('createSession 同步停止在途流，旧 partial 不入新会话', async () => {
        streamMode = 'abort-slow';
        diagState.ai = makeFakeAi();
        diagState.activeSessionId = 'sess-A';
        diagState.messages.push({ role: 'user', content: 'hello-A' });

        diagState.callbacks.continueStream?.();
        await vi.waitFor(() => {
            expect(diagState.isStreaming).toBe(true);
        });
        await vi.waitFor(() => {
            expect(capturedSignals.length).toBe(1);
        });
        await sleep(30);

        await createSession();

        // 修复点②：createSession 现在同步停止在途流
        expect(capturedSignals[0].aborted).toBe(true);
        expect(diagState.isStreaming).toBe(false);
        expect(diagState.abortController).toBeNull();
        // 已切到新会话
        expect(diagState.activeSessionId).toBe('sess-NEW');
        expect(diagState.messages).toHaveLength(0);

        // 旧流 finally 晚到，应被快照 guard 丢弃
        await sleep(200);
        expect(diagState.messages).toHaveLength(0);
        expect(vi.mocked(saveSession).mock.calls.every((c) => c[0].id !== 'sess-NEW')).toBe(true);
        expect(addAssistantMessage).not.toHaveBeenCalled();
    });
});
