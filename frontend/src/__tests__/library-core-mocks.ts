// @ts-nocheck — vi.mock 工厂 + 共享 helper（library-core 拆分测试用）
// mock 类均直接内联（无外部依赖），vi.hoisted mockState 由各测试文件提供。
import { vi } from 'vitest';
import { sceneMockSuperset } from './mocks/scene-superset';

// ---- vi.hoisted state 工厂（由各测试文件通过 vi.hoisted(() => createMockState()) 调用）----

export function createMockState() {
    return {
        allModels: [] as any[],
        libraryRoot: '/test/root',
        displayNamePriority: 'filename' as string,
        librarySortMode: 'default' as string,
        modelMetaCache: new Map<string, any>(),
        recentModels: [] as string[],
        focusedModelId: null as string | null,
    };
}

// ---- vi.mock 工厂（接收测试文件的 mockState / capturedSlideRows 等）----

export function sceneFactory() {
    return {
        ...sceneMockSuperset(),
        loadPMXFile: vi.fn(),
        loadVMDFromPath: vi.fn(),
        removeModel: vi.fn(),
        loadAudioFile: vi.fn(),
        loadVPDPose: vi.fn(),
    };
}

export function wailsBindingsFactory() {
    return {
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
        GetLastBrowseDir: vi.fn(),
        SetLastBrowseDir: vi.fn(),
        GetAllTags: vi.fn(),
        GetModelsByTag: vi.fn(),
        SelectAudioFile: vi.fn(),
        SelectVMDMotion: vi.fn(),
        SelectVPDPose: vi.fn(),
        SetUIState: vi.fn().mockResolvedValue(undefined),
    };
}

export function loadManagerFactory() {
    return { loadManager: { load: vi.fn() } };
}

export function modelDetailFactory() {
    return { buildModelLevel: vi.fn() };
}

export function sceneMenuFactory() {
    return { buildStageTransformLevel: vi.fn() };
}

export function menuFactory() {
    return { SlideMenu: vi.fn() };
}

export function iconsFactory() {
    return { createIconifyIcon: vi.fn(() => null) };
}

export function configModuleFactory(ms: any) {
    return {
        getBaseName: vi.fn((p: string) => p.split('/').pop() || p),
        get allModels() {
            return ms.allModels;
        },
        get libraryRoot() {
            return ms.libraryRoot;
        },
        get displayNamePriority() {
            return ms.displayNamePriority;
        },
        get librarySortMode() {
            return ms.librarySortMode;
        },
        get modelMetaCache() {
            return ms.modelMetaCache;
        },
        get recentModels() {
            return ms.recentModels;
        },
        get focusedModelId() {
            return ms.focusedModelId;
        },

        normPath: (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, ''),
        getBrowseDir: (category: string) => {
            if (category === 'prop') {
                return '/test/root/props';
            }
            if (category === 'stage') {
                return '/test/root/stages';
            }
            return '/test/root/models';
        },
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
        stackRegistry: { modelStack: null, buildLevel: null },
        uiState: {} as Record<string, unknown>,

        // Setters
        setStatus: vi.fn(),
        setLibraryRoot: vi.fn(),
        setResourceRoot: vi.fn(),
        setAllModels: vi.fn(),
        setDisplayNamePriority: vi.fn(),
        setOverridePaths: vi.fn(),
        setThumbnailCache: vi.fn(),
        setModelMetaCache: vi.fn(),
        setRecentModels: vi.fn(),
        setFocusedModelId: vi.fn(),
        closeAllOverlays: vi.fn(),
        modelRegistry: new Map(),
        LoadingGuard: class {
            tryEnter() {
                return true;
            }
            leave() {}
            isLoading() {
                return false;
            }
            clear() {}
        },
    };
}

// statusBarFactory：简单返回 { setStatus: vi.fn() }，不委托到 config。
// 注：importFile 测试需通过 withLoadingStatus 调用 status-bar.setStatus；若测试需要
// config.setStatus 同时捕捉这些调用，请在该文件内联委托版 vi.mock。
export function statusBarFactory() {
    return { setStatus: vi.fn() };
}

/** [fix:de-barreling] library-core 已从 core/config 改引 core/library-path，
 *  测试需同步 mock 该模块，否则 getBrowseDir / computeLibraryRef 读到真实空状态。 */
export function libraryPathFactory(_ms: any) {
    return {
        CATEGORY_DIR: {
            pmx: 'PMX',
            vmd: 'VMD',
            audio: 'audio',
            stage: 'stage',
            prop: 'prop',
            environment: 'environment',
            md_dress: 'MD-dress',
            setting: 'setting',
        },
        getBrowseDir: (category: string) => {
            if (category === 'prop') {
                return '/test/root/props';
            }
            if (category === 'stage') {
                return '/test/root/stages';
            }
            return '/test/root/models';
        },
        computeLibraryRef: (fp: string) => fp,
        resolveLibraryRef: (ref: string) => (ref ? `/test/root/${ref}` : null),
    };
}

export function uiHelpersFactory(capturedRows: any[]) {
    return {
        slideRow: vi.fn(
            (
                _card: any,
                icon: string,
                label: string,
                _isFolder: boolean,
                _onClick: any,
                sublabel?: string
            ) => {
                capturedRows.push({ icon, label, isFolder: _isFolder, sublabel });
            }
        ),
    };
}

// ---- Helpers ----

export function makeModel(overrides: Record<string, any> = {}): any {
    return {
        dir: '/test/root/models',
        file_path: '/test/root/models/model.pmx',
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

export function extractLevelRows(level: any, capturedRows: any[]): any[] {
    capturedRows.length = 0;
    const container = document.createElement('div');
    if (typeof level.renderCustom === 'function') {
        level.renderCustom(container);
    }
    return [...capturedRows];
}
