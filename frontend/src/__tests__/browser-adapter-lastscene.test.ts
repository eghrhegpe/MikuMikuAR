// @vitest-environment node
// browser-adapter SaveLastScene / LoadLastScene — [audit:fix 2026-10] logWarn catch 分支覆盖
//
// 覆盖目标（browser-adapter.ts L1769-1792）：
//   SaveLastScene  L1774-1776: localStorage.setItem throws → logWarn('browser-adapter', 'LAST_SCENE 镜像写入失败…')
//   LoadLastScene  L1787-1790: localStorage.getItem throws  → logWarn('browser-adapter', 'LAST_SCENE 镜像读取失败…')
//
// Mock 面：
//   @/core/backend/idb   — 6 个 vi.fn()（文件级 vi.mock 覆盖 setup-wails.ts 的 makeIdbMock）
//   @/core/logger        — logWarn vi.fn()（vi.hoisted 范式，同 camera.test.ts）
//   globalThis.localStorage — fake { setItem, getItem }（node 环境无原生 localStorage）
import { describe, it, expect, vi, beforeEach } from 'vitest';

const shared = vi.hoisted(() => {
    const logWarn = vi.fn();
    const idbGet = vi.fn();
    const idbSet = vi.fn().mockResolvedValue(undefined);
    const idbDelete = vi.fn().mockResolvedValue(undefined);
    const idbKeys = vi.fn().mockResolvedValue([] as string[]);
    const idbBatchSet = vi.fn().mockResolvedValue(undefined);
    const closeIDB = vi.fn().mockResolvedValue(undefined);
    return { logWarn, idbGet, idbSet, idbDelete, idbKeys, idbBatchSet, closeIDB };
});

vi.mock('@/core/backend/idb', () => ({
    idbGet: shared.idbGet,
    idbSet: shared.idbSet,
    idbDelete: shared.idbDelete,
    idbKeys: shared.idbKeys,
    idbBatchSet: shared.idbBatchSet,
    closeIDB: shared.closeIDB,
}));

vi.mock('@/core/logger', () => ({
    logWarn: shared.logWarn,
}));

// fake localStorage — browser-adapter.ts 内直接调 globalThis.localStorage
const fakeStorage = {
    _store: new Map<string, string>(),
    setItem(k: string, v: string) {
        this._store.set(k, v);
    },
    getItem(k: string) {
        return this._store.has(k) ? this._store.get(k)! : null;
    },
};

beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage);
    fakeStorage._store.clear();
    shared.logWarn.mockReset();
    shared.idbGet.mockReset();
    shared.idbSet.mockClear();
});

// 从 browser-adapter.ts 导入被测模块（该文件同时 import fflate / gpu-capabilities / goerr，
// 均安全执行：gpu-capabilities.detectKtx2Support 在 node 下返回 {supported:false}）
import { browserAdapter } from '@/core/backend/browser-adapter';

const MIRROR_KEY = 'mikumikuar:last_scene_mirror';

describe('browserAdapter SaveLastScene / LoadLastScene', () => {
    it('SaveLastScene 正常：setItem ok + idbSet 被调 + logWarn 未调', async () => {
        await browserAdapter.SaveLastScene('{"scene":1}');

        expect(fakeStorage._store.get(MIRROR_KEY)).toBe('{"scene":1}');
        expect(shared.idbSet).toHaveBeenCalledWith('scenes', 'last_scene', '{"scene":1}');
        expect(shared.logWarn).not.toHaveBeenCalled();
    });

    it('SaveLastScene 镜像写失败：setItem throws → logWarn 含「镜像写入失败」+ idbSet 仍被调', async () => {
        const origSetItem = fakeStorage.setItem;
        fakeStorage.setItem = vi.fn().mockImplementation(() => {
            throw new DOMException('quota exceeded', 'QuotaExceededError');
        });

        await browserAdapter.SaveLastScene('{"scene":2}');

        expect(shared.logWarn).toHaveBeenCalledTimes(1);
        const [tag, msg, err] = shared.logWarn.mock.calls[0] as [string, string, unknown];
        expect(tag).toBe('browser-adapter');
        expect(msg).toContain('镜像写入失败');
        expect(err).toBeInstanceOf(DOMException);
        // 主路径不受影响：idbSet 仍被调
        expect(shared.idbSet).toHaveBeenCalledWith('scenes', 'last_scene', '{"scene":2}');

        fakeStorage.setItem = origSetItem;
    });

    it('LoadLastScene 主路径命中：idbGet→"x" 返回 "x"，localStorage.getItem 未调', async () => {
        shared.idbGet.mockResolvedValueOnce('x');
        const getItemSpy = vi.fn();
        fakeStorage.getItem = getItemSpy;

        const result = await browserAdapter.LoadLastScene();

        expect(result).toBe('x');
        expect(shared.idbGet).toHaveBeenCalledWith('scenes', 'last_scene');
        // 主路径命中 → 不走镜像 → getItem 不应被调
        expect(getItemSpy).not.toHaveBeenCalled();
    });

    it("LoadLastScene 镜像兜底读失败：idbGet→null + getItem throws → 返回 '' + logWarn 含「镜像读取失败」", async () => {
        shared.idbGet.mockResolvedValueOnce(null);
        const origGetItem = fakeStorage.getItem;
        fakeStorage.getItem = vi.fn().mockImplementation(() => {
            throw new Error('storage unavailable');
        });

        const result = await browserAdapter.LoadLastScene();

        expect(result).toBe('');
        expect(shared.logWarn).toHaveBeenCalledTimes(1);
        const [tag, msg] = shared.logWarn.mock.calls[0] as [string, string];
        expect(tag).toBe('browser-adapter');
        expect(msg).toContain('镜像读取失败');

        fakeStorage.getItem = origGetItem;
    });

    it('LoadLastScene 镜像兜底正常：idbGet→null + getItem→"mirror" → 返回 "mirror" + logWarn 未调', async () => {
        shared.idbGet.mockResolvedValueOnce(null);
        const origGetItem = fakeStorage.getItem;
        fakeStorage.getItem = vi.fn().mockReturnValue('mirror');

        const result = await browserAdapter.LoadLastScene();

        expect(result).toBe('mirror');
        expect(shared.logWarn).not.toHaveBeenCalled();

        fakeStorage.getItem = origGetItem;
    });
});
