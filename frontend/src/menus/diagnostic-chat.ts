// diagnostic-chat.ts — 纯 UI 渲染函数（无业务协调逻辑）
import { t } from '../core/i18n/t';
import { getLang } from '../core/i18n/locale';
import { renderMarkdownInto } from '../core/ai/markdown';
import { buildToolCatalogText } from '../core/ai/action-catalog';
import type { ChatMessage, ChatChunk, AiErrorKind } from '../core/ai/types';
import { diagState } from './diagnostic-state';
import { speakLines, cancelSpeech, isSpeechSupported } from '../core/ai/dialogue-speech';
import { parseDialogueLines, type DialogueLine } from '../core/ai/character-bible';
import { getActiveBible, buildDialogueSystemPrompt, listBibles, setActiveBible } from '../core/ai/dialogue-session';
import { renderPendingAction, renderControlHint } from './diagnostic-control';
import { cardContainer } from '../core/config';
import { addSectionTitle } from '../core/ui-helpers';
import type { MenuNode } from './menu-schema';

/** 添加助手消息 */
export function addAssistantMessage(text: string): void {
    diagState.messages.push({ role: 'assistant', content: text });
}

/** 全量重绘对话区 */
export function renderChat(): void {
    if (!diagState.chatContainer) return;
    diagState.chatContainer.innerHTML = '';
    for (const msg of diagState.messages) {
        if (msg.role === 'tool') continue;
        if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) continue;
        const row = document.createElement('div');
        row.className = `diag-chat-row chat-row--${msg.role}`;
        const label = document.createElement('strong');
        label.textContent = msg.role === 'user' ? t('ai.chat.you') : t('ai.chat.assistant');
        label.className = 'diag-chat-label';
        row.appendChild(label);
        const content = document.createElement('div');
        const textContent = typeof msg.content === 'string' ? msg.content : '';
        content.className = 'diag-chat-content';
        if (msg.role === 'assistant') {
            renderMarkdownInto(content, textContent);
        } else {
            content.textContent = textContent;
        }
        row.appendChild(content);
        diagState.chatContainer.appendChild(row);
    }
    diagState.chatContainer.scrollTop = diagState.chatContainer.scrollHeight;
}

/** 显示"思考中"占位气泡 */
export function showPendingBubble(): void {
    if (!diagState.chatContainer) return;
    if (diagState.chatContainer.querySelector('.chat-row--streaming')) return;
    const row = document.createElement('div');
    row.className = 'diag-chat-row chat-row--streaming chat-row--assistant';
    row.dataset.pending = 'true';
    const label = document.createElement('strong');
    label.textContent = t('ai.chat.assistant');
    label.className = 'diag-chat-label';
    row.appendChild(label);
    const content = document.createElement('div');
    content.textContent = t('ai.chat.thinking');
    content.className = 'diag-chat-content diag-chat-pending';
    row.appendChild(content);
    diagState.chatContainer.appendChild(row);
    diagState.chatContainer.scrollTop = diagState.chatContainer.scrollHeight;
}

/** 流式追加 chunk 到当前 streaming row */
export function renderStreamingChunk(chunk: ChatChunk): void {
    if (!diagState.chatContainer) return;
    if (chunk.type !== 'text' || !chunk.content) return;
    let lastRow = diagState.chatContainer.lastElementChild as HTMLElement | null;
    if (!lastRow || !lastRow.classList.contains('chat-row--streaming')) {
        const row = document.createElement('div');
        row.className = 'diag-chat-row chat-row--streaming chat-row--assistant';
        const label = document.createElement('strong');
        label.textContent = t('ai.chat.assistant');
        label.className = 'diag-chat-label';
        row.appendChild(label);
        const content = document.createElement('div');
        content.textContent = '';
        content.className = 'diag-chat-content';
        row.appendChild(content);
        diagState.chatContainer.appendChild(row);
        lastRow = row;
    } else if (lastRow.dataset.pending === 'true') {
        delete lastRow.dataset.pending;
        const pendingContent = lastRow.querySelector('.diag-chat-pending') as HTMLElement | null;
        if (pendingContent) {
            pendingContent.textContent = '';
            pendingContent.classList.remove('diag-chat-pending');
        }
    }
    if (chunk.reasoning) {
        let details = lastRow.querySelector('.diag-reasoning') as HTMLDetailsElement | null;
        if (!details) {
            details = document.createElement('details');
            details.className = 'diag-reasoning';
            details.open = true;
            const summary = document.createElement('summary');
            summary.textContent = t('ai.chat.reasoning');
            details.appendChild(summary);
            const body = document.createElement('div');
            body.className = 'diag-reasoning-body';
            details.appendChild(body);
            const contentDiv = lastRow.querySelector('.diag-chat-content');
            lastRow.insertBefore(details, contentDiv);
        }
        const body = details.querySelector('.diag-reasoning-body') as HTMLElement;
        if (body) body.textContent += chunk.content;
    } else {
        const contentDiv = lastRow.querySelector('.diag-chat-content') as HTMLElement | null;
        if (contentDiv) {
            const fullText = (contentDiv.dataset.fullText ?? '') + chunk.content;
            contentDiv.dataset.fullText = fullText;
            contentDiv.innerHTML = '';
            renderMarkdownInto(contentDiv, fullText);
        }
    }
    diagState.chatContainer.scrollTop = diagState.chatContainer.scrollHeight;
}

/** 定格 streaming row（移除 streaming class + Markdown 渲染） */
export function finalizeStreamRow(fullText: string): void {
    if (diagState.chatContainer && fullText) {
        const streamingRow = diagState.chatContainer.querySelector('.chat-row--streaming');
        if (streamingRow) {
            streamingRow.classList.remove('chat-row--streaming');
            const contentDiv = streamingRow.querySelector('.diag-chat-content') as HTMLElement | null;
            if (contentDiv) renderMarkdownInto(contentDiv, fullText);
            diagState.chatContainer.scrollTop = diagState.chatContainer.scrollHeight;
        } else {
            renderChat();
        }
    } else {
        renderChat();
    }
}

/** 流式完成收尾（非 dialogue 模式） */
export function finalizeStream(fullText: string, afterFinalize: () => void): void {
    if (fullText) {
        diagState.messages.push({ role: 'assistant', content: fullText });
    }
    diagState.isStreaming = false;
    diagState.abortController = null;
    if (diagState.dialogueMode && fullText) {
        const lines = parseDialogueLines(fullText);
        renderChat();
        renderDialogueCards(lines);
        if (diagState.speakEnabled) {
            speakLines(lines, speechLang());
        }
    } else {
        finalizeStreamRow(fullText);
    }
    afterFinalize();
}

function speechLang(): string {
    switch (getLang()) {
        case 'ja': return 'ja-JP';
        case 'ko': return 'ko-KR';
        case 'en': return 'en-US';
        case 'zh-TW': return 'zh-TW';
        default: return 'zh-CN';
    }
}

/** 渲染情绪卡片（台词模式） */
export function renderDialogueCards(lines: DialogueLine[]): void {
    if (!diagState.chatContainer || lines.length === 0) return;
    const wrap = document.createElement('div');
    wrap.className = 'diag-dialogue-cards';
    for (const { line, emotion } of lines) {
        const card = document.createElement('div');
        card.className = `diag-dialogue-card diag-emotion--${emotion}`;
        const tag = document.createElement('span');
        tag.className = 'diag-dialogue-emotion';
        tag.textContent = t('ai.dialogue.emotion.' + emotion);
        card.appendChild(tag);
        const body = document.createElement('div');
        body.className = 'diag-dialogue-line';
        body.textContent = line;
        card.appendChild(body);
        wrap.appendChild(card);
    }
    diagState.chatContainer.appendChild(wrap);
    diagState.chatContainer.scrollTop = diagState.chatContainer.scrollHeight;
}

/** 历史截断 */
export function pruneHistory(messages: ChatMessage[], maxPairs = 10): ChatMessage[] {
    const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
    const body = systemMsg ? messages.slice(1) : messages;
    if (body.length <= maxPairs * 2) return messages;
    const keepFromIdx = body.length - maxPairs * 2;
    let start = keepFromIdx;
    while (start > 0 && body[start]?.role === 'tool') start--;
    if (start > 0 && body[start]?.role === 'assistant') {
        const asst = body[start] as Extract<ChatMessage, { role: 'assistant' }>;
        if (asst.tool_calls) {
            while (start > 0 && body[start - 1]?.role === 'tool') start--;
        }
    }
    const pruned = body.slice(start);
    return systemMsg ? [systemMsg, ...pruned] : pruned;
}

/** 构造 system message */
export function buildSystemMessage(): ChatMessage {
    if (diagState.dialogueMode) {
        return { role: 'system', content: buildDialogueSystemPrompt(getActiveBible()) };
    }
    const catalog = buildToolCatalogText();
    return {
        role: 'system',
        content: [
            t('ai.system.role'),
            t('ai.system.control'),
            catalog,
            t('ai.system.controlFormat'),
        ].join('\n\n'),
    };
}

/** 更新朗读开关 UI（不支持时隐藏） */
export function updateSpeakToggle(): void {
    if (!diagState.speakToggleBtn) return;
    if (!isSpeechSupported() && diagState.dialogueMode) {
        diagState.speakToggleBtn.style.display = 'none';
        return;
    }
    diagState.speakToggleBtn.style.display = diagState.dialogueMode ? '' : 'none';
    diagState.speakToggleBtn.textContent = diagState.speakEnabled
        ? t('ai.dialogue.speakOn')
        : t('ai.dialogue.speakOff');
    diagState.speakToggleBtn.setAttribute('aria-checked', String(diagState.speakEnabled));
    diagState.speakToggleBtn.setAttribute('aria-label', t('ai.dialogue.speakToggle'));
}

/** 更新发送/停止按钮 */
export function updateSendButton(): void {
    const sendBtn = document.getElementById('diag-send-btn') as HTMLButtonElement | null;
    if (!sendBtn) return;
    if (diagState.isStreaming) {
        sendBtn.innerHTML = '\u25A0';
        sendBtn.setAttribute('aria-label', t('ai.chat.stop'));
        sendBtn.disabled = false;
    } else {
        sendBtn.innerHTML = '\u25B6';
        sendBtn.setAttribute('aria-label', t('ai.chat.send'));
        sendBtn.disabled = diagState.pendingAction !== null || !diagState.aiResolved;
    }
}

/** 构建 chat schema（纯 DOM 构建） */
export function buildChatSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:chat',
            kind: 'custom',
            renderCustom: (c) => {
                diagState.chatContainer = document.createElement('div');
                diagState.chatContainer.setAttribute('aria-live', 'polite');
                diagState.chatContainer.setAttribute('aria-relevant', 'additions');
                diagState.chatContainer.className = 'diag-chat-box';
                c.appendChild(diagState.chatContainer);

                const inputRow = document.createElement('div');
                inputRow.className = 'diag-input-row';
                diagState.inputEl = document.createElement('textarea');
                diagState.inputEl.placeholder = t('ai.chat.placeholder');
                diagState.inputEl.setAttribute('aria-label', t('ai.chat.placeholder'));
                diagState.inputEl.className = 'diag-textarea';
                diagState.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); }
                });
                inputRow.appendChild(diagState.inputEl);
                c.appendChild(inputRow);

                const btnRow = document.createElement('div');
                btnRow.className = 'diag-btn-row';

                const sendBtn = document.createElement('button');
                sendBtn.id = 'diag-send-btn';
                sendBtn.className = 'preset-chip diag-btn-icon';
                sendBtn.setAttribute('aria-label', t('ai.chat.send'));
                sendBtn.innerHTML = '\u25B6';
                btnRow.appendChild(sendBtn);

                const clearBtn = document.createElement('button');
                clearBtn.id = 'diag-clear-btn';
                clearBtn.className = 'preset-chip diag-btn-icon';
                clearBtn.setAttribute('aria-label', t('ai.chat.clear'));
                clearBtn.innerHTML = '\u2715';
                btnRow.appendChild(clearBtn);

                const spacer = document.createElement('div');
                spacer.className = 'diag-btn-spacer';
                btnRow.appendChild(spacer);

                const dialogueToggle = document.createElement('button');
                dialogueToggle.id = 'diag-dialogue-toggle';
                dialogueToggle.className = 'preset-chip diag-btn-icon';
                dialogueToggle.setAttribute('aria-pressed', 'false');
                dialogueToggle.setAttribute('aria-label', t('ai.mode.dialogue'));
                dialogueToggle.innerHTML = '\uD83D\uDCAC';
                btnRow.appendChild(dialogueToggle);

                const roleSelect = document.createElement('select');
                roleSelect.className = 'diag-role-select';
                roleSelect.style.display = 'none';
                roleSelect.setAttribute('aria-label', t('ai.dialogue.roleSelect'));
                for (const bible of listBibles()) {
                    const opt = document.createElement('option');
                    opt.value = bible.id;
                    opt.textContent = bible.name;
                    if (bible.id === getActiveBible().id) opt.selected = true;
                    roleSelect.appendChild(opt);
                }
                roleSelect.addEventListener('change', () => setActiveBible(roleSelect.value));
                btnRow.appendChild(roleSelect);

                dialogueToggle.addEventListener('click', () => {
                    diagState.dialogueMode = !diagState.dialogueMode;
                    roleSelect.style.display = diagState.dialogueMode ? '' : 'none';
                    dialogueToggle.setAttribute('aria-pressed', String(diagState.dialogueMode));
                    if (diagState.dialogueMode) {
                        diagState.callbacks.ensureActionsRegistered?.();
                    } else {
                        cancelSpeech();
                    }
                    updateSpeakToggle();
                    if (diagState.pendingContainer) {
                        diagState.pendingContainer.style.display = diagState.dialogueMode ? 'none' : '';
                        if (!diagState.dialogueMode) {
                            if (diagState.pendingAction) {
                                renderPendingAction();
                            } else {
                                renderControlHint();
                            }
                        }
                    }
                    diagState.callbacks.updateControlsEnabled?.();
                });

                diagState.speakToggleBtn = document.createElement('button');
                diagState.speakToggleBtn.id = 'diag-speak-toggle';
                diagState.speakToggleBtn.className = 'preset-chip diag-btn-icon';
                diagState.speakToggleBtn.setAttribute('role', 'switch');
                diagState.speakToggleBtn.innerHTML = '\uD83D\uDD0A';
                btnRow.appendChild(diagState.speakToggleBtn);
                updateSpeakToggle();

                c.appendChild(btnRow);

                diagState.pendingContainer = document.createElement('div');
                diagState.pendingContainer.className = 'diag-pending-area';
                diagState.pendingContainer.style.display = 'none';
                diagState.pendingContainer.setAttribute('data-testid', 'ai:control:pending-action');
                c.appendChild(diagState.pendingContainer);

                renderChat();
                updateSendButton();
            },
        },
    ];
}
