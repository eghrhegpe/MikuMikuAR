import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import type { PopupLevel } from '../../core/config';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';
import { bundles } from '../../core/i18n/t';
import { zhCN } from '../../core/i18n/locales/zh-CN';

// ─── SlideMenu 测试：层级栈管理 + 渲染 ─────────────────────────────
// 过渡动画基于 CSS，jsdom/happy-dom 中不触发 transitionend；
// 通过手动清除 transitioning 标志来测试同步状态变更。

beforeAll(() => {
    // [doc:perf] 语言包运行时加载；测试环境直接预填基准包，避免 t() 缺失 key 告警
    bundles['zh-CN'] = zhCN;
});

describe('SlideMenu — 层级栈管理', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    afterEach(() => {
        // dispose 会取消 push/pop 留下的未决定时器并移出全局存活集合；
        // 移除 DOM 容器避免测试间污染。
        menu.dispose();
        container.remove();
    });

    it('reset 创建初始层级', () => {
        menu.reset(makeTestLevel('根'));
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('根');
    });

    it('push 立即增加层级数（同步）', () => {
        menu.reset(makeTestLevel('根'));
        const before = menu.levelCount;
        menu.push(makeTestLevel('子级'));
        // levels.push() 是同步的，transitioning 不影响数组
        expect(menu.levelCount).toBe(before + 1);
    });

    it('pop 减少层级数', () => {
        menu.reset(makeTestLevel('根'));
        menu.push(makeTestLevel('子级'));
        const before = menu.levelCount;
        // 手动清除 transitioning 使 pop 可以执行
        (menu as any).transitioning = false;
        menu.pop();
        (menu as any).transitioning = false;
        expect(menu.levelCount).toBe(before - 1);
    });

    it('pop 在仅有一层时无效', () => {
        menu.reset(makeTestLevel('根'));
        menu.pop();
        expect(menu.levelCount).toBe(1);
    });

    it('pop 不会清空最后一层（currentLevel 保留）', () => {
        menu.reset(makeTestLevel('X'));
        menu.pop();
        (menu as any).transitioning = false;
        // SlideMenu 设计上不允许完全空栈：pop 到最后一层时保留当前层
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('X');
    });

    it('popTo 回退到指定深度', () => {
        // 直接设置 levels 数组，绕过 push 的 transitioning 守卫
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1'), makeTestLevel('L2')];
        (menu as any).transitioning = false;
        menu.popTo(0);
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('L0');
    });

    it('reset 清空所有层级并设新根', () => {
        menu.reset(makeTestLevel('A'));
        menu.push(makeTestLevel('B'));
        (menu as any).transitioning = false;

        menu.reset(makeTestLevel('Z'));
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('Z');
    });

    it('push 在 transitioning 时被阻止', () => {
        menu.reset(makeTestLevel('根'));
        const before = menu.levelCount;
        (menu as any).transitioning = true;
        menu.push(makeTestLevel('不应推入'));
        expect(menu.levelCount).toBe(before);
    });

    it('pop 在 transitioning 时被阻止', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1')];
        const before = (menu as any).levels.length;
        (menu as any).transitioning = true;
        menu.pop();
        expect((menu as any).levels.length).toBe(before);
    });

    it('popTo 到当前层级无变化', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1'), makeTestLevel('L2')];
        const before = menu.levelCount;
        menu.popTo(2); // index === length-1 → no-op
        expect(menu.levelCount).toBe(before);
    });

    it('popTo 负数索引被忽略', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1')];
        const before = menu.levelCount;
        menu.popTo(-1);
        expect(menu.levelCount).toBe(before);
    });

    it('popTo 越界索引被忽略', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1')];
        const before = menu.levelCount;
        menu.popTo(5);
        expect(menu.levelCount).toBe(before);
    });

    it('popTo NaN 索引被忽略', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1')];
        const before = menu.levelCount;
        menu.popTo(Number.NaN);
        expect(menu.levelCount).toBe(before);
        expect(menu.currentLevel?.label).toBe('L1');
    });

    it('popTo 非整数索引被忽略', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1'), makeTestLevel('L2')];
        const before = menu.levelCount;
        menu.popTo(1.5);
        expect(menu.levelCount).toBe(before);
        expect(menu.currentLevel?.label).toBe('L2');
    });

    it('resetToRoot 清除多余层级至根', () => {
        (menu as any).levels = [makeTestLevel('根'), makeTestLevel('A'), makeTestLevel('B')];
        menu.resetToRoot();
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('根');
    });

    it('resetToRoot 单层级时无变化', () => {
        menu.reset(makeTestLevel('仅一层'));
        menu.resetToRoot();
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('仅一层');
    });
});

describe('SlideMenu — 渲染', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    afterEach(() => {
        menu.dispose();
        container.remove();
    });

    it('reset 构建面板 DOM', () => {
        const level: PopupLevel = {
            label: '测试',
            dir: '',
            items: [
                { kind: 'action' as const, label: '项目1', icon: 'i', target: 'v1' },
                { kind: 'action' as const, label: '项目2', icon: 'i', target: 'v2' },
            ],
        };
        menu.reset(level);
        const items = container.querySelectorAll('.slide-item');
        expect(items.length).toBe(2);
        expect(items[0]?.textContent).toContain('项目1');
        expect(items[1]?.textContent).toContain('项目2');
    });

    it('renderCustom 回调创建自定义 DOM', async () => {
        let rendered = false;
        const level: PopupLevel = {
            label: '自定义',
            dir: '',
            items: [],
            renderCustom: (c) => {
                const div = document.createElement('div');
                div.className = 'custom-content';
                div.textContent = 'Hello';
                c.appendChild(div);
            },
        };
        (menu as any).onAfterRender = () => {
            rendered = true;
        };
        menu.reset(level);
        // buildPanel 的 renderCustom 是 async 流程，用 RAF 冲刷微任务；
        // 不使用裸 setTimeout 忙等，避免无超时死循环与真实定时器抖动。
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(rendered).toBe(true);
        const custom = container.querySelectorAll('.custom-content');
        expect(custom.length).toBe(1);
        expect(custom[0]?.textContent).toBe('Hello');
    });

    it('reRender 重新构建当前层级', async () => {
        const level: PopupLevel = {
            label: 'R',
            dir: '',
            items: [{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }],
        };
        menu.reset(level);
        expect(container.querySelectorAll('.slide-item').length).toBe(1);

        level.items.push({ kind: 'action' as const, label: 'B', icon: 'i', target: 'b' });
        menu.reRender();
        // reRender 使用 RAF 去抖，需等待下一帧
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(container.querySelectorAll('.slide-item').length).toBe(2);
    });

    it('同帧多次 reRender 合并时保留 preserveFocus', async () => {
        const level: PopupLevel = {
            label: 'R',
            dir: '',
            items: [
                { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
                { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' },
            ],
        };
        menu.reset(level);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        // 先把焦点移到第二项，preserveFocus=true 的 reRender 不应重置焦点
        (menu as any).focusNext();
        expect((menu as any).focusIndex).toBe(1);

        // 同帧内先普通 reRender，再 preserveFocus reRender：后者不能被去抖吞掉
        menu.reRender();
        menu.reRender({ preserveFocus: true });
        await new Promise((resolve) => requestAnimationFrame(resolve));

        expect((menu as any).focusIndex).toBe(1);
    });
});
