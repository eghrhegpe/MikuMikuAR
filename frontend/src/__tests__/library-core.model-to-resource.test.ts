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
vi.mock('../core/ui-helpers', () => ({ slideRow: vi.fn() }));

import { modelToResourceItem } from '../menus/library-core';

describe('modelToResourceItem', () => {
    beforeEach(() => {
        mockState.displayNamePriority = 'filename';
        mockState.modelMetaCache.clear();
    });

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

    it('always uses filename as label regardless of displayNamePriority', () => {
        mockState.displayNamePriority = 'name_en';
        const model = makeModel({
            file_path: '/test/a.pmx',
            dir: '/test',
        });
        const item = modelToResourceItem(model);
        expect(item.label).toBe('a.pmx');
    });

    it('always uses filename when displayNamePriority is name_jp', () => {
        mockState.displayNamePriority = 'name_jp';
        const model = makeModel({
            file_path: '/test/a.pmx',
            dir: '/test',
        });
        const item = modelToResourceItem(model);
        expect(item.label).toBe('a.pmx');
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
