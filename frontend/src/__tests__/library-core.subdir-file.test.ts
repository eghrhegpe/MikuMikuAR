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
// status-bar 委托到 config.setStatus: importFile 通过 withLoadingStatus 调用 status-bar
vi.mock('../core/status-bar', async () => {
    const config = await import('../core/config');
    return { setStatus: (...args: any[]) => (config as any).setStatus(...args) };
});
vi.mock('../core/config', () => configModuleFactory(mockState));
vi.mock('../core/ui-helpers', () => ({
    slideRow: vi.fn(
        (
            _card: any,
            icon: string,
            label: string,
            _isFolder: boolean,
            _onClick: any,
            sublabel?: string
        ) => {}
    ),
}));

import {
    splitSubdirSegments,
    importFile,
    getResourceViewMode,
    setResourceViewMode,
} from '../menus/library-core';

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
        await new Promise((r) => setTimeout(r, 10));
        expect(SetUIState).toHaveBeenCalledWith(
            expect.objectContaining({ resourceViewMode: 'grid' })
        );
    });
});
