// shortcut-registry.test.ts — registerShortcut 冲突守卫 + deferred 恢复单测
// 覆盖 code_review P3：跨 id 同绑定冲突（先注册者保留）、同 id HMR 重注册不丢弃、
// 冲突解除后（resetKeyBinding 触发 flush）deferred 自动恢复、非冲突修饰键双注册。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const __mocks = vi.hoisted(() => ({
    logWarn: vi.fn(),
    addDisposableListener: vi.fn(() => ({ dispose: vi.fn() })),
    safeDispose: vi.fn((x) => x),
}));

vi.mock('../core/logger', () => ({ logWarn: __mocks.logWarn }));
vi.mock('../core/dom', () => ({ addDisposableListener: __mocks.addDisposableListener }));
vi.mock('../core/dispose-helpers', () => ({ safeDispose: __mocks.safeDispose }));

import {
    registerShortcut,
    getAllShortcuts,
    setKeyBinding,
    resetKeyBinding,
    _resetShortcutRegistry,
} from '../core/shortcut-registry';
import type { ShortcutDef } from '../core/shortcut-registry';

function makeDef(id: string, defaultKey: string, extra?: Partial<ShortcutDef>): ShortcutDef {
    return {
        id,
        label: `shortcuts.label.${id}`,
        defaultKey,
        handler: vi.fn(),
        group: 'test',
        ...extra,
    };
}

beforeEach(() => {
    _resetShortcutRegistry();
    __mocks.logWarn.mockClear();
});

describe('registerShortcut 冲突守卫', () => {
    it('跨 id 同绑定冲突：先注册者保留，后注册者被拦截 + logWarn', () => {
        registerShortcut(makeDef('a', 'Space'));
        registerShortcut(makeDef('b', 'Space'));

        // a 保留，b 未注册（getAllShortcuts 不含 b）
        const ids = getAllShortcuts().map((s) => s.id);
        expect(ids).toContain('a');
        expect(ids).not.toContain('b');
        expect(__mocks.logWarn).toHaveBeenCalledWith(
            'shortcut-registry',
            expect.stringContaining('"b" 与 "a" 按键冲突')
        );
    });

    it('同 id 重注册（HMR）：不拦截，替换条目', () => {
        registerShortcut(makeDef('a', 'Space'));
        const newHandler = vi.fn();
        registerShortcut(makeDef('a', 'Space', { handler: newHandler }));

        // a 仍在且 handler 已被替换（HMR 重载语义）
        const a = getAllShortcuts().find((s) => s.id === 'a');
        expect(a).toBeDefined();
        expect(a!.handler).toBe(newHandler);
        expect(__mocks.logWarn).not.toHaveBeenCalledWith(
            'shortcut-registry',
            expect.stringContaining('按键冲突')
        );
    });

    it('非冲突修饰键：两者均注册', () => {
        registerShortcut(makeDef('a', 'Space', { defaultCtrl: true }));
        registerShortcut(makeDef('b', 'Space')); // b 无 Ctrl，与 a 不冲突

        const ids = getAllShortcuts().map((s) => s.id);
        expect(ids).toContain('a');
        expect(ids).toContain('b');
        expect(__mocks.logWarn).not.toHaveBeenCalledWith(
            'shortcut-registry',
            expect.stringContaining('按键冲突')
        );
    });
});

describe('冲突解除后 deferred 自动恢复', () => {
    it('先冲突后 resetKeyBinding 解除 → 被拦截者恢复注册', () => {
        registerShortcut(makeDef('a', 'Space'));
        registerShortcut(makeDef('b', 'Space')); // b 冲突入 deferred
        expect(getAllShortcuts().map((s) => s.id)).not.toContain('b');

        // 把 a 改绑到其它键，或重置 a 的 override → 解除 b 的冲突
        setKeyBinding('a', 'KeyX');
        expect(getAllShortcuts().map((s) => s.id)).toContain('b');
        expect(__mocks.logWarn).toHaveBeenCalledWith(
            'shortcut-registry',
            expect.stringContaining('冲突已解除，恢复注册')
        );
    });

    it('resetKeyBinding 恢复默认后同样触发 deferred 重试', () => {
        registerShortcut(makeDef('a', 'Space'));
        registerShortcut(makeDef('b', 'Space'));
        // 先给 a 设 override 让其让位 → b 恢复
        setKeyBinding('a', 'KeyY');
        expect(getAllShortcuts().map((s) => s.id)).toContain('b');

        // 重置 a 的 override 回 Space → b 重新冲突，但 deferred 为空不再入队
        resetKeyBinding('a');
        expect(__mocks.logWarn).toHaveBeenCalled();
    });

    it('deferred id 后重新注册成功，flush 不得用 stale 条目覆盖新注册（code_review P2）', () => {
        // B 与 A 冲突 → B 入 deferred
        registerShortcut(makeDef('a', 'Space'));
        registerShortcut(makeDef('b', 'Space'));
        expect(getAllShortcuts().map((s) => s.id)).not.toContain('b');

        // HMR 重注册 B（改绑 KeyZ + 新 handler）→ 无冲突，直接注册成功
        const newHandler = vi.fn();
        registerShortcut(makeDef('b', 'KeyZ', { handler: newHandler }));
        const bAfterReReg = getAllShortcuts().find((s) => s.id === 'b');
        expect(bAfterReReg).toBeDefined();
        expect(bAfterReReg!.handler).toBe(newHandler);

        // 触发 flush（改绑 A）——stale 队列条目不得覆盖当前 B（KeyZ+newHandler）
        setKeyBinding('a', 'KeyX');
        const bAfterFlush = getAllShortcuts().find((s) => s.id === 'b');
        expect(bAfterFlush).toBeDefined();
        expect(bAfterFlush!.defaultKey).toBe('KeyZ'); // 仍是新注册的 KeyZ，非 stale 的 Space
        expect(bAfterFlush!.handler).toBe(newHandler); // 仍是新 handler，非 stale 闭包
    });

    it('成功重注册后再次冲突入队再 flush：最新冲突意图恢复（code_review P2 round2）', () => {
        // 1. A 注册 Space
        registerShortcut(makeDef('a', 'Space'));
        // 2. B 冲突入队（Space）
        registerShortcut(makeDef('b', 'Space'));
        expect(getAllShortcuts().map((s) => s.id)).not.toContain('b');
        // 3. B 成功重注册（KeyZ/h2）——成功路径清理 stale 的 b(Space)
        const h2 = vi.fn();
        registerShortcut(makeDef('b', 'KeyZ', { handler: h2 }));
        // 4. B 再次以冲突绑定注册（Space/h4）——入队去重覆盖为最新意图
        const h4 = vi.fn();
        registerShortcut(makeDef('b', 'Space', { handler: h4 }));
        // 5. 改绑 A 解除冲突 → flush：残留队列条目是 fresh 的 b(Space/h4)，
        //    必须恢复为最新意图（Space/h4），而非停留在 KeyZ/h2
        setKeyBinding('a', 'KeyX');
        const bAfterFlush = getAllShortcuts().find((s) => s.id === 'b');
        expect(bAfterFlush).toBeDefined();
        expect(bAfterFlush!.defaultKey).toBe('Space'); // 最新冲突意图 Space，非 KeyZ
        expect(bAfterFlush!.handler).toBe(h4); // 最新 handler h4，非 h2
    });
});
