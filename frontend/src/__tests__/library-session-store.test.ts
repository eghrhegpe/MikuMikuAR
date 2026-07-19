// [doc:adr-135] LibrarySessionStore 回归测试
//
// 守护 ADR-135 引入的行为变更：
//  - reset() 现清理 restore 残留态（timer / status / pending*）—— 原代码不清理，属修 bug 的行为变更
//  - P0.3 restore.status 状态机（idle/polling/ready/timeout）的正确流转与 ready 瞬态自回转
//  - setRestoreTimer 在重设新 timer 前清理旧 timer（并发 deferRestore 不残留）
//
// 注意：librarySessionStore 是跨用例共享的单例，每个用例前后必须回到干净态。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { librarySessionStore } from '../menus/library-session-store';

describe('LibrarySessionStore', () => {
    beforeEach(() => {
        librarySessionStore.reset();
        librarySessionStore.clearExtracting();
        librarySessionStore.setReplaceLoading(false);
        librarySessionStore.clearRestoreTimer();
        librarySessionStore.clearRestoreStatus();
    });

    // 取消可能残留的 ready 瞬态 timer，避免跨用例泄漏
    afterEach(() => {
        librarySessionStore.clearRestoreTimer();
        librarySessionStore.clearRestoreStatus();
    });

    describe('reset()', () => {
        it('clears restore state (pendingAutoExpand / pendingFocusModel)', () => {
            librarySessionStore.setPendingAutoExpand(['a', 'b']);
            librarySessionStore.setPendingFocusModel({ dir: 'd', rowKey: 'r' });

            librarySessionStore.reset();

            expect(librarySessionStore.getPendingAutoExpand()).toBeNull();
            expect(librarySessionStore.getPendingFocusModel()).toBeNull();
        });

        it('clears restore timer (P0.1 行为变更：原代码不清理)', () => {
            const fake = setTimeout(() => {}, 1000);
            librarySessionStore.setRestoreTimer(fake);
            expect(librarySessionStore.getRestoreTimer()).not.toBeNull();

            librarySessionStore.reset();

            expect(librarySessionStore.getRestoreTimer()).toBeNull();
            clearTimeout(fake);
        });

        it('clears restore status to idle (P0.3)', () => {
            librarySessionStore.markRestorePolling('cat');
            expect(librarySessionStore.getRestoreStatus()).toBe('polling');

            librarySessionStore.reset();

            expect(librarySessionStore.getRestoreStatus()).toBe('idle');
        });

        it('does NOT reset loading guards (跨弹窗重置期间解压/替换仍在进行是合理场景)', () => {
            librarySessionStore.setExtracting('foo.pmx');
            librarySessionStore.setReplaceLoading(true);

            librarySessionStore.reset();

            expect(librarySessionStore.isExtracting('foo.pmx')).toBe(true);
            expect(librarySessionStore.isReplaceLoading()).toBe(true);
        });
    });

    describe('restore status state machine (P0.3)', () => {
        it('markRestorePolling records seg + startedAt and sets status=polling', () => {
            librarySessionStore.markRestorePolling('cat');

            expect(librarySessionStore.getRestoreStatus()).toBe('polling');
            expect(librarySessionStore.getRestoreTargetSeg()).toBe('cat');
            expect(typeof librarySessionStore.getRestoreStartedAt()).toBe('number');
        });

        it('markRestoreTimeout resets seg/startedAt and sets status=timeout', () => {
            librarySessionStore.markRestorePolling('cat');
            librarySessionStore.markRestoreTimeout();

            expect(librarySessionStore.getRestoreStatus()).toBe('timeout');
            expect(librarySessionStore.getRestoreTargetSeg()).toBeNull();
            expect(librarySessionStore.getRestoreStartedAt()).toBeNull();
        });

        it('markRestoreReady clears seg/startedAt and sets status=ready', () => {
            librarySessionStore.markRestorePolling('cat');
            librarySessionStore.markRestoreReady();

            expect(librarySessionStore.getRestoreStatus()).toBe('ready');
            expect(librarySessionStore.getRestoreTargetSeg()).toBeNull();
            expect(librarySessionStore.getRestoreStartedAt()).toBeNull();
        });

        it('markRestoreReady auto-reverts ready -> idle after 2s (兑现 ADR-135 瞬态契约)', () => {
            vi.useFakeTimers();
            try {
                librarySessionStore.markRestoreReady();
                expect(librarySessionStore.getRestoreStatus()).toBe('ready');

                vi.advanceTimersByTime(1999);
                expect(librarySessionStore.getRestoreStatus()).toBe('ready');

                vi.advanceTimersByTime(1);
                expect(librarySessionStore.getRestoreStatus()).toBe('idle');
            } finally {
                vi.useRealTimers();
            }
        });

        it('a new markRestorePolling cancels a pending ready auto-revert timer', () => {
            vi.useFakeTimers();
            try {
                librarySessionStore.markRestoreReady();
                librarySessionStore.markRestorePolling('next');
                vi.advanceTimersByTime(10000);
                // ready 的 2s 自回转已被取消，当前应处于 polling
                expect(librarySessionStore.getRestoreStatus()).toBe('polling');
            } finally {
                vi.useRealTimers();
            }
        });

        it('clearRestoreStatus returns to idle and cancels pending ready timer', () => {
            vi.useFakeTimers();
            try {
                librarySessionStore.markRestoreReady();
                librarySessionStore.clearRestoreStatus();
                expect(librarySessionStore.getRestoreStatus()).toBe('idle');
                // 推进时间不应再触发任何状态变化
                vi.advanceTimersByTime(5000);
                expect(librarySessionStore.getRestoreStatus()).toBe('idle');
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('setRestoreTimer()', () => {
        it('clears the previous timer when setting a new one (并发 deferRestore 不残留旧 timer)', () => {
            const spy = vi.spyOn(globalThis, 'clearTimeout');
            try {
                const t1 = setTimeout(() => {}, 5000);
                const t2 = setTimeout(() => {}, 5000);

                librarySessionStore.setRestoreTimer(t1); // 首次：timer 为 null，不清理
                librarySessionStore.setRestoreTimer(t2); // 重设：应先清理 t1

                expect(spy).toHaveBeenCalledWith(t1);
                clearTimeout(t2);
            } finally {
                spy.mockRestore();
            }
        });

        it('clearRestoreTimer nulls the handle after clearing', () => {
            const t = setTimeout(() => {}, 5000);
            librarySessionStore.setRestoreTimer(t);
            expect(librarySessionStore.getRestoreTimer()).toBe(t);

            librarySessionStore.clearRestoreTimer();
            expect(librarySessionStore.getRestoreTimer()).toBeNull();
        });
    });
});
