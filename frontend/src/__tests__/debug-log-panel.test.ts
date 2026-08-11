// @vitest-environment happy-dom
// [ADR-248] 调试日志面板单测 — 覆盖 showLogPanel / hideLogPanel / toggleLogPanel /
// 过滤渲染 / formatTime 输出 / 自动滚动 / 事件绑定
//
// ⚠️ 代码现状：debug-log-panel.ts 未导出 disposeLogPanel，仅有 showLogPanel /
// hideLogPanel / toggleLogPanel。模块级 _panel 变量无清理路径（仅隐藏 display:none），
// 属于 ADR-248 遗留缺口，建议后续补 disposeLogPanel 以支持彻底卸载。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type MockEntry = { tag: string; level: 'info' | 'warn' | 'error'; message: string; time: number };

const mockState = vi.hoisted(() => ({
    entries: [] as MockEntry[],
    consoleOutput: true,
    subscribeFn: null as (() => void) | null,
    setConsoleOutputCalls: [] as boolean[],
    clearLogsCalls: 0,
}));

vi.mock('../core/logger', () => ({
    getLogBuffer: () => ({
        getAll: () => mockState.entries,
        subscribe: (fn: () => void) => {
            mockState.subscribeFn = fn;
            return () => { mockState.subscribeFn = null; };
        },
        push: (entry: MockEntry) => {
            mockState.entries.push(entry);
            mockState.subscribeFn?.();
        },
        clear: () => {
            mockState.entries = [];
            mockState.subscribeFn?.();
        },
    }),
    clearLogs: () => {
        mockState.clearLogsCalls++;
        mockState.entries = [];
        mockState.subscribeFn?.();
    },
    setConsoleOutput: (v: boolean) => {
        mockState.consoleOutput = v;
        mockState.setConsoleOutputCalls.push(v);
    },
}));

import { showLogPanel, hideLogPanel, toggleLogPanel } from '../core/debug-log-panel';

function panel(): HTMLElement | null {
    return document.querySelector('.debug-log-panel') as HTMLElement | null;
}

function listEl(): HTMLElement | null {
    return panel()?.querySelector('[data-role="log-list"]') as HTMLElement | null;
}

function resetFilterState(): void {
    const p = panel();
    if (!p) return;
    const filter = p.querySelector('[data-role="filter"]') as HTMLInputElement;
    filter.value = '';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    const level = p.querySelector('[data-role="level"]') as HTMLSelectElement;
    level.value = 'info';
    level.dispatchEvent(new Event('change', { bubbles: true }));
    // 直接改 textContent 避免触发事件处理器污染 mockState
    const consoleBtn = p.querySelector('[data-role="console"]') as HTMLElement | null;
    if (consoleBtn && consoleBtn.textContent === 'Console: ON') {
        consoleBtn.textContent = 'Console: OFF';
        consoleBtn.style.background = '#2980b9';
        mockState.consoleOutput = false;
    }
}

beforeEach(() => {
    mockState.entries = [];
    mockState.consoleOutput = true;
    mockState.setConsoleOutputCalls = [];
    mockState.clearLogsCalls = 0;
});

afterEach(() => {
    hideLogPanel();
    resetFilterState();
    mockState.entries = [];
    mockState.consoleOutput = true;
});

describe('showLogPanel — 创建与重复调用', () => {
    it('首次调用创建面板，className 与 data-role 元素齐全', () => {
        showLogPanel();
        const p = panel();
        expect(p).not.toBeNull();
        expect(p!.className).toBe('debug-log-panel');
        expect(p!.querySelector('[data-role="filter"]')).toBeTruthy();
        expect(p!.querySelector('[data-role="level"]')).toBeTruthy();
        expect(p!.querySelector('[data-role="log-list"]')).toBeTruthy();
        expect(p!.querySelector('[data-role="clear"]')).toBeTruthy();
        expect(p!.querySelector('[data-role="console"]')).toBeTruthy();
        expect(p!.querySelector('[data-role="close"]')).toBeTruthy();
        expect(p!.style.position).toBe('fixed');
        expect(p!.style.zIndex).toBe('10000');
    });

    it('首次调用后 panel 挂载到 document.body', () => {
        showLogPanel();
        expect(document.body.contains(panel()!)).toBe(true);
    });

    it('再次调用 showLogPanel 不重复创建，仅切换 display:block', () => {
        showLogPanel();
        const firstPanel = panel();
        showLogPanel();
        expect(panel()).toBe(firstPanel);
        expect(document.querySelectorAll('.debug-log-panel').length).toBe(1);
        expect(firstPanel!.style.display).toBe('block');
    });

    it('首次调用触发 subscribe 且立即 renderPanel', () => {
        mockState.entries = [
            { tag: 'app', level: 'info', message: '[app] boot', time: 1700000000000 },
        ];
        showLogPanel();
        expect(mockState.subscribeFn).not.toBeNull();
        expect(listEl()!.textContent).toContain('boot');
    });
});

describe('hideLogPanel / toggleLogPanel', () => {
    it('hideLogPanel 设置 display:none（面板已存在）', () => {
        showLogPanel();
        expect(panel()!.style.display).toBe('block');
        hideLogPanel();
        expect(panel()!.style.display).toBe('none');
    });

    it('hideLogPanel 在面板不存在时不报错', () => {
        expect(() => hideLogPanel()).not.toThrow();
    });

    it('toggleLogPanel：面板不存在时 → 创建并显示', () => {
        toggleLogPanel();
        expect(panel()).not.toBeNull();
        expect(panel()!.style.display).toBe('block');
    });

    it('toggleLogPanel：面板显示时 → 隐藏', () => {
        showLogPanel();
        toggleLogPanel();
        expect(panel()!.style.display).toBe('none');
    });

    it('toggleLogPanel：面板隐藏时 → 显示', () => {
        showLogPanel();
        hideLogPanel();
        toggleLogPanel();
        expect(panel()!.style.display).toBe('block');
    });
});

describe('renderPanel — 过滤与渲染', () => {
    const fixedTime = Date.UTC(2024, 5, 15, 10, 30, 45, 678);

    beforeEach(() => {
        showLogPanel();
    });

    it('空缓冲区显示「暂无日志」占位', () => {
        expect(listEl()!.textContent).toContain('暂无日志');
        expect(listEl()!.querySelector('.log-entry')).toBeNull();
    });

    it('日志条目含 level / message / time，且按 level 着色', () => {
        mockState.entries = [
            { tag: 'app', level: 'info', message: '[app] init', time: fixedTime },
            { tag: 'ui', level: 'warn', message: '[ui] slow', time: fixedTime },
        ];
        mockState.subscribeFn?.();
        const list = listEl()!;
        expect(list.querySelectorAll('.log-entry').length).toBe(2);
        expect(list.textContent).toContain('[INFO]');
        expect(list.textContent).toContain('[WARN]');
        expect(list.textContent).toContain('init');
        expect(list.textContent).toContain('slow');
    });

    it('formatTime 输出 HH:mm:ss.SSS 格式', () => {
        mockState.entries = [
            { tag: 'x', level: 'info', message: 'msg', time: fixedTime },
        ];
        mockState.subscribeFn?.();
        const list = listEl()!;
        const timeMatch = list.textContent!.match(/\d{2}:\d{2}:\d{2}\.\d{3}/);
        expect(timeMatch).not.toBeNull();
        expect(timeMatch![0].length).toBe(12);
    });

    it('minLevel=warn 过滤掉 info 条目', () => {
        mockState.entries = [
            { tag: 'a', level: 'info', message: '[a] info msg', time: fixedTime },
            { tag: 'b', level: 'warn', message: '[b] warn msg', time: fixedTime },
            { tag: 'c', level: 'error', message: '[c] err msg', time: fixedTime },
        ];
        mockState.subscribeFn?.();
        const level = panel()!.querySelector('[data-role="level"]') as HTMLSelectElement;
        level.value = 'warn';
        level.dispatchEvent(new Event('change', { bubbles: true }));
        const list = listEl()!;
        expect(list.querySelectorAll('.log-entry').length).toBe(2);
        expect(list.textContent).not.toContain('info msg');
        expect(list.textContent).toContain('warn msg');
        expect(list.textContent).toContain('err msg');
    });

    it('minLevel=error 仅保留 error 条目', () => {
        mockState.entries = [
            { tag: 'a', level: 'info', message: '[a]', time: fixedTime },
            { tag: 'b', level: 'warn', message: '[b]', time: fixedTime },
            { tag: 'c', level: 'error', message: '[c]', time: fixedTime },
        ];
        mockState.subscribeFn?.();
        const level = panel()!.querySelector('[data-role="level"]') as HTMLSelectElement;
        level.value = 'error';
        level.dispatchEvent(new Event('change', { bubbles: true }));
        const list = listEl()!;
        expect(list.querySelectorAll('.log-entry').length).toBe(1);
        expect(list.textContent).toContain('[c]');
    });

    it('filterTag 匹配时保留对应条目（大小写不敏感）', () => {
        mockState.entries = [
            { tag: 'renderer', level: 'info', message: '[renderer] frame', time: fixedTime },
            { tag: 'physics', level: 'info', message: '[physics] step', time: fixedTime },
        ];
        mockState.subscribeFn?.();
        const filter = panel()!.querySelector('[data-role="filter"]') as HTMLInputElement;
        filter.value = 'RENDER';
        filter.dispatchEvent(new Event('input', { bubbles: true }));
        const list = listEl()!;
        expect(list.querySelectorAll('.log-entry').length).toBe(1);
        expect(list.textContent).toContain('frame');
        expect(list.textContent).not.toContain('step');
    });

    it('filterTag 无匹配时显示「暂无日志」', () => {
        mockState.entries = [
            { tag: 'app', level: 'info', message: '[app]', time: fixedTime },
        ];
        mockState.subscribeFn?.();
        const filter = panel()!.querySelector('[data-role="filter"]') as HTMLInputElement;
        filter.value = 'nonexistent';
        filter.dispatchEvent(new Event('input', { bubbles: true }));
        expect(listEl()!.textContent).toContain('暂无日志');
    });

    it('日志按 level 着色：info 蓝 / warn 橙 / error 红', () => {
        mockState.entries = [
            { tag: 'a', level: 'info', message: '[a]', time: fixedTime },
            { tag: 'b', level: 'warn', message: '[b]', time: fixedTime },
            { tag: 'c', level: 'error', message: '[c]', time: fixedTime },
        ];
        mockState.subscribeFn?.();
        const entries = listEl()!.querySelectorAll('.log-entry');
        // 直接比对 inline style 的 hex 值（避免 happy-dom getComputedStyle 不转 rgb 的差异）
        expect((entries[0] as HTMLElement).style.borderLeftColor).toBe('#4FC3F7');
        expect((entries[1] as HTMLElement).style.borderLeftColor).toBe('#FFB74D');
        expect((entries[2] as HTMLElement).style.borderLeftColor).toBe('#EF5350');
    });
});

describe('renderPanel — 自动滚动', () => {
    const fixedTime = Date.UTC(2024, 5, 15, 10, 30, 45, 678);

    it('用户在底部（isNearBottom）时自动滚动到底部', () => {
        showLogPanel();
        const list = listEl()!;
        let scrollTop = 300;
        Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true });
        Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
        Object.defineProperty(list, 'scrollTop', {
            get: () => scrollTop,
            set: (v: number) => { scrollTop = v; },
            configurable: true,
        });
        mockState.entries = [
            { tag: 'a', level: 'info', message: '[a]', time: fixedTime },
        ];
        mockState.subscribeFn?.();
        expect(scrollTop).toBe(500);
    });

    it('用户不在底部（isNearBottom false）时不自动滚动', () => {
        showLogPanel();
        const list = listEl()!;
        let scrollTop = 100;
        Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
        Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
        Object.defineProperty(list, 'scrollTop', {
            get: () => scrollTop,
            set: (v: number) => { scrollTop = v; },
            configurable: true,
        });
        mockState.entries = [
            { tag: 'a', level: 'info', message: '[a]', time: fixedTime },
        ];
        mockState.subscribeFn?.();
        expect(scrollTop).toBe(100);
    });

    it('push 新条目后自动 re-render（subscribe 回调）', () => {
        showLogPanel();
        expect(listEl()!.textContent).toContain('暂无日志');
        mockState.entries.push({
            tag: 'live', level: 'info', message: '[live] tick', time: Date.now(),
        });
        mockState.subscribeFn?.();
        expect(listEl()!.textContent).not.toContain('暂无日志');
        expect(listEl()!.textContent).toContain('[live] tick');
    });
});

describe('事件绑定 — 清空 / Console 切换 / 关闭', () => {
    it('点击「清空」按钮调用 clearLogs 并重新渲染', () => {
        showLogPanel();
        mockState.entries = [
            { tag: 'a', level: 'info', message: '[a]', time: 1 },
        ];
        mockState.subscribeFn?.();
        expect(listEl()!.querySelectorAll('.log-entry').length).toBe(1);
        const clearBtn = panel()!.querySelector('[data-role="clear"]')!;
        clearBtn.click();
        expect(mockState.clearLogsCalls).toBe(1);
        expect(listEl()!.textContent).toContain('暂无日志');
    });

    it('点击「Console」按钮（初始 OFF）→ 切换 ON', () => {
        showLogPanel();
        const btn = panel()!.querySelector('[data-role="console"]') as HTMLElement;
        expect(btn.textContent).toBe('Console: OFF');
        btn.click();
        expect(mockState.setConsoleOutputCalls).toEqual([true]);
        expect(btn.textContent).toBe('Console: ON');
    });

    it('点击「Console」按钮（ON）→ 切换 OFF', () => {
        showLogPanel();
        const btn = panel()!.querySelector('[data-role="console"]') as HTMLElement;
        btn.click();
        expect(btn.textContent).toBe('Console: ON');
        btn.click();
        expect(btn.textContent).toBe('Console: OFF');
        expect(mockState.setConsoleOutputCalls).toEqual([true, false]);
    });

    it('点击「✕」关闭按钮隐藏面板', () => {
        showLogPanel();
        expect(panel()!.style.display).toBe('block');
        const closeBtn = panel()!.querySelector('[data-role="close"]')!;
        closeBtn.click();
        expect(panel()!.style.display).toBe('none');
    });
});

describe('window.__logPanel 全局挂载', () => {
    it('window.__logPanel 暴露 show/hide/toggle/clear', () => {
        expect(window.__logPanel).toBeDefined();
        expect(typeof window.__logPanel!.show).toBe('function');
        expect(typeof window.__logPanel!.hide).toBe('function');
        expect(typeof window.__logPanel!.toggle).toBe('function');
        expect(typeof window.__logPanel!.clear).toBe('function');
    });

    it('window.__logPanel.clear 调用后清除缓冲区', () => {
        mockState.entries = [
            { tag: 'x', level: 'info', message: '[x]', time: 1 },
        ];
        window.__logPanel!.clear();
        expect(mockState.clearLogsCalls).toBe(1);
        expect(mockState.entries).toHaveLength(0);
    });
});