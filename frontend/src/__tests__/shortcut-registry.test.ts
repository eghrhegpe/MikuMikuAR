// @vitest-environment node
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
    registerShortcuts,
    getAllShortcuts,
    setKeyBinding,
    resetKeyBinding,
    formatKeyBinding,
    exportKeyBindings,
    loadKeyBindings,
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

    it('findDeferredIndex 非空队列未命中：注册不冲突的 C 不得 splice 误伤已在队的 B', () => {
        // A 注册 Space（无修饰键）
        registerShortcut(makeDef('a', 'Space'));
        // B 与 A 冲突 → 入 deferred 队列，此时 _deferredShortcuts=[b]（非空）
        registerShortcut(makeDef('b', 'Space'));
        expect(getAllShortcuts().map((s) => s.id)).not.toContain('b');

        // C 以 Space+Ctrl 注册：与 A(plain Space) 不冲突 → 直接注册成功。
        // 其成功路径调用 findDeferredIndex('c')，队列非空但无 'c' 命中（返回 -1），
        // 必须跳过 splice 分支，不得误删已在 index 0 的 b。
        registerShortcut(makeDef('c', 'Space', { defaultCtrl: true }));
        const idsAfterC = getAllShortcuts().map((s) => s.id);
        expect(idsAfterC).toContain('a');
        expect(idsAfterC).toContain('c');
        expect(idsAfterC).not.toContain('b'); // b 仍在 deferred，未被误删
        expect(__mocks.logWarn).not.toHaveBeenCalledWith(
            'shortcut-registry',
            expect.stringContaining('"c" 与')
        );

        // 旁证：触发 flush（改绑 A 解除与 B 的冲突），b 必须仍能被恢复，
        // 证明它从始至终都留在队列里（从未被 C 的 -1 命中误 splice）。
        setKeyBinding('a', 'KeyX');
        const idsAfterFlush = getAllShortcuts().map((s) => s.id);
        expect(idsAfterFlush).toContain('b');
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
        // 4. B 再次以冲突绑定注册（Space/h4）——入队去队覆盖为最新意图
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

    it('flush 互冲守卫：多个 deferred 项彼此冲突时，仅先入队者恢复，后者留队', () => {
        // A 注册 Space
        registerShortcut(makeDef('a', 'Space'));
        // B 与 A 冲突 → 入 deferred
        registerShortcut(makeDef('b', 'Space'));
        // C 也与 A 冲突 → 入 deferred（B 与 C 彼此也冲突）
        registerShortcut(makeDef('c', 'Space'));
        expect(getAllShortcuts().map((s) => s.id)).toEqual(['a']);

        // 改绑 A → flush：B 先恢复（占用 Space），C 与 B 冲突 → 留队
        setKeyBinding('a', 'KeyX');
        const ids = getAllShortcuts().map((s) => s.id);
        expect(ids).toContain('b');
        expect(ids).not.toContain('c'); // C 仍 deferred，不与 B 同时占 Space
    });
});

describe('formatKeyBinding', () => {
    it('普通键名原样输出', () => {
        expect(formatKeyBinding('Tab', false, false, false)).toBe('Tab');
    });

    it('Ctrl+组合键', () => {
        expect(formatKeyBinding('KeyS', true, false, false)).toBe('Ctrl+S');
    });

    it('Ctrl+Shift+组合键', () => {
        expect(formatKeyBinding('KeyZ', true, true, false)).toBe('Ctrl+Shift+Z');
    });

    it('全修饰键', () => {
        expect(formatKeyBinding('KeyA', true, true, true)).toBe('Ctrl+Shift+Alt+A');
    });

    it('Space 显示为 Space', () => {
        expect(formatKeyBinding('Space', false, false, false)).toBe('Space');
    });

    it('Escape 显示为 Esc', () => {
        expect(formatKeyBinding('Escape', false, false, false)).toBe('Esc');
    });

    it('方向键显示为箭头符号', () => {
        expect(formatKeyBinding('ArrowLeft', false, false, false)).toBe('←');
        expect(formatKeyBinding('ArrowRight', false, false, false)).toBe('→');
        expect(formatKeyBinding('ArrowUp', false, false, false)).toBe('↑');
        expect(formatKeyBinding('ArrowDown', false, false, false)).toBe('↓');
    });

    it('Digit 前缀剥离', () => {
        expect(formatKeyBinding('Digit1', false, false, false)).toBe('1');
        expect(formatKeyBinding('Digit5', true, false, false)).toBe('Ctrl+5');
    });

    it('Key 前缀剥离', () => {
        expect(formatKeyBinding('KeyA', false, false, false)).toBe('A');
    });

    it('Enter 保持原样', () => {
        expect(formatKeyBinding('Enter', false, false, false)).toBe('Enter');
    });
});

describe('registerShortcuts 批量注册', () => {
    it('批量注册多个不冲突的快捷键', () => {
        registerShortcuts([
            makeDef('a', 'KeyA'),
            makeDef('b', 'KeyB'),
            makeDef('c', 'KeyC'),
        ]);
        const ids = getAllShortcuts().map((s) => s.id);
        expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('批量注册中遇到冲突仍遵守守卫', () => {
        registerShortcuts([
            makeDef('a', 'Space'),
            makeDef('b', 'Space'), // 与 a 冲突
        ]);
        const ids = getAllShortcuts().map((s) => s.id);
        expect(ids).toContain('a');
        expect(ids).not.toContain('b');
    });
});

describe('exportKeyBindings / loadKeyBindings 持久化往返', () => {
    it('无 override 时 export 返回空对象', () => {
        registerShortcut(makeDef('a', 'Space'));
        expect(exportKeyBindings()).toEqual({});
    });

    it('setKeyBinding 后 export 包含 override', () => {
        registerShortcut(makeDef('a', 'Space'));
        setKeyBinding('a', 'KeyX', true);
        expect(exportKeyBindings()).toEqual({
            a: { key: 'KeyX', ctrl: true, shift: undefined, alt: undefined },
        });
    });

    it('export → reset → load 往返一致', () => {
        registerShortcut(makeDef('a', 'Space'));
        setKeyBinding('a', 'KeyY', false, true);
        const exported = exportKeyBindings();

        resetKeyBinding('a');
        // reset 后 a 回到默认 Space
        const aAfterReset = getAllShortcuts().find((s) => s.id === 'a');
        expect(aAfterReset!.currentKey).toBe('Space');

        loadKeyBindings(exported);
        // load 后恢复 override
        const aAfterLoad = getAllShortcuts().find((s) => s.id === 'a');
        expect(aAfterLoad!.currentKey).toBe('KeyY');
        expect(aAfterLoad!.currentShift).toBe(true);
    });

    it('loadKeyBindings 触发 deferred flush', () => {
        registerShortcut(makeDef('a', 'Space'));
        registerShortcut(makeDef('b', 'Space')); // b 冲突入 deferred
        expect(getAllShortcuts().map((s) => s.id)).not.toContain('b');

        // load 把 a 改绑到 KeyX → 解除冲突 → b 恢复
        loadKeyBindings({ a: { key: 'KeyX' } });
        expect(getAllShortcuts().map((s) => s.id)).toContain('b');
    });
});

describe('getAllShortcuts 返回 effective bindings', () => {
    it('无 override 时返回 defaultKey', () => {
        registerShortcut(makeDef('a', 'Space', { defaultCtrl: true }));
        const a = getAllShortcuts().find((s) => s.id === 'a');
        expect(a!.currentKey).toBe('Space');
        expect(a!.currentCtrl).toBe(true);
        expect(a!.currentShift).toBe(false);
    });

    it('setKeyBinding 后 getAllShortcuts 反映 override', () => {
        registerShortcut(makeDef('a', 'Space'));
        setKeyBinding('a', 'KeyZ', false, false, true);
        const a = getAllShortcuts().find((s) => s.id === 'a');
        expect(a!.currentKey).toBe('KeyZ');
        expect(a!.currentAlt).toBe(true);
        expect(a!.currentCtrl).toBe(false);
    });
});

describe('registerShortcut 边界', () => {
    it('无 handler 时 logWarn 且不注册', () => {
        const def = { id: 'x', label: 'x', defaultKey: 'KeyX', group: 'test' } as ShortcutDef;
        registerShortcut(def);
        expect(__mocks.logWarn).toHaveBeenCalledWith(
            'shortcut-registry',
            expect.stringContaining('no handler')
        );
        expect(getAllShortcuts().map((s) => s.id)).not.toContain('x');
    });

    it('setKeyBinding 返回冲突信息', () => {
        registerShortcut(makeDef('a', 'Space'));
        registerShortcut(makeDef('b', 'KeyB'));
        const result = setKeyBinding('b', 'Space');
        expect(result).toEqual({ ok: false, conflictId: 'a', conflictLabel: 'shortcuts.label.a' });
    });

    it('setKeyBinding 成功时返回 ok:true', () => {
        registerShortcut(makeDef('a', 'Space'));
        const result = setKeyBinding('a', 'KeyX');
        expect(result).toEqual({ ok: true });
    });
});
