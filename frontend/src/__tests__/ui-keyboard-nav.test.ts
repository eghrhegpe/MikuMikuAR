// [doc:adr-153] 键盘导航公共工具单测 —— 覆盖默认路径 + 全大统一增强能力
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createKeyboardNav } from '../core/ui-keyboard-nav';

function makeContainer(n: number): { container: HTMLElement; items: HTMLElement[] } {
    const container = document.createElement('div');
    const items: HTMLElement[] = [];
    for (let i = 0; i < n; i++) {
        const el = document.createElement('div');
        el.className = 'slide-item';
        el.tabIndex = 0;
        el.textContent = `item-${i}`;
        container.appendChild(el);
        items.push(el);
    }
    document.body.appendChild(container);
    return { container, items };
}

function key(el: HTMLElement, k: string): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
}

describe('createKeyboardNav — 默认路径（:focus 反查）', () => {
    let container: HTMLElement;
    let items: HTMLElement[];
    let disp: { dispose: () => void };

    beforeEach(() => {
        ({ container, items } = makeContainer(3));
    });
    afterEach(() => {
        disp?.dispose();
        container.remove();
    });

    it('ArrowDown 在 :focus 项上向后移动焦点', () => {
        disp = createKeyboardNav(container, { selector: '.slide-item' });
        items[0].focus();
        key(items[0], 'ArrowDown');
        expect(document.activeElement).toBe(items[1]);
    });

    it('ArrowUp 循环到末项（wrap 默认开）', () => {
        disp = createKeyboardNav(container, { selector: '.slide-item' });
        items[0].focus();
        key(items[0], 'ArrowUp');
        expect(document.activeElement).toBe(items[2]);
    });

    it('Enter 无 onEnter 时触发 click()', () => {
        const clicked = vi.fn();
        items[1].addEventListener('click', clicked);
        disp = createKeyboardNav(container, { selector: '.slide-item' });
        items[1].focus();
        key(items[1], 'Enter');
        expect(clicked).toHaveBeenCalledOnce();
    });

    it('Escape 触发 onEscape', () => {
        const onEscape = vi.fn();
        disp = createKeyboardNav(container, { selector: '.slide-item', onEscape });
        items[0].focus();
        key(items[0], 'Escape');
        expect(onEscape).toHaveBeenCalledOnce();
    });

    it('transitioningGuard 为 true 时忽略所有按键', () => {
        disp = createKeyboardNav(container, {
            selector: '.slide-item',
            transitioningGuard: () => true,
        });
        items[0].focus();
        key(items[0], 'ArrowDown');
        expect(document.activeElement).toBe(items[0]);
    });
});

describe('createKeyboardNav — roving tabIndex（tablist 路径，ADR-196）', () => {
    it('移动后新元素 tabIndex=0、旧元素 tabIndex=-1，并触发 onArrowActivate', () => {
        const { container, items } = makeContainer(3);
        const onArrowActivate = vi.fn();
        const disp = createKeyboardNav(container, {
            selector: '.slide-item',
            rovingTabIndex: true,
            onArrowActivate,
        });
        items[0].focus();
        key(items[0], 'ArrowDown');
        expect(items[0].tabIndex).toBe(-1);
        expect(items[1].tabIndex).toBe(0);
        expect(onArrowActivate).toHaveBeenCalledWith(items[1]);
        disp.dispose();
        container.remove();
    });
});

describe('createKeyboardNav — 全大统一增强（menu.ts 接入路径）', () => {
    let container: HTMLElement;
    let items: HTMLElement[];
    let disp: { dispose: () => void };

    beforeEach(() => {
        ({ container, items } = makeContainer(3));
    });
    afterEach(() => {
        disp?.dispose();
        container.remove();
    });

    it('getActiveIndex/setActiveIndex 桥接外部焦点源（不依赖 :focus）', () => {
        let active = 0;
        const applied: number[] = [];
        disp = createKeyboardNav(container, {
            selector: '.slide-item',
            getActiveIndex: () => active,
            setActiveIndex: (_items, next) => {
                active = next;
                applied.push(next);
            },
        });
        // 不 focus 任何元素，纯靠外部索引
        key(container, 'ArrowDown');
        expect(active).toBe(1);
        key(container, 'ArrowDown');
        expect(active).toBe(2);
        key(container, 'ArrowDown'); // wrap 回 0
        expect(active).toBe(0);
        expect(applied).toEqual([1, 2, 0]);
    });

    it('arrowRightActivate=true 时 ArrowRight 走 onEnter 而非移动', () => {
        const active = 1;
        const onEnter = vi.fn();
        const setActiveIndex = vi.fn();
        disp = createKeyboardNav(container, {
            selector: '.slide-item',
            getActiveIndex: () => active,
            setActiveIndex,
            arrowRightActivate: true,
            onEnter,
        });
        key(container, 'ArrowRight');
        expect(onEnter).toHaveBeenCalledWith(items[1]);
        expect(setActiveIndex).not.toHaveBeenCalled();
    });

    it('onArrowBack：ArrowLeft 触发返回而非移动焦点', () => {
        const onArrowBack = vi.fn();
        disp = createKeyboardNav(container, {
            selector: '.slide-item',
            getActiveIndex: () => 1,
            setActiveIndex: vi.fn(),
            onArrowBack,
        });
        key(container, 'ArrowLeft');
        expect(onArrowBack).toHaveBeenCalledOnce();
    });

    it('perKeySkip：horizontal 跳过 button，vertical 不跳', () => {
        const btn = document.createElement('button');
        container.appendChild(btn);
        const setActiveIndex = vi.fn();
        const onEnter = vi.fn();
        disp = createKeyboardNav(container, {
            selector: '.slide-item',
            getActiveIndex: () => 0,
            setActiveIndex,
            arrowRightActivate: true,
            onEnter,
            perKeySkip: (target, kind) => kind === 'horizontal' && !!target?.closest('button'),
        });
        // 焦点在 button 上：horizontal（Enter/→）被跳过，事件透传
        const enterEv = key(btn, 'Enter');
        expect(onEnter).not.toHaveBeenCalled();
        expect(enterEv.defaultPrevented).toBe(false);
        // vertical（↓）不跳过，正常移动
        key(btn, 'ArrowDown');
        expect(setActiveIndex).toHaveBeenCalled();
    });

    it('Enter 用 getActiveIndex 定位当前项激活（无 :focus）', () => {
        const onEnter = vi.fn();
        disp = createKeyboardNav(container, {
            selector: '.slide-item',
            getActiveIndex: () => 2,
            setActiveIndex: vi.fn(),
            onEnter,
        });
        key(container, 'Enter');
        expect(onEnter).toHaveBeenCalledWith(items[2]);
    });
});
