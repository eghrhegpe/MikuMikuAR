// @vitest-environment node
// browser-adapter.fsa-conflict.test.ts — FSA 多选同名 PMX 冲突检测与序号后缀（拆自 browser-adapter.test.ts）
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

import { browserAdapter } from './browser-adapter';

const pmxBytes1 = new Uint8Array([1, 2, 3]);
const pmxBytes2 = new Uint8Array([4, 5, 6]);
const tex1 = new Uint8Array([10, 20, 30]);
const tex2 = new Uint8Array([40, 50, 60]);

/**
 * 模拟 _writeModelWithTextures 写入的 IDB 条目。
 * 第一次导入 miku.pmx → stem=miku → encStem=miku
 * 第二次导入同名 miku.pmx → 冲突 → stem=miku (2) → encStem=miku%20(2)
 */
function writeSimulatedImport(
    baseName: string,
    suffixN: number,
    pmxBytes: Uint8Array,
    texBytes: Uint8Array,
    texName: string
): string {
    if (!mem.has('models')) {
        mem.set('models', new Map());
    }
    const store = mem.get('models')!;
    const stem = suffixN === 1 ? baseName : `${baseName} (${suffixN})`;
    const encStem = encodeURIComponent(stem);
    const dirKey = `dir:${encStem}:${texName}`;
    store.set(`file:${encStem}`, pmxBytes);
    store.set(dirKey, texBytes);
    const modelDir = 'web://model';
    const filePath = `${modelDir}/${encStem}`;
    store.set(`entry:${encStem}`, {
        dir: modelDir,
        file_path: filePath,
        name_jp: stem,
        name_en: stem,
        comment: '',
        has_thumb: false,
        type: 'actor',
        format: 'pmx',
        container: 'file',
        zip_inner: '',
        category: '',
        source: '',
        name: stem,
        fileName: `${baseName}.pmx`,
        kind: 'pmx',
        size: pmxBytes.byteLength,
        savedAt: Date.now(),
    });
    return filePath;
}

const eqBytes = (a: Uint8Array | null, b: Uint8Array): boolean =>
    !!a && a.length === b.length && a.every((v, i) => v === b[i]);

describe('FSA 多选同名 PMX 冲突检测与序号后缀', () => {
    beforeEach(() => resetMem());

    it('两次导入同名 PMX → 第二次自动加序号后缀 "(2)"，两个 stem 互不覆盖', async () => {
        const path1 = writeSimulatedImport('miku', 1, pmxBytes1, tex1, 'face.png');
        const path2 = writeSimulatedImport('miku', 2, pmxBytes2, tex2, 'face.png');

        expect(path1).toBe('web://model/miku');
        expect(path2).toBe('web://model/miku%20(2)');
        expect(path1).not.toBe(path2);

        const got1 = await browserAdapter.readFileBytes(path1);
        const got2 = await browserAdapter.readFileBytes(path2);
        expect(eqBytes(got1, pmxBytes1)).toBe(true);
        expect(eqBytes(got2, pmxBytes2)).toBe(true);
        expect(eqBytes(got1, pmxBytes2)).toBe(false);

        const gotTex1 = await browserAdapter.readFileBytes(`${path1}/face.png`);
        const gotTex2 = await browserAdapter.readFileBytes(`${path2}/face.png`);
        expect(eqBytes(gotTex1, tex1)).toBe(true);
        expect(eqBytes(gotTex2, tex2)).toBe(true);
        expect(eqBytes(gotTex1, tex2)).toBe(false);
    });

    it('三次导入同名 PMX → 三次递增后缀 (2), (3)，全不覆盖', async () => {
        const bytes3 = new Uint8Array([7, 8, 9]);
        const tex3 = new Uint8Array([70, 80, 90]);

        const path1 = writeSimulatedImport('miku', 1, pmxBytes1, tex1, 'face.png');
        const path2 = writeSimulatedImport('miku', 2, pmxBytes2, tex2, 'face.png');
        const path3 = writeSimulatedImport('miku', 3, bytes3, tex3, 'face.png');

        expect(path1).toBe('web://model/miku');
        expect(path2).toBe('web://model/miku%20(2)');
        expect(path3).toBe('web://model/miku%20(3)');

        const got1 = await browserAdapter.readFileBytes(path1);
        const got2 = await browserAdapter.readFileBytes(path2);
        const got3 = await browserAdapter.readFileBytes(path3);
        expect(eqBytes(got1, pmxBytes1)).toBe(true);
        expect(eqBytes(got2, pmxBytes2)).toBe(true);
        expect(eqBytes(got3, bytes3)).toBe(true);
    });

    it('不同名 PMX 不触发冲突检测，各自使用原始 stem', async () => {
        const pathA = writeSimulatedImport('miku', 1, pmxBytes1, tex1, 'face.png');
        const pathB = writeSimulatedImport('rin', 1, pmxBytes2, tex2, 'face.png');

        expect(pathA).toBe('web://model/miku');
        expect(pathB).toBe('web://model/rin');
        expect(pathA).not.toBe(pathB);

        const gotA = await browserAdapter.readFileBytes(pathA);
        const gotB = await browserAdapter.readFileBytes(pathB);
        expect(eqBytes(gotA, pmxBytes1)).toBe(true);
        expect(eqBytes(gotB, pmxBytes2)).toBe(true);
    });

    it('手动导入 entry 补全 dir/file_path → 模型库可见（_listModels 不再过滤）', async () => {
        writeSimulatedImport('miku', 1, pmxBytes1, tex1, 'face.png');
        writeSimulatedImport('miku', 2, pmxBytes2, tex2, 'face.png');

        const lib = await browserAdapter.GetLibraryIndex();
        expect(lib.length).toBeGreaterThanOrEqual(2);

        const names = lib.map((e) => e.name_jp);
        expect(names).toContain('miku');
        expect(names).toContain('miku (2)');

        const miku1 = lib.find((e) => e.name_jp === 'miku');
        const miku2 = lib.find((e) => e.name_jp === 'miku (2)');
        expect(miku1?.file_path).toBe('web://model/miku');
        expect(miku2?.file_path).toBe('web://model/miku%20(2)');
    });

    it('IsolateModelDir 对导入路径幂等（已含 web://model/ 则不二次编码）', async () => {
        const path2 = writeSimulatedImport('miku', 2, pmxBytes2, tex2, 'face.png');
        const dir = await browserAdapter.IsolateModelDir(path2);
        expect(dir).toBe(path2);
    });

    it('扫描 entry（dir=web://selected-dir）与手动导入 entry（dir=web://model）无冲突', async () => {
        writeSimulatedImport('miku', 1, pmxBytes1, tex1, 'face.png');

        mem.get('models')?.set('entry:A%2Fmiku', {
            name: 'A/miku',
            fileName: 'miku.pmx',
            kind: 'pmx',
            size: 100,
            savedAt: Date.now(),
            dir: 'web://selected-dir/PMX',
            file_path: 'web://selected-dir/PMX/A/miku.pmx',
        });

        const lib = await browserAdapter.GetLibraryIndex();
        expect(lib.length).toBeGreaterThanOrEqual(2);

        const manualEntry = lib.find((e) => e.name_jp === 'miku');
        expect(manualEntry).toBeDefined();
        expect(manualEntry?.dir).toBe('web://model');
    });
});
