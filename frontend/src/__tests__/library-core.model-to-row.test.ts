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
vi.mock('../library/library-path', () => libraryPathFactory(mockState));

import { modelToRow } from '../menus/library-core';

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
