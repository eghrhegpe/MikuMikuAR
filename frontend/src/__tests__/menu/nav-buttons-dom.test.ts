import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── nav 按钮静态 DOM 断言（happy-dom 试点）─────────────────────────
// 直接读取真实 frontend/index.html，验证「渲染层静态 DOM 契约」而不是自证
// 测试内手工拼接的骨架；与 nav-click-dom.test.ts 共用语义（此处仅验证「存在」，
// 交互链路见该文件）。注意：happy-dom 无 CSS 布局，getBoundingClientRect 全 0，
// 故断言「存在」而非 e2e 的「toBeVisible」。

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');

function setupFromIndexHtml(): void {
    const match = INDEX_HTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    // happy-dom 不会执行脚本；保留 script 会让 innerHTML 解析器尝试加载模块并刷错误日志。
    const bodyHtml = (match ? match[1] : '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    document.body.innerHTML = bodyHtml;
}

const NAV_BUTTON_IDS = [
    'btnMainAction',
    'btnMotionPopup',
    'btnScene',
    'btnEnv',
    'btnSettings',
    'btnAssistant',
    'btnPlaza',
] as const;

describe('nav 按钮静态 DOM（happy-dom，无渲染器）', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('renderCanvas 存在（app 渲染锚点）', () => {
        setupFromIndexHtml();
        expect(document.getElementById('renderCanvas')).toBeTruthy();
    });

    it('7 个 nav 按钮全集存在（模型/动作/场景/环境/设置/AI/广场）', () => {
        setupFromIndexHtml();
        for (const id of NAV_BUTTON_IDS) {
            expect(document.getElementById(id), `缺少 #${id}`).toBeTruthy();
        }
    });

    it('sceneOverlay 与 webviewLayer 存在（SlideMenu 共享容器 + 广场独立全屏层）', () => {
        setupFromIndexHtml();
        expect(document.getElementById('sceneOverlay')).toBeTruthy();
        expect(document.getElementById('webviewLayer')).toBeTruthy();
    });
});
