// browser-adapter.fsa-auth.test.ts — FSA 认证状态 + 重新授权（拆自 browser-adapter.test.ts）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mem, setStore, resetMem } from './browser-adapter-mocks';

vi.mock('./idb', () => ({
    idbGet: async (store: string, key: string) => mem.get(store)?.get(key) ?? undefined,
    idbSet: async (store: string, key: string, value: unknown) => {
        if (!mem.has(store)) mem.set(store, new Map());
        mem.get(store)!.set(key, value);
    },
    idbKeys: async (store: string) => [...(mem.get(store)?.keys() ?? [])],
    idbDelete: async (store: string, key: string) => { mem.get(store)?.delete(key); },
    idbBatchSet: async (store: string, entries: [string, unknown][]) => {
        if (!mem.has(store)) mem.set(store, new Map());
        for (const [k, v] of entries) mem.get(store)!.set(k, v);
    },
    openDB: async () => ({}) as unknown,
    closeIDB: () => {},
}));

import {
    getFsaAuthState,
    isFsaAuthPromptDismissed,
    dismissFsaAuthPrompt,
    reauthorizeFsaRoot,
} from './browser-adapter';

describe('getFsaAuthState 四态（adr-177 启动引导）', () => {
    const realWindow = (globalThis as { window?: unknown }).window;
    beforeEach(() => resetMem());
    afterEach(() => {
        if (realWindow === undefined) {
            delete (globalThis as { window?: unknown }).window;
        } else {
            (globalThis as { window?: unknown }).window = realWindow;
        }
    });

    it('unsupported: 有 window 但不暴露 FSA API → 不引导', async () => {
        (globalThis as { window?: unknown }).window = { addEventListener: () => {} };
        expect(await getFsaAuthState()).toBe('unsupported');
    });

    it('none: 有 FSA API 且无持久化句柄 → 应引导', async () => {
        (globalThis as { window?: unknown }).window = {
            showDirectoryPicker: () => {},
            showOpenFilePicker: () => {},
        };
        expect(await getFsaAuthState()).toBe('none');
    });

    it('granted: 句柄 queryPermission 返回 granted → 不引导', async () => {
        (globalThis as { window?: unknown }).window = {
            showDirectoryPicker: () => {},
            showOpenFilePicker: () => {},
        };
        setStore('config', { fsaRootHandle: { queryPermission: async () => 'granted' } });
        expect(await getFsaAuthState()).toBe('granted');
    });

    it('revoked: 句柄 queryPermission 返回 prompt → 应提示重设', async () => {
        (globalThis as { window?: unknown }).window = {
            showDirectoryPicker: () => {},
            showOpenFilePicker: () => {},
        };
        setStore('config', { fsaRootHandle: { queryPermission: async () => 'prompt' } });
        expect(await getFsaAuthState()).toBe('revoked');
    });

    it('revoked: 老实现无 queryPermission → 保守视为需重选', async () => {
        (globalThis as { window?: unknown }).window = {
            showDirectoryPicker: () => {},
            showOpenFilePicker: () => {},
        };
        setStore('config', { fsaRootHandle: {} });
        expect(await getFsaAuthState()).toBe('revoked');
    });
});

describe('fsaAuthPrompt dismissed 标志（adr-177 跳过不再弹）', () => {
    beforeEach(() => resetMem());
    it('默认未跳过；dismiss 后记为已跳过', async () => {
        expect(await isFsaAuthPromptDismissed()).toBe(false);
        await dismissFsaAuthPrompt();
        expect(await isFsaAuthPromptDismissed()).toBe(true);
    });
});

describe('reauthorizeFsaRoot', () => {
    beforeEach(() => resetMem());

    it('无持久化句柄 → 返回 false（不弹权限）', async () => {
        expect(await reauthorizeFsaRoot()).toBe(false);
    });

    it('句柄存在且 requestPermission 返回 granted → 返回 true', async () => {
        const handle = {
            name: 'models',
            queryPermission: async () => 'granted' as PermissionState,
            requestPermission: async () => 'granted' as PermissionState,
        } as unknown as FileSystemDirectoryHandle;
        setStore('config', { fsaRootHandle: handle });
        expect(await reauthorizeFsaRoot()).toBe(true);
    });

    it('requestPermission 返回 prompt（用户拒绝）→ 返回 false', async () => {
        const handle = {
            name: 'models',
            queryPermission: async () => 'granted' as PermissionState,
            requestPermission: async () => 'prompt' as PermissionState,
        } as unknown as FileSystemDirectoryHandle;
        setStore('config', { fsaRootHandle: handle });
        expect(await reauthorizeFsaRoot()).toBe(false);
    });

    it('句柄无 requestPermission 方法 → 返回 false（不抛错）', async () => {
        const handle = {
            name: 'models',
            queryPermission: async () => 'granted' as PermissionState,
        } as unknown as FileSystemDirectoryHandle;
        setStore('config', { fsaRootHandle: handle });
        expect(await reauthorizeFsaRoot()).toBe(false);
    });
});
