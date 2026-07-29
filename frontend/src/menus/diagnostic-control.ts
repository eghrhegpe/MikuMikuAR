// diagnostic-control.ts — 纯 tool call UI（无 chat/config 协调逻辑）
import { t } from '../core/i18n/t';
import { getAction, listActions } from '../core/action-registry';
import { executeAction, parseActionFromLLM } from '../core/ai/intent-dispatcher';
import { showConfirm } from '../core/dialog';
import { showErrorToast } from '../core/toast';
import { diagState } from './diagnostic-state';

/** 将 LLM 文本回退解析的 action 入待确认队列 */
export function tryQueuePendingAction(
    actionId: string,
    params: Record<string, unknown>,
    toolCallId: string | null
): boolean {
    const action = getAction(actionId);
    if (!action) {
        return false;
    }
    diagState.pendingAction = { actionId, params, toolCallId: toolCallId ?? undefined };
    diagState.pendingQueue = [];
    diagState.pendingToolResults = [];
    diagState.pendingBatchHasToolCalls = false;
    diagState.lastUndoable = null;
    return true;
}

/** 处理 LLM 文本回退（无 tool_call 时） */
export function handleControlFallback(
    fullResponse: string,
    afterFallback: (queued: boolean) => void
): boolean {
    const fallback = parseActionFromLLM(fullResponse);
    if (!fallback) {
        return false;
    }
    const queued = tryQueuePendingAction(fallback.action, fallback.params, null);
    diagState.isStreaming = false;
    diagState.abortController = null;
    afterFallback(queued);
    return true;
}

/** 渲染 pending 区域（无待确认时显示 hint） */
export function renderControlHint(): void {
    if (!diagState.pendingContainer || diagState.pendingAction || diagState.dialogueMode) {
        return;
    }
    diagState.pendingContainer.innerHTML = '';
    diagState.pendingContainer.style.display = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'diag-control-hint';

    if (diagState.lastUndoable) {
        const undoRow = document.createElement('div');
        undoRow.className = 'diag-control-undo-row';
        undoRow.setAttribute('data-testid', 'ai:control:undo-row');
        const undoHint = document.createElement('span');
        undoHint.className = 'diag-control-undo-hint';
        undoHint.textContent = t('ai.control.undoHint', { action: diagState.lastUndoable.label });
        undoRow.appendChild(undoHint);
        const undoBtn = document.createElement('button');
        undoBtn.textContent = t('ai.control.undo');
        undoBtn.className = 'preset-chip';
        undoBtn.addEventListener('click', () => void undoLastAction(undoBtn));
        undoRow.appendChild(undoBtn);
        wrapper.appendChild(undoRow);
    }

    const hint = document.createElement('div');
    hint.className = 'diag-control-hint-text';
    hint.textContent = t('ai.control.emptyHint');
    wrapper.appendChild(hint);

    const modelHint = document.createElement('div');
    modelHint.className = 'diag-control-hint-note';
    modelHint.textContent = t('ai.control.modelHint');
    wrapper.appendChild(modelHint);

    const toolCount = listActions().length;
    const toolSummary = document.createElement('div');
    toolSummary.className = 'diag-control-hint-note';
    toolSummary.textContent = t('ai.control.toolSummary', { count: String(toolCount) });
    wrapper.appendChild(toolSummary);

    diagState.pendingContainer.appendChild(wrapper);
}

/** 撤销上一个破坏性动作 */
export async function undoLastAction(btn: HTMLButtonElement): Promise<void> {
    if (!diagState.lastUndoable) {
        return;
    }
    btn.disabled = true;
    btn.textContent = t('ai.control.executing');
    const result = await executeAction('scene:undo', {});
    diagState.lastUndoable = null;
    diagState.messages.push({
        role: 'assistant',
        content: result.success
            ? t('ai.control.undone')
            : t('ai.control.resultFailed', { message: result.message }),
    });
    renderControlHint();
}

/** 渲染待确认操作卡 */
export function renderPendingAction(): void {
    if (!diagState.pendingContainer || !diagState.pendingAction) {
        return;
    }
    diagState.pendingContainer.innerHTML = '';
    diagState.pendingContainer.style.display = '';

    const action = getAction(diagState.pendingAction.actionId);
    if (!action) {
        diagState.pendingContainer.textContent = t('ai.control.unsupported');
        return;
    }

    const card = document.createElement('div');
    card.className = 'diag-pending-card';
    card.setAttribute('role', 'alert');
    card.setAttribute('data-testid', 'ai:control:pending-card');

    const title = document.createElement('div');
    title.className = 'diag-pending-title';
    const totalWritable = 1 + diagState.pendingQueue.length;
    const processedCount = diagState.pendingToolResults.length;
    title.textContent =
        totalWritable > 1
            ? t('ai.control.pendingProgress', {
                  current: String(processedCount + 1),
                  total: String(totalWritable),
              })
            : t('ai.control.pending');
    card.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'diag-pending-desc';
    desc.textContent = t(action.label);
    card.appendChild(desc);

    const paramsList = document.createElement('div');
    paramsList.className = 'diag-pending-params';
    for (const [key, val] of Object.entries(diagState.pendingAction.params)) {
        const paramRow = document.createElement('span');
        paramRow.textContent = `${key}: ${JSON.stringify(val)}`;
        paramsList.appendChild(paramRow);
    }
    card.appendChild(paramsList);

    const btnRow = document.createElement('div');
    btnRow.className = 'diag-hint-row';
    const applyBtn = document.createElement('button');
    applyBtn.textContent = t('ai.control.apply');
    applyBtn.className = 'mode-btn active';
    applyBtn.id = 'diag-pending-apply';
    applyBtn.addEventListener('click', () => diagState.callbacks.applyPending?.());
    btnRow.appendChild(applyBtn);
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('ai.control.cancel');
    cancelBtn.className = 'preset-chip';
    cancelBtn.id = 'diag-pending-cancel';
    cancelBtn.addEventListener('click', () => diagState.callbacks.cancelPending?.());
    btnRow.appendChild(cancelBtn);
    card.appendChild(btnRow);

    diagState.pendingContainer.appendChild(card);
}

/** 应用 pending action */
export async function applyPendingAction(
    onComplete: () => void,
    onQueueAdvance: () => void
): Promise<void> {
    if (!diagState.pendingAction) {
        return;
    }
    const action = getAction(diagState.pendingAction.actionId);
    if (action?.destructive) {
        const ok = await showConfirm(
            t('ai.control.confirmDestructive', { action: t(action.label) })
        );
        if (!ok) {
            return;
        }
    }
    const result = await executeAction(
        diagState.pendingAction.actionId,
        diagState.pendingAction.params
    );
    if (!result.success) {
        showErrorToast(result.message ?? t('ai.control.executeFailed'));
    }
    if (result.success && action?.destructive) {
        diagState.lastUndoable = { label: t(action.label) };
    }
    const toolCallId = diagState.pendingAction.toolCallId;
    if (toolCallId) {
        diagState.pendingToolResults.push({
            toolCallId,
            content: JSON.stringify({ success: result.success, message: result.message }),
        });
    } else {
        diagState.messages.push({
            role: 'assistant',
            content: result.success
                ? t('ai.control.resultSuccess', { message: result.message })
                : t('ai.control.resultFailed', { message: result.message }),
        });
    }
    onComplete();
    await advancePendingQueue(onQueueAdvance);
}

/** 取消 pending action */
export async function cancelPendingAction(onQueueAdvance: () => void): Promise<void> {
    if (!diagState.pendingAction) {
        return;
    }
    const toolCallId = diagState.pendingAction.toolCallId;
    if (toolCallId) {
        diagState.pendingToolResults.push({
            toolCallId,
            content: JSON.stringify({ success: false, message: '用户已取消' }),
        });
    } else {
        diagState.messages.push({ role: 'assistant', content: t('ai.control.cancelled') });
    }
    await advancePendingQueue(onQueueAdvance);
}

/** 推进队列 */
export async function advancePendingQueue(onAdvance: () => void): Promise<void> {
    if (diagState.pendingQueue.length > 0) {
        diagState.pendingAction = diagState.pendingQueue.shift() ?? null;
        renderPendingAction();
        return;
    }
    diagState.pendingAction = null;
    await finalizePendingBatch(onAdvance);
}

/** 本批处理完成：回填 tool 消息，触发后续 stream */
export async function finalizePendingBatch(onComplete: () => void): Promise<void> {
    const hadToolCalls = diagState.pendingBatchHasToolCalls;
    const results = diagState.pendingToolResults;
    diagState.pendingToolResults = [];
    diagState.pendingBatchHasToolCalls = false;

    for (const r of results) {
        if (r.toolCallId) {
            diagState.messages.push({
                role: 'tool',
                content: r.content,
                tool_call_id: r.toolCallId,
            });
        }
    }
    renderControlHint();
    onComplete();

    if (hadToolCalls && results.some((r) => r.toolCallId)) {
        diagState.callbacks.continueStream?.();
    }
}
