// @ts-nocheck — vi.mock 运行时替换（见 ./library-core-mocks）
// [doc:perf] library-core 测试合并（原 6 文件：build-level / model-to-resource / model-to-row /
// path-boundary / resource-items / subdir-file）。
// 合并动机：vitest isolate 模式下每文件重复加载同一批依赖图（同先例 model-detail-ui 3→1、
// model-preset 5→1、material-editor 4→1）。6 文件 vi.mock 列表完全同构，合并后只付一次。
// 调整说明：
//  - 6 文件各自的 mockState（结构完全一致）合并为一个共享实例；capturedSlideRows 合并为一个。
//  - status-bar 统一为委托版（subdir-file 原版）：setStatus 转发到 config.setStatus，
//    供 importFile 断言；其余 5 文件的用例不依赖 status-bar 行为，委托版无影响。
//  - ui-helpers 统一为 uiHelpersFactory(capturedSlideRows) capture 版（build-level 原版）：
//    extractLevelRows 依赖 capturedRows 收集；capture 版对不读 capturedRows 的文件无副作用。
//  - 各 describe 的 beforeEach 清理组合为顶层一份（一次性清全部 mockState 字段 + capturedSlideRows）；
//    importFile / Resource View Mode / modelToRow.label 子 describe 自带的 beforeEach 保留。
//  - i18n beforeAll（bundles['zh-CN'] = zhCN）重复两份，保留一份。
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import {
    sceneFactory,
    wailsBindingsFactory,
    loadManagerFactory,
    modelDetailFactory,
    sceneMenuFactory,
    menuFactory,
    iconsFactory,
    configModuleFactory,
    libraryPathFactory,
    uiHelpersFactory,
    makeModel,
    extractLevelRows,
} from './library-core-mocks';
import { bundles } from '../core/i18n/t';
import { zhCN } from '../core/i18n/locales/zh-CN';

const mockState = vi.hoisted(() => ({
    allModels: [] as any[],
    libraryRoot: '/test/root',
    displayNamePriority: 'filename' as string,
    librarySortMode: 'default' as string,
    modelMetaCache: new Map<string, any>(),
    recentModels: [] as string[],
    focusedModelId: null as string | null,
}));
const capturedSlideRows = vi.hoisted(() => [] as any[]);

vi.mock('../scene/scene', () => sceneFactory());
vi.mock('../core/wails-bindings', () => wailsBindingsFactory());
vi.mock('../core/load-manager', () => loadManagerFactory());
vi.mock('./model-detail', () => modelDetailFactory());
vi.mock('../menus/scene-menu', () => sceneMenuFactory());
vi.mock('./menu', () => menuFactory());
vi.mock('../core/icons', () => iconsFactory());
// status-bar 委托到 config.setStatus: importFile 通过 withLoadingStatus 调用 status-bar
// （原 subdir-file 委托版；其余 5 文件原用 statusBarFactory() 独立版，用例不依赖其行为）
vi.mock('../core/status-bar', async () => {
    const config = await import('../core/config');
    return { setStatus: (...args: any[]) => (config as any).setStatus(...args) };
});
vi.mock('../core/ui-helpers', () => uiHelpersFactory(capturedSlideRows));
vi.mock('../core/config', () => configModuleFactory(mockState));
vi.mock('@/core/library-path', () => libraryPathFactory(mockState));
vi.mock('../menus/library-setup', () => ({
    refreshLibrary: vi.fn().mockResolvedValue(undefined),
    initLibrary: vi.fn(),
    selectResourceRoot: vi.fn(),
    selectOverridePath: vi.fn(),
    switchStorageMode: vi.fn(),
    rescanAndSync: vi.fn(),
    reloadConfig: vi.fn(),
}));

import {
    buildLevel,
    modelToResourceItem,
    modelToRow,
    getRelativePathUnderDir,
    splitSubdirSegments,
    buildResourceItemsForDir,
    isLeafFlattenDir,
    resolveDisplayBrowseDir,
    computeRestoreSegments,
    importFile,
    getResourceViewMode,
    setResourceViewMode,
} from '../menus/library-core';
import { isUnderRoot } from '../core/path';
import { normPath } from '../core/fileservice';

// [doc:perf] 语言包改为运行时加载，测试环境直接预填缓存
beforeAll(() => {
    bundles['zh-CN'] = zhCN;
});

// 组合各 describe 的 beforeEach 清理（build-level 清 allModels/libraryRoot/librarySortMode
// + capturedSlideRows；model-to-resource/model-to-row/resource-items 清
// displayNamePriority + modelMetaCache.clear()），顶层一次性清全部字段。
beforeEach(() => {
    mockState.allModels = [];
    mockState.libraryRoot = '/test/root';
    mockState.displayNamePriority = 'filename';
    mockState.librarySortMode = 'default';
    mockState.modelMetaCache.clear();
    mockState.recentModels = [];
    mockState.focusedModelId = null;
    capturedSlideRows.length = 0;
});

describe('buildLevel', () => {
    it('returns a PopupLevel with correct label and dir', () => {
        const level = buildLevel('/test/root/models', 'My Models');
        expect(level.label).toBe('My Models');
        expect(level.dir).toBe('/test/root/models');
    });

    it('creates model rows for items directly in directory', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/root/models/a.pmx', dir: '/test/root/models' }),
            makeModel({ file_path: '/test/root/models/b.pmx', dir: '/test/root/models' }),
        ];

        const level = buildLevel('/test/root/models', 'Models');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(2);
        expect(rows[0].label).toBe('a.pmx');
        expect(rows[1].label).toBe('b.pmx');
    });

    it('creates folder entries for subdirectories when at root level', () => {
        mockState.libraryRoot = '/test/root/models';
        mockState.allModels = [
            makeModel({ file_path: '/test/root/models/sub/a.pmx', dir: '/test/root/models/sub' }),
        ];

        const level = buildLevel('/test/root/models', 'Models');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(1);
        expect(rows[0].label).toBe('sub');
        expect(rows[0].isFolder).toBe(true);
    });

    it('flattens leaf-nonzip subdirs into model rows when not at root', () => {
        mockState.libraryRoot = '/test/lib';
        mockState.allModels = [
            makeModel({
                file_path: '/test/models/sub/a.pmx',
                dir: '/test/models/sub',
                container: 'file',
            }),
        ];

        const level = buildLevel('/test/models', 'Models', (m: any) => m.format === 'pmx');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(1);
        expect(rows[0].label).toBe('a.pmx');
        expect(rows[0].isFolder).toBeFalsy();
    });

    it('flattens leaf subdir with single zip model into model row', () => {
        mockState.libraryRoot = '/test/lib';
        mockState.allModels = [
            makeModel({
                file_path: '/test/models/sub/a.pmx',
                dir: '/test/models/sub',
                container: 'zip',
                format: 'pmx',
            }),
        ];

        const level = buildLevel('/test/models', 'Models', (m: any) => m.format === 'pmx');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(1);
        expect(rows[0].label).toBe('a.pmx');
        expect(rows[0].isFolder).toBeFalsy();
    });

    it('keeps leaf subdir as folder when multiple zip models inside', () => {
        mockState.libraryRoot = '/test/lib';
        mockState.allModels = [
            makeModel({
                file_path: '/test/models/sub/a.pmx',
                dir: '/test/models/sub',
                container: 'zip',
                format: 'pmx',
            }),
            makeModel({
                file_path: '/test/models/sub/b.pmx',
                dir: '/test/models/sub',
                container: 'zip',
                format: 'pmx',
            }),
        ];

        const level = buildLevel('/test/models', 'Models', (m: any) => m.format === 'pmx');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(1);
        expect(rows[0].label).toBe('sub');
        expect(rows[0].isFolder).toBe(true);
    });

    it('returns empty rows for empty directory', () => {
        const level = buildLevel('/test/root/empty', 'Empty');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(0);
    });

    it('prepends extraFolders as plug-icon folder entries', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/root/models/a.pmx', dir: '/test/root/models' }),
        ];

        const level = buildLevel('/test/root/models', 'Models', undefined, undefined, [
            { label: 'External Lib', path: '/external/path' },
        ]);
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows[0].label).toBe('External Lib');
        expect(rows[0].icon).toBe('plug');
        expect(rows[0].isFolder).toBe(true);
    });

    it('sorts by label when librarySortMode=name', () => {
        mockState.librarySortMode = 'name';
        mockState.allModels = [
            makeModel({ file_path: '/test/z.pmx', dir: '/test' }),
            makeModel({ file_path: '/test/a.pmx', dir: '/test' }),
            makeModel({ file_path: '/test/m.pmx', dir: '/test' }),
        ];

        const level = buildLevel('/test', 'Test');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(3);
        expect(rows[0].label).toBe('a.pmx');
        expect(rows[1].label).toBe('m.pmx');
        expect(rows[2].label).toBe('z.pmx');
    });

    it('applies filter to exclude non-matching models', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/a.pmx', dir: '/test', format: 'pmx' }),
            makeModel({ file_path: '/test/b.vmd', dir: '/test', format: 'vmd' }),
            makeModel({ file_path: '/test/c.pmx', dir: '/test', format: 'pmx' }),
        ];

        const level = buildLevel('/test', 'PMX', (m: any) => m.format === 'pmx');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(2);
        expect(rows[0].label).toBe('a.pmx');
        expect(rows[1].label).toBe('c.pmx');
    });

    it('handles mixed direct models and subdir folders when browsed at root', () => {
        mockState.libraryRoot = '/test';
        mockState.allModels = [
            makeModel({ file_path: '/test/root.pmx', dir: '/test' }),
            makeModel({ file_path: '/test/sub/a.pmx', dir: '/test/sub' }),
        ];

        const level = buildLevel('/test', 'Root');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(2);
        const modelRow = rows.find((r: any) => !r.isFolder);
        const folderRow = rows.find((r: any) => r.isFolder);
        expect(modelRow).toBeDefined();
        expect(modelRow.label).toBe('root.pmx');
        expect(folderRow).toBeDefined();
        expect(folderRow.label).toBe('sub');
    });

    it('preserves default iteration order when librarySortMode=default', () => {
        mockState.librarySortMode = 'default';
        mockState.allModels = [
            makeModel({ file_path: '/test/b.pmx', dir: '/test' }),
            makeModel({ file_path: '/test/c.pmx', dir: '/test' }),
            makeModel({ file_path: '/test/a.pmx', dir: '/test' }),
        ];

        const level = buildLevel('/test', 'Test');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows[0].label).toBe('b.pmx');
        expect(rows[1].label).toBe('c.pmx');
        expect(rows[2].label).toBe('a.pmx');
    });

    it('does NOT create a phantom folder when dir is a string-prefix but not a path-component boundary', () => {
        mockState.libraryRoot = '/test/root';
        mockState.allModels = [
            makeModel({ file_path: '/test/root/PMXSub/a.pmx', dir: '/test/root/PMXSub' }),
        ];

        const level = buildLevel('/test/root/PMX', 'PMX');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(0);
        expect(rows.some((r: any) => r.label === 'Sub')).toBe(false);
    });

    it('preserves sorted order for multiple non-leaf subdirs (not reversed)', () => {
        mockState.libraryRoot = '/test';
        mockState.allModels = [
            makeModel({ file_path: '/test/models/alpha/deep/a.pmx', dir: '/test/models/alpha/deep' }),
            makeModel({ file_path: '/test/models/beta/deep/b.pmx', dir: '/test/models/beta/deep' }),
            makeModel({ file_path: '/test/models/gamma/deep/c.pmx', dir: '/test/models/gamma/deep' }),
        ];
        const level = buildLevel('/test/models', 'Models');
        const rows = extractLevelRows(level, capturedSlideRows);
        const folders = rows.filter((r: any) => r.isFolder);
        expect(folders).toHaveLength(3);
        expect(folders[0].label).toBe('alpha');
        expect(folders[1].label).toBe('beta');
        expect(folders[2].label).toBe('gamma');
    });

    it('does NOT create a ":" phantom folder when dir is a drive-letter-only prefix', () => {
        mockState.libraryRoot = 'C:';
        mockState.allModels = [
            makeModel({
                file_path: 'C:/Users/foo/Models/PMX/Sub/x.pmx',
                dir: 'C:/Users/foo/Models/PMX/Sub',
            }),
        ];

        const level = buildLevel('C', 'C');
        const rows = extractLevelRows(level, capturedSlideRows);
        expect(rows).toHaveLength(0);
        expect(rows.some((r: any) => r.label === ':')).toBe(false);
    });
});

describe('modelToResourceItem', () => {
    it('returns correct id and label for plain pmx', () => {
        const model = makeModel({
            file_path: '/test/a.pmx',
            dir: '/test',
        });
        const item = modelToResourceItem(model);
        expect(item.id).toBe('/test/a.pmx');
        expect(item.label).toBe('a.pmx');
        expect(item.filePath).toBe('/test/a.pmx');
        expect(item.isFolder).toBe(false);
        expect(item.icon).toBe('box');
    });

    it('returns archive icon for zip+pmx', () => {
        const model = makeModel({
            file_path: '/test/m.zip',
            dir: '/test',
            container: 'zip',
            zip_inner: 'm.pmx',
        });
        const item = modelToResourceItem(model);
        expect(item.icon).toBe('archive');
        expect(item.label).toBe('m.pmx');
    });

    it('returns music icon for vmd', () => {
        const model = makeModel({
            file_path: '/test/m.vmd',
            dir: '/test',
            format: 'vmd',
        });
        const item = modelToResourceItem(model);
        expect(item.icon).toBe('music');
    });

    it('returns volume-2 icon for audio', () => {
        const model = makeModel({
            file_path: '/test/m.wav',
            dir: '/test',
            format: 'audio',
        });
        const item = modelToResourceItem(model);
        expect(item.icon).toBe('volume-2');
    });

    it('returns user icon for vpd', () => {
        const model = makeModel({
            file_path: '/test/m.vpd',
            dir: '/test',
            format: 'vpd',
        });
        const item = modelToResourceItem(model);
        expect(item.icon).toBe('user');
    });

    it.each(['name_en', 'name_jp'])(
        'always uses filename as label regardless of displayNamePriority=%s',
        (priority) => {
            mockState.displayNamePriority = priority as any;
            const model = makeModel({
                file_path: '/test/a.pmx',
                dir: '/test',
            });
            const item = modelToResourceItem(model);
            expect(item.label).toBe('a.pmx');
        }
    );

    it('cached metadata does not affect label (source resolveModelLabel 不读缓存，仍用文件名)', () => {
        mockState.displayNamePriority = 'name_en';
        mockState.modelMetaCache.set('/test/a.pmx', {
            name_en: 'Cached English',
            name_jp: 'Cached Japanese',
            comment: 'Cached comment',
        });
        const model = makeModel({
            file_path: '/test/a.pmx',
            dir: '/test',
            comment: '',
        });
        const item = modelToResourceItem(model);
        expect(item.label).toBe('a.pmx');
    });

    it('does not set sublabel from comment (comment is shown in detail page)', () => {
        const model = makeModel({
            file_path: '/test/a.pmx',
            dir: '/test',
            comment: 'Some description',
        });
        const item = modelToResourceItem(model);
        expect(item.sublabel).toBeUndefined();
    });

    it('stores model reference in data field', () => {
        const model = makeModel({ file_path: '/test/a.pmx', dir: '/test' });
        const item = modelToResourceItem(model);
        expect(item.data).toBe(model);
    });
});

describe('modelToRow', () => {
    describe('icon mapping', () => {
        it('returns "box" for unknown format', () => {
            const row = modelToRow(makeModel({ format: 'unknown' }));
            expect(row.icon).toBe('box');
        });

        it('returns "music" for vmd', () => {
            const row = modelToRow(makeModel({ format: 'vmd' }));
            expect(row.icon).toBe('music');
        });

        it('returns "volume-2" for audio', () => {
            const row = modelToRow(makeModel({ format: 'audio' }));
            expect(row.icon).toBe('volume-2');
        });

        it('returns "user" for vpd', () => {
            const row = modelToRow(makeModel({ format: 'vpd' }));
            expect(row.icon).toBe('user');
        });

        it('returns "archive" for zip+pmx', () => {
            const row = modelToRow(makeModel({ format: 'pmx', container: 'zip' }));
            expect(row.icon).toBe('archive');
        });

        it('returns "box" for plain pmx (file container)', () => {
            const row = modelToRow(makeModel({ format: 'pmx', container: 'file' }));
            expect(row.icon).toBe('box');
        });
    });

    describe('label — always filename', () => {
        beforeEach(() => {
            mockState.displayNamePriority = 'filename';
        });

        it('uses filename from file_path', () => {
            const m = makeModel({
                file_path: '/root/models/miku.pmx',
                name_jp: 'ミク',
                name_en: 'Miku',
            });
            const row = modelToRow(m);
            expect(row.label).toBe('miku.pmx');
        });

        it('uses zip_inner filename for zip containers', () => {
            const m = makeModel({
                container: 'zip',
                file_path: '/root/zips/model.zip',
                zip_inner: 'models/miku.pmx',
            });
            const row = modelToRow(m);
            expect(row.label).toBe('miku.pmx');
        });

        it('falls back to "未知" when file_path has no filename', () => {
            const m = makeModel({ file_path: '' });
            const row = modelToRow(m);
            expect(row.label).toBe('未知');
        });
    });

    it('does not set sublabel from comment (comment is shown in detail page)', () => {
        const row = modelToRow(makeModel({ comment: 'Miku model' }));
        expect(row.sublabel).toBeUndefined();
    });

    describe('row metadata', () => {
        it('sets kind to "model"', () => {
            const row = modelToRow(makeModel());
            expect(row.kind).toBe('model');
        });

        it('sets target to file_path', () => {
            const m = makeModel({ file_path: '/some/path/model.pmx' });
            const row = modelToRow(m);
            expect(row.target).toBe('/some/path/model.pmx');
        });

        it('sets editable only for pmx format', () => {
            expect(modelToRow(makeModel({ format: 'pmx' })).editable).toBe(true);
            expect(modelToRow(makeModel({ format: 'vmd' })).editable).toBe(false);
            expect(modelToRow(makeModel({ format: 'audio' })).editable).toBe(false);
        });

        it('stores model reference on the row', () => {
            const m = makeModel();
            const row = modelToRow(m);
            expect(row.model).toBe(m);
        });

        it('includes onAddClick callback', () => {
            const row = modelToRow(makeModel());
            expect(row.onAddClick).toBeInstanceOf(Function);
        });
    });
});

describe('path-boundary hardening', () => {
    describe('isUnderRoot 拒绝 .. 逃逸段 (P2 场景1)', () => {
        it('含 /../ 的中间段返回 false', () => {
            expect(isUnderRoot('C:/text-model/PMX', 'C:/text-model/PMX/../VMD')).toBe(false);
        });
        it('以 /.. 结尾返回 false', () => {
            expect(isUnderRoot('C:/text-model/PMX', 'C:/text-model/PMX/..')).toBe(false);
        });
        it('正常子路径仍返回 true（回归保护）', () => {
            expect(isUnderRoot('C:/text-model/PMX', 'C:/text-model/PMX/Sub')).toBe(true);
        });
    });

    describe('getRelativePathUnderDir 拒绝 .. 逃逸段 (P2 场景1)', () => {
        it('含 .. 的路径返回 null，不把 .. 当子目录段', () => {
            expect(
                getRelativePathUnderDir('C:/text-model/PMX/../VMD/foo.pmx', 'C:/text-model/PMX')
            ).toBeNull();
        });
        it('正常子目录返回相对路径（回归保护）', () => {
            expect(
                getRelativePathUnderDir('C:/text-model/PMX/Sub/foo.pmx', 'C:/text-model/PMX')
            ).toBe('Sub/foo.pmx');
        });
        it('mdir 与 base 完全相等（同目录）返回空字符串（既有语义保持）', () => {
            expect(getRelativePathUnderDir('C:/text-model/PMX', 'C:/text-model/PMX')).toBe('');
        });
    });

    describe('normPath 折叠 . 段 + content:// 去尾部斜杠 (P3/P4)', () => {
        it('折叠中间 . 段', () => {
            expect(normPath('C:/text-model/./PMX')).toBe('C:/text-model/PMX');
        });
        it('折叠开头 . 段', () => {
            expect(normPath('./foo/bar')).toBe('foo/bar');
        });
        it('折叠结尾 . 段', () => {
            expect(normPath('foo/bar/.')).toBe('foo/bar');
        });
        it('content:// 去除尾部斜杠（与文件 URI 行为统一）', () => {
            expect(normPath('content://com.example/foo/')).toBe('content://com.example/foo');
        });
        it('正常路径不变（回归保护）', () => {
            expect(normPath('C:/text-model/PMX/Sub')).toBe('C:/text-model/PMX/Sub');
        });
    });

    describe('splitSubdirSegments 加固 (P2 场景1 + P2 场景2)', () => {
        it('含 .. 的 root 或 dir 直接返回 null', () => {
            expect(
                splitSubdirSegments('C:/text-model/PMX', 'C:/text-model/PMX/../VMD/Sub')
            ).toBeNull();
            expect(splitSubdirSegments('C:/text-model/PMX/..', 'C:/text-model/Sub')).toBeNull();
        });
        it('同盘异父串台拒绝展开（C:/other/PMX/Sub 不应展开到 C:/text-model/PMX/Sub）', () => {
            expect(splitSubdirSegments('C:/text-model/PMX', 'C:/other/PMX/Sub')).toBeNull();
        });
        it('同根异形态仍展开（大小写/反斜杠，回归保护）', () => {
            expect(splitSubdirSegments('C:/Models/pmx', 'C:/Models/PMX/Sub')).toEqual(['Sub']);
            expect(splitSubdirSegments('C:\\Models\\PMX', 'C:/Models/PMX/Sub')).toEqual(['Sub']);
        });
    });
});

describe('buildResourceItemsForDir', () => {
    it('returns models in the specified directory', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/models/a.pmx', dir: '/test/models' }),
            makeModel({ file_path: '/test/models/b.pmx', dir: '/test/models' }),
            makeModel({ file_path: '/test/other/c.pmx', dir: '/test/other' }),
        ];

        const items = buildResourceItemsForDir('/test/models');
        expect(items).toHaveLength(2);
        expect(items.every((i: any) => !i.isFolder)).toBe(true);
    });

    it('flattens leaf subdir with single model into items when not at root', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/models/sub/a.pmx', dir: '/test/models/sub' }),
        ];

        const items = buildResourceItemsForDir('/test/models');
        expect(items).toHaveLength(1);
        expect(items[0].isFolder).toBe(false);
        expect(items[0].label).toBe('a.pmx');
    });

    it('mixes flattened leaf models with direct models (leaf subdir models after direct models)', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/models/a.pmx', dir: '/test/models' }),
            makeModel({ file_path: '/test/models/sub/b.pmx', dir: '/test/models/sub' }),
        ];

        const items = buildResourceItemsForDir('/test/models');
        expect(items).toHaveLength(2);
        expect(items[0].isFolder).toBe(false);
        expect(items[0].label).toBe('a.pmx');
        expect(items[1].isFolder).toBe(false);
        expect(items[1].label).toBe('b.pmx');
    });

    it('keeps leaf subdir as folder when multiple zip models inside', () => {
        mockState.allModels = [
            makeModel({
                file_path: '/test/models/sub/m1.zip',
                dir: '/test/models/sub',
                container: 'zip',
                zip_inner: 'm1.pmx',
            }),
            makeModel({
                file_path: '/test/models/sub/m2.zip',
                dir: '/test/models/sub',
                container: 'zip',
                zip_inner: 'm2.pmx',
            }),
        ];

        const items = buildResourceItemsForDir('/test/models');
        expect(items).toHaveLength(1);
        expect(items[0].isFolder).toBe(true);
        expect(items[0].label).toBe('sub');
    });

    it('keeps non-leaf subdir as folder (has deeper subdirs)', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/models/sub/deep/a.pmx', dir: '/test/models/sub/deep' }),
        ];

        const items = buildResourceItemsForDir('/test/models');
        expect(items).toHaveLength(1);
        expect(items[0].isFolder).toBe(true);
        expect(items[0].label).toBe('sub');
    });

    it('applies filter to exclude models', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/a.pmx', dir: '/test', format: 'pmx' }),
            makeModel({ file_path: '/test/b.vmd', dir: '/test', format: 'vmd' }),
        ];

        const items = buildResourceItemsForDir('/test', (m: any) => m.format === 'pmx');
        expect(items).toHaveLength(1);
        expect(items[0].filePath).toBe('/test/a.pmx');
    });

    it('returns empty array for nonexistent directory', () => {
        mockState.allModels = [];
        const items = buildResourceItemsForDir('/nonexistent');
        expect(items).toHaveLength(0);
    });

    it('filters by browseDir when provided (excludes models outside browseDir)', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/models/a.pmx', dir: '/test/models' }),
            makeModel({ file_path: '/other/b.pmx', dir: '/other' }),
        ];
        const items = buildResourceItemsForDir('/test/models', undefined, '/test/models');
        expect(items).toHaveLength(1);
        expect(items[0].filePath).toBe('/test/models/a.pmx');
    });

    it('preserves sorted order for multiple non-leaf subdirs (not reversed)', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/models/alpha/deep/a.pmx', dir: '/test/models/alpha/deep' }),
            makeModel({ file_path: '/test/models/beta/deep/b.pmx', dir: '/test/models/beta/deep' }),
            makeModel({ file_path: '/test/models/gamma/deep/c.pmx', dir: '/test/models/gamma/deep' }),
        ];
        const items = buildResourceItemsForDir('/test/models');
        const folders = items.filter((i: any) => i.isFolder);
        expect(folders).toHaveLength(3);
        expect(folders[0].label).toBe('alpha');
        expect(folders[1].label).toBe('beta');
        expect(folders[2].label).toBe('gamma');
    });
});

describe('isLeafFlattenDir', () => {
    it('returns false for non-existent directory', () => {
        const models = [];
        expect(isLeafFlattenDir('/test/nonexistent', models)).toBe(false);
    });

    it('returns false for directory with no models', () => {
        const models = [makeModel({ file_path: '/test/other/a.pmx', dir: '/test/other' })];
        expect(isLeafFlattenDir('/test/nonexistent', models)).toBe(false);
    });

    it('returns true for leaf directory with single pmx model', () => {
        const models = [
            makeModel({ file_path: '/test/models/sub/a.pmx', dir: '/test/models/sub' }),
        ];
        expect(isLeafFlattenDir('/test/models/sub', models)).toBe(true);
    });

    it('returns true for leaf directory with single zip model', () => {
        const models = [
            makeModel({
                file_path: '/test/models/sub/m.zip',
                dir: '/test/models/sub',
                container: 'zip',
                zip_inner: 'm.pmx',
            }),
        ];
        expect(isLeafFlattenDir('/test/models/sub', models)).toBe(true);
    });

    it('returns false for leaf directory with multiple zip models', () => {
        const models = [
            makeModel({
                file_path: '/test/models/sub/m1.zip',
                dir: '/test/models/sub',
                container: 'zip',
                zip_inner: 'm1.pmx',
            }),
            makeModel({
                file_path: '/test/models/sub/m2.zip',
                dir: '/test/models/sub',
                container: 'zip',
                zip_inner: 'm2.pmx',
            }),
        ];
        expect(isLeafFlattenDir('/test/models/sub', models)).toBe(false);
    });

    it('returns false for non-leaf directory (has deeper subdirs)', () => {
        const models = [
            makeModel({ file_path: '/test/models/sub/deep/a.pmx', dir: '/test/models/sub/deep' }),
        ];
        expect(isLeafFlattenDir('/test/models/sub', models)).toBe(false);
    });

    it('returns true for leaf directory with mixed pmx and zip (single each)', () => {
        const models = [
            makeModel({ file_path: '/test/models/sub/a.pmx', dir: '/test/models/sub' }),
            makeModel({
                file_path: '/test/models/sub/b.zip',
                dir: '/test/models/sub',
                container: 'zip',
                zip_inner: 'b.pmx',
            }),
        ];
        expect(isLeafFlattenDir('/test/models/sub', models)).toBe(true);
    });

    it('respects category filter', () => {
        const models = [
            makeModel({
                file_path: '/test/models/sub/a.pmx',
                dir: '/test/models/sub',
                format: 'pmx',
            }),
            makeModel({
                file_path: '/test/models/sub/b.vmd',
                dir: '/test/models/sub',
                format: 'vmd',
            }),
        ];
        expect(isLeafFlattenDir('/test/models/sub', models, (m: any) => m.format === 'pmx')).toBe(
            true
        );
        expect(isLeafFlattenDir('/test/models/sub', models, (m: any) => m.format === 'vmd')).toBe(
            true
        );
    });

    it('skips stale entries with empty dir field without crashing', () => {
        const models = [
            makeModel({ file_path: '/test/models/sub/a.pmx', dir: '/test/models/sub' }),
            { file_path: '/test/stale.pmx', dir: '' } as any,
            { file_path: '/test/nodir.pmx' } as any,
        ];
        expect(isLeafFlattenDir('/test/models/sub', models)).toBe(true);
    });
});

describe('resolveDisplayBrowseDir', () => {
    it('resolves a single-pmx leaf subdir to the browse root', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/root/models/X/a.pmx', dir: '/test/root/models/X' }),
        ];
        const m = makeModel({ file_path: '/test/root/models/X/a.pmx', dir: '/test/root/models/X' });
        expect(resolveDisplayBrowseDir(m, 'pmx')).toBe('/test/root/models');
    });

    it('returns the model dir unchanged for a normal (non-flatten) subfolder', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/root/models/sub/a.pmx', dir: '/test/root/models/sub' }),
            makeModel({
                file_path: '/test/root/models/sub/deep/b.pmx',
                dir: '/test/root/models/sub/deep',
            }),
        ];
        const m = makeModel({
            file_path: '/test/root/models/sub/a.pmx',
            dir: '/test/root/models/sub',
        });
        expect(resolveDisplayBrowseDir(m, 'pmx')).toBe('/test/root/models/sub');
    });

    it('returns browse root for a model placed directly at root', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/root/models/a.pmx', dir: '/test/root/models' }),
        ];
        const m = makeModel({ file_path: '/test/root/models/a.pmx', dir: '/test/root/models' });
        expect(resolveDisplayBrowseDir(m, 'pmx')).toBe('/test/root/models');
    });
});

describe('computeRestoreSegments', () => {
    it('returns null when target not under browseDir', () => {
        const models = [];
        expect(computeRestoreSegments('/test/models', '/other/path', models)).toBeNull();
    });

    it('returns [] when target equals browseDir', () => {
        const models = [];
        expect(computeRestoreSegments('/test/models', '/test/models', models)).toEqual([]);
    });

    it('returns empty [] when target is a leaf flatten dir (single segment)', () => {
        const models = [
            makeModel({ file_path: '/test/models/sub/a.pmx', dir: '/test/models/sub' }),
        ];
        expect(computeRestoreSegments('/test/models', '/test/models/sub', models)).toEqual([]);
    });

    it('returns partial segments when passing through non-leaf dir to leaf dir', () => {
        const models = [
            makeModel({ file_path: '/test/models/cat/sub/a.pmx', dir: '/test/models/cat/sub' }),
        ];
        expect(computeRestoreSegments('/test/models', '/test/models/cat/sub', models)).toEqual([
            'cat',
        ]);
    });

    it('returns full segments when target is a multi-zip folder', () => {
        const models = [
            makeModel({
                file_path: '/test/models/sub/m1.zip',
                dir: '/test/models/sub',
                container: 'zip',
                zip_inner: 'm1.pmx',
            }),
            makeModel({
                file_path: '/test/models/sub/m2.zip',
                dir: '/test/models/sub',
                container: 'zip',
                zip_inner: 'm2.pmx',
            }),
        ];
        expect(computeRestoreSegments('/test/models', '/test/models/sub', models)).toEqual(['sub']);
    });

    it('returns partial segments for non-leaf dir when target is one level deeper', () => {
        const models = [
            makeModel({ file_path: '/test/models/sub/deep/a.pmx', dir: '/test/models/sub/deep' }),
        ];
        expect(computeRestoreSegments('/test/models', '/test/models/sub/deep', models)).toEqual([
            'sub',
        ]);
    });

    it('respects category filter', () => {
        const models = [
            makeModel({
                file_path: '/test/models/sub/a.pmx',
                dir: '/test/models/sub',
                format: 'pmx',
            }),
            makeModel({
                file_path: '/test/models/sub/b.vmd',
                dir: '/test/models/sub',
                format: 'vmd',
            }),
        ];
        expect(
            computeRestoreSegments(
                '/test/models',
                '/test/models/sub',
                models,
                (m: any) => m.format === 'pmx'
            )
        ).toEqual([]);
        expect(
            computeRestoreSegments(
                '/test/models',
                '/test/models/sub',
                models,
                (m: any) => m.format === 'vmd'
            )
        ).toEqual([]);
    });
});

describe('splitSubdirSegments', () => {
    it('returns [] when dir equals root', () => {
        expect(splitSubdirSegments('/test/PMX', '/test/PMX')).toEqual([]);
    });
    it('returns the single segment for a direct child', () => {
        expect(splitSubdirSegments('/test/PMX', '/test/PMX/Sub')).toEqual(['Sub']);
    });
    it('returns nested segments in order', () => {
        expect(splitSubdirSegments('/test/PMX', '/test/PMX/Sub/deep')).toEqual(['Sub', 'deep']);
    });
    it('rejects bare-prefix sibling (PMX vs PMXSub) as non-child', () => {
        expect(splitSubdirSegments('/test/PMX', '/test/PMXSub')).toBeNull();
    });
    it('rejects unrelated directory (different root)', () => {
        expect(splitSubdirSegments('/test/PMX', '/other/X/Sub')).toBeNull();
        expect(splitSubdirSegments('C:/Models/PMX', 'D:/Models/PMX/Sub')).toBeNull();
    });
    it('is case-insensitive on the path boundary', () => {
        expect(splitSubdirSegments('C:/Models/pmx', 'C:/Models/PMX/Sub')).toEqual(['Sub']);
    });
    it('normalizes backslashes before comparing', () => {
        expect(splitSubdirSegments('C:\\Models\\PMX', 'C:/Models/PMX/Sub')).toEqual(['Sub']);
    });
    it('falls back when root/dir differ only by case (libraryRoot vs ResourceRoot)', () => {
        expect(splitSubdirSegments('/test/lib/PMX', '/TEST/LIB/PMX/Sub')).toEqual(['Sub']);
        expect(
            splitSubdirSegments('C:/Users/a/MikuMikuAR/PMX', 'C:/Users/a/mikumikuar/PMX/SK')
        ).toEqual(['SK']);
    });
    it('falls back across mixed separators (root backslash, dir slash) on same drive', () => {
        expect(
            splitSubdirSegments(
                'C:\\Users\\a\\MikuMikuAR\\PMX',
                'C:/Users/a/mikumikuar/PMX/Sub/deep'
            )
        ).toEqual(['Sub', 'deep']);
    });
    it('still rejects cross-drive memory (never expands onto wrong disk)', () => {
        expect(splitSubdirSegments('C:/Models/PMX', 'D:/Models/PMX/Sub')).toBeNull();
    });
});

describe('importFile', () => {
    let mockLoad: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mockLm = await import('../core/load-manager');
        mockLoad = mockLm.loadManager.load as ReturnType<typeof vi.fn>;
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('/test/file.pmx');
    });

    it('does nothing when user cancels file picker (returns empty)', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('');
        await importFile();
        expect(mockB.ImportZip).not.toHaveBeenCalled();
        expect(mockLoad).not.toHaveBeenCalled();
    });

    it('routes .pmx to loadManager.load with kind=actor', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('/test/model.pmx');
        await importFile();
        expect(mockLoad).toHaveBeenCalledWith({ kind: 'actor', path: '/test/model.pmx' });
    });

    it('routes .vmd to loadManager.load with kind=vmd', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('/test/motion.vmd');
        await importFile();
        expect(mockLoad).toHaveBeenCalledWith({ kind: 'vmd', path: '/test/motion.vmd' });
    });

    it('routes .zip to ImportZip and refreshLibrary', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('/test/archive.zip');
        (mockB.ImportZip as any).mockResolvedValue(undefined);
        await importFile();
        expect(mockB.ImportZip).toHaveBeenCalledWith('/test/archive.zip');
    });

    it('shows error for unsupported file extension', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('/test/readme.txt');
        await importFile();
        expect(mockLoad).not.toHaveBeenCalled();
        const { setStatus } = await import('../core/config');
        expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('不支持的文件格式'), true);
    });

    it('catches loadManager error on pmx load', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('/test/model.pmx');
        mockLoad.mockRejectedValue(new Error('corrupt file'));
        await importFile();
        const { setStatus } = await import('../core/config');
        expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('加载模型'), true);
    });

    it('catches ImportZip error', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('/test/archive.zip');
        (mockB.ImportZip as any).mockRejectedValue(new Error('extraction failed'));
        await importFile();
        const { setStatus } = await import('../core/config');
        expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('导入压缩包'), true);
    });

    it('does not call load when SelectImportFile throws a non-cancel error', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockRejectedValue(new Error('permission denied'));
        await importFile();
        expect(mockB.ImportZip).not.toHaveBeenCalled();
        expect(mockLoad).not.toHaveBeenCalled();
    });

    it('zip import with returned file_path triggers loadManager.load for auto-load', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('/test/archive.zip');
        (mockB.ImportZip as any).mockResolvedValue({ file_path: '/test/extracted/model.pmx' });
        await importFile();
        expect(mockB.ImportZip).toHaveBeenCalledWith('/test/archive.zip');
        expect(mockLoad).toHaveBeenCalledWith({
            kind: 'actor',
            path: '/test/extracted/model.pmx',
        });
    });
});

describe('Resource View Mode', () => {
    beforeEach(() => {
        setResourceViewMode('list');
    });

    it('getResourceViewMode returns default "list"', () => {
        expect(getResourceViewMode()).toBe('list');
    });

    it('setResourceViewMode updates mode', () => {
        setResourceViewMode('grid');
        expect(getResourceViewMode()).toBe('grid');
        setResourceViewMode('list');
        expect(getResourceViewMode()).toBe('list');
    });

    it('setResourceViewMode persists via SetUIState', async () => {
        const { SetUIState } = await import('../core/wails-bindings');
        setResourceViewMode('grid');
        // 原 setTimeout(10) 裸等易受负载抖动，改 waitFor 轮询直至持久化调用落定
        await vi.waitFor(() =>
            expect(SetUIState).toHaveBeenCalledWith(
                expect.objectContaining({ resourceViewMode: 'grid' })
            )
        );
    });

    it('setResourceViewMode does not throw when SetUIState rejects', async () => {
        const { SetUIState } = await import('../core/wails-bindings');
        (SetUIState as any).mockRejectedValueOnce(new Error('persist failed'));
        expect(() => setResourceViewMode('grid')).not.toThrow();
        // 本地状态仍更新
        expect(getResourceViewMode()).toBe('grid');
    });
});
