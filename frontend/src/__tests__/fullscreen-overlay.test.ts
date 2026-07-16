import { describe, it, expect, afterEach } from 'vitest';

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

describe('FullscreenOverlay navigation', () => {
    afterEach(() => {
        closeFullscreen();
        document.querySelectorAll('.fullscreen-overlay').forEach((el) => el.remove());
    });

    it('opens only from CLOSED and restores CLOSED on close', () => {
        setCurrentState('CLOSED');
        const handle = openFullscreen({
            title: 'Root',
            onBack: () => {},
            renderContent: () => {},
        });
        expect(getCurrentState()).toBe('FULLSCREEN');
        expect(typeof handle.close).toBe('function');
        expect(typeof handle.getElement).toBe('function');

        // 已在全屏时再次 open 应返回 no-op handle
        const second = openFullscreen({
            title: 'X',
            onBack: () => {},
            renderContent: () => {},
        });
        expect(second).not.toBe(handle);

        closeFullscreen();
        expect(getCurrentState()).toBe('CLOSED');
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
        const backBtn = Array.from(
            document.querySelectorAll('.fullscreen-overlay button')
        ).find((b) => (b as HTMLButtonElement).textContent === '←') as HTMLButtonElement;
        expect(backBtn).toBeTruthy();
        backBtn.click();

        // 返回必须重渲染父级（root），而非停留在或再次渲染子级（child）
        expect(renders[renders.length - 1]).toBe('root');
        expect(renders).toEqual(['root', 'child', 'root']);
    });

    it('close (✕) restores CLOSED without pushing frozen SlideMenu stack', () => {
        openFullscreen({
            title: 'Root',
            onBack: () => {},
            renderContent: (container, navigate) => {
                const trigger = document.createElement('button');
                trigger.className = 'folder-trigger';
                trigger.addEventListener('click', () => navigate('Child', () => {}));
                container.appendChild(trigger);
            },
        });
        (document.querySelector('.folder-trigger') as HTMLButtonElement).click();

        const closeBtn = Array.from(
            document.querySelectorAll('.fullscreen-overlay button')
        ).find((b) => (b as HTMLButtonElement).textContent === '✕') as HTMLButtonElement;
        closeBtn.click();

        // 关闭后状态还原；overlay 已从 DOM 移除
        expect(getCurrentState()).toBe('CLOSED');
        expect(document.querySelectorAll('.fullscreen-overlay').length).toBe(0);
    });
});
