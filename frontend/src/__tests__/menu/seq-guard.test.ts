import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import type { PopupLevel, PopupRow } from '../../core/config';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';

// ─── 回归：seq guard 过期时的卡死（transitioning 永久 true + opacity 卡 0）───
// 根因：push/pop 的 onFadeOut 里 `await buildPanel()` 返回后若 `seq !== _buildSeq`
// （buildPanel 挂起期间被 dispose / updateControls 重入的裸 buildPanel 顶掉序号），
// 旧代码直接 return：既不执行 fadeIn（opacity 0→1）也不调 _endTransition，
// 导致 transitioning 永久 true（后续 push/pop 全被拒 = 累及上级菜单）、
// panel opacity 卡 0（内容已渲染但看不见，对应真实 DOM 快照）。
// 修复：seq 过期时兜底恢复可见并结束过渡（_recoverStaleTransition），保证状态必然收敛。
// 本文件用「renderCustom 返回可控 Promise」让 buildPanel 挂起，复现该竞态并验证不卡死。

function rows(n: number): PopupRow[] {
    const arr: PopupRow[] = [];
    for (let i = 0; i < n; i++) {
        arr.push({ kind: 'action' as const, label: '行' + i, icon: 'i', target: 't' + i });
    }
    return arr;
}

/** 构造一个 renderCustom 挂起（直到调用释放函数才完成）的层级 */
function makeAsyncLevel(
    label: string,
    onRender?: (list: HTMLElement) => void
): { level: PopupLevel; release: () => void } {
    let release: () => void = () => {};
    const level = makeTestLevel(label, '', []);
    level.renderCustom = (list) => {
        onRender?.(list as HTMLElement);
        return new Promise<void>((r) => {
            release = () => r(undefined);
        });
    };
    return { level, release: () => release() };
}

describe('seq guard 过期兜底 — push 路径', () => {
    let menu: SlideMenu;
    let container: HTMLElement;

    beforeEach(() => {
        const m = makeTestMenu();
        menu = m.menu;
        container = m.container;
    });

    afterEach(() => {
        vi.useRealTimers();
        menu.dispose();
        container.remove();
    });

    it('buildPanel 挂起期间重入 buildPanel → 旧 onFadeOut seq 过期 → 不卡死', async () => {
        vi.useFakeTimers();
        menu.reset(makeTestLevel('根', '', rows(1)));
        await vi.advanceTimersByTimeAsync(0); // flush reset 的异步 build

        // 推入异步 renderCustom 层：onFadeOut 的 buildPanel 将挂起
        const { level: asyncLevel, release } = makeAsyncLevel('异步层', (list) => {
            const el = document.createElement('div');
            el.className = 'slide-item';
            el.textContent = 'async';
            list.appendChild(el);
        });
        menu.push(asyncLevel);
        expect((menu as any).transitioning).toBe(true);

        // 推进到 fadeOut 完成（150ms 兜底）→ onFadeOut → buildPanel 挂起（renderCustom pending）
        await vi.advanceTimersByTimeAsync(160);

        // 挂起期间：模拟 updateControls 裸 buildPanel 重入 → _buildSeq++（同步完成）
        const reentryLevel = makeTestLevel('重入层', '', rows(2));
        const reentryP = (menu as any).buildPanel(reentryLevel);
        await vi.advanceTimersByTimeAsync(0);

        // 释放旧 build → 旧 onFadeOut 的 await 返回 → seq 过期 → 兜底恢复
        release();
        await vi.advanceTimersByTimeAsync(0);

        // 核心断言：不永久卡死——transitioning 复位、opacity 恢复可见
        expect((menu as any).transitioning).toBe(false);
        expect((menu as any).panel.style.opacity).toBe('1');
        expect((menu as any).panel.style.transform).toBe('translateX(0)');
        // 重入 build 的内容已渲染且可见
        expect(container.querySelectorAll('.slide-item').length).toBe(2);
        await reentryP;

        // 修复后导航能力恢复：可再次 push 并正常完成过渡（不累及上级）
        menu.push(makeTestLevel('后续层', '', rows(1)));
        expect((menu as any).transitioning).toBe(true);
        await vi.advanceTimersByTimeAsync(160);
        await vi.advanceTimersByTimeAsync(210);
        expect((menu as any).transitioning).toBe(false);
        expect(menu.currentLevel?.label).toBe('后续层');
    });
});

describe('seq guard 过期兜底 — pop 路径', () => {
    let menu: SlideMenu;
    let container: HTMLElement;

    beforeEach(() => {
        const m = makeTestMenu();
        menu = m.menu;
        container = m.container;
    });

    afterEach(() => {
        vi.useRealTimers();
        menu.dispose();
        container.remove();
    });

    it('pop 的 buildPanel 挂起期间重入 buildPanel → 旧 onFadeOut seq 过期 → 不卡死', async () => {
        vi.useFakeTimers();

        // 构造两层栈 [异步根, 子层]，目标返回层带异步 renderCustom
        const { level: asyncRoot, release } = makeAsyncLevel('异步根', (list) => {
            const el = document.createElement('div');
            el.className = 'slide-item';
            el.textContent = 'async';
            list.appendChild(el);
        });
        (menu as any).levels = [asyncRoot, makeTestLevel('子层', '', rows(1))];
        (menu as any).transitioning = false;
        menu.pop();
        expect((menu as any).transitioning).toBe(true);
        expect(menu.currentLevel).toBe(asyncRoot);

        // 推进到 fadeOut 完成 → onFadeOut → buildPanel(asyncRoot) 挂起
        await vi.advanceTimersByTimeAsync(160);

        // 挂起期间：模拟裸 buildPanel 重入 → _buildSeq++
        const reentryLevel = makeTestLevel('重入层', '', rows(2));
        const reentryP = (menu as any).buildPanel(reentryLevel);
        await vi.advanceTimersByTimeAsync(0);

        // 释放旧 build → seq 过期 → 兜底恢复
        release();
        await vi.advanceTimersByTimeAsync(0);

        expect((menu as any).transitioning).toBe(false);
        expect((menu as any).panel.style.opacity).toBe('1');
        expect((menu as any).panel.style.transform).toBe('translateX(0)');
        expect(container.querySelectorAll('.slide-item').length).toBe(2);
        await reentryP;

        // 修复后导航能力恢复：可再次 push 正常过渡
        (menu as any).transitioning = false;
        menu.push(makeTestLevel('孙层', '', rows(1)));
        await vi.advanceTimersByTimeAsync(160);
        await vi.advanceTimersByTimeAsync(210);
        expect((menu as any).transitioning).toBe(false);
        expect(menu.currentLevel?.label).toBe('孙层');
    });
});
