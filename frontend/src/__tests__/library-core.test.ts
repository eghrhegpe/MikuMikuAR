import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- hoisted mutable state (live bindings for mocked config) -----

const mockState = vi.hoisted(() => ({
    allModels: [] as any[],
    libraryRoot: '/test/root',
    displayNamePriority: 'filename' as string,
    librarySortMode: 'default' as string,
    modelMetaCache: new Map<string, any>(),
    externalPaths: [] as any[],
    recentModels: [] as string[],
    focusedModelId: null as string | null,
    motionBindingTargetId: null as string | null,
}));

// Capture calls to slideRow for buildLevel tests
const capturedSlideRows = vi.hoisted(() => [] as any[]);

// ----- mock heavy deps first -----

vi.mock('../scene/scene', () => ({
    loadPMXFile: vi.fn(),
    loadVMDFromPath: vi.fn(),
    removeModel: vi.fn(),
    loadAudioFile: vi.fn(),
    loadVPDPose: vi.fn(),
}));

vi.mock('../core/wails-bindings', () => ({
    GetConfig: vi.fn(),
    SetResourceRoot: vi.fn(),
    SetOverridePath: vi.fn(),
    SelectDir: vi.fn(),
    SelectImportFile: vi.fn(),
    ImportZip: vi.fn(),
    ScanModelDir: vi.fn(),
    GetLibraryIndex: vi.fn(),
    ExtractZip: vi.fn(),
    CleanOrphanCache: vi.fn(),
    ClearExtractCache: vi.fn(),
    GetThumbnailBatch: vi.fn(),
    GetModelMetaBatch: vi.fn(),
    GetRecentModels: vi.fn(),
    AddRecentModel: vi.fn(),
    GetAllTags: vi.fn(),
    GetModelsByTag: vi.fn(),
    SelectAudioFile: vi.fn(),
    SelectVMDMotion: vi.fn(),
    SelectVPDPose: vi.fn(),
    SetUIState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../core/load-manager', () => ({
    loadManager: { load: vi.fn() },
}));

vi.mock('./model-detail', () => ({ buildModelLevel: vi.fn() }));
vi.mock('../menus/scene-menu', () => ({ buildStageTransformLevel: vi.fn() }));
vi.mock('./menu', () => ({ SlideMenu: vi.fn() }));
vi.mock('../core/icons', () => ({ createIconifyIcon: vi.fn(() => null) }));
vi.mock('../core/ui-helpers', () => ({
    slideRow: vi.fn(
        (
            _card: any,
            icon: string,
            label: string,
            _isFolder: boolean,
            _onClick: any,
            sublabel?: string
        ) => {
            capturedSlideRows.push({ icon, label, isFolder: _isFolder, sublabel });
        }
    ),
}));

vi.mock('../core/config', () => ({
    get allModels() {
        return mockState.allModels;
    },
    get libraryRoot() {
        return mockState.libraryRoot;
    },
    get displayNamePriority() {
        return mockState.displayNamePriority;
    },
    get librarySortMode() {
        return mockState.librarySortMode;
    },
    get modelMetaCache() {
        return mockState.modelMetaCache;
    },
    get externalPaths() {
        return mockState.externalPaths;
    },
    get recentModels() {
        return mockState.recentModels;
    },
    get focusedModelId() {
        return mockState.focusedModelId;
    },
    get motionBindingTargetId() {
        return mockState.motionBindingTargetId;
    },

    normPath: (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, ''),
    cardContainer: (container: HTMLElement, fn: (c: HTMLElement) => void) => {
        const card = document.createElement('div');
        fn(card);
        container.appendChild(card);
    },
    formatError: (e: any) => String(e),
    computeLibraryRef: (fp: string) => fp,
    dom: {
        sceneOverlay: {
            classList: { contains: () => false, add: vi.fn(), remove: vi.fn() },
            dataset: {} as Record<string, string>,
        },
    },
    getMenuWrapper: () => document.createElement('div'),
    stackRegistry: { modelStack: null, sceneStackGetter: null, buildLevel: null },
    uiState: {} as Record<string, unknown>,

    // Setters (capture calls but values are controlled via mockState)
    setStatus: vi.fn(),
    setLibraryRoot: vi.fn(),
    setResourceRoot: vi.fn(),
    setAllModels: vi.fn(),
    setDisplayNamePriority: vi.fn(),
    setExternalPaths: vi.fn(),
    setOverridePaths: vi.fn(),
    setThumbnailCache: vi.fn(),
    setModelMetaCache: vi.fn(),
    setRecentModels: vi.fn(),
    setFocusedModelId: vi.fn(),
    setMotionBindingTargetId: vi.fn(),
    closeAllOverlays: vi.fn(),
    modelRegistry: new Map(),
}));

// ----- SUT -----

import {
    modelToRow,
    buildLevel,
    splitSubdirSegments,
    importFile,
    getResourceViewMode,
    setResourceViewMode,
    buildResourceItemsForDir,
    getRelativePathUnderDir,
    isLeafFlattenDir,
    computeRestoreSegments,
    modelToResourceItem,
} from '../menus/library-core';
import { isUnderRoot } from '../core/utils';
import { normPath } from '../core/fileservice';

// ----- helpers -----

function makeModel(overrides: Record<string, any> = {}): any {
    return {
        dir: '/test/root/models',
        file_path: '/test/root/models/model.pmx',
        name_jp: '',
        name_en: '',
        comment: '',
        has_thumb: false,
        type: 'actor',
        format: 'pmx',
        container: 'file',
        zip_inner: '',
        category: '',
        source: '',
        ...overrides,
    };
}

// ===================================================================
// modelToRow
// ===================================================================

describe('modelToRow', () => {
    beforeEach(() => {
        mockState.displayNamePriority = 'filename';
        mockState.modelMetaCache.clear();
    });

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

    describe('label — displayNamePriority = filename', () => {
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

    describe('label — displayNamePriority = name_en', () => {
        beforeEach(() => {
            mockState.displayNamePriority = 'name_en';
        });

        it('uses name_en from model entry', () => {
            const m = makeModel({ file_path: '/r/miku.pmx', name_en: 'Hatsune Miku' });
            const row = modelToRow(m);
            expect(row.label).toBe('Hatsune Miku');
        });

        it('falls back to name_jp when name_en empty', () => {
            const m = makeModel({ file_path: '/r/miku.pmx', name_en: '', name_jp: '初音ミク' });
            const row = modelToRow(m);
            expect(row.label).toBe('初音ミク');
        });

        it('falls back to filename when both names empty', () => {
            const m = makeModel({ file_path: '/r/miku.pmx', name_en: '', name_jp: '' });
            const row = modelToRow(m);
            expect(row.label).toBe('miku.pmx');
        });

        it('uses cached name_en when available', () => {
            mockState.modelMetaCache.set('/r/miku.pmx', {
                name_en: 'Cached EN',
                name_jp: 'Cached JP',
                comment: '',
            });
            const m = makeModel({ file_path: '/r/miku.pmx', name_en: 'Uncached' });
            const row = modelToRow(m);
            expect(row.label).toBe('Cached EN');
        });
    });

    describe('label — displayNamePriority = name_jp', () => {
        beforeEach(() => {
            mockState.displayNamePriority = 'name_jp';
        });

        it('uses name_jp from model entry', () => {
            const m = makeModel({ file_path: '/r/miku.pmx', name_jp: '初音ミク' });
            const row = modelToRow(m);
            expect(row.label).toBe('初音ミク');
        });

        it('falls back to name_en when name_jp empty', () => {
            const m = makeModel({ file_path: '/r/miku.pmx', name_jp: '', name_en: 'Miku' });
            const row = modelToRow(m);
            expect(row.label).toBe('Miku');
        });

        it('falls back to filename when both names empty', () => {
            const m = makeModel({ file_path: '/r/miku.pmx', name_jp: '', name_en: '' });
            const row = modelToRow(m);
            expect(row.label).toBe('miku.pmx');
        });

        it('uses cached name_jp when available', () => {
            mockState.modelMetaCache.set('/r/miku.pmx', {
                name_en: 'EN',
                name_jp: '初音ミク(キャッシュ)',
                comment: '',
            });
            const m = makeModel({ file_path: '/r/miku.pmx' });
            const row = modelToRow(m);
            expect(row.label).toBe('初音ミク(キャッシュ)');
        });
    });

    it('sublabel is always undefined', () => {
        const row = modelToRow(makeModel({ comment: 'Any comment' }));
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

// ===================================================================
// buildLevel
// ===================================================================

describe('buildLevel', () => {
    beforeEach(() => {
        mockState.allModels = [];
        mockState.libraryRoot = '/test/root';
        mockState.librarySortMode = 'default';
        capturedSlideRows.length = 0;
    });

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
        const rows = extractLevelRows(level);
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
        const rows = extractLevelRows(level);
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
        const rows = extractLevelRows(level);
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
        const rows = extractLevelRows(level);
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
        const rows = extractLevelRows(level);
        expect(rows).toHaveLength(1);
        expect(rows[0].label).toBe('sub');
        expect(rows[0].isFolder).toBe(true);
    });

    it('returns empty rows for empty directory', () => {
        const level = buildLevel('/test/root/empty', 'Empty');
        const rows = extractLevelRows(level);
        expect(rows).toHaveLength(0);
    });

    it('prepends extraFolders as plug-icon folder entries', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/root/models/a.pmx', dir: '/test/root/models' }),
        ];

        const level = buildLevel('/test/root/models', 'Models', undefined, undefined, [
            { label: 'External Lib', path: '/external/path' },
        ]);
        const rows = extractLevelRows(level);
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
        const rows = extractLevelRows(level);
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
        const rows = extractLevelRows(level);
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
        const rows = extractLevelRows(level);
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
        const rows = extractLevelRows(level);
        expect(rows[0].label).toBe('b.pmx');
        expect(rows[1].label).toBe('c.pmx');
        expect(rows[2].label).toBe('a.pmx');
    });

    it('does NOT create a phantom folder when dir is a string-prefix but not a path-component boundary', () => {
        // dir=".../PMX" 与 m.dir=".../PMXSub/..." 仅字符串前缀相同，并非真实父子路径
        mockState.libraryRoot = '/test/root';
        mockState.allModels = [
            makeModel({ file_path: '/test/root/PMXSub/a.pmx', dir: '/test/root/PMXSub' }),
        ];

        const level = buildLevel('/test/root/PMX', 'PMX');
        const rows = extractLevelRows(level);
        expect(rows).toHaveLength(0);
        expect(rows.some((r: any) => r.label === 'Sub')).toBe(false);
    });

    it('does NOT create a ":" phantom folder when dir is a drive-letter-only prefix', () => {
        // 复现资源库记忆恢复时的边界场景：dir 为盘符残缺形态，会切出 ":" 段
        mockState.libraryRoot = 'C:';
        mockState.allModels = [
            makeModel({ file_path: 'C:/Users/foo/Models/PMX/Sub/x.pmx', dir: 'C:/Users/foo/Models/PMX/Sub' }),
        ];

        const level = buildLevel('C', 'C');
        const rows = extractLevelRows(level);
        expect(rows).toHaveLength(0);
        expect(rows.some((r: any) => r.label === ':')).toBe(false);
    });
});

// ===================================================================
// splitSubdirSegments（展开栈：路径边界匹配，防止伪文件夹）
// ===================================================================
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
        // 关键防护：上次 buildLevel 边界 bug 正是 "PMX" 误匹配 "PMXSub" 生成伪文件夹
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
        // 真实触发场景：前端 libraryRoot 与后端 cfg.ResourceRoot 大小写形态不一致，
        // 严格前缀匹配失败，但同盘符且 lastDir 含 root 末段标记 "PMX"
        expect(splitSubdirSegments('/test/lib/PMX', '/TEST/LIB/PMX/Sub')).toEqual(['Sub']);
        expect(splitSubdirSegments('C:/Users/a/MikuMikuAR/PMX', 'C:/Users/a/mikumikuar/PMX/SK')).toEqual(['SK']);
    });
    it('falls back across mixed separators (root backslash, dir slash) on same drive', () => {
        expect(splitSubdirSegments('C:\\Users\\a\\MikuMikuAR\\PMX', 'C:/Users/a/mikumikuar/PMX/Sub/deep')).toEqual(['Sub', 'deep']);
    });
    it('still rejects cross-drive memory (never expands onto wrong disk)', () => {
        expect(splitSubdirSegments('C:/Models/PMX', 'D:/Models/PMX/Sub')).toBeNull();
    });
});

// ===================================================================
// importFile
// ===================================================================

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
        expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('不支持的文件格式'), false);
    });

    it('catches loadManager error on pmx load', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('/test/model.pmx');
        mockLoad.mockRejectedValue(new Error('corrupt file'));
        await importFile(); // should not throw
        const { setStatus } = await import('../core/config');
        expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('模型加载失败'), false);
    });

    it('catches ImportZip error', async () => {
        const mockB = await import('../core/wails-bindings');
        (mockB.SelectImportFile as any).mockResolvedValue('/test/archive.zip');
        (mockB.ImportZip as any).mockRejectedValue(new Error('extraction failed'));
        await importFile(); // should not throw
        const { setStatus } = await import('../core/config');
        expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('导入失败'), false);
    });
});

// ===================================================================
// Resource View Mode [doc:adr-066]
// ===================================================================

describe('Resource View Mode', () => {
    beforeEach(() => {
        // Reset to default
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
        // SetUIState is called asynchronously
        await new Promise((r) => setTimeout(r, 10));
        expect(SetUIState).toHaveBeenCalledWith(
            expect.objectContaining({ resourceViewMode: 'grid' })
        );
    });
});

// ===================================================================
// buildResourceItemsForDir [doc:adr-066]
// ===================================================================

describe('buildResourceItemsForDir', () => {
    beforeEach(() => {
        mockState.displayNamePriority = 'filename';
        mockState.modelMetaCache.clear();
    });

    it('returns models in the specified directory', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/models/a.pmx', dir: '/test/models' }),
            makeModel({ file_path: '/test/models/b.pmx', dir: '/test/models' }),
            makeModel({ file_path: '/test/other/c.pmx', dir: '/test/other' }),
        ];

        const items = buildResourceItemsForDir('/test/models');
        expect(items).toHaveLength(2);
        expect(items.every((i) => !i.isFolder)).toBe(true);
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

        const items = buildResourceItemsForDir('/test', (m) => m.format === 'pmx');
        expect(items).toHaveLength(1);
        expect(items[0].filePath).toBe('/test/a.pmx');
    });

    it('returns empty array for nonexistent directory', () => {
        mockState.allModels = [];
        const items = buildResourceItemsForDir('/nonexistent');
        expect(items).toHaveLength(0);
    });
});

// isLeafFlattenDir [doc:adr-090]
// ===================================================================

describe('isLeafFlattenDir', () => {
    it('returns false for non-existent directory', () => {
        const models = [];
        expect(isLeafFlattenDir('/test/nonexistent', models)).toBe(false);
    });

    it('returns false for directory with no models', () => {
        const models = [
            makeModel({ file_path: '/test/other/a.pmx', dir: '/test/other' }),
        ];
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
            makeModel({ file_path: '/test/models/sub/a.pmx', dir: '/test/models/sub', format: 'pmx' }),
            makeModel({ file_path: '/test/models/sub/b.vmd', dir: '/test/models/sub', format: 'vmd' }),
        ];
        expect(isLeafFlattenDir('/test/models/sub', models, (m) => m.format === 'pmx')).toBe(true);
        expect(isLeafFlattenDir('/test/models/sub', models, (m) => m.format === 'vmd')).toBe(true);
    });
});

// computeRestoreSegments [doc:adr-090]
// ===================================================================

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
        expect(computeRestoreSegments('/test/models', '/test/models/cat/sub', models)).toEqual(['cat']);
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
        expect(computeRestoreSegments('/test/models', '/test/models/sub/deep', models)).toEqual(['sub']);
    });

    it('respects category filter', () => {
        const models = [
            makeModel({ file_path: '/test/models/sub/a.pmx', dir: '/test/models/sub', format: 'pmx' }),
            makeModel({ file_path: '/test/models/sub/b.vmd', dir: '/test/models/sub', format: 'vmd' }),
        ];
        expect(computeRestoreSegments('/test/models', '/test/models/sub', models, (m) => m.format === 'pmx')).toEqual([]);
        expect(computeRestoreSegments('/test/models', '/test/models/sub', models, (m) => m.format === 'vmd')).toEqual([]);
    });
});

// modelToResourceItem [doc:adr-066]
// ===================================================================

describe('modelToResourceItem', () => {
    beforeEach(() => {
        mockState.displayNamePriority = 'filename';
        mockState.modelMetaCache.clear();
    });

    it('returns correct id and label for plain pmx', () => {
        const model = makeModel({
            file_path: '/test/a.pmx',
            dir: '/test',
            name_jp: '',
            name_en: '',
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

    it('uses name_en when displayNamePriority is name_en', () => {
        mockState.displayNamePriority = 'name_en';
        const model = makeModel({
            file_path: '/test/a.pmx',
            dir: '/test',
            name_en: 'English Name',
            name_jp: '日本語名',
        });
        const item = modelToResourceItem(model);
        expect(item.label).toBe('English Name');
    });

    it('uses name_jp when displayNamePriority is name_jp', () => {
        mockState.displayNamePriority = 'name_jp';
        const model = makeModel({
            file_path: '/test/a.pmx',
            dir: '/test',
            name_en: 'English Name',
            name_jp: '日本語名',
        });
        const item = modelToResourceItem(model);
        expect(item.label).toBe('日本語名');
    });

    it('falls back to cached metadata when available', () => {
        mockState.displayNamePriority = 'name_en';
        mockState.modelMetaCache.set('/test/a.pmx', {
            name_en: 'Cached English',
            name_jp: 'Cached Japanese',
            comment: 'Cached comment',
        });
        const model = makeModel({
            file_path: '/test/a.pmx',
            dir: '/test',
            name_en: 'Original English',
            name_jp: '',
            comment: '',
        });
        const item = modelToResourceItem(model);
        expect(item.label).toBe('Cached English');
        expect(item.sublabel).toBe('Cached comment');
    });

    it('sets sublabel to undefined when both cached and model comment are empty', () => {
        const model = makeModel({
            file_path: '/test/a.pmx',
            dir: '/test',
            comment: '',
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

/** Invoke level.renderCustom and return rows produced by slideRow. */
function extractLevelRows(level: any): any[] {
    capturedSlideRows.length = 0;
    const container = document.createElement('div');
    if (typeof level.renderCustom === 'function') {
        level.renderCustom(container);
    }
    return [...capturedSlideRows];
}

// ===== 路径边界加固回归测试（联邦架构师 审核 P2/P3/P4 修复） =====
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
            expect(getRelativePathUnderDir('C:/text-model/PMX/../VMD/foo.pmx', 'C:/text-model/PMX')).toBeNull();
        });
        it('正常子目录返回相对路径（回归保护）', () => {
            expect(getRelativePathUnderDir('C:/text-model/PMX/Sub/foo.pmx', 'C:/text-model/PMX')).toBe('Sub/foo.pmx');
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
            expect(splitSubdirSegments('C:/text-model/PMX', 'C:/text-model/PMX/../VMD/Sub')).toBeNull();
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
