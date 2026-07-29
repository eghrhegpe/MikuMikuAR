import { t } from '../core/i18n/t';
import { showConfirm, showPrompt } from '../core/dialog';
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
    type ChatSession,
} from '../core/ai/chat-store';
import { diagState } from './diagnostic-state';
import type { MenuNode } from './menu-schema';

export async function doPersistSession(): Promise<void> {
    if (!diagState.sessionLoaded) {
        return;
    }
    if (diagState.messages.length === 0) {
        return;
    }
    if (!diagState.activeSessionId) {
        diagState.activeSessionId = newSessionId();
        diagState.sessionCreatedAt = Date.now();
        await setActiveId(diagState.activeSessionId);
    }
    const title = deriveTitle(diagState.messages) || t('ai.chat.untitled');
    await saveSession({
        id: diagState.activeSessionId,
        title,
        dialogueMode: diagState.dialogueMode,
        createdAt: diagState.sessionCreatedAt || Date.now(),
        updatedAt: Date.now(),
        messages: [...diagState.messages],
    });
}

export function schedulePersistSession(): void {
    diagState.persistTimer.schedule(() => void doPersistSession(), 500);
}

export async function flushSession(): Promise<void> {
    diagState.persistTimer.cancel();
    await doPersistSession();
}

export async function loadActiveSession(): Promise<void> {
    try {
        const activeId = await getActiveId();
        if (activeId) {
            const session = await loadSession(activeId);
            if (session) {
                diagState.activeSessionId = session.id;
                diagState.sessionCreatedAt = session.createdAt;
                const raw = session as unknown as Record<string, unknown>;
                diagState.dialogueMode =
                    raw.dialogueMode !== undefined ? !!raw.dialogueMode : raw.mode === 'dialogue';
                diagState.messages.length = 0;
                diagState.messages.push(...session.messages);
            }
        }
    } catch {
        /* 恢复失败保持空会话 */
    } finally {
        diagState.sessionLoaded = true;
    }
}

/** 由 entry point 调用——通过 callbacks 通知 UI 更新 */
export async function createSession(): Promise<void> {
    await flushSession();
    diagState.activeSessionId = newSessionId();
    diagState.sessionCreatedAt = Date.now();
    await setActiveId(diagState.activeSessionId);
    diagState.messages.length = 0;
    diagState.dialogueMode = false;
    diagState.callbacks.renderChat?.();
    diagState.callbacks.refreshSessionList?.();
}

export async function switchSession(id: string): Promise<void> {
    if (id === diagState.activeSessionId) {
        return;
    }
    if (diagState.isStreaming) {
        diagState.abortController?.abort();
        diagState.isStreaming = false;
        diagState.abortController = null;
    }
    await flushSession();
    const session = await loadSession(id);
    if (!session) {
        return;
    }
    diagState.activeSessionId = session.id;
    diagState.sessionCreatedAt = session.createdAt;
    const raw = session as unknown as Record<string, unknown>;
    diagState.dialogueMode =
        raw.dialogueMode !== undefined ? !!raw.dialogueMode : raw.mode === 'dialogue';
    diagState.messages.length = 0;
    diagState.messages.push(...session.messages);
    await setActiveId(id);
    diagState.callbacks.renderChat?.();
    diagState.callbacks.updateSendButton?.();
    diagState.callbacks.refreshSessionList?.();
}

export async function deleteSessionAndAdjust(id: string): Promise<void> {
    await deleteSession(id);
    if (id === diagState.activeSessionId) {
        diagState.messages.length = 0;
        diagState.activeSessionId = null;
        const remaining = await listSessions();
        if (remaining.length > 0) {
            await switchSession(remaining[0].id);
        } else {
            await clearActiveId();
            diagState.callbacks.renderChat?.();
        }
    }
    diagState.callbacks.refreshSessionList?.();
}

export function buildSessionsSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:sessions',
            kind: 'custom',
            renderCustom: (c) => {
                diagState.sessionListEl = document.createElement('div');
                diagState.sessionListEl.className = 'diag-session-list';
                c.appendChild(diagState.sessionListEl);
                void renderSessionList(diagState.sessionListEl);
            },
        },
    ];
}

export async function renderSessionList(container: HTMLElement): Promise<void> {
    container.innerHTML = '';
    const newBtn = document.createElement('button');
    newBtn.className = 'preset-chip diag-session-new';
    newBtn.textContent = '\uFF0B ' + t('ai.chat.newSession');
    newBtn.setAttribute('aria-label', t('ai.chat.newSession'));
    newBtn.addEventListener('click', () => void createSession());
    container.appendChild(newBtn);
    const sessions = await listSessions();
    for (const s of sessions) {
        container.appendChild(createSessionRow(s));
    }
}

function createSessionRow(s: ChatSession): HTMLElement {
    const row = document.createElement('div');
    row.className =
        'diag-session-row' +
        (s.id === diagState.activeSessionId ? ' diag-session-row--active' : '');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', s.title || t('ai.chat.untitled'));
    row.addEventListener('click', () => void switchSession(s.id));
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void switchSession(s.id);
        }
    });
    const title = document.createElement('span');
    title.className = 'diag-session-title';
    title.textContent = s.title || t('ai.chat.untitled');
    row.appendChild(title);
    const renameBtn = document.createElement('button');
    renameBtn.className = 'diag-session-btn';
    renameBtn.textContent = '\u270E';
    renameBtn.setAttribute('title', t('ai.chat.rename'));
    renameBtn.setAttribute('aria-label', t('ai.chat.rename'));
    renameBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = await showPrompt(t('ai.chat.rename'), s.title);
        if (name && name.trim()) {
            const full = await loadSession(s.id);
            if (full) {
                await saveSession({ ...full, title: name.trim(), updatedAt: Date.now() });
                if (diagState.sessionListEl) {
                    void renderSessionList(diagState.sessionListEl);
                }
            }
        }
    });
    row.appendChild(renameBtn);
    const delBtn = document.createElement('button');
    delBtn.className = 'diag-session-btn diag-session-btn--danger';
    delBtn.textContent = '\u2715';
    delBtn.setAttribute('title', t('ai.chat.delete'));
    delBtn.setAttribute('aria-label', t('ai.chat.delete'));
    delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await showConfirm(t('ai.chat.deleteConfirm', { title: s.title }));
        if (ok) {
            await deleteSessionAndAdjust(s.id);
        }
    });
    row.appendChild(delBtn);
    return row;
}

export function fmtTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
