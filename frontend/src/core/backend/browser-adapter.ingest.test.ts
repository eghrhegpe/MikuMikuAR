// @vitest-environment node
// browser-adapter.ingest.test.ts — 下载文件夹统一摄入（拆自 browser-adapter.test.ts）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mem, resetMem } from './browser-adapter-mocks';

vi.mock('./idb', () => ({
    idbGet: async (store: string, key: string) => mem.get(store)?.get(key) ?? undefined,
    idbSet: async (store: string, key: string, value: unknown) => {
        if (!mem.has(store)) {
            mem.set(store, new Map());
        }
        mem.get(store)!.set(key, value);
    },
    idbKeys: async (store: string) => [...(mem.get(store)?.keys() ?? [])],
    idbDelete: async (store: string, key: string) => {
        mem.get(store)?.delete(key);
    },
    idbBatchSet: async (store: string, entries: [string, unknown][]) => {
        if (!mem.has(store)) {
            mem.set(store, new Map());
        }
        for (const [k, v] of entries) {
            mem.get(store)!.set(k, v);
        }
    },
    openDB: async () => ({}) as unknown,
    closeIDB: () => {},
}));

import {
    browserAdapter,
    ingestModelFile,
    ingestModelBytes,
    ingestModelFiles,
} from './browser-adapter';

const mkFile = (name: string, bytes: number[]): File => new File([new Uint8Array(bytes)], name);

describe('[doc:adr-195] 下载文件夹统一摄入：ingestModelFile / ingestModelBytes / ingestModelFiles', () => {
    beforeEach(() => resetMem());

    it('ingestModelBytes(pmx) 写入 file:<encStem>+entry:<encStem>，且入库可见（不进场景）', async () => {
        const loadPath = await ingestModelBytes('miku.pmx', new Uint8Array([1, 2, 3]));

        expect(loadPath).toBe('web://model/miku');

        const stored = mem.get('models')?.get('file:miku');
        expect(stored).toBeInstanceOf(Uint8Array);
        expect(Array.from(stored as Uint8Array)).toEqual([1, 2, 3]);

        const entry = mem.get('models')?.get('entry:miku') as {
            dir: string;
            file_path: string;
            kind: string;
        };
        expect(entry).toBeDefined();
        expect(entry.dir).toBe('web://model');
        expect(entry.file_path).toBe('web://model/miku');
        expect(entry.kind).toBe('pmx');

        const lib = await browserAdapter.GetLibraryIndex();
        const found = lib.find((e) => e.name_jp === 'miku');
        expect(found).toBeDefined();
        expect(found?.dir).toBe('web://model');
    });

    it('ingestModelFile(pmx, File 形态) 行为与 bytes 形态一致', async () => {
        const loadPath = await ingestModelFile(mkFile('miku.pmx', [4, 5, 6]));
        expect(loadPath).toBe('web://model/miku');
        expect(Array.from(mem.get('models')?.get('file:miku') as Uint8Array)).toEqual([4, 5, 6]);
        expect((mem.get('models')?.get('entry:miku') as { kind: string }).kind).toBe('pmx');
    });

    it('ingestModelFiles 批量单事务写入：pmx/vmd/zip 全部落库，且不触发 loadManager.load', async () => {
        const count = await ingestModelFiles([
            { name: 'miku.pmx', bytes: new Uint8Array([1]) },
            { name: 'dance.vmd', bytes: new Uint8Array([2]) },
            { name: 'pack.zip', bytes: new Uint8Array([3]) },
        ]);

        expect(count).toBe(3);

        expect(mem.get('models')?.has('file:miku')).toBe(true);
        expect(mem.get('models')?.has('entry:miku')).toBe(true);
        expect((mem.get('models')?.get('entry:miku') as { kind: string }).kind).toBe('pmx');

        expect(mem.get('models')?.has('file:dance')).toBe(true);
        expect(mem.get('models')?.has('entry:dance')).toBe(false);

        expect(mem.get('models')?.has('file:pack')).toBe(true);
        expect((mem.get('models')?.get('entry:pack') as { kind: string }).kind).toBe('zip');
    });

    it('同名 PMX 冲突追加序号后缀，不覆盖既有 entry', async () => {
        await ingestModelBytes('miku.pmx', new Uint8Array([1]));
        await ingestModelBytes('miku.pmx', new Uint8Array([2]));

        expect(Array.from(mem.get('models')?.get('file:miku') as Uint8Array)).toEqual([1]);
        expect(mem.get('models')?.has('file:miku%20(2)')).toBe(true);
        expect(mem.get('models')?.has('entry:miku%20(2)')).toBe(true);

        const lib = await browserAdapter.GetLibraryIndex();
        const names = lib.filter((e) => e.name_jp?.startsWith('miku')).map((e) => e.name_jp);
        expect(names).toContain('miku');
        expect(names).toContain('miku (2)');
    });
});
