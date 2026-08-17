// [doc:test] resolveBackend 三路径（拆自 backend.test.ts）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setWindow, clearWebFlag, goAdapterMock } from './backend-mocks';

vi.mock('./go-adapter', () => goAdapterMock);

// setWindow 会把全局 window 换成桩对象，no-isolate 单 worker 下 window 跨文件共享，
// 必须 afterEach 恢复，否则污染其后收集期（ADR-219 治理）。
const realWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
    if (realWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
    } else {
        (globalThis as { window?: unknown }).window = realWindow;
    }
});

describe('resolveBackend 三路径（异步选型，Android 冷启动竞态防护）', () => {
    beforeEach(() => {
        setWindow(undefined);
        clearWebFlag();
        vi.useRealTimers();
    });

    it('Web 入口短路 → browserAdapter', async () => {
        vi.resetModules();
        (globalThis as { __MMKU_WEB__?: boolean }).__MMKU_WEB__ = true;
        const { resolveBackend } = await import('./index');
        const b = await resolveBackend();
        expect(b.kind).toBe('browser');
    });

    it('Tier0 显式 __MMKU_BACKEND__=browser 即便 window.wails 存在仍走 browserAdapter', async () => {
        vi.resetModules();
        (globalThis as { __MMKU_BACKEND__?: string }).__MMKU_BACKEND__ = 'browser';
        setWindow({ wails: { platform: () => 'desktop' } });
        const { resolveBackend } = await import('./index');
        const b = await resolveBackend();
        expect(b.kind).toBe('browser');
    });

    it('Tier0 显式 __MMKU_BACKEND__=go 且 wails 就绪 → goAdapter', async () => {
        vi.resetModules();
        (globalThis as { __MMKU_BACKEND__?: string }).__MMKU_BACKEND__ = 'go';
        setWindow({ wails: { platform: () => 'desktop' } });
        const { resolveBackend } = await import('./index');
        const b = await resolveBackend();
        expect(b.kind).toBe('go');
    });

    it('window.wails 存在 → goAdapter', async () => {
        vi.resetModules();
        setWindow({ wails: { platform: () => 'desktop' } });
        const { resolveBackend } = await import('./index');
        const b = await resolveBackend();
        expect(b.kind).toBe('go');
    });

    it('无 wails 且非 web → awaitWailsBridge 超时后回退 browserAdapter', async () => {
        vi.resetModules();
        setWindow({}); // 无 wails
        vi.useFakeTimers();
        const { resolveBackend } = await import('./index');
        const p = resolveBackend();
        vi.advanceTimersByTime(3100);
        const b = await p;
        vi.useRealTimers();
        expect(b.kind).toBe('browser');
    });
});
