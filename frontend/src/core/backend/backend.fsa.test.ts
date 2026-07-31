// [doc:test] FSA 目录扫描嵌套结构（拆自 backend.test.ts）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { idbStore, resetIdb, setWindow, makeIdbMock } from './backend-mocks';

vi.mock('./go-adapter', () => ({ goAdapter: {} }));
vi.mock('./idb', () => makeIdbMock());

import { browserAdapter } from './browser-adapter';

// [doc:test] P1 修复回归：FSA 目录扫描需保留嵌套层级，且不同子目录的同名文件互不覆盖
describe('FSA 目录扫描嵌套结构（保留目录层级 + 同名不覆盖）', () => {
    interface FakeNode {
        name: string;
        kind: 'directory' | 'file';
        bytes?: Uint8Array;
        children?: FakeNode[];
    }
    function buildFakeTree(node: FakeNode): unknown {
        return {
            name: node.name,
            kind: 'directory',
            async *values() {
                for (const c of node.children ?? []) {
                    if (c.kind === 'file') {
                        yield {
                            kind: 'file',
                            name: c.name,
                            getFile: async () => ({
                                arrayBuffer: async () => (c.bytes ?? new Uint8Array()).buffer,
                            }),
                        };
                    } else {
                        yield buildFakeTree(c);
                    }
                }
            },
            async getDirectoryHandle(name: string) {
                const c = (node.children ?? []).find(
                    (x) => x.name === name && x.kind === 'directory'
                );
                if (!c) {
                    throw new Error('no such dir ' + name);
                }
                return buildFakeTree(c);
            },
        };
    }

    beforeEach(() => {
        resetIdb();
    });

    it('嵌套目录 → entry.dir 保留层级，同名 miku.pmx 不互相覆盖', async () => {
        const root = buildFakeTree({
            name: 'models',
            kind: 'directory',
            children: [
                { kind: 'file', name: 'test.pmx', bytes: new Uint8Array([1, 2]) },
                {
                    kind: 'directory',
                    name: '分类1',
                    children: [
                        { kind: 'file', name: 'miku.pmx', bytes: new Uint8Array([3, 4]) },
                        {
                            kind: 'directory',
                            name: 'sub',
                            children: [
                                { kind: 'file', name: 'miku.pmx', bytes: new Uint8Array([5, 6]) },
                            ],
                        },
                    ],
                },
            ],
        }) as FileSystemDirectoryHandle;
        setWindow({ showDirectoryPicker: async () => root });
        await browserAdapter.SelectDir();

        const models = await browserAdapter.GetLibraryIndex();
        const byPath = new Map(models.map((m) => [m.file_path, m]));

        // 根 pmx → web://selected-dir/PMX（扁平子集仍工作）
        expect(byPath.get('web://selected-dir/PMX/test.pmx')?.dir).toBe('web://selected-dir/PMX');
        // 分类1/miku → 嵌套 dir
        const m1 = byPath.get('web://selected-dir/PMX/分类1/miku.pmx');
        expect(m1?.dir).toBe('web://selected-dir/PMX/分类1');
        // 分类1/sub/miku → 更深嵌套，独立 entry（同名不覆盖）
        const m2 = byPath.get('web://selected-dir/PMX/分类1/sub/miku.pmx');
        expect(m2?.dir).toBe('web://selected-dir/PMX/分类1/sub');
        expect(m1).not.toBe(m2);

        // readFileBytes 经类别段剥离正确命中各自字节
        expect(await browserAdapter.readFileBytes('web://selected-dir/PMX/分类1/miku.pmx')).toEqual(
            new Uint8Array([3, 4])
        );
        expect(
            await browserAdapter.readFileBytes('web://selected-dir/PMX/分类1/sub/miku.pmx')
        ).toEqual(new Uint8Array([5, 6]));
    });

    it('[p2b] 子目录纹理 → 按相对 PMX 路径写入 dir:<stem>:<relPath>，readFileBytes 精确命中', async () => {
        const root = buildFakeTree({
            name: 'models',
            kind: 'directory',
            children: [
                {
                    kind: 'directory',
                    name: 'PMX',
                    children: [
                        { kind: 'file', name: 'miku.pmx', bytes: new Uint8Array([9, 9]) },
                        { kind: 'file', name: 'toon.png', bytes: new Uint8Array([1, 1]) },
                        {
                            kind: 'directory',
                            name: 'tex',
                            children: [
                                { kind: 'file', name: 'face.png', bytes: new Uint8Array([2, 2]) },
                            ],
                        },
                    ],
                },
            ],
        }) as FileSystemDirectoryHandle;
        setWindow({ showDirectoryPicker: async () => root });
        await browserAdapter.SelectDir();

        // 子目录纹理按相对 PMX 路径落地：dir:<stem>:<relToPmx>/<name>
        expect(idbStore.get('dir:miku:tex/face.png')).toEqual(new Uint8Array([2, 2]));
        // 同层纹理仍按 basename 落地（相对 PMX 路径为空）：dir:<stem>:<name>
        expect(idbStore.get('dir:miku:toon.png')).toEqual(new Uint8Array([1, 1]));
        // 旧实现错存键 dir:<stem>:<name>（丢子目录）应不存在
        expect(idbStore.get('dir:miku:face.png')).toBeUndefined();

        // 读取侧：web://model/<stem>/<relPath> 精确路由到 dir:<stem>:<relPath>
        expect(await browserAdapter.readFileBytes('web://model/miku/tex/face.png')).toEqual(
            new Uint8Array([2, 2])
        );
        expect(await browserAdapter.readFileBytes('web://model/miku/toon.png')).toEqual(
            new Uint8Array([1, 1])
        );
    });

    it('[adr-180] SelectDir 后持久化 fsaRootHandle 到 IndexedDB', async () => {
        const root = buildFakeTree({
            name: 'models',
            kind: 'directory',
            children: [{ kind: 'file', name: 'm.pmx', bytes: new Uint8Array([1]) }],
        });
        setWindow({ showDirectoryPicker: async () => root });
        await browserAdapter.SelectDir();
        expect(idbStore.get('fsaRootHandle')).toBe(root);
    });

    it('[adr-180] ScanModelDir 从持久化句柄自动重扫，覆盖旧塌缩 entry', async () => {
        // 隔离模块状态：fresh import 使 _fsaRootHandle 重置为 null，专测「恢复」路径。
        vi.resetModules();
        const { browserAdapter: fresh } = await import('./browser-adapter');
        const root = buildFakeTree({
            name: 'models',
            kind: 'directory',
            children: [
                {
                    kind: 'directory',
                    name: 'PMX',
                    children: [{ kind: 'file', name: 'miku.pmx', bytes: new Uint8Array([9, 9]) }],
                },
            ],
        }) as FileSystemDirectoryHandle & {
            queryPermission: (o: { mode: string }) => Promise<string>;
        };
        root.queryPermission = async () => 'granted';
        // 预置持久化句柄 + 一个旧版塌缩 entry（平铺、字段齐全，_listModels 过滤不掉）。
        idbStore.set('fsaRootHandle', root);
        idbStore.set('entry:foo', {
            dir: 'web://selected-dir/PMX',
            file_path: 'web://selected-dir/PMX/foo.pmx',
            name: 'foo',
            fileName: 'foo.pmx',
            type: 'actor',
            format: 'pmx',
            container: 'file',
            kind: 'pmx',
            size: 1,
            savedAt: Date.now(),
        });
        const models = await fresh.ScanModelDir();
        // 根重扫先清旧：旧平铺 entry 必须消失
        expect(idbStore.get('entry:foo')).toBeUndefined();
        // 新嵌套 entry 来自重扫
        const byPath = new Map(models.map((m) => [m.file_path, m]));
        expect(byPath.get('web://selected-dir/PMX/miku.pmx')?.dir).toBe('web://selected-dir/PMX');
    });

    it('[adr-180] 根重扫不误删用户导入模型（无 dir 的 import entry 与 file:/dir: 保留）', async () => {
        const root = buildFakeTree({
            name: 'models',
            kind: 'directory',
            children: [{ kind: 'file', name: 'm.pmx', bytes: new Uint8Array([1]) }],
        });
        setWindow({ showDirectoryPicker: async () => root });
        // 预置用户导入模型（SelectImportFile 写入：entry 无 dir，file:/dir: 与扫描同命名空间）。
        idbStore.set('entry:importedMiku', {
            file_path: 'web://import/importedMiku.pmx',
            name: 'importedMiku',
            fileName: 'importedMiku.pmx',
            type: 'actor',
            format: 'pmx',
            container: 'file',
            kind: 'pmx',
            size: 2,
            savedAt: Date.now(),
        });
        idbStore.set('file:importedMiku', new Uint8Array([7, 7]));
        idbStore.set('dir:importedMiku:toon.png', new Uint8Array([8, 8]));

        await browserAdapter.SelectDir(); // 触发根重扫（清旧）

        // 导入模型索引 entry 必须保留（无 dir → 不被 _clearScannedEntries 命中）
        expect(idbStore.get('entry:importedMiku')).toBeDefined();
        // 导入模型字节与纹理保留
        expect(idbStore.get('file:importedMiku')).toEqual(new Uint8Array([7, 7]));
        expect(idbStore.get('dir:importedMiku:toon.png')).toEqual(new Uint8Array([8, 8]));
        // FSA 扫描写入的新 entry 同时存在
        expect(idbStore.get('entry:m')).toBeDefined();
    });
});
