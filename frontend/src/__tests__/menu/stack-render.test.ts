import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import type { PopupLevel, PopupRow } from '../../core/config';
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

// ─── 纯 items 层 reRender 走增量 patch（不重建 DOM） ───────────────────
// _doReRender 的纯 items 分支历史上走 buildPanel 全量重建；现与 updateControls 的
// itemBuilder 热路径同机制改走 patchPanel：只创建/替换/删除有变化的行，
// 未变的行保留 DOM 实例、监听器与键盘焦点。
describe('SlideMenu — 纯 items reRender 增量 patch', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    const row = (target: string, label = target.toUpperCase()): PopupRow =>
        ({ kind: 'action', label, icon: 'i', target }) as PopupRow;

    beforeEach(() => {
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    afterEach(() => {
        menu.dispose();
        container.remove();
    });

    /** 等一帧冲刷 reRender 的 rAF 去抖 */
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    it('reRender 保留未变化行的 DOM 实例（不重建面板）', async () => {
        const level: PopupLevel = { label: 'R', dir: '', items: [row('a'), row('b')] };
        menu.reset(level);
        await nextFrame();

        const before = Array.from(container.querySelectorAll<HTMLElement>('.slide-item'));
        expect(before.length).toBe(2);
        const listBefore = container.querySelector('.slide-list');

        menu.reRender();
        await nextFrame();

        const after = Array.from(container.querySelectorAll<HTMLElement>('.slide-item'));
        // 行数与内容不变
        expect(after.length).toBe(2);
        // DOM 实例原样保留（增量 patch 的标志：不是 replaceWith 造的新节点）
        expect(after[0]).toBe(before[0]);
        expect(after[1]).toBe(before[1]);
        // slide-list 容器本身也没被重建
        expect(container.querySelector('.slide-list')).toBe(listBefore);
    });

    it('reRender 后新增行被追加、删除行被移除、换 key 的行被替换', async () => {
        const level: PopupLevel = { label: 'R', dir: '', items: [row('a'), row('b')] };
        menu.reset(level);
        await nextFrame();
        const firstRow = container.querySelectorAll<HTMLElement>('.slide-item')[0]!;

        // a 保留（key 不变）、b → c（key 变）、追加 d
        level.items = [row('a'), row('c'), row('d')];
        menu.reRender();
        await nextFrame();

        const rows = Array.from(container.querySelectorAll<HTMLElement>('.slide-item'));
        expect(rows.length).toBe(3);
        // key 未变的行原样保留
        expect(rows[0]).toBe(firstRow);
        expect(rows[0]?.dataset.rowKey).toBe('action:a');
        // key 变化的行被整行替换，新行带新 key
        expect(rows[1]?.dataset.rowKey).toBe('action:c');
        expect(rows[1]).not.toBe(firstRow);
        expect(rows[2]?.dataset.rowKey).toBe('action:d');
        // 旧 key 的行已不在 DOM 中
        expect(container.querySelector('[data-row-key="action:b"]')).toBeNull();
    });

    it('reRender 更新行的可见文本（label 变化）', async () => {
        const level: PopupLevel = { label: 'R', dir: '', items: [row('a', '旧标签')] };
        menu.reset(level);
        await nextFrame();
        expect(container.querySelector('.slide-label')?.textContent).toBe('旧标签');

        level.items = [row('a', '新标签')];
        menu.reRender();
        await nextFrame();

        // key 未变 → 原地刷新文本，不重建 DOM
        expect(container.querySelector('.slide-label')?.textContent).toBe('新标签');
        expect(container.querySelectorAll('.slide-item').length).toBe(1);
    });

    it('divider 分组结构不变时按 card 增量 patch，分组数变化时正确重建', async () => {
        const level: PopupLevel = {
            label: 'R',
            dir: '',
            items: [row('a'), { kind: 'divider' } as PopupRow, row('b')],
        };
        menu.reset(level);
        await nextFrame();
        // 初始：两个 lcard 分组
        expect(container.querySelectorAll('.lcard').length).toBe(2);

        // 组内增行：分组数不变 → 增量 patch，lcard 容器保留
        const cardBefore = container.querySelectorAll<HTMLElement>('.lcard')[0]!;
        level.items = [row('a'), row('a2'), { kind: 'divider' } as PopupRow, row('b')];
        menu.reRender();
        await nextFrame();
        expect(container.querySelectorAll('.lcard').length).toBe(2);
        expect(container.querySelectorAll<HTMLElement>('.lcard')[0]).toBe(cardBefore);
        expect(container.querySelectorAll('.slide-item').length).toBe(3);

        // 分组数变化（再插一个 divider）→ 回退全量重建，结构仍然正确
        level.items = [
            row('a'),
            row('a2'),
            { kind: 'divider' } as PopupRow,
            row('b'),
            { kind: 'divider' } as PopupRow,
            row('c'),
        ];
        menu.reRender();
        await nextFrame();
        expect(container.querySelectorAll('.lcard').length).toBe(3);
        expect(container.querySelectorAll('.slide-item').length).toBe(4);
    });

    it('onAfterRender 在增量 patch 路径下只触发一次', async () => {
        const onAfterRender = vi.fn();
        const m = makeTestMenu({ handlers: { onAfterRender } });
        container = m.container;
        menu = m.menu;
        const level: PopupLevel = { label: 'R', dir: '', items: [row('a')] };
        menu.reset(level);
        await nextFrame();
        onAfterRender.mockClear();

        level.items = [row('a'), row('b')];
        menu.reRender();
        await nextFrame();

        // [fix P2] 契约：buildPanel 异步路径曾因同步+异步双 finalize 重复触发；
        // 增量路径是同步 patch + 单次 safeFinalize，不得回归成两次。
        expect(onAfterRender).toHaveBeenCalledTimes(1);
    });
});
