import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { bundles } from '../core/i18n/t';
import { zhCN } from '../core/i18n/locales/zh-CN';
import {
    openFullscreen,
    closeFullscreen,
    getCurrentState,
    setCurrentState,
} from '../core/ui-fullscreen-overlay';

// [回归] 全屏 overlay 返回栈：
// 1) 仅能从 CLOSED 打开，关闭后还原 CLOSED（不再依赖 EMBEDDED_GRID 硬门槛，
//    修复 list 模式 ⛶ 死按钮）；
// 2) 返回键必须重渲染「父级」而非「子级」（修复旧 navigate/back 把 Child render 压栈、
//    返回时又渲染 Child 的 bug）；
// 3) 进入文件夹走 overlay.navigate 重渲染当前面板，不触碰被冻结的 SlideMenu 栈。
// 4) 所有关闭入口（handle.close / ← / ✕ / Escape / 背景点击 / closeFullscreen）
//    都必须且只能触发一次 onBack，保证调用方资源释放不泄漏、不重复释放。

beforeAll(() => {
    bundles['zh-CN'] = zhCN;
});

function findOverlayButton(text: string): HTMLButtonElement {
    const btn = Array.from(document.querySelectorAll('.fullscreen-overlay button')).find(
        (b) => (b as HTMLButtonElement).textContent === text
    ) as HTMLButtonElement | undefined;
    expect(btn).toBeTruthy();
    return btn!;
}

describe('FullscreenOverlay navigation', () => {
    beforeEach(() => {
        closeFullscreen();
        setCurrentState('CLOSED');
        document
            .querySelectorAll('.fullscreen-overlay, .slide-menu, .slide-menu-container')
            .forEach((el) => el.remove());
    });

    afterEach(() => {
        closeFullscreen();
        document
            .querySelectorAll('.fullscreen-overlay, .slide-menu, .slide-menu-container')
            .forEach((el) => el.remove());
    });

    it('opens only from CLOSED, no-op second open, handle.close restores CLOSED and fires onBack once', () => {
        setCurrentState('CLOSED');
        const onBack = vi.fn();
        const handle = openFullscreen({
            title: 'Root',
            onBack,
            renderContent: (container) => {
                const p = document.createElement('p');
                p.textContent = 'root content';
                container.appendChild(p);
            },
        });

        expect(getCurrentState()).toBe('FULLSCREEN');
        expect(document.querySelectorAll('.fullscreen-overlay').length).toBe(1);
        expect(handle.getElement()).toBe(document.querySelector('.fullscreen-overlay'));
        expect(handle.getElement().textContent).toContain('Root');
        expect(typeof handle.close).toBe('function');
        expect(typeof handle.getElement).toBe('function');

        // 已在全屏时再次 open 应返回 no-op handle，不能影响当前 overlay
        const second = openFullscreen({
            title: 'X',
            onBack: vi.fn(),
            renderContent: () => {},
        });
        expect(second).not.toBe(handle);
        expect(second.getElement().isConnected).toBe(false);
        expect(getCurrentState()).toBe('FULLSCREEN');
        expect(document.querySelectorAll('.fullscreen-overlay').length).toBe(1);

        // no-op handle.close 不得关闭真实 overlay
        second.close();
        expect(getCurrentState()).toBe('FULLSCREEN');
        expect(document.querySelectorAll('.fullscreen-overlay').length).toBe(1);
        expect(onBack).not.toHaveBeenCalled();

        // 程序化关闭走同一 onBack 契约
        handle.close();
        expect(getCurrentState()).toBe('CLOSED');
        expect(document.querySelectorAll('.fullscreen-overlay').length).toBe(0);
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('back button re-renders the PARENT level, not the child', () => {
        const renders: string[] = [];
        openFullscreen({
            title: 'Root',
            onBack: () => {},
            renderContent: (container, navigate) => {
                renders.push('root');
                const trigger = document.createElement('button');
                trigger.className = 'folder-trigger';
                trigger.addEventListener('click', () => {
                    navigate('Child', () => {
                        renders.push('child');
                    });
                });
                container.appendChild(trigger);
            },
        });

        // 进入子文件夹
        const trigger = document.querySelector('.folder-trigger') as HTMLButtonElement;
        trigger.click();
        expect(renders).toEqual(['root', 'child']);

        // 点击返回（← 按钮）
        findOverlayButton('←').click();

        // 返回必须重渲染父级（root），而非停留在或再次渲染子级（child）
        expect(renders[renders.length - 1]).toBe('root');
        expect(renders).toEqual(['root', 'child', 'root']);
        expect(getCurrentState()).toBe('FULLSCREEN');
        expect(document.querySelector('.fullscreen-header span')?.textContent).toBe('Root');
    });

    it('root back button (←) closes and fires onBack once', () => {
        const onBack = vi.fn();
        openFullscreen({
            title: 'Root',
            onBack,
            renderContent: () => {},
        });

        findOverlayButton('←').click();

        expect(getCurrentState()).toBe('CLOSED');
        expect(document.querySelectorAll('.fullscreen-overlay').length).toBe(0);
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('close (✕) restores CLOSED without pushing frozen SlideMenu stack and fires onBack once', () => {
        const onBack = vi.fn();
        openFullscreen({
            title: 'Root',
            onBack,
            renderContent: (container, navigate) => {
                const trigger = document.createElement('button');
                trigger.className = 'folder-trigger';
                trigger.addEventListener('click', () => navigate('Child', () => {}));
                container.appendChild(trigger);
            },
        });
        (document.querySelector('.folder-trigger') as HTMLButtonElement).click();

        findOverlayButton('✕').click();

        // 关闭后状态还原；overlay 已从 DOM 移除
        expect(getCurrentState()).toBe('CLOSED');
        expect(document.querySelectorAll('.fullscreen-overlay').length).toBe(0);
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('Escape inside overlay closes, cleans up, and fires onBack once', () => {
        const onBack = vi.fn();
        openFullscreen({
            title: 'Root',
            onBack,
            renderContent: (container) => {
                const btn = document.createElement('button');
                btn.className = 'inside-button';
                btn.textContent = 'inside';
                container.appendChild(btn);
            },
        });
        const overlay = document.querySelector('.fullscreen-overlay') as HTMLElement;
        overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(getCurrentState()).toBe('CLOSED');
        expect(document.querySelectorAll('.fullscreen-overlay').length).toBe(0);
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('background click closes and fires onBack once', () => {
        const onBack = vi.fn();
        openFullscreen({
            title: 'Root',
            onBack,
            renderContent: (container) => {
                const inner = document.createElement('div');
                inner.className = 'inner-content';
                container.appendChild(inner);
            },
        });

        const overlay = document.querySelector('.fullscreen-overlay') as HTMLElement;
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(getCurrentState()).toBe('CLOSED');
        expect(document.querySelectorAll('.fullscreen-overlay').length).toBe(0);
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('freezes and restores SlideMenu display', () => {
        const menu = document.createElement('div');
        menu.className = 'slide-menu';
        menu.style.display = 'block';
        document.body.appendChild(menu);

        const onBack = vi.fn();
        openFullscreen({
            title: 'Root',
            onBack,
            renderContent: () => {},
        });

        expect(menu.style.display).toBe('none');
        expect(menu.dataset.previousDisplay).toBe('block');

        closeFullscreen();

        expect(menu.style.display).toBe('block');
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('freezes and restores every visible SlideMenu, preserving original display', () => {
        const menuA = document.createElement('div');
        menuA.className = 'slide-menu';
        menuA.style.display = 'block';
        document.body.appendChild(menuA);

        const menuB = document.createElement('div');
        menuB.className = 'slide-menu';
        menuB.style.display = 'flex';
        document.body.appendChild(menuB);

        const onBack = vi.fn();
        openFullscreen({
            title: 'Root',
            onBack,
            renderContent: () => {},
        });

        expect(menuA.style.display).toBe('none');
        expect(menuB.style.display).toBe('none');

        closeFullscreen();

        expect(menuA.style.display).toBe('block');
        expect(menuB.style.display).toBe('flex');
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
