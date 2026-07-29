// runtime-bridge 守护测试 —— 桌面端 events 桥接不得回落到 no-op WebEvents。
//
// 回归背景：WailsRuntimeBridge 用惰性 _load() 包装 @wailsio/runtime，但 init()/_load()
// 曾从未被调用，导致 `get events` 永远回落到 no-op WebEvents，Wails 后端事件
// （ai:chunk/ai:done/ai:error、android:* 等）全部收不到，AI 流式永久挂起。
// 本测试锁定：initRuntimeBridge() 后，events.on 必须命中真实 @wailsio/runtime 的 Events.On。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const onSpy = vi.fn((_name: string, _cb: unknown) => () => undefined);

vi.mock('@wailsio/runtime', () => ({
    Events: {
        On: onSpy,
        Once: vi.fn(() => () => undefined),
        Off: vi.fn(),
        OffAll: vi.fn(),
        Emit: vi.fn(() => Promise.resolve(true)),
    },
    Browser: { OpenURL: vi.fn(() => Promise.resolve()) },
}));

describe('runtime-bridge — 桌面事件桥接', () => {
    beforeEach(() => {
        vi.resetModules();
        onSpy.mockClear();
        // 桌面路径：isWebPlatform() 依 window.wails 是否存在判定
        (window as { wails?: unknown }).wails = {};
    });

    it('initRuntimeBridge() 后 events.on 命中真实 Wails Events.On（非 no-op）', async () => {
        const { events, initRuntimeBridge } = await import('../runtime-bridge');
        await initRuntimeBridge();

        const cb = vi.fn();
        events.on('ai:chunk', cb);

        expect(onSpy).toHaveBeenCalledWith('ai:chunk', cb);
    });

    it('未调 initRuntimeBridge() 时桌面 events.on 回落 no-op（暴露回归风险）', async () => {
        const { events } = await import('../runtime-bridge');
        // 故意不调用 initRuntimeBridge()
        const unsub = events.on('ai:done', vi.fn());

        // 回落到 WebEvents：不会触达真实 Events.On，返回可调用的 no-op unsub
        expect(onSpy).not.toHaveBeenCalled();
        expect(typeof unsub).toBe('function');
    });
});
