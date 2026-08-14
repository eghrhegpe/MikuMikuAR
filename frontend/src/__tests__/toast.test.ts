// toast.test.ts — 全局 toast 单测（ADR-153）
// 覆盖 P2#9 document 守卫（headless 降级）+ 渲染/aria-live/MAX_VISIBLE 限制/
// copy 按钮/action 按钮/close 淡出。mock './i18n/t'，用 fake timers 控制定时器。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../core/i18n/t', () => ({
    t: (key: string) => key,
}));

import {
    showToast,
    showErrorToast,
    showInfoToast,
    _resetToastForTest,
} from '../core/toast';

function container(): HTMLElement | null {
    return document.getElementById('mmk-toast-container');
}

function toastCount(): number {
    return container()?.children.length ?? 0;
}

beforeEach(() => {
    vi.useFakeTimers();
    // [audit:round16 P2] 重置模块级 _activeToasts，杜绝跨用例残留污染 MAX_VISIBLE 语义
    _resetToastForTest();
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('showToast（P2#9 document 守卫 + 渲染）', () => {
    it('无 document 环境 → 静默降级不抛错（P2#9）', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('document', undefined);
        expect(() => showToast('标题')).not.toThrow();
        // [audit:round16 P4] 校验告警带 [toast] 前缀，防误告警其他模块
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('[toast]'));
    });

    it('首次调用创建容器（含 aria-live 属性）', () => {
        showToast('标题');
        const c = container();
        expect(c).not.toBeNull();
        expect(c!.hasAttribute('aria-live')).toBe(true);
    });

    it('error variant → 容器切 alert/assertive（ADR-153）', () => {
        showErrorToast('错误');
        const c = container();
        expect(c!.getAttribute('role')).toBe('alert');
        expect(c!.getAttribute('aria-live')).toBe('assertive');
    });

    it('info variant 保持 status/polite', () => {
        showInfoToast('提示');
        const c = container();
        expect(c!.getAttribute('role')).toBe('status');
        expect(c!.getAttribute('aria-live')).toBe('polite');
    });

    it('toast 元素含标题文本', () => {
        showToast('加载失败');
        expect(container()!.textContent).toContain('加载失败');
    });

    it('超过 MAX_VISIBLE_TOASTS 时移除最旧 toast', () => {
        for (let i = 0; i < 6; i++) {
            showToast(`t${i}`);
        }
        // [audit:round16 P3] 同步裁剪语义下必然恰为 5，收紧断言防裁剪过头/不足漂移
        expect(toastCount()).toBe(5);
        // 最旧的 t0 被移除
        expect(container()!.textContent).not.toContain('t0');
        expect(container()!.textContent).toContain('t5');
    });

    it('detail 存在时创建 copy 按钮', () => {
        showToast('标题', '详情');
        const copyBtn = Array.from(container()!.querySelectorAll("button")).find(
            (b) => b.textContent === 'toast.copy'
        );
        expect(copyBtn).toBeTruthy();
    });

    it('action 按钮点击触发 onClick 并移除 toast', () => {
        const onClick = vi.fn();
        showToast('标题', undefined, [{ label: '重试', onClick }]);
        const btn = Array.from(container()!.querySelectorAll("button")).find(
            (b) => b.textContent === '重试'
        );
        btn!.click();
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(toastCount()).toBe(0);
    });

    it('close 按钮点击淡出并移除 toast', () => {
        showToast('标题');
        expect(toastCount()).toBe(1);
        // [audit:round16 P2] close 已从 span 改原生 button（键盘可操作），选择器同步
        const close = container()!.querySelector('button[aria-label="common.close"]')!;
        close.dispatchEvent(new MouseEvent('click'));
        // fadeAndRemoveToast: 50ms 后开始淡出，再 150ms 后移除
        vi.advanceTimersByTime(50);
        vi.advanceTimersByTime(150);
        expect(toastCount()).toBe(0);
    });

    it('最后一个 error toast 移除后容器回退 status/polite（aria 回退路径）', () => {
        // [audit:round16 P3] _syncToastAriaLive 回退是唯一有状态逻辑，此前未测
        showErrorToast('错误');
        const c = container()!;
        expect(c.getAttribute('role')).toBe('alert');
        // 自动移除：duration 8000 → 淡出 50ms → 淡出完成 300ms → removeToast
        vi.advanceTimersByTime(8000);
        vi.advanceTimersByTime(50);
        vi.advanceTimersByTime(300);
        expect(toastCount()).toBe(0);
        expect(c.getAttribute('role')).toBe('status');
        expect(c.getAttribute('aria-live')).toBe('polite');
    });

    it('duration 到期后自动淡出移除', () => {
        showToast('标题', undefined, undefined, 100);
        expect(toastCount()).toBe(1);
        vi.advanceTimersByTime(100); // 触发 fadeAndRemoveToast
        vi.advanceTimersByTime(50); // fade 开始
        vi.advanceTimersByTime(300); // fade 完成移除
        expect(toastCount()).toBe(0);
    });
});

describe('copy 按钮（clipboard）', () => {
    it('复制成功 → 文案切 copied 再复原', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        showToast('标题', '详情');
        const copyBtn = Array.from(container()!.querySelectorAll("button")).find(
            (b) => b.textContent === 'toast.copy'
        )!;
        copyBtn.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(writeText).toHaveBeenCalledWith('标题\n详情');
        expect(copyBtn.textContent).toBe('toast.copied');
        await vi.advanceTimersByTimeAsync(1500);
        expect(copyBtn.textContent).toBe('toast.copy');
    });

    it('clipboard 不可用 → 降级弹错误 toast', async () => {
        vi.stubGlobal('navigator', {
            clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
        });
        showToast('标题', '详情');
        const copyBtn = Array.from(container()!.querySelectorAll("button")).find(
            (b) => b.textContent === 'toast.copy'
        )!;
        copyBtn.click();
        await vi.advanceTimersByTimeAsync(0);
        // 降级错误 toast 出现
        expect(container()!.textContent).toContain('motion.clipboardUnavailable');
    });
});