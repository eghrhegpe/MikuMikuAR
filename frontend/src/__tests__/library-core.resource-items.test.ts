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
    makeModel,
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

vi.mock('../scene/scene', () => sceneFactory());
vi.mock('../core/wails-bindings', () => wailsBindingsFactory());
vi.mock('../core/load-manager', () => loadManagerFactory());
vi.mock('./model-detail', () => modelDetailFactory());
vi.mock('../menus/scene-menu', () => sceneMenuFactory());
vi.mock('./menu', () => menuFactory());
vi.mock('../core/icons', () => iconsFactory());
vi.mock('../core/status-bar', () => statusBarFactory());
vi.mock('../core/config', () => configModuleFactory(mockState));
vi.mock('../core/ui-helpers', () => ({ slideRow: vi.fn() }));

import { buildResourceItemsForDir, isLeafFlattenDir, resolveDisplayBrowseDir, computeRestoreSegments } from '../menus/library-core';

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
        expect(isLeafFlattenDir('/test/models/sub', models, (m: any) => m.format === 'pmx')).toBe(true);
        expect(isLeafFlattenDir('/test/models/sub', models, (m: any) => m.format === 'vmd')).toBe(true);
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
            computeRestoreSegments('/test/models', '/test/models/sub', models, (m: any) => m.format === 'pmx')
        ).toEqual([]);
        expect(
            computeRestoreSegments('/test/models', '/test/models/sub', models, (m: any) => m.format === 'vmd')
        ).toEqual([]);
    });
});
