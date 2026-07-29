// diagnostic-state.ts — 诊断面板单例状态

import type { AiService, AiCapabilities, ChatMessage, AiErrorKind } from '../core/ai/types';
import type { AiConfig } from '../core/ai/config-store';
import { loadAiConfig } from '../core/ai/config-store';
import { DebouncedTimer } from '../core/async';

export interface PendingAction {
    actionId: string;
    params: Record<string, unknown>;
    toolCallId?: string;
}

export interface PendingToolResult {
    toolCallId: string;
    content: string;
}

export class DiagnosticState {
    ai: AiService | null = null;
    caps: AiCapabilities | null = null;
    aiResolved = false;
    messages: ChatMessage[] = [];
    isStreaming = false;
    abortController: AbortController | null = null;
    dialogueMode = false;

    activeSessionId: string | null = null;
    sessionCreatedAt = 0;
    sessionLoaded = false;
    sessionListEl: HTMLElement | null = null;

    chatContainer: HTMLElement | null = null;
    inputEl: HTMLTextAreaElement | null = null;
    corsWarningEl: HTMLElement | null = null;
    configEndpoint: HTMLInputElement | null = null;
    configApiKey: HTMLInputElement | null = null;
    configModel: HTMLInputElement | null = null;
    configModelDatalist: HTMLDataListElement | null = null;
    modelListEl: HTMLElement | null = null;
    statusBadgeEl: HTMLElement | null = null;
    adviceEl: HTMLElement | null = null;
    statusTextEl: HTMLElement | null = null;
    pendingContainer: HTMLElement | null = null;
    speakToggleBtn: HTMLButtonElement | null = null;

    localConfig: AiConfig = { ...loadAiConfig() };
    lastConnectionOk: boolean | null = null;
    lastConnectionKind: AiErrorKind | null = null;
    testing = false;
    autoTesting = false;
    refreshingCaps = false;
    goKeyConfigured = false;
    fetchedModels: string[] = [];

    controlRegistered = false;
    pendingAction: PendingAction | null = null;
    pendingQueue: PendingAction[] = [];
    pendingToolResults: PendingToolResult[] = [];
    pendingBatchHasToolCalls = false;
    lastUndoable: { label: string } | null = null;

    speakEnabled = true;

    saveChain: Promise<void> = Promise.resolve();
    persistTimer = new DebouncedTimer();
    autoTestTimer: DebouncedTimer | null = null;

    activeProviderButtons: HTMLButtonElement[] = [];
    activeDocLink: HTMLAnchorElement | null = null;

    /** 跨模块回调注册表（避免循环依赖：entry point 负责接线） */
    callbacks: {
        renderChat?: () => void;
        refreshSessionList?: () => void;
        renderControlHint?: () => void;
        updateControlsEnabled?: () => void;
        updateSendButton?: () => void;
        /** finalizePendingBatch 后触发后续 stream */
        continueStream?: () => void;
        /** 确保动作注册表已加载（dialogue toggle 需切换 mode 时调用） */
        ensureActionsRegistered?: () => void;
        /** 发送消息（entry point 接线，chat 模块调用） */
        sendMessage?: () => void;
        /** 应用待确认操作 */
        applyPending?: () => void;
        /** 取消待确认操作 */
        cancelPending?: () => void;
    } = {};
}

export const diagState = new DiagnosticState();
