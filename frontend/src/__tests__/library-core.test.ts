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
}));

vi.mock('./model-detail', () => ({ buildModelDetailLevel: vi.fn() }));
vi.mock('../menus/scene-menu', () => ({ buildStageTransformLevel: vi.fn() }));
vi.mock('./motion-popup', () => ({ buildDanceSetDetailLevel: vi.fn(), loadDanceSets: vi.fn() }));
vi.mock('./menu', () => ({ SlideMenu: vi.fn() }));
vi.mock('../core/icons', () => ({ createIconifyIcon: vi.fn(() => null) }));
vi.mock('../core/ui-helpers', () => ({
    slideRow: vi.fn((_card: any, icon: string, label: string, _isFolder: boolean, _onClick: any, sublabel?: string, catTag?: string) => {
        capturedSlideRows.push({ icon, label, isFolder: _isFolder, sublabel, catTag });
    }),
}));

vi.mock('../core/config', () => ({
    get allModels() { return mockState.allModels; },
    get libraryRoot() { return mockState.libraryRoot; },
    get displayNamePriority() { return mockState.displayNamePriority; },
    get librarySortMode() { return mockState.librarySortMode; },
    get modelMetaCache() { return mockState.modelMetaCache; },
    get externalPaths() { return mockState.externalPaths; },
    get recentModels() { return mockState.recentModels; },
    get focusedModelId() { return mockState.focusedModelId; },
    get motionBindingTargetId() { return mockState.motionBindingTargetId; },

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

import { modelToRow, buildLevel } from '../menus/library-core';

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
            const m = makeModel({ file_path: '/root/models/miku.pmx', name_jp: 'ミク', name_en: 'Miku' });
            const row = modelToRow(m);
            expect(row.label).toBe('miku.pmx');
        });

        it('uses zip_inner filename for zip containers', () => {
            const m = makeModel({ container: 'zip', file_path: '/root/zips/model.zip', zip_inner: 'models/miku.pmx' });
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

    describe('sublabel', () => {
        it('truncates comment to 28 chars', () => {
            const m = makeModel({ comment: 'A very long comment that should be truncated by the function' });
            const row = modelToRow(m);
            expect(row.sublabel).toBe('A very long comment that sho');
            expect(row.sublabel!.length).toBe(28);
        });

        it('uses cached comment when available', () => {
            mockState.modelMetaCache.set('/r/miku.pmx', {
                name_en: '',
                name_jp: '',
                comment: 'Cached comment',
            });
            const m = makeModel({ file_path: '/r/miku.pmx' });
            const row = modelToRow(m);
            expect(row.sublabel).toBe('Cached comment');
        });

        it('is undefined when no comment', () => {
            const row = modelToRow(makeModel({ file_path: '/r/miku.pmx', comment: '' }));
            expect(row.sublabel).toBeUndefined();
        });
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

        it('sets catTag from category', () => {
            const m = makeModel({ category: 'VRM' });
            const row = modelToRow(m);
            expect(row.catTag).toBe('VRM');
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

    it('keeps leaf subdir as folder when every entry is zip', () => {
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
