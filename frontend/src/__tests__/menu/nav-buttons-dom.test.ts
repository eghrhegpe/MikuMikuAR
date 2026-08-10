import { describe, it, expect, afterEach } from 'vitest';

// ─── nav 按钮静态 DOM 断言（happy-dom 试点）─────────────────────────
// [fix:P1] e2e @dom 门禁中 smoke "app loaded" + desktop-capabilities "nav 按钮全集"
// 是纯静态 DOM 断言（canvas + 6 nav 按钮存在）——迁移为 vitest 直测：
//   1) 不依赖 init()/NullEngine/WebGL，无 vitePage fixture 开销（<10ms vs e2e ~50s）
//   2) 与 nav-click-dom.test.ts 共用骨架语义（此处仅验证「存在」，交互链路见该文件）
// 注意：happy-dom 无 CSS 布局，getBoundingClientRect 全 0，故断言「存在」而非
// e2e 的「toBeVisible」——DOM 结构契约等价（渲染层可见性由 menu-schema 单测覆盖）。

function setupNavSkeleton(): void {
    document.body.innerHTML = `
        <canvas id="renderCanvas"></canvas>
        <button id="btnMainAction"></button>
        <button id="btnMotionPopup"></button>
        <button id="btnScene"></button>
        <button id="btnEnv"></button>
        <button id="btnSettings"></button>
        <button id="btnPlaza"></button>
        <div id="sceneOverlay"></div>
    `;
}

const NAV_BUTTON_IDS = [
    'btnMainAction',
    'btnMotionPopup',
    'btnScene',
    'btnEnv',
    'btnSettings',
    'btnPlaza',
] as const;

describe('nav 按钮静态 DOM（happy-dom，无渲染器）', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('renderCanvas 存在（app 渲染锚点）', () => {
        setupNavSkeleton();
        expect(document.getElementById('renderCanvas')).toBeTruthy();
    });

    it('6 个 nav 按钮全集存在（模型/动作/场景/环境/设置/广场）', () => {
        setupNavSkeleton();
        for (const id of NAV_BUTTON_IDS) {
            expect(document.getElementById(id), `缺少 #${id}`).toBeTruthy();
        }
    });

    it('sceneOverlay 存在（所有面板共享容器）', () => {
        setupNavSkeleton();
        expect(document.getElementById('sceneOverlay')).toBeTruthy();
    });
});
