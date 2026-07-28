import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    registerAction,
    registerActions,
    getAction,
    listActions,
    unregisterAction,
    _resetActionRegistry,
    _setStrictMode,
} from '../action-registry';
import type { ActionDef } from '../action-registry';

beforeEach(() => {
    _resetActionRegistry();
});

afterEach(() => {
    _resetActionRegistry();
    _setStrictMode(false);
});

describe('registerAction', () => {
    it('registers an action and returns unregister function', () => {
        const unregister = registerAction({
            id: 'test:foo',
            label: '测试动作',
            domain: 'scene',
            params: [],
            execute: () => {},
        });
        expect(getAction('test:foo')).toBeDefined();
        unregister();
        expect(getAction('test:foo')).toBeUndefined();
    });

    it('warns on duplicate id and overwrites', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const handlerA = vi.fn();
        const handlerB = vi.fn();
        registerAction({
            id: 'test:dup',
            label: 'A',
            domain: 'scene',
            params: [],
            execute: handlerA,
        });
        registerAction({
            id: 'test:dup',
            label: 'B',
            domain: 'scene',
            params: [],
            execute: handlerB,
        });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('test:dup'));
        expect(getAction('test:dup')?.execute).toBe(handlerB);
        warnSpy.mockRestore();
    });

    it('throws in strict mode on duplicate', () => {
        _setStrictMode(true);
        registerAction({
            id: 'test:strict',
            label: 'A',
            domain: 'scene',
            params: [],
            execute: () => {},
        });
        expect(() =>
            registerAction({
                id: 'test:strict',
                label: 'B',
                domain: 'scene',
                params: [],
                execute: () => {},
            })
        ).toThrow('test:strict');
    });
});

describe('registerActions', () => {
    it('registers multiple actions at once', () => {
        const unregisters = registerActions([
            { id: 'batch:a', label: 'A', domain: 'scene', params: [], execute: vi.fn() },
            { id: 'batch:b', label: 'B', domain: 'env', params: [], execute: vi.fn() },
            { id: 'batch:c', label: 'C', domain: 'motion', params: [], execute: vi.fn() },
        ]);
        expect(listActions()).toHaveLength(3);
        unregisters.forEach((u) => u());
        expect(listActions()).toHaveLength(0);
    });
});

describe('getAction', () => {
    it('returns undefined for unknown id', () => {
        expect(getAction('nonexistent')).toBeUndefined();
    });

    it('returns the full ActionDef', () => {
        const def: ActionDef = {
            id: 'test:full',
            label: '完整信息',
            domain: 'settings',
            icon: 'lucide:settings-2',
            params: [{ name: 'value', type: 'range', min: 0, max: 1, step: 0.05 }],
            execute: () => {},
            destructive: true,
        };
        registerAction(def);
        const got = getAction('test:full');
        expect(got?.id).toBe('test:full');
        expect(got?.domain).toBe('settings');
        expect(got?.icon).toBe('lucide:settings-2');
        expect(got?.destructive).toBe(true);
        expect(got?.params).toHaveLength(1);
        expect(got?.params[0].type).toBe('range');
    });
});

describe('listActions', () => {
    it('returns all actions when domain omitted', () => {
        registerActions([
            { id: 'list:1', label: '1', domain: 'scene', params: [], execute: vi.fn() },
            { id: 'list:2', label: '2', domain: 'env', params: [], execute: vi.fn() },
        ]);
        expect(listActions()).toHaveLength(2);
    });

    it('filters by domain', () => {
        registerActions([
            { id: 'dom:scene', label: 'S', domain: 'scene', params: [], execute: vi.fn() },
            { id: 'dom:env', label: 'E', domain: 'env', params: [], execute: vi.fn() },
            { id: 'dom:motion', label: 'M', domain: 'motion', params: [], execute: vi.fn() },
        ]);
        const scenes = listActions('scene');
        expect(scenes).toHaveLength(1);
        expect(scenes[0].id).toBe('dom:scene');
    });

    it('returns empty array for unknown domain', () => {
        expect(listActions('library')).toHaveLength(0);
    });
});

describe('unregisterAction', () => {
    it('removes an action by id', () => {
        registerAction({
            id: 'test:remove',
            label: '待移除',
            domain: 'scene',
            params: [],
            execute: () => {},
        });
        expect(getAction('test:remove')).toBeDefined();
        unregisterAction('test:remove');
        expect(getAction('test:remove')).toBeUndefined();
    });

    it('no-op for non-existent id', () => {
        expect(() => unregisterAction('no-such-action')).not.toThrow();
    });
});

describe('_resetActionRegistry', () => {
    it('clears all registered actions', () => {
        registerActions([
            { id: 'reset:a', label: 'A', domain: 'scene', params: [], execute: vi.fn() },
            { id: 'reset:b', label: 'B', domain: 'env', params: [], execute: vi.fn() },
        ]);
        _resetActionRegistry();
        expect(listActions()).toHaveLength(0);
    });
});

describe('execute integration', () => {
    it('executes action with params', () => {
        const handler = vi.fn();
        registerAction({
            id: 'test:exec',
            label: '执行测试',
            domain: 'scene',
            params: [{ name: 'value', type: 'range' }],
            execute: handler,
        });
        const def = getAction('test:exec')!;
        def.execute({ value: 0.5 });
        expect(handler).toHaveBeenCalledWith({ value: 0.5 });
    });

    it('supports async execute', async () => {
        const handler = vi.fn().mockResolvedValue(undefined);
        registerAction({
            id: 'test:async',
            label: '异步测试',
            domain: 'scene',
            params: [],
            execute: handler,
        });
        await getAction('test:async')!.execute({});
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
