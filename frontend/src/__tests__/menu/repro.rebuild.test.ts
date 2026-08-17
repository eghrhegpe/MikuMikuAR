import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import { dom } from '../../core/config';
import { showPopupMenu, registerPopupMenu } from '../../menus/menu-factory';
import { closeAllOverlays, disposeMenuWrapper } from '../../menus/menu-overlay';
import { makeTestLevel } from '../fixtures/menu';
import type { PopupRow } from '../../core/config';

// ─── 回归：弹窗经 closeAllOverlays 回收 wrapper 后必须能重建 ───
// 根因：closeAllOverlays（跨根切换/普通关闭）只回收 wrapper（ADR-252）不 dispose
// 存活实例；工厂复用分支随后把内容渲染进已脱离文档的旧容器 → 弹窗「无法再次重建」。
// 修复：复用前校验 menu.isContainerAttached，容器脱离即 dispose + 新建。

function rows(n: number): PopupRow[] {
    const arr: PopupRow[] = [];
    for (let i = 0; i < n; i++) {
        arr.push({ kind: 'action' as const, label: '行' + i, icon: 'i', target: 't' + i });
    }
    return arr;
}

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
    disposeMenuWrapper('rebuild-w');
    sceneOverlay.remove();
    (dom as any).sceneOverlay = null;
});

describe('showPopupMenu — closeAllOverlays 后可重建', () => {
    const build = () =>
        showPopupMenu({
            wrapperKey: 'rebuild-w',
            popupType: 'model',
            buildRoot: () => makeTestLevel('根', '', rows(3)),
            handlers: {},
            getMenu: () => storedMenu,
            setMenu: (m) => {
                storedMenu = m;
            },
        });

    it('wrapper 被 closeAllOverlays 回收后，再次 show 重建可见内容', async () => {
        build();
        await new Promise((r) => requestAnimationFrame(r));
        expect(sceneOverlay.querySelectorAll('.slide-item').length).toBe(3);

        // 模拟跨根切换：closeAllOverlays 清除 menu wrapper 注册表 + 移除 DOM
        document.querySelectorAll('[data-overlay].visible').forEach((e) => {
            (e as HTMLElement).classList.remove('visible');
        });
        closeAllOverlays();

        // 旧实例未被置 null（closeAllOverlays 不经 onClose/dispose）
        expect(storedMenu).not.toBeNull();
        // 其容器已脱离文档 → 复用时须丢弃重建
        expect(storedMenu!.isContainerAttached).toBe(false);

        build();
        await new Promise((r) => requestAnimationFrame(r));
        expect(storedMenu).not.toBeNull();
        expect(storedMenu!.isContainerAttached).toBe(true);
        expect(sceneOverlay.querySelectorAll('.slide-item').length).toBe(3);
    });

    it('容器仍挂载时正常复用，不重建新实例', async () => {
        build();
        await new Promise((r) => requestAnimationFrame(r));
        const first = storedMenu;
        expect(first).not.toBeNull();
        expect(first!.isContainerAttached).toBe(true);

        build(); // 未发生 wrapper 回收 → 复用同一实例
        expect(storedMenu).toBe(first);
        expect(sceneOverlay.querySelectorAll('.slide-item').length).toBe(3);
    });
});

describe('registerPopupMenu — closeAllOverlays 后可重建', () => {
    it('wrapper 被回收后再次 show 重建可见内容', async () => {
        const handle = registerPopupMenu({
            wrapperKey: 'rebuild-w',
            popupType: 'model',
            buildRoot: () => makeTestLevel('根', '', rows(2)),
            handlers: {},
        });
        handle.show();
        await new Promise((r) => requestAnimationFrame(r));
        expect(sceneOverlay.querySelectorAll('.slide-item').length).toBe(2);

        closeAllOverlays();
        handle.show();
        await new Promise((r) => requestAnimationFrame(r));
        expect(handle.getMenu()).not.toBeNull();
        expect(handle.getMenu()!.isContainerAttached).toBe(true);
        expect(sceneOverlay.querySelectorAll('.slide-item').length).toBe(2);
    });
});

// ─── 守卫：push 动画期间触发 reRender 不得在动画结束后清空内容（安全网） ───
describe('push 动画期间 reRender 保持内容完整', () => {
    it('push 触发 reRender（transitioning 期间缓存 pending）后动画结束内容完整', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const menu = new (await import('../../menus/menu')).SlideMenu({
            container,
            onClose: () => {},
        });
        menu.reset(makeTestLevel('根', '', rows(3)));
        await new Promise((r) => requestAnimationFrame(r));

        menu.push(makeTestLevel('子', '', rows(2)));
        menu.reRender(); // 推入期间 transitioning=true → 缓存为 _pendingReRender
        await new Promise((r) => setTimeout(r, 420)); // 走 fallback 定时器完成动画
        expect(container.querySelectorAll('.slide-item').length).toBe(2);
        menu.dispose();
        container.remove();
    });
});