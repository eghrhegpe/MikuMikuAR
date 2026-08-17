import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import { dom } from '../../core/config';
import { showPopupMenu } from '../../menus/menu-factory';
import { closeAllOverlays, disposeMenuWrapper } from '../../menus/menu-overlay';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';
import type { PopupLevel, PopupRow } from '../../core/config';

// ─── REPRO: 复现「弹窗被其他根菜单销毁后无法重建」 ───

function rows(n: number): PopupRow[] {
    const arr: PopupRow[] = [];
    for (let i = 0; i < n; i++) {
        arr.push({ kind: 'action' as const, label: '行' + i, icon: 'i', target: 't' + i });
    }
    return arr;
}

describe('REPRO-1 销毁后无法重建', () => {
    let sceneOverlay: HTMLElement;
    let storedMenu: SlideMenu | null = null;

    beforeEach(() => {
        storedMenu = null;
        sceneOverlay = document.createElement('div');
        sceneOverlay.id = 'sceneOverlay';
        document.body.appendChild(sceneOverlay);
        (dom as any).sceneOverlay = sceneOverlay;
    });

    afterEach(() => {
        storedMenu?.dispose();
        storedMenu = null;
        disposeMenuWrapper('repro1');
        sceneOverlay.remove();
        (dom as any).sceneOverlay = null;
    });

    const build = () =>
        showPopupMenu({
            wrapperKey: 'repro1',
            popupType: 'model',
            buildRoot: () => makeTestLevel('根', '', rows(3)),
            handlers: {},
            getMenu: () => storedMenu,
            setMenu: (m) => {
                storedMenu = m;
            },
        });

    it('closeAllOverlays 清除 wrapper 后，再次 show 仍能渲染', async () => {
        build();
        await new Promise((r) => requestAnimationFrame(r));
        // 第一次正常
        expect(sceneOverlay.querySelectorAll('.slide-item').length).toBe(3);

        // 模拟「被其他根菜单销毁」：closeAllOverlays 清除 menu wrapper 注册表 + 移除 DOM
        document.querySelectorAll('[data-overlay].visible').forEach((e) => {
            (e as HTMLElement).classList.remove('visible');
        });
        closeAllOverlays();

        // storedMenu 未被置 null（closeAllOverlays 不通知 onClose/dispose）
        expect(storedMenu).not.toBeNull();

        // 再次 show —— 期望重建并能看到内容
        build();
        await new Promise((r) => requestAnimationFrame(r));
        const wrappers = sceneOverlay.querySelectorAll('.menu-wrapper');
        expect(sceneOverlay.querySelectorAll('.slide-item').length).toBe(3);
    });
});

describe('REPRO-2 动画结束变空白', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        const m = makeTestMenu({ container });
        menu = m.menu;
    });

    afterEach(() => {
        menu.dispose();
        container.remove();
    });

    it('push 触发 reRender（transitioning 期间）后，动画结束内容仍完整', async () => {
        menu.reset(makeTestLevel('根', '', rows(3)));
        await new Promise((r) => requestAnimationFrame(r));

        // push 子级；push 期间 transitioning=true
        menu.push(makeTestLevel('子', '', rows(2)));
        // 动画进行中触发一次 reRender（会被缓存为 pending）
        menu.reRender();
        // 走 fallback 定时器完成 push 动画：150ms fadeOut + 200ms fadeIn
        await new Promise((r) => setTimeout(r, 420));
        expect(container.querySelectorAll('.slide-item').length).toBe(2);
    });
});