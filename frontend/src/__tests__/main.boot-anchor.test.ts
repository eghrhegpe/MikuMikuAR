// main.boot-anchor.test.ts — [fix:audit] main.ts 加载锚点回归测试（防 P0 复发）
//
// 背景（v1.9.0 P0）：menus 子系统曾因加载锚点丢失而从未加载——nav-actions 的
// 按钮接线 + ui-action-bridge 注册、library-setup 的 scene-action-bridge 注册
// 全部静默缺失，导致 navAction/toggleOverlayMode/handleAndroidBack/initLibrary
// 桥接未注册、按钮无响应，且现有测试套件无一捕获（240+ 测试文件没有一个 import
// main.ts / library-setup / nav-actions）。
//
// 本测试 import main.ts（真实入口），把与锚点链无关的重依赖（bootstrap / SW /
// scene / menu 等 UI 组件树）mock 成 no-op，但保留锚点链模块（library-setup →
// nav-actions → library-core → library-actions）的**真实模块顶层副作用**，断言
// ui-action/scene-action 桥接注册确实生效：
//   - 若 main.ts 的 `import '../menus/library-setup'` 被删/改名/被 tree-shake，
//     library-setup 链不加载 → 桥接不注册 → 断言失败（P0 复发被 CI 拦截）。
//   - 若 nav-actions/library-setup 的模块顶层注册被移进函数内部，同样拦截。
//   - 桥接模块（ui-action-bridge / scene-action-bridge）**不 mock**——它们是断言对象。
import { describe, it, expect, vi } from 'vitest';
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

// ── 与锚点链无关的重依赖 mock（保持 main.ts 其余副作用最小化）──
vi.mock('../core/init', () => ({
    bootstrap: vi.fn(),
}));
vi.mock('../core/sw-register', () => ({
    registerServiceWorker: vi.fn(),
}));
// library-core / library-setup 依赖树（对齐 library-actions.test.ts 的成熟 mock 集合）
vi.mock('../scene/scene', () => ({
    ...sceneFactory(),
    pushUndoSnapshot: vi.fn(),
    offerSceneUndoAndRefresh: vi.fn(),
    triggerAutoSave: vi.fn(),
}));
vi.mock('../core/wails-bindings', () => wailsBindingsFactory());
vi.mock('../core/load-manager', () => loadManagerFactory());
vi.mock('./model-detail', () => modelDetailFactory());
vi.mock('../menus/scene-menu', () => sceneMenuFactory());
vi.mock('./menu', () => menuFactory());
vi.mock('../core/icons', () => iconsFactory());
vi.mock('../core/status-bar', () => statusBarFactory());
vi.mock('../core/ui-helpers', () => uiHelpersFactory(capturedSlideRows));
vi.mock('../core/config', () => configModuleFactory(mockState));
vi.mock('@/core/library-path', () => libraryPathFactory(mockState));
vi.mock('../scene/manager/model-ops', () => ({
    captureInheritedState: vi.fn(() => null),
    applyInheritedState: vi.fn(),
}));
vi.mock('../core/toast', () => ({ showErrorToast: vi.fn(), showInfoToast: vi.fn() }));
vi.mock('../core/dom', () => ({
    addDisposableListener: vi.fn(() => ({ dispose: vi.fn() })),
    dom: {
        btnMainAction: null,
        btnMotionPopup: null,
        btnScene: null,
        btnEnv: null,
        btnSettings: null,
        btnAssistant: null,
        btnPlaza: null,
    },
}));
vi.mock('./menu-stack-registry', () => ({
    stackRegistry: { modelStack: null, buildLevel: null },
}));
vi.mock('./menu-overlay', () => ({
    closeAllOverlays: vi.fn(),
    setOnCloseAllOverlays: vi.fn(),
}));
vi.mock('./library-browse', () => ({ showModelPopup: vi.fn() }));
vi.mock('./motion-popup', () => ({
    showMotionPopup: vi.fn(),
    getMotionMenu: vi.fn(),
    refreshMotionRoot: vi.fn(),
    buildBrowseLevel: vi.fn(),
}));
vi.mock('./plaza-browser', () => ({ showPlaza: vi.fn() }));
vi.mock('./plaza-state', () => ({ closePlaza: vi.fn() }));
vi.mock('../core/backend', () => ({ getCachedCapabilities: vi.fn(() => null) }));
vi.mock('../core/backend/browser-adapter', () => ({
    getFsaAuthState: vi.fn(),
    isFsaAuthPromptDismissed: vi.fn(() => false),
    dismissFsaAuthPrompt: vi.fn(),
    reauthorizeFsaRoot: vi.fn(),
}));
vi.mock('../core/dialog', () => ({
    showConfirm: vi.fn(() => Promise.resolve(true)),
    showInfoToast: vi.fn(),
    disposeOverlay2: vi.fn(),
}));
vi.mock('../core/feedback', () => ({ feedbackStatus: vi.fn() }));
vi.mock('../core/status-helpers', () => ({ tryCatchStatus: vi.fn() }));
vi.mock('../core/safe-call', () => ({ safeCallAsync: vi.fn() }));
vi.mock('../core/ui-resource-panel', () => ({ notifyThumbnailUpdate: vi.fn() }));
vi.mock('../core/shortcut-registry', () => ({
    getAllShortcuts: vi.fn(() => []),
    getAriaKeyshortcuts: vi.fn(() => ''),
}));

// 真实 import main.ts：执行锚点链（library-setup → nav-actions 等模块顶层副作用）。
// 必须在 mock 声明之后（vi.mock 会被 hoist，静态 import 顺序安全）。
import '../core/main';
import { getUiAction } from '../core/ui-action-bridge';
import { getSceneAction } from '../core/scene-action-bridge';
import { bootstrap } from '../core/init';
import { registerServiceWorker } from '../core/sw-register';

describe('main.ts 加载锚点（menus 子系统）', () => {
    it('bootstrap 与 SW 注册被 mock 为 no-op（本测试只验锚点链）', () => {
        expect(bootstrap).toHaveBeenCalledTimes(1);
        expect(registerServiceWorker).toHaveBeenCalledTimes(1);
    });

    it('nav-actions 桥接已注册：navAction / toggleOverlayMode / handleAndroidBack / navLabel', () => {
        expect(getUiAction('navAction')).toBeTypeOf('function');
        expect(getUiAction('toggleOverlayMode')).toBeTypeOf('function');
        expect(getUiAction('handleAndroidBack')).toBeTypeOf('function');
        expect(getUiAction('navLabel')).toBeTypeOf('function');
    });

    it('library-setup 桥接已注册：initLibrary / refreshLibrary', () => {
        expect(getSceneAction('initLibrary')).toBeTypeOf('function');
        expect(getSceneAction('refreshLibrary')).toBeTypeOf('function');
    });
});
