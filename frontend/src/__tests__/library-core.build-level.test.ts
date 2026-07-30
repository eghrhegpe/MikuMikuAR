// @ts-nocheck — vi.mock 运行时替换（见 ./library-core-mocks）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    sceneFactory,
    wailsBindingsFactory,
    loadManagerFactory,
    modelDetailFactory,
    sceneMenuFactory,
    menuFactory,
    iconsFactory,
    statusBarFactory,
    configModuleFactory,
    libraryPathFactory,
    uiHelpersFactory,
    makeModel,
    extractLevelRows,
} from './library-core-mocks';

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
vi.mock('../core/status-bar', () => statusBarFactory());
vi.mock('../core/ui-helpers', () => uiHelpersFactory(capturedSlideRows));
vi.mock('../core/config', () => configModuleFactory(mockState));
vi.mock('../library/library-path', () => libraryPathFactory(mockState));

import { buildLevel } from '../menus/library-core';

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
