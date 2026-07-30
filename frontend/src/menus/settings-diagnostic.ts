// settings-diagnostic.ts — AI 助手面板入口（协调各子模块）
import { t } from '../core/i18n/t';
import { resolveAi } from '../core/ai';
import type { ChatMessage } from '../core/ai/types';
import { validateAiConfig } from '../core/ai/config-store';
import { buildToolSchemas } from '../core/ai/action-catalog';
import { captureError } from '../core/ai/error-buffer';
import { cancelSpeech } from '../core/ai/dialogue-speech';
import { deleteSession, clearActiveId } from '../core/ai/chat-store';
import { showErrorToast } from '../core/toast';
import { showConfirm } from '../core/dialog';
import { logInfo, logWarn } from '../core/logger';
import { getAction } from '../core/action-registry';
import { executeActionById } from '../core/action-executor';
import { cardContainer } from '../core/config';
import { addSectionTitle } from '../core/ui-helpers';
import type { PopupLevel } from '../core/config';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import type { SettingsMenuHandle } from './settings-shared';
import { diagState } from './diagnostic-state';
import {
    loadActiveSession,
    schedulePersistSession,
    flushSession,
    renderSessionList,
    fmtTime,
    buildSessionsSchema,
} from './diagnostic-session';
import {
    renderChat,
    showPendingBubble,
    renderStreamingChunk,
    finalizeStreamRow,
    finalizeStream,
    pruneHistory,
    buildSystemMessage,
    updateSpeakToggle,
    updateSendButton,
    addAssistantMessage,
    buildChatSchema,
} from './diagnostic-chat';
import {
    renderControlHint,
    renderPendingAction,
    handleControlFallback,
    applyPendingAction,
    cancelPendingAction,
    advancePendingQueue,
    finalizePendingBatch,
} from './diagnostic-control';
import {
    loadInitialConfig,
    refreshCaps,
    persistConfig,
    buildConfigSchema,
    refreshModelList,
    updateStatusBadge,
    goKeyAllowsProceed,
} from './diagnostic-config';

// ======== 生命周期 ========
resolveAi()
    .then(async (ai) => {
        diagState.ai = ai;
        diagState.aiResolved = true;
        await loadActiveSession();
        await refreshCaps();
        diagState.callbacks.updateControlsEnabled?.();
        renderChat();
        diagState.callbacks.refreshSessionList?.();
    })
    .catch(() => {
        diagState.aiResolved = false;
        diagState.sessionLoaded = true;
        renderChat();
        diagState.callbacks.updateControlsEnabled?.();
    });

// ======== Callback 注册 ========
diagState.callbacks.renderChat = renderChat;
diagState.callbacks.refreshSessionList = () => {
    if (diagState.sessionListEl) {
        void renderSessionList(diagState.sessionListEl);
    }
};
diagState.callbacks.renderControlHint = renderControlHint;
diagState.callbacks.ensureActionsRegistered = () => void ensureActionsRegistered();
diagState.callbacks.updateControlsEnabled = () => {
    const testBtn = document.getElementById('diag-test-btn') as HTMLButtonElement | null;
    if (testBtn) {
        testBtn.disabled = !diagState.aiResolved;
    }
    updateSendButton();
};
diagState.callbacks.updateSendButton = updateSendButton;
diagState.callbacks.continueStream = () => void runStream({ allowTools: false });
diagState.callbacks.sendMessage = () => void sendMessage();
diagState.callbacks.applyPending = () =>
    void applyPendingAction(
        () => {
            renderChat();
            renderControlHint();
        },
        () => {
            renderChat();
            renderControlHint();
        }
    );
diagState.callbacks.cancelPending = () =>
    void cancelPendingAction(() => {
        renderChat();
        renderControlHint();
    });

// ======== 核心协调函数 ========
async function runStream(opts?: { allowTools?: boolean }): Promise<void> {
    if (diagState.isStreaming || !diagState.ai) {
        return;
    }
    await ensureActionsRegistered();
    const allowTools = opts?.allowTools ?? !diagState.dialogueMode;
    diagState.isStreaming = true;
    updateSendButton();
    diagState.abortController = new AbortController();
    showPendingBubble();
    logInfo(
        'ai-stream',
        `dialogueMode=${diagState.dialogueMode} allowTools=${allowTools} msgs=${diagState.messages.length}`
    );
    const systemMessage = buildSystemMessage();
    const chatMessages: ChatMessage[] = pruneHistory([systemMessage, ...diagState.messages]);
    let fullResponse = '';
    const pendingToolCalls: Array<{ id: string; name: string; args: string }> = [];
    let streamErrorSeen = false;
    let abortedByUser = false;
    let interruptMessage: string | null = null;
    // 局部完成标志：tool_call 分支自行收尾后置 true，finally 据此跳过；
    // 避免全局 isStreaming 被 continueStream 触发的下一次 runStream 改回 true 后，
    // finally 误判“本次还在 streaming”而重复 push assistant 消息（幽灵消息）。
    let thisStreamDone = false;
    try {
        const requestTools = allowTools ? buildToolSchemas() : undefined;
        const chunks = diagState.ai.streamChat({
            messages: chatMessages,
            signal: diagState.abortController.signal,
            tools: requestTools,
        });
        for await (const chunk of chunks) {
            if (chunk.type === 'text' && chunk.content) {
                if (chunk.reasoning) {
                    renderStreamingChunk(chunk);
                } else {
                    fullResponse += chunk.content;
                    renderStreamingChunk(chunk);
                }
            } else if (chunk.type === 'tool_call' && allowTools) {
                pendingToolCalls.push({
                    id: chunk.toolId ?? `call_${Date.now()}_${pendingToolCalls.length}`,
                    name: chunk.toolName ?? '',
                    args: chunk.toolArgs ?? '{}',
                });
            } else if (chunk.type === 'error') {
                streamErrorSeen = true;
                captureError('ai-stream', chunk.error ?? 'AI stream error', undefined);
                showErrorToast(t('ai.errors.apiError', { msg: chunk.error ?? '' }));
                interruptMessage = t('ai.errors.apiError', { msg: chunk.error ?? '' });
                break;
            } else if (chunk.type === 'done') {
                break;
            }
        }
        if (pendingToolCalls.length > 0) {
            const parsed = pendingToolCalls.map((tc) => {
                let params: Record<string, unknown> = {};
                try {
                    params = JSON.parse(tc.args);
                } catch {
                    /* ignore */
                }
                return { actionId: tc.name, params, toolCallId: tc.id };
            });
            const writable: typeof parsed = [];
            diagState.pendingToolResults = [];
            diagState.pendingBatchHasToolCalls = true;
            for (const p of parsed) {
                const def = getAction(p.actionId);
                if (!def) {
                    diagState.pendingToolResults.push({
                        toolCallId: p.toolCallId ?? '',
                        content: JSON.stringify({ success: false, message: '不支持的操作' }),
                    });
                } else if (def.readonly) {
                    const result = await executeActionById(p.actionId, p.params);
                    diagState.pendingToolResults.push({
                        toolCallId: p.toolCallId ?? '',
                        content: JSON.stringify(result),
                    });
                } else {
                    writable.push(p);
                }
            }
            diagState.messages.push({
                role: 'assistant',
                content: fullResponse || null,
                tool_calls: pendingToolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: tc.args },
                })),
            });
            diagState.isStreaming = false;
            diagState.abortController = null;
            updateSendButton();
            renderChat();
            // tool_call 消息立即落盘，避免后续 pendingAction 确认期间崩溃丢失
            schedulePersistSession();
            // 标记本次 stream 已自行收尾，finally 不得再用 fullResponse 二次 push
            thisStreamDone = true;
            if (writable.length === 0) {
                await finalizePendingBatch(() => {
                    renderChat();
                    renderControlHint();
                });
                return;
            }
            diagState.pendingAction = writable[0];
            diagState.pendingQueue = writable.slice(1);
            diagState.lastUndoable = null;
            renderPendingAction();
            return;
        }
    } catch (err) {
        if (
            diagState.abortController?.signal.aborted ||
            (err instanceof Error && err.name === 'AbortError')
        ) {
            abortedByUser = true;
            interruptMessage = t('ai.errors.aborted');
        } else {
            streamErrorSeen = true;
            const errMsg = err instanceof Error ? err.message : String(err);
            captureError('ai-stream', errMsg, err);
            showErrorToast(t('ai.errors.apiError', { msg: errMsg }));
            interruptMessage = t('ai.errors.apiError', { msg: errMsg });
        }
    } finally {
        // 用局部标志判断，而非全局 diagState.isStreaming：
        // continueStream 会在 finalizePendingBatch 末尾 fire-and-forget 触发下一次 runStream，
        // 下一次会把 isStreaming 改回 true；若用全局标志判断，本次 finally 会误判“还在 streaming”，
        // 用本次 fullResponse 二次 push assistant 消息（幽灵消息），并破坏下一次 runStream 的状态。
        if (!thisStreamDone) {
            const handledAsFallback =
                !streamErrorSeen &&
                !abortedByUser &&
                !diagState.dialogueMode &&
                fullResponse &&
                !diagState.pendingAction &&
                handleControlFallback(fullResponse, (queued) => {
                    diagState.isStreaming = false;
                    diagState.abortController = null;
                    updateSendButton();
                    renderChat();
                    if (queued) {
                        renderPendingAction();
                    } else {
                        renderControlHint();
                    }
                });
            if (!handledAsFallback) {
                if (streamErrorSeen || abortedByUser) {
                    if (fullResponse) {
                        diagState.messages.push({ role: 'assistant', content: fullResponse });
                    }
                    diagState.isStreaming = false;
                    diagState.abortController = null;
                    finalizeStreamRow(fullResponse);
                    if (interruptMessage) {
                        addAssistantMessage(`${interruptMessage} · ${fmtTime(Date.now())}`);
                        renderChat();
                    }
                    updateSendButton();
                    // 中断/异常时立即落盘，避免面板关闭或应用退出丢失已收到的 partial
                    void flushSession();
                } else {
                    finalizeStream(fullResponse, () => {
                        updateSendButton();
                        // 正常完成也立即落盘 assistant 回复（finalizeStream 内 push 后）
                        void flushSession();
                    });
                }
            }
        }
    }
}

async function sendMessage(): Promise<void> {
    if (diagState.isStreaming || diagState.pendingAction || !diagState.inputEl || !diagState.ai) {
        if (diagState.pendingAction) {
            showErrorToast(t('ai.chat.pendingBlocked'));
        }
        return;
    }
    const text = diagState.inputEl.value.trim();
    if (!text) {
        return;
    }
    const validation = validateAiConfig(diagState.localConfig);
    if (!validation.ok && !goKeyAllowsProceed(validation)) {
        if (validation.kind) {
            updateStatusBadge();
        }
        addAssistantMessage(t('ai.errorAdvice.' + (validation.kind ?? 'unknown')));
        renderChat();
        return;
    }
    diagState.messages.push({ role: 'user', content: text });
    diagState.inputEl.value = '';
    schedulePersistSession();
    renderChat();
    await runStream();
}

function stopStreaming(): void {
    diagState.abortController?.abort();
    diagState.abortController = null;
}

async function clearChat(): Promise<void> {
    const ok = await showConfirm(t('ai.chat.clearConfirm'));
    if (!ok) {
        return;
    }
    const id = diagState.activeSessionId;
    diagState.messages.length = 0;
    diagState.activeSessionId = null;
    if (id) {
        await deleteSession(id);
        await clearActiveId();
    }
    renderChat();
    diagState.callbacks.refreshSessionList?.();
}

async function ensureActionsRegistered(): Promise<void> {
    if (diagState.controlRegistered) {
        return;
    }
    try {
        const m = await import('../core/ai/action-registry-defs');
        m.registerAllActions();
        diagState.controlRegistered = true;
    } catch (err) {
        logWarn('diagnostic', '动作注册表加载失败，AI 工具将不可用', err);
    }
}

// ======== 面板生命周期 ========
function disposeDiagnosticPanel(): void {
    cancelSpeech();
    diagState.abortController?.abort();
    if (diagState.configEndpoint) {
        diagState.localConfig.endpoint = diagState.configEndpoint.value;
    }
    if (diagState.configModel) {
        diagState.localConfig.model = diagState.configModel.value;
    }
    if (diagState.configApiKey) {
        diagState.localConfig.apiKey = diagState.configApiKey.value;
    }
    persistConfig(diagState.localConfig);
    void flushSession();
    // 不在此处设 isStreaming=false：若 streaming 中关闭面板，abort 会触发 runStream 的
    // catch+finally，finally 内会 push assistant partial 并 flushSession 落盘；提前置
    // false 会导致 finally 跳过保存分支，已收到的流式内容丢失（ADR-203 持久化触发点）。
    diagState.pendingAction = null;
    diagState.pendingQueue = [];
    diagState.pendingToolResults = [];
    diagState.pendingBatchHasToolCalls = false;
    diagState.lastUndoable = null;
    diagState.autoTestTimer?.cancel();
    diagState.autoTestTimer = null;
    diagState.testing = false;
    diagState.refreshingCaps = false;
    diagState.fetchedModels = [];
    diagState.lastConnectionOk = null;
    diagState.lastConnectionKind = null;
    diagState.goKeyConfigured = false;
    diagState.chatContainer = null;
    diagState.inputEl = null;
    diagState.corsWarningEl = null;
    diagState.configEndpoint = null;
    diagState.configApiKey = null;
    diagState.configModel = null;
    diagState.configModelDatalist = null;
    diagState.modelListEl = null;
    diagState.statusBadgeEl = null;
    diagState.adviceEl = null;
    diagState.statusTextEl = null;
    diagState.pendingContainer = null;
    diagState.speakToggleBtn = null;
    diagState.sessionListEl = null;
    diagState.activeProviderButtons = [];
    diagState.activeDocLink = null;
}

// ======== Schema 构建 ========
export function buildDiagnosticSchema(opts?: { withSessions?: boolean }): MenuNode[] {
    return [
        {
            id: 'diagnostic:panel',
            kind: 'custom',
            renderCustom: (c) => {
                const container = document.createElement('div');
                container.className = 'diag-panel-layout';

                const tabBar = document.createElement('div');
                tabBar.className = 'type-row';
                type PanelTab = 'diagnostic:chat' | 'diagnostic:config';
                const tabs: { id: PanelTab; label: string }[] = [
                    { id: 'diagnostic:chat', label: t('ai.chat.title') },
                    { id: 'diagnostic:config', label: t('ai.config.title') },
                ];
                let activeTab: PanelTab = 'diagnostic:chat';
                const tabBtns: HTMLButtonElement[] = [];
                for (const tab of tabs) {
                    const btn = document.createElement('button');
                    btn.textContent = tab.label;
                    btn.className = 'mode-btn' + (activeTab === tab.id ? ' active' : '');
                    btn.setAttribute('role', 'tab');
                    btn.setAttribute('aria-selected', String(activeTab === tab.id));
                    btn.addEventListener('click', () => switchTab(tab.id));
                    tabBar.appendChild(btn);
                    tabBtns.push(btn);
                }
                cardContainer(container, (card) => {
                    card.appendChild(tabBar);
                });

                const chatPane = document.createElement('div');
                chatPane.className = 'diag-tab-pane';
                if (opts?.withSessions) {
                    cardContainer(chatPane, (inner) => {
                        addSectionTitle(inner, t('ai.chat.history'));
                        return renderMenu(buildSessionsSchema(), inner);
                    });
                }
                cardContainer(chatPane, (inner) => {
                    addSectionTitle(inner, t('ai.chat.title'));
                    return renderMenu(buildChatSchema(), inner);
                });
                container.appendChild(chatPane);

                const configPane = document.createElement('div');
                configPane.className = 'diag-tab-pane';
                configPane.style.display = 'none';
                cardContainer(configPane, (inner) => {
                    addSectionTitle(inner, t('ai.config.title'));
                    return renderMenu(buildConfigSchema(), inner);
                });
                container.appendChild(configPane);
                c.appendChild(container);

                function switchTab(tabId: PanelTab) {
                    if (activeTab === tabId) {
                        return;
                    }
                    activeTab = tabId;
                    for (let i = 0; i < tabs.length; i++) {
                        const isActive = tabs[i].id === tabId;
                        tabBtns[i].className = 'mode-btn' + (isActive ? ' active' : '');
                        tabBtns[i].setAttribute('aria-selected', String(isActive));
                    }
                    chatPane.style.display = tabId === 'diagnostic:chat' ? '' : 'none';
                    configPane.style.display = tabId === 'diagnostic:config' ? '' : 'none';
                }
            },
        },
    ];
}

export function renderDiagnosticPanel(
    container: HTMLElement,
    opts?: { withSessions?: boolean }
): () => void {
    const dispose = renderMenu(buildDiagnosticSchema(opts), container);

    // 接线发送 / 停止 / 清空按钮（schema 只建 DOM，事件由入口统一挂载）
    // 注意：renderCustom 阶段 container 可能尚未挂载到 document，
    // 必须用 container.querySelector 而非 document.getElementById。
    const sendBtn = container.querySelector<HTMLButtonElement>('#diag-send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            if (diagState.isStreaming) {
                stopStreaming();
            } else {
                void sendMessage();
            }
        });
    }
    const clearBtn = container.querySelector<HTMLButtonElement>('#diag-clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => void clearChat());
    }

    return () => {
        dispose();
        disposeDiagnosticPanel();
    };
}

export function buildSettingsDiagnosticLevel(
    getSettingsMenu: () => SettingsMenuHandle
): PopupLevel {
    return {
        label: t('settings.diagnostic'),
        dir: '',
        items: [],
        renderCustom: (container) => renderDiagnosticPanel(container),
    };
}
