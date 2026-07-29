// [doc:test] ADR-177 Phase 2 A4 p2-5 虚拟目录（拆自 backend.test.ts）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { idbStore, resetIdb } from './backend-mocks';

vi.mock('./go-adapter', () => ({ goAdapter: {} }));
vi.mock('./idb', () => ({
    idbGet: vi.fn(async (_store: string, key: string) => idbStore.get(key)),
    idbSet: vi.fn(async (_store: string, key: string, val: unknown) => { idbStore.set(key, val); }),
    idbDelete: vi.fn(async (_store: string, key: string) => { idbStore.delete(key); }),
    idbKeys: vi.fn(async (_store: string) => Array.from(idbStore.keys())),
    closeIDB: vi.fn(),
}));

import { browserAdapter } from './browser-adapter';

describe('ADR-177 Phase 2 A4 p2-5：虚拟目录 + 伴生文件加载', () => {
    beforeEach(() => {
        resetIdb();
    });

    describe('IsolateModelDir 虚拟目录', () => {
        it('绝对路径 → web://model/<stem>', async () => {
            expect(await browserAdapter.IsolateModelDir('D:/models/Miku.pmx')).toBe(
                'web://model/Miku'
            );
        });
        it('file: 前缀 → web://model/<stem>', async () => {
            expect(await browserAdapter.IsolateModelDir('file:Miku')).toBe('web://model/Miku');
        });
        it('web://selected-dir/ 路径 → 剥离类别段并编码 web://model/<encRelIdStem>', async () => {
            // [bugfix:tex-stem-collision] stem 含路径维度须 encodeURIComponent，
            // 否则不同目录同名 PMX 的 dir: 纹理键会互相覆盖。
            expect(
                await browserAdapter.IsolateModelDir('web://selected-dir/PMX/分类1/miku.pmx')
            ).toBe(`web://model/${encodeURIComponent('分类1/miku')}`);
        });
    });

    describe('ListDirRecursive 扫描 dir: 前缀', () => {
        it('返回带 relativePath 的 FileInfo[]', async () => {
            idbStore.set('dir:Miku:tex/face.png', new Uint8Array([1]));
            idbStore.set('dir:Miku:bg/sky.png', new Uint8Array([2]));
            idbStore.set('dir:Other:foo.png', new Uint8Array([3]));
            const entries = await browserAdapter.ListDirRecursive('web://model/Miku');
            expect(entries).toHaveLength(2);
            expect(entries).toEqual(
                expect.arrayContaining([
                    { name: 'face.png', relativePath: 'tex/face.png' },
                    { name: 'sky.png', relativePath: 'bg/sky.png' },
                ])
            );
        });

        it('无 dir: 条目 → 返回空数组', async () => {
            const entries = await browserAdapter.ListDirRecursive('web://model/Ghost');
            expect(entries).toEqual([]);
        });

        it('FSA stem 含类别前缀 → bare stem fallback 命中', async () => {
            // FSA 扫描存储 bare stem 键 dir:Miku:tex/face.png，
            // 查询 web://model/分类1/Miku 时精确前缀 miss，fallback 到 bare stem
            idbStore.set('dir:Miku:tex/face.png', new Uint8Array([10]));
            idbStore.set('dir:Miku:bg/sky.png', new Uint8Array([20]));
            const entries = await browserAdapter.ListDirRecursive('web://model/分类1/Miku');
            expect(entries).toHaveLength(2);
            expect(entries).toEqual(
                expect.arrayContaining([
                    { name: 'face.png', relativePath: 'tex/face.png' },
                    { name: 'sky.png', relativePath: 'bg/sky.png' },
                ])
            );
        });
    });

    describe('readFileBytes web://model/ 路由', () => {
        it('经虚拟目录路径命中 dir:<stem>:<relPath>', async () => {
            const tex = new Uint8Array([9, 9]);
            idbStore.set('dir:Miku:tex/face.png', tex);
            const r = await browserAdapter.readFileBytes('web://model/Miku/tex/face.png');
            expect(r).toBe(tex);
        });

        it('dir: 未命中时兜底 file:<baseName>', async () => {
            const tex = new Uint8Array([7]);
            idbStore.set('file:face', tex); // ExtractZip 扁平键兜底
            const r = await browserAdapter.readFileBytes('web://model/Miku/tex/face.png');
            expect(r).toBe(tex);
        });

        it('FSA stem 含类别前缀 → bare stem fallback 命中', async () => {
            // 模拟真实链路：ListDirRecursive 返回 bare relativePath（tex/face.png），
            // model-loader 拼接 modelDir + '/' + relativePath 后 readFileBytes 查找
            // FSA 扫描存储 dir:Miku:tex/face.png（bare stem），拼接路径精确命中
            const tex = new Uint8Array([11, 12]);
            idbStore.set('dir:Miku:tex/face.png', tex);
            const r = await browserAdapter.readFileBytes('web://model/分类1/Miku/tex/face.png');
            expect(r).toBe(tex);
        });
    });
});
