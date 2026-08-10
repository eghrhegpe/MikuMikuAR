import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── nav 按钮 → overlay 渲染（happy-dom 试点）────────────────────────
// [fix:P1] 证明「点 nav 按钮 → sceneOverlay 渲染」链路可在 happy-dom 直测，
// 无需真实 WebGL/GPU——纯 UI 测试从渲染器解耦的第一步。
// 已落地（同批次）：nav-actions 把 `./library` 静态 import 改为动态 import
// （loadLibrary 惰性缓存 + 错误处理）。注意：动态 import 只切断 nav-actions 自身的
// 模块边（chunk 求值失败时 nav 接线/桥注册仍存活）；生产启动链仍经
// plaza-browser → plaza-download 静态拉 library → library-core → scene.ts，
// 本改动是韧性提升而非「切断渲染器链」根因修复。
// 隔离方式：vi.mock scene 模块（顶层 `new Scene(engine)` 依赖真实 WebGL，
// happy-dom 无 GPU 必崩）+ mock env-menu/library（点击 handler 的动态 import 目标，
// 断言其 showFn 被调用——不拉真实 env-* 依赖树）。plaza 链 mock 同理（循环依赖）。
// ⚠️ 单用例约束：dom.ts 模块级捕获按钮引用，跨用例重建 DOM 后 dom.btn* 指向旧节点
// （新按钮无 listener），故全部断言必须同批节点完成（此前「单用例规避」注释同因）。
vi.mock('../../scene/scene', () => ({
    scene: { meshes: [] },
    engine: {},
    isHeadless: true,
    focusedModel: () => null,
    focusModel: () => undefined,
    modelManager: { models: [] },
    getRenderState: () => ({}),
    setRenderState: () => true,
    setEnvState: () => undefined,
}));
vi.mock('../../menus/plaza-browser', () => ({
    showPlaza: () => undefined,
}));
vi.mock('../../menus/plaza-state', () => ({
    closePlaza: () => undefined,
}));
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

function setupDomSkeleton(): void {
    document.body.innerHTML = `
        <canvas id="renderCanvas"></canvas>
        <div id="statusBar" style="display:none"></div>
        <div id="statusText"></div>
        <div id="fpsClock"></div>
        <div id="runtimeBadge"></div>
        <div id="loading" style="display:none"></div>
        <button id="btnMainAction"></button>
        <button id="btnMotionPopup"></button>
        <div id="playbackBar"></div>
        <button id="btnPlayPause"></button>
        <button id="btnLoopToggle"></button>
        <div id="timeDisplay"></div>
        <div id="seekBar"></div>
        <div id="seekProgress"></div>
        <div id="loadingText"></div>
        <button id="btnSettings"></button>
        <button id="btnScene"></button>
        <button id="btnEnv"></button>
        <button id="btnAssistant"></button>
        <button id="btnPlaza"></button>
        <div id="sceneOverlay"></div>
        <div id="webviewLayer"></div>
    `;
}

describe('nav 按钮 → overlay 渲染（happy-dom 试点，渲染器已隔离）', () => {
    beforeEach(() => {
        envMock.showEnvMenu.mockClear();
        libMock.showModelPopup.mockClear();
        libMock.showMotionPopup.mockClear();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('点击 #btnEnv/#btnMainAction + navActions[1] 均触发 showFn 且 overlay 切换', async () => {
        setupDomSkeleton();
        const nav = await import('../../menus/nav-actions');
        // [fix:P1] 显式重接线：模块加载顶层 initNavActions() 已执行一次（绑定当前 DOM），
        // 单用例下 DOM 未重建，listener 有效；此处幂等调用仅为语义明确。
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

        // 4) navActions[1] 快捷键 → 与 click handler 同源（shortcut 映射）
        await nav.navActions[1]();
        expect(libMock.showModelPopup).toHaveBeenCalled();
        expect(overlay.classList.contains('visible')).toBe(true);
        await nav.navActions[1]();
        expect(overlay.classList.contains('visible')).toBe(false);
    });
});
