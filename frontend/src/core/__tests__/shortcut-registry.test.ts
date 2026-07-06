import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    registerShortcut,
    registerShortcuts,
    getAllShortcuts,
    setKeyBinding,
    resetKeyBinding,
    resetAllKeyBindings,
    loadKeyBindings,
    exportKeyBindings,
    initShortcutDispatcher,
    _resetShortcutRegistry,
} from '../shortcut-registry';
import type { KeyBindingOverride } from '../shortcut-registry';

beforeEach(() => {
    _resetShortcutRegistry();
});

afterEach(() => {
    _resetShortcutRegistry();
});

describe('registerShortcut / registerShortcuts', () => {
    it('registers a single shortcut', () => {
        const handler = vi.fn();
        registerShortcut({
            id: 'test:single',
            label: '测试',
            defaultKey: 'Digit1',
            handler,
            group: '测试组',
        });
        const all = getAllShortcuts();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe('test:single');
        expect(all[0].label).toBe('测试');
    });

    it('registers multiple shortcuts at once', () => {
        registerShortcuts([
            { id: 'a', label: 'A', defaultKey: 'KeyA', handler: vi.fn(), group: 'g' },
            { id: 'b', label: 'B', defaultKey: 'KeyB', handler: vi.fn(), group: 'g' },
            { id: 'c', label: 'C', defaultKey: 'KeyC', handler: vi.fn(), group: 'g' },
        ]);
        expect(getAllShortcuts()).toHaveLength(3);
    });

    it('console.warn when handler is missing but does not crash', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerShortcut({
            id: 'test:no-handler',
            label: '无处理',
            defaultKey: 'Digit9',
            handler: undefined as unknown as () => void,
            group: 'g',
        });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('test:no-handler'));
        // Should not have been added
        expect(getAllShortcuts()).toHaveLength(0);
        warnSpy.mockRestore();
    });
});

describe('getAllShortcuts', () => {
    it('returns effective bindings with overrides applied', () => {
        registerShortcut({
            id: 'test:eff',
            label: '有效绑定',
            defaultKey: 'Digit1',
            defaultCtrl: true,
            handler: vi.fn(),
            group: 'g',
        });
        setKeyBinding('test:eff', 'KeyA', false, true);
        const all = getAllShortcuts();
        expect(all).toHaveLength(1);
        expect(all[0].currentKey).toBe('KeyA');
        expect(all[0].currentCtrl).toBe(false);
        expect(all[0].currentShift).toBe(true);
    });

    it('returns defaults when no override exists', () => {
        registerShortcut({
            id: 'test:defaults',
            label: '默认',
            defaultKey: 'Space',
            defaultAlt: true,
            handler: vi.fn(),
            group: 'g',
        });
        const all = getAllShortcuts();
        expect(all[0].currentKey).toBe('Space');
        expect(all[0].currentAlt).toBe(true);
    });
});

describe('initShortcutDispatcher — key event dispatch', () => {
    it('dispatch matching key → handler fired', () => {
        const handler = vi.fn();
        registerShortcut({
            id: 'dispatch:match',
            label: '匹配测试',
            defaultKey: 'Digit1',
            handler,
            group: '测试组',
        });
        initShortcutDispatcher();
        window.dispatchEvent(
            new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true })
        );
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('dispatch non-matching key → handler NOT fired', () => {
        const handler = vi.fn();
        registerShortcut({
            id: 'dispatch:no-match',
            label: '不匹配',
            defaultKey: 'Digit1',
            handler,
            group: 'g',
        });
        initShortcutDispatcher();
        window.dispatchEvent(
            new KeyboardEvent('keydown', { code: 'Digit2', key: '2', bubbles: true })
        );
        expect(handler).not.toHaveBeenCalled();
    });

    it('dispatch Ctrl+A → only Ctrl+A handler fires (not A alone)', () => {
        const handlerPlainA = vi.fn();
        const handlerCtrlA = vi.fn();
        registerShortcut({
            id: 'dispatch:plain-a',
            label: 'A',
            defaultKey: 'KeyA',
            handler: handlerPlainA,
            group: 'g',
        });
        registerShortcut({
            id: 'dispatch:ctrl-a',
            label: 'Ctrl+A',
            defaultKey: 'KeyA',
            defaultCtrl: true,
            handler: handlerCtrlA,
            group: 'g',
        });
        initShortcutDispatcher();

        window.dispatchEvent(
            new KeyboardEvent('keydown', {
                code: 'KeyA',
                key: 'a',
                ctrlKey: true,
                bubbles: true,
            })
        );
        expect(handlerCtrlA).toHaveBeenCalledTimes(1);
        expect(handlerPlainA).not.toHaveBeenCalled();
    });

    it('target is INPUT → no handler fired', () => {
        const handler = vi.fn();
        registerShortcut({
            id: 'dispatch:input',
            label: '输入跳过',
            defaultKey: 'Digit1',
            handler,
            group: 'g',
        });
        initShortcutDispatcher();

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.dispatchEvent(
            new KeyboardEvent('keydown', {
                code: 'Digit1',
                key: '1',
                bubbles: true,
            })
        );
        expect(handler).not.toHaveBeenCalled();
        document.body.removeChild(input);
    });

    it('target is TEXTAREA → no handler fired', () => {
        const handler = vi.fn();
        registerShortcut({
            id: 'dispatch:textarea',
            label: '文本域跳过',
            defaultKey: 'Digit1',
            handler,
            group: 'g',
        });
        initShortcutDispatcher();

        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);
        textarea.dispatchEvent(
            new KeyboardEvent('keydown', {
                code: 'Digit1',
                key: '1',
                bubbles: true,
            })
        );
        expect(handler).not.toHaveBeenCalled();
        document.body.removeChild(textarea);
    });

    it('ArrowLeft: element with cs-slider class → handler NOT fired', () => {
        const handler = vi.fn();
        registerShortcut({
            id: 'dispatch:arrow-left',
            label: '←',
            defaultKey: 'ArrowLeft',
            handler,
            group: 'g',
        });
        initShortcutDispatcher();

        const slider = document.createElement('div');
        slider.className = 'cs-slider';
        document.body.appendChild(slider);
        slider.dispatchEvent(
            new KeyboardEvent('keydown', {
                code: 'ArrowLeft',
                key: 'ArrowLeft',
                bubbles: true,
            })
        );
        expect(handler).not.toHaveBeenCalled();
        document.body.removeChild(slider);
    });

    it('ArrowRight: element with color-slider class → handler NOT fired', () => {
        const handler = vi.fn();
        registerShortcut({
            id: 'dispatch:arrow-right',
            label: '→',
            defaultKey: 'ArrowRight',
            handler,
            group: 'g',
        });
        initShortcutDispatcher();

        const slider = document.createElement('div');
        slider.className = 'color-slider';
        document.body.appendChild(slider);
        slider.dispatchEvent(
            new KeyboardEvent('keydown', {
                code: 'ArrowRight',
                key: 'ArrowRight',
                bubbles: true,
            })
        );
        expect(handler).not.toHaveBeenCalled();
        document.body.removeChild(slider);
    });

    it('dispatch with prevent: true calls preventDefault', () => {
        const handler = vi.fn();
        registerShortcut({
            id: 'dispatch:prevent',
            label: '阻止默认',
            defaultKey: 'KeyP',
            prevent: true,
            handler,
            group: 'g',
        });
        initShortcutDispatcher();

        const ev = new KeyboardEvent('keydown', {
            code: 'KeyP',
            key: 'p',
            cancelable: true,
            bubbles: true,
        });
        const preventSpy = vi.spyOn(ev, 'preventDefault');
        window.dispatchEvent(ev);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(preventSpy).toHaveBeenCalled();
    });
});

describe('setKeyBinding — conflict detection', () => {
    beforeEach(() => {
        registerShortcut({
            id: 'conflict:a',
            label: '快捷A',
            defaultKey: 'Digit1',
            handler: vi.fn(),
            group: 'g',
        });
        registerShortcut({
            id: 'conflict:b',
            label: '快捷B',
            defaultKey: 'Digit2',
            handler: vi.fn(),
            group: 'g',
        });
    });

    it('returns conflict when another shortcut uses same key', () => {
        const result = setKeyBinding('conflict:b', 'Digit1');
        expect(result).toEqual({
            ok: false,
            conflictId: 'conflict:a',
            conflictLabel: '快捷A',
        });
    });

    it('returns conflict with same modifier combo', () => {
        setKeyBinding('conflict:a', 'KeyX', true, false, false);
        const result = setKeyBinding('conflict:b', 'KeyX', true, false, false);
        expect(result.ok).toBe(false);
        if ('conflictId' in result) {
            expect(result.conflictId).toBe('conflict:a');
        }
    });

    it('succeeds when no conflict', () => {
        const result = setKeyBinding('conflict:b', 'Digit9');
        expect(result).toEqual({ ok: true });
    });

    it('self-conflict is allowed (same id)', () => {
        const result = setKeyBinding('conflict:a', 'Digit1');
        expect(result).toEqual({ ok: true });
    });
});

describe('setKeyBinding — dispatch after override', () => {
    it('after setKeyBinding, old key no longer triggers', () => {
        const handler = vi.fn();
        registerShortcut({
            id: 'override:test',
            label: '重绑定',
            defaultKey: 'Digit1',
            handler,
            group: 'g',
        });
        initShortcutDispatcher();

        // Bind to Digit2
        setKeyBinding('override:test', 'Digit2');

        // Old key should not trigger
        window.dispatchEvent(
            new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true })
        );
        expect(handler).not.toHaveBeenCalled();

        // New key should trigger
        window.dispatchEvent(
            new KeyboardEvent('keydown', { code: 'Digit2', key: '2', bubbles: true })
        );
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('resetKeyBinding', () => {
    it('restores default after override', () => {
        const handler = vi.fn();
        registerShortcut({
            id: 'reset:test',
            label: '重置测试',
            defaultKey: 'Digit1',
            handler,
            group: 'g',
        });
        initShortcutDispatcher();

        // Override then reset
        setKeyBinding('reset:test', 'Digit2');
        resetKeyBinding('reset:test');

        // Default key should work again
        window.dispatchEvent(
            new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true })
        );
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('resetAllKeyBindings', () => {
    it('resets all overrides to defaults', () => {
        registerShortcut({
            id: 'reset-all:a',
            label: 'A',
            defaultKey: 'Digit1',
            handler: vi.fn(),
            group: 'g',
        });
        registerShortcut({
            id: 'reset-all:b',
            label: 'B',
            defaultKey: 'Digit2',
            handler: vi.fn(),
            group: 'g',
        });

        setKeyBinding('reset-all:a', 'KeyA');
        setKeyBinding('reset-all:b', 'KeyB');
        resetAllKeyBindings();

        const all = getAllShortcuts();
        const a = all.find((s) => s.id === 'reset-all:a')!;
        const b = all.find((s) => s.id === 'reset-all:b')!;
        expect(a.currentKey).toBe('Digit1');
        expect(b.currentKey).toBe('Digit2');
    });
});

describe('loadKeyBindings / exportKeyBindings round-trip', () => {
    it('export returns saved overrides', () => {
        registerShortcut({
            id: 'roundtrip:test',
            label: '往返测试',
            defaultKey: 'Digit1',
            handler: vi.fn(),
            group: 'g',
        });
        setKeyBinding('roundtrip:test', 'KeyZ', true, false, true);
        const exported = exportKeyBindings();
        expect(exported['roundtrip:test']).toEqual({
            key: 'KeyZ',
            ctrl: true,
            shift: false,
            alt: true,
        });
    });

    it('load restores previously exported bindings', () => {
        registerShortcut({
            id: 'load:test',
            label: '加载测试',
            defaultKey: 'Digit1',
            handler: vi.fn(),
            group: 'g',
        });
        loadKeyBindings({
            'load:test': { key: 'KeyM', ctrl: true },
        });

        const all = getAllShortcuts();
        const s = all.find((x) => x.id === 'load:test')!;
        expect(s.currentKey).toBe('KeyM');
        expect(s.currentCtrl).toBe(true);
    });

    it('full round-trip: export after load returns identical data', () => {
        registerShortcut({
            id: 'rt:full',
            label: '全往返',
            defaultKey: 'Digit1',
            handler: vi.fn(),
            group: 'g',
        });
        const original = { 'rt:full': { key: 'KeyQ', shift: true } as KeyBindingOverride };
        loadKeyBindings(original);
        expect(exportKeyBindings()).toEqual(original);
    });
});

describe('initShortcutDispatcher — initialization guard', () => {
    it('only initializes once, warns on second call', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        initShortcutDispatcher();
        initShortcutDispatcher();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already initialized'));
        warnSpy.mockRestore();
    });
});
