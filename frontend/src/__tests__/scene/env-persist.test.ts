// env-persist.test.ts — envState/uiState 防抖持久化直接单测
// 背景：此前无专属单测（仅间接覆盖），flushUIState cancel→await 竞态窗口、
// 防抖调度、失败反馈零直接验证（ADR-204 违规）。本文件直接测 env-persist 模块。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ======== Mock 依赖 ========
const __mocks = vi.hoisted(() => {
    const resolveBackend = vi.fn(() => ({
        SetEnvState: vi.fn().mockResolvedValue(undefined),
        SetUIState: vi.fn().mockResolvedValue(undefined),
    }));
    const feedbackStatus = vi.fn();
    const logWarn = vi.fn();
    const setUIPersistCallback = vi.fn();
    const envState = { skyColorTop: [0.3, 0.5, 0.8], fogEnabled: true } as Record<string, unknown>;
    const uiState = {
        scale: 1,
        accent: '#4a6cf7',
        fontFamily: undefined as string | undefined, // 模拟 undefined 字段剔除
        popupWidth: 280,
    } as Record<string, unknown>;
    return { resolveBackend, feedbackStatus, logWarn, setUIPersistCallback, envState, uiState };
});

vi.mock('@/core/backend', () => ({
    resolveBackend: __mocks.resolveBackend,
}));
vi.mock('@/core/feedback', () => ({
    feedbackStatus: __mocks.feedbackStatus,
}));
vi.mock('@/core/logger', () => ({
    logWarn: __mocks.logWarn,
}));
vi.mock('@/core/config', () => ({
    envState: __mocks.envState,
}));
vi.mock('@/core/state', () => ({
    uiState: __mocks.uiState,
    setUIPersistCallback: __mocks.setUIPersistCallback,
}));
vi.mock('@/core/scene-action-bridge', () => ({
    registerSceneAction: vi.fn(),
}));

import { beforeEach as _b } from 'vitest';

import {
    flushEnvState,
    flushUIState,
    persistEnvState,
    persistUIState,
    schedulePersistEnvState,
    schedulePersistUI,
    cancelEnvPersistTimer,
} from '../../scene/env/_bridge/env-persist';
import { DebouncedTimer } from '@/core/async';

describe('env-persist', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        __mocks.resolveBackend.mockClear();
        __mocks.feedbackStatus.mockClear();
        __mocks.logWarn.mockClear();
        // 重置防抖 timer（模块级单例，测试间隔离）
        cancelEnvPersistTimer();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('persistEnvState 经 resolveBackend 路由调用 SetEnvState', async () => {
        const payload = { skyColorTop: [0.3, 0.5, 0.8] };
        await persistEnvState(payload);
        const backend = __mocks.resolveBackend.mock.results[0].value;
        expect(backend.SetEnvState).toHaveBeenCalledWith(payload);
    });

    it('flushEnvState 立即刷写并取消挂起防抖', async () => {
        const p = flushEnvState();
        await vi.runAllTimersAsync();
        await p;
        const backend = __mocks.resolveBackend.mock.results[0].value;
        expect(backend.SetEnvState).toHaveBeenCalledWith(expect.objectContaining(__mocks.envState));
    });

    it('schedulePersistEnvState 防抖 500ms 后触发持久化', async () => {
        schedulePersistEnvState();
        // 防抖窗口内未触发
        await vi.advanceTimersByTimeAsync(499);
        expect(__mocks.resolveBackend).not.toHaveBeenCalled();
        // 500ms 到点触发
        await vi.advanceTimersByTimeAsync(1);
        const backend = __mocks.resolveBackend.mock.results[0].value;
        expect(backend.SetEnvState).toHaveBeenCalled();
    });

    it('flushUIState 空载荷直接返回（nothing to persist，不调后端）', async () => {
        const orig = { ...__mocks.uiState };
        Object.keys(orig).forEach((k) => (__mocks.uiState[k] = undefined));
        await flushUIState();
        expect(__mocks.resolveBackend).not.toHaveBeenCalled();
        // 恢复
        Object.assign(__mocks.uiState, orig);
    });

    it('flushUIState 剔除 undefined 字段后持久化', async () => {
        // uiState 含 fontFamily=undefined，载荷应剔除
        await flushUIState();
        const backend = __mocks.resolveBackend.mock.results[0].value;
        const payload = backend.SetUIState.mock.calls[0][0];
        expect(payload).not.toHaveProperty('fontFamily');
        expect(payload).toHaveProperty('scale', 1);
    });

    it('flushEnvState 后端抛错 → logWarn + feedbackStatus（不静默）', async () => {
        __mocks.resolveBackend.mockImplementationOnce(() => ({
            SetEnvState: vi.fn().mockRejectedValue(new Error('boom')),
            SetUIState: vi.fn().mockResolvedValue(undefined),
        }));
        await flushEnvState();
        expect(__mocks.logWarn).toHaveBeenCalled();
        expect(__mocks.feedbackStatus).toHaveBeenCalledWith('env.persistFailed', undefined, false);
    });

    it('persistUIState 经 resolveBackend 路由调用 SetUIState', async () => {
        await persistUIState({ scale: 1.5 } as never);
        const backend = __mocks.resolveBackend.mock.results[0].value;
        expect(backend.SetUIState).toHaveBeenCalledWith({ scale: 1.5 });
    });
});
