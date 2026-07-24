// [doc:test] ADR-177 Phase 2 A4 — drop 导入闭环单测
//
// 覆盖 handleDroppedFile 浏览器分支语义：
// - desktop path → 走原生 handleDropFile，不写 IndexedDB
// - 浏览器 pmx/zip/vmd → 字节落地 file:<name> + 触发 loadManager.load
// - 错误路径不崩溃（catch → setStatus 失败消息）
import { describe, it, expect, beforeEach, vi } from 'vitest';

// —— mock 依赖（vi.hoisted 保证 mock 对象在 vi.mock 工厂执行前已初始化）——
const { loadManagerMock, ImportZipMock, ExtractZipMock, idbSetMock, saveModelMock } = vi.hoisted(
    () => ({
        loadManagerMock: { load: vi.fn(async () => null) },
        ImportZipMock: vi.fn(async () => undefined),
        ExtractZipMock: vi.fn(async () => ({ file_path: 'Miku.pmx' })),
        idbSetMock: vi.fn(async () => {}),
        saveModelMock: vi.fn(async () => {}),
    })
);

vi.mock('../load-manager', () => ({ loadManager: loadManagerMock }));

vi.mock('../wails-bindings', () => ({
    ImportZip: ImportZipMock,
    ExtractZip: ExtractZipMock,
}));

vi.mock('../backend/idb', () => ({ idbSet: idbSetMock, saveModel: saveModelMock }));

vi.mock('../config', () => ({
    setStatus: vi.fn(),
    formatError: vi.fn((e: unknown) => String(e)),
}));

vi.mock('../i18n/t', () => ({ t: vi.fn((k: string) => k) }));

vi.mock('../safe-call', () => ({
    safeCallAsync: vi.fn(async () => {}),
}));

vi.mock('../../menus/library', () => ({
    refreshLibrary: vi.fn(async () => {}),
}));

import { handleDroppedFile, handleDropFile } from '../drop-import';

/** 构造测试 File，可选注入桌面 path（Wails desktop 才有）。 */
function makeFile(name: string, bytes: Uint8Array, path?: string): File {
    const f = new File([bytes as BlobPart], name);
    if (path) {
        (f as File & { path?: string }).path = path;
    }
    return f;
}

describe('handleDroppedFile 桌面分支（file.path 存在）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('走 handleDropFile(path)，不写 IndexedDB', async () => {
        const f = makeFile('Miku.pmx', new Uint8Array([1, 2]), 'D:/models/Miku.pmx');
        await handleDroppedFile(f);
        expect(idbSetMock).not.toHaveBeenCalled();
        expect(loadManagerMock.load).toHaveBeenCalledWith({
            kind: 'actor',
            path: 'D:/models/Miku.pmx',
        });
    });

    it('桌面 zip 走 ImportZip（非 ExtractZip）', async () => {
        const f = makeFile('pack.zip', new Uint8Array([1]), 'D:/pack.zip');
        await handleDroppedFile(f);
        expect(ImportZipMock).toHaveBeenCalledWith('D:/pack.zip');
        expect(ExtractZipMock).not.toHaveBeenCalled();
        expect(idbSetMock).not.toHaveBeenCalled();
    });
});

describe('handleDroppedFile 浏览器分支（无 file.path）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('非支持后缀 → 直接 return，不触发任何依赖', async () => {
        const f = makeFile('readme.txt', new Uint8Array([0]));
        await handleDroppedFile(f);
        expect(idbSetMock).not.toHaveBeenCalled();
        expect(saveModelMock).not.toHaveBeenCalled();
        expect(loadManagerMock.load).not.toHaveBeenCalled();
    });

    it('pmx → idbSet file:<name> + saveModel(pmx) + loadManager.load(actor)', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const f = makeFile('Miku.pmx', bytes);
        await handleDroppedFile(f);
        expect(idbSetMock).toHaveBeenCalledWith('models', 'file:Miku', bytes);
        expect(saveModelMock).toHaveBeenCalledWith('Miku.pmx', bytes, 'pmx');
        expect(loadManagerMock.load).toHaveBeenCalledWith({
            kind: 'actor',
            path: 'Miku.pmx',
        });
    });

    it('vmd → idbSet file:<name> + loadManager.load(vmd)，不调 saveModel', async () => {
        const bytes = new Uint8Array([4, 5]);
        const f = makeFile('dance.vmd', bytes);
        await handleDroppedFile(f);
        expect(idbSetMock).toHaveBeenCalledWith('models', 'file:dance', bytes);
        expect(saveModelMock).not.toHaveBeenCalled();
        expect(loadManagerMock.load).toHaveBeenCalledWith({
            kind: 'vmd',
            path: 'dance.vmd',
        });
    });

    it('zip → saveModel(zip) + ExtractZip + loadManager.load(actor, file_path)', async () => {
        const bytes = new Uint8Array([6, 7, 8]);
        const f = makeFile('pack.zip', bytes);
        await handleDroppedFile(f);
        expect(saveModelMock).toHaveBeenCalledWith('pack.zip', bytes, 'zip');
        expect(ExtractZipMock).toHaveBeenCalledWith('pack.zip', '');
        expect(loadManagerMock.load).toHaveBeenCalledWith({
            kind: 'actor',
            path: 'Miku.pmx',
        });
        // 浏览器 zip 分支不直接 idbSet（由 ExtractZip 内部落地）
        expect(idbSetMock).not.toHaveBeenCalled();
    });

    it('文件名含路径分隔符 → idbSet 用去扩展名的 stem', async () => {
        // 模拟某些浏览器给 file.name 带相对路径的边界情况
        const bytes = new Uint8Array([1]);
        const f = makeFile('sub/Miku.pmx', bytes);
        await handleDroppedFile(f);
        // file.name 是 'sub/Miku.pmx'，replace 只去 .pmx → name = 'sub/Miku'
        expect(idbSetMock).toHaveBeenCalledWith('models', 'file:sub/Miku', bytes);
    });
});

describe('handleDropFile 直接调用（路径已落地）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('zip 无 bytes → ImportZip(path)（桌面分支）', async () => {
        await handleDropFile('D:/pack.zip');
        expect(ImportZipMock).toHaveBeenCalledWith('D:/pack.zip');
        expect(ExtractZipMock).not.toHaveBeenCalled();
    });

    it('pmx → loadManager.load(actor)', async () => {
        await handleDropFile('Miku.pmx');
        expect(loadManagerMock.load).toHaveBeenCalledWith({
            kind: 'actor',
            path: 'Miku.pmx',
        });
    });

    it('vmd → loadManager.load(vmd)', async () => {
        await handleDropFile('dance.vmd');
        expect(loadManagerMock.load).toHaveBeenCalledWith({
            kind: 'vmd',
            path: 'dance.vmd',
        });
    });

    it('未知后缀 → 无操作', async () => {
        await handleDropFile('readme.txt');
        expect(loadManagerMock.load).not.toHaveBeenCalled();
        expect(ImportZipMock).not.toHaveBeenCalled();
    });

    it('zip + bytes 且 ExtractZip 抛错 → 不崩溃，不触发 load', async () => {
        ExtractZipMock.mockRejectedValueOnce(new Error('zip boom'));
        await handleDropFile('pack.zip', new Uint8Array([1]));
        // catch 吞错，不抛出
        expect(loadManagerMock.load).not.toHaveBeenCalled();
    });

    it('pmx 加载抛错 → 不崩溃', async () => {
        loadManagerMock.load.mockRejectedValueOnce(new Error('pmx boom'));
        await handleDropFile('Miku.pmx');
        // 不抛出，已被 catch 处理
        expect(loadManagerMock.load).toHaveBeenCalled();
    });
});
