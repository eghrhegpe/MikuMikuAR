// [doc:architecture] Env Persist — envState/uiState 防抖持久化
// 从 env-bridge.ts 拆出（ADR-148 Phase 5：env-bridge 瘦身）
// 职责: envState/uiState 防抖调度 + 立即 flush + 启动回调注册
// 依赖: 仅 core 层，无 env-bridge 反向依赖

import { resolveBackend } from '@/core/backend';
import type { UIState } from '@/core/wails-bindings';
import { envState, triggerAutoSave } from '@/core/config';
import { uiState, setUIPersistCallback } from '@/core/state';
import { feedbackStatus } from '@/core/feedback';
import { logWarn, DebouncedTimer } from '@/core/utils';

// ======== EnvState Persist ========

const _envPersistTimer = new DebouncedTimer();

/** 持久化 envState 到后端（ADR-176 第 2 步：经 resolveBackend 路由）。
 * 上抛错误——调用方（防抖回调/flush）负责 catch + setStatus 提示。 */
export async function persistEnvState(payload: UIState | Record<string, unknown>): Promise<void> {
    const backend = await resolveBackend();
    await backend.SetEnvState(payload as any);
}

/** 立即刷写 env state 到后端（无防抖）。关闭/隐藏页面时调用。
 * 返回 Promise 供调用方可选 await（如显式等待持久化完成）。 */
export async function flushEnvState(): Promise<void> {
    if (import.meta.env.DEV) {
        console.info('[env-persist] flushEnvState() — immediate flush');
    }
    _envPersistTimer.cancel();
    // 传普通对象副本（非 reactive Proxy）
    try {
        await persistEnvState({ ...envState });
    } catch (err) {
        logWarn('flushEnvState', 'persist failed', err);
        feedbackStatus('env.persistFailed', undefined, false);
    }
}

/** 取消挂起的 env state 防抖持久化定时器（HMR 重入清理用，见 ADR-106 D3）。 */
export function cancelEnvPersistTimer(): void {
    _envPersistTimer.cancel();
}

/** 调度 env state 防抖持久化（500ms）。setEnvState 内部调用。 */
export function schedulePersistEnvState(): void {
    _envPersistTimer.schedule(() => {
        // 传普通对象副本（非 reactive Proxy），避免 JSON.stringify 对 Proxy 枚举不完整
        if (import.meta.env.DEV) {
            console.info('[env-persist] debounce fired → SetEnvState()');
        }
        void persistEnvState({ ...envState }).catch((err) => {
            logWarn('persistEnvState', 'persist failed', err);
            feedbackStatus('env.persistFailed', undefined, false);
        });
    }, 500);
}

// ======== UIState Persist ========

const _uiPersistTimer = new DebouncedTimer();

/** 以当前 uiState 完整对象构建持久化载荷，剔除未定义字段。 */
function _buildUIStatePayload(): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    const s = uiState as Record<string, unknown>;
    for (const key of Object.keys(s)) {
        const v = s[key];
        if (v !== undefined) {
            p[key] = v;
        }
    }
    return p;
}

/** 防抖调度 UIState 持久化。修改 uiState 后调用此函数。 */
export function schedulePersistUI(): void {
    _uiPersistTimer.schedule(() => void flushUIState(), 500);
}

/** 与 persistEnvState 对称：持久化 UI state（ADR-176 第 2 步：经 resolveBackend 路由）。
 *
 * Go 端 SetUIState 语义是 json.Unmarshal 合并（缺省字段保留原值），
 * 但类型声明是完整 UIState。payload 用 Partial<UIState> 表达部分字段，
 * 强转后传入是安全的。
 * 上抛错误——调用方（防抖回调/flush）负责 catch + setStatus 提示。
 */
export async function persistUIState(payload: Partial<UIState>): Promise<void> {
    const backend = await resolveBackend();
    await backend.SetUIState(payload as unknown as UIState);
}

/** 立即刷写 UI state 到后端（无防抖）。关闭/隐藏页面时调用。
 * 返回 Promise 供调用方可选 await（如显式等待持久化完成）。 */
export async function flushUIState(): Promise<void> {
    if (import.meta.env.DEV) {
        console.info('[ui-persist] flushUIState() — immediate flush');
    }
    _uiPersistTimer.cancel();
    const payload = _buildUIStatePayload();
    if (Object.keys(payload).length === 0) {
        return;
    } // nothing to persist
    try {
        await persistUIState(payload);
    } catch (err) {
        logWarn('flushUIState', 'persist failed', err);
        feedbackStatus('env.persistFailed', undefined, false);
    }
}

// 注册持久化回调（state.ts → 本模块，避免循环依赖）
setUIPersistCallback(schedulePersistUI);
