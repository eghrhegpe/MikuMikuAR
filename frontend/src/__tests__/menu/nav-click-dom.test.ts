import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sceneMockSuperset } from '../mocks/scene-superset';

// ─── nav 按钮 → overlay 渲染（happy-dom 试点）────────────────────────
// [fix:P1] 证明「点 nav 按钮 → sceneOverlay 渲染」链路可在 happy-dom 直测，
// 无需真实 WebGL/GPU——纯 UI 测试从渲染器解耦的第一步。
// 已落地（同批次）：nav-actions 把 `./library` 静态 import 改为动态 import
// （loadLibrary 惰性缓存 + 错误处理）。注意：动态 import 只切断 nav-actions 自身的
// 模块边（chunk 求值失败时 nav 接线/桥注册仍存活）；生产启动链仍经
// plaza-browser → plaza-download 静态拉 library → library-core → scene.ts，
// 本改动是韧性提升而非「切断渲染器链」根因修复。
// 隔离方式：vi.mock scene 模块（顶层 `new Scene(engine)` 依赖真实 WebGL，
// happy-dom 无 GPU 必崩）+ mock env-menu/library/scene-menu/settings/assistant
// （点击 handler 的动态 import 目标，断言其 showFn 被调用——不拉真实依赖树）。
// plaza 链 mock 同理（循环依赖 + 独立 webviewLayer 关闭语义）。
// ⚠️ 单用例约束：dom.ts 模块级捕获按钮引用，跨用例重建 DOM 后 dom.btn* 指向旧节点
// （新按钮无 listener），故 beforeEach 先 vi.resetModules() 再 setup DOM + 动态 import，
// 保证每个用例拿到重新捕获的 dom 引用。
vi.mock('../../scene/scene', () => sceneMockSuperset());
const plazaMock = vi.hoisted(() => ({
    showPlaza: vi.fn(() => undefined),
    // 真实 closePlaza 负责移除 webviewLayer 的 visible；mock 同步模拟该副作用，
    // 否则「再点广场按钮 → closePlaza」无法断言 overlay 关闭。
    closePlaza: vi.fn(() => {
        document.getElementById('webviewLayer')?.classList.remove('visible');
    }),
}));
vi.mock('../../menus/plaza-browser', () => ({ showPlaza: plazaMock.showPlaza }));
vi.mock('../../menus/plaza-state', () => ({ closePlaza: plazaMock.closePlaza }));
// [fix:P1] mock env-menu：点击 #btnEnv 走动态 import('./env-menu')，真模块会拉起
// env-sky/env-wind/lighting 等整棵依赖树（happy-dom 求值 >10ms 且脆弱），
// mock 后 showEnvMenu 可被 spy 断言「点击确实触发了面板渲染函数」。
const envMock = vi.hoisted(() => ({ showEnvMenu: vi.fn(() => undefined) }));
vi.mock('../../menus/env-menu', () => ({ showEnvMenu: envMock.showEnvMenu }));
// [fix:P1] mock library：直接覆盖本次动态 import 变更点——btnMainAction/btnMotionPopup
// 经 loadLibrary() 加载，mock 后断言 showModelPopup/showMotionPopup 被调用 + overlay 切换。
const libMock = vi.hoisted(() => ({
    showModelPopup: vi.fn(() => undefined),
    showMotionPopup: vi.fn(() => undefined),
}));
vi.mock('../../menus/library', () => libMock);
const sceneMenuMock = vi.hoisted(() => ({ showSceneMenu: vi.fn(() => undefined) }));
vi.mock('../../menus/scene-menu', () => ({ showSceneMenu: sceneMenuMock.showSceneMenu }));
const settingsMock = vi.hoisted(() => ({
    showSettings: vi.fn(() => undefined),
    preloadAutoImportState: vi.fn(() => Promise.resolve()),
    preloadDownloadWatchState: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../menus/settings', () => settingsMock);
const assistantMock = vi.hoisted(() => ({ showAssistant: vi.fn(() => undefined) }));
vi.mock('../../menus/assistant-panel', () => ({ showAssistant: assistantMock.showAssistant }));

function setupDomSkeleton(): void {
    document.body.innerHTML = `
        <canvas id="renderCanvas"></canvas>
        <div id="statusBar" style="display:none"></div>
        <div id="statusText"></div>
        <div id="fpsClock"></div>
        <div id="runtimeBadge"></div>
        <div id="loading" style="display:none"></div>
        <button id="btnMainAction" aria-controls="sceneOverlay" data-popup-type="model"></button>
        <button id="btnMotionPopup" aria-controls="sceneOverlay" data-popup-type="motion"></button>
        <div id="playbackBar"></div>
        <button id="btnPlayPause"></button>
        <button id="btnLoopToggle"></button>
        <div id="timeDisplay"></div>
        <div id="seekBar"></div>
        <div id="seekProgress"></div>
        <div id="loadingText"></div>
        <button id="btnSettings" aria-controls="sceneOverlay" data-popup-type="settings"></button>
        <button id="btnScene" aria-controls="sceneOverlay" data-popup-type="scene"></button>
        <button id="btnEnv" aria-controls="sceneOverlay" data-popup-type="env"></button>
        <button id="btnAssistant" aria-controls="sceneOverlay" data-popup-type="assistant"></button>
        <button id="btnPlaza" aria-controls="sceneOverlay" data-popup-type="plaza"></button>
        <div id="sceneOverlay" data-overlay></div>
        <div id="webviewLayer" data-overlay></div>
    `;
}

describe('nav 按钮 → overlay 渲染（happy-dom 试点，渲染器已隔离）', () => {
    let navModule: typeof import('../../menus/nav-actions') | undefined;

    beforeEach(() => {
        vi.resetModules();
        envMock.showEnvMenu.mockClear();
        libMock.showModelPopup.mockClear();
        libMock.showMotionPopup.mockClear();
        sceneMenuMock.showSceneMenu.mockClear();
        settingsMock.showSettings.mockClear();
        settingsMock.preloadAutoImportState.mockClear();
        settingsMock.preloadDownloadWatchState.mockClear();
        assistantMock.showAssistant.mockClear();
        plazaMock.showPlaza.mockClear();
        plazaMock.closePlaza.mockClear();
    });

    afterEach(async () => {
        navModule?.disposeNavBindings();
        navModule = undefined;
        const overlayModule = await import('../../menus/menu-overlay');
        overlayModule.closeAllOverlays();
        document.body.innerHTML = '';
    });

    it('点击 #btnEnv/#btnMainAction/#btnMotionPopup 均触发 showFn 且 overlay 切换', async () => {
        setupDomSkeleton();
        const nav = await import('../../menus/nav-actions');
        navModule = nav;
        // [fix:P1] 显式重接线：模块加载顶层 initNavActions() 已执行一次（绑定当前 DOM），
        // 幂等调用仅为语义明确；配合 beforeEach resetModules，DOM 引用已重新捕获。
        nav.initNavActions();
        const overlay = document.getElementById('sceneOverlay')!;

        // 1) #btnEnv → showEnvMenu 被调用 + overlay 打开（动态 import 链路）
        document.getElementById('btnEnv')!.click();
        await vi.waitFor(() => {
            expect(envMock.showEnvMenu).toHaveBeenCalled();
            expect(overlay.classList.contains('visible')).toBe(true);
        });

        // 2) 交叉切换：#btnMainAction → showModelPopup（不同 showFn → cross-fade 打开）
        document.getElementById('btnMainAction')!.click();
        await vi.waitFor(() => {
            expect(libMock.showModelPopup).toHaveBeenCalled();
            expect(overlay.classList.contains('visible')).toBe(true);
        });

        // 3) 再次点击 #btnMainAction → toggle 关闭（动态 import 下引用同一性保持）
        document.getElementById('btnMainAction')!.click();
        await vi.waitFor(() => {
            expect(overlay.classList.contains('visible')).toBe(false);
        });

        // 4) #btnMotionPopup → showMotionPopup + 打开，再点关闭
        document.getElementById('btnMotionPopup')!.click();
        await vi.waitFor(() => {
            expect(libMock.showMotionPopup).toHaveBeenCalled();
            expect(overlay.classList.contains('visible')).toBe(true);
        });
        document.getElementById('btnMotionPopup')!.click();
        await vi.waitFor(() => {
            expect(overlay.classList.contains('visible')).toBe(false);
        });

        // 5) navActions[1] 快捷键 → 与 click handler 同源（shortcut 映射）
        await nav.navActions[1]();
        expect(overlay.classList.contains('visible')).toBe(true);
        await nav.navActions[1]();
        expect(overlay.classList.contains('visible')).toBe(false);
    });

    it('点击 #btnScene/#btnSettings/#btnAssistant 触发对应 showFn 且 overlay 打开', async () => {
        setupDomSkeleton();
        const nav = await import('../../menus/nav-actions');
        navModule = nav;
        nav.initNavActions();
        const overlay = document.getElementById('sceneOverlay')!;

        document.getElementById('btnScene')!.click();
        await vi.waitFor(() => {
            expect(sceneMenuMock.showSceneMenu).toHaveBeenCalled();
            expect(overlay.classList.contains('visible')).toBe(true);
        });

        document.getElementById('btnSettings')!.click();
        await vi.waitFor(() => {
            expect(settingsMock.showSettings).toHaveBeenCalled();
            expect(settingsMock.preloadAutoImportState).toHaveBeenCalled();
            expect(settingsMock.preloadDownloadWatchState).toHaveBeenCalled();
            expect(overlay.classList.contains('visible')).toBe(true);
        });

        document.getElementById('btnAssistant')!.click();
        await vi.waitFor(() => {
            expect(assistantMock.showAssistant).toHaveBeenCalled();
            expect(overlay.classList.contains('visible')).toBe(true);
        });
    });

    it('点击 #btnPlaza 打开 webviewLayer，再次点击走 closePlaza 关闭', async () => {
        setupDomSkeleton();
        const nav = await import('../../menus/nav-actions');
        navModule = nav;
        nav.initNavActions();
        const layer = document.getElementById('webviewLayer')!;

        document.getElementById('btnPlaza')!.click();
        await vi.waitFor(() => {
            expect(plazaMock.showPlaza).toHaveBeenCalled();
            expect(layer.classList.contains('visible')).toBe(true);
        });

        document.getElementById('btnPlaza')!.click();
        await vi.waitFor(() => {
            expect(plazaMock.closePlaza).toHaveBeenCalled();
            expect(layer.classList.contains('visible')).toBe(false);
        });
    });
});
