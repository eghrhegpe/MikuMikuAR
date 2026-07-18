// [doc:adr-125] motion-history 单测 — push/undo/redo 循环、多模型隔离、合并策略

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    getHistoryEntries,
    getHistoryCursor,
    clearHistory,
    jumpToHistory,
} from '@/scene/motion/motion-modules/motion-history';

type Snap = Record<string, { enabled: boolean; params: Record<string, number | boolean | string> }>;

let _snapId = 0;
function makeBuilder(enabled = false): () => Snap {
    return () => ({
        mod1: { enabled, params: { tilt: _snapId++ } },
    });
}

function makeApplier(log: string[]): (snap: Snap) => void {
    return (snap) => {
        log.push(JSON.stringify(snap));
    };
}

describe('motion-history', () => {
    beforeEach(() => {
        clearHistory('model-1');
        clearHistory('model-2');
        _snapId = 0;
        vi.useFakeTimers();
    });

    it('push + undo 恢复到上一条快照', () => {
        const log: string[] = [];
        const applier = makeApplier(log);

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder(false));
        vi.advanceTimersByTime(600); // 超出合并窗口
        pushHistory('model-1', 'mod1', 'tilt', 5, 10, makeBuilder(true));

        expect(canUndo('model-1')).toBe(true);
        undo('model-1', applier);
        expect(log).toHaveLength(1);
        expect(JSON.parse(log[0]).mod1.enabled).toBe(false);
    });

    it('undo 到初始状态时传入空对象', () => {
        const log: string[] = [];
        const applier = makeApplier(log);

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        undo('model-1', applier);
        expect(log).toHaveLength(1);
        expect(log[0]).toBe('{}');
    });

    it('undo 不会越界（cursor < 0 时返回 false）', () => {
        const log: string[] = [];
        const applier = makeApplier(log);

        expect(undo('model-1', applier)).toBe(false);
        expect(log).toHaveLength(0);
    });

    it('redo 恢复到下一条快照', () => {
        const log: string[] = [];
        const applier = makeApplier(log);

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder(false));
        vi.advanceTimersByTime(600);
        pushHistory('model-1', 'mod1', 'tilt', 5, 10, makeBuilder(true));

        undo('model-1', applier);
        redo('model-1', applier);
        expect(log).toHaveLength(2);
        expect(JSON.parse(log[1]).mod1.enabled).toBe(true);
    });

    it('redo 不会越界（已在最新时返回 false）', () => {
        const log: string[] = [];
        const applier = makeApplier(log);

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        expect(redo('model-1', applier)).toBe(false);
    });

    it('新 push 截断 redo 分支', () => {
        const log: string[] = [];
        const applier = makeApplier(log);

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        vi.advanceTimersByTime(600);
        pushHistory('model-1', 'mod1', 'tilt', 5, 10, makeBuilder());
        undo('model-1', applier); // cursor: 1→0

        vi.advanceTimersByTime(600);
        pushHistory('model-1', 'mod1', 'tilt', 5, 15, makeBuilder());

        expect(canRedo('model-1')).toBe(false);
        expect(getHistoryEntries('model-1')).toHaveLength(2);
    });

    it('多模型隔离', () => {
        const log1: string[] = [];
        const log2: string[] = [];
        const applier1 = makeApplier(log1);
        const applier2 = makeApplier(log2);

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        vi.advanceTimersByTime(600);
        pushHistory('model-2', 'mod1', 'tilt', 0, 8, makeBuilder());

        undo('model-1', applier1);
        expect(log1).toHaveLength(1);
        expect(log2).toHaveLength(0);

        undo('model-2', applier2);
        expect(log2).toHaveLength(1);
    });

    it('canUndo / canRedo 状态正确', () => {
        expect(canUndo('model-1')).toBe(false);
        expect(canRedo('model-1')).toBe(false);

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        expect(canUndo('model-1')).toBe(true);
        expect(canRedo('model-1')).toBe(false);

        undo('model-1', () => {});
        expect(canUndo('model-1')).toBe(false);
        expect(canRedo('model-1')).toBe(true);
    });

    it('getHistoryEntries 返回条目列表', () => {
        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        vi.advanceTimersByTime(600);
        pushHistory('model-1', 'mod1', 'tilt', 5, 10, makeBuilder());

        const entries = getHistoryEntries('model-1');
        expect(entries).toHaveLength(2);
        expect(entries[0].description).toBe('mod1.tilt: 0 → 5');
        expect(entries[1].description).toBe('mod1.tilt: 5 → 10');
    });

    it('getHistoryCursor 返回当前位置', () => {
        expect(getHistoryCursor('model-1')).toBe(-1);

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        expect(getHistoryCursor('model-1')).toBe(0);

        vi.advanceTimersByTime(600);
        pushHistory('model-1', 'mod1', 'tilt', 5, 10, makeBuilder());
        expect(getHistoryCursor('model-1')).toBe(1);

        undo('model-1', () => {});
        expect(getHistoryCursor('model-1')).toBe(0);
    });

    it('clearHistory 清除指定模型历史', () => {
        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        vi.advanceTimersByTime(600);
        pushHistory('model-2', 'mod1', 'tilt', 0, 5, makeBuilder());

        clearHistory('model-1');
        expect(canUndo('model-1')).toBe(false);
        expect(canUndo('model-2')).toBe(true);
    });

    it('时间窗口合并：同参数连续变更只保留一条', () => {
        pushHistory('model-1', 'mod1', 'tilt', 0, 1, makeBuilder());
        pushHistory('model-1', 'mod1', 'tilt', 1, 2, makeBuilder());
        pushHistory('model-1', 'mod1', 'tilt', 2, 3, makeBuilder());

        const entries = getHistoryEntries('model-1');
        expect(entries).toHaveLength(1);
        expect(entries[0].description).toContain('2 → 3');
    });

    it('不同参数不合并', () => {
        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        pushHistory('model-1', 'mod1', 'bend', 0, 10, makeBuilder());

        const entries = getHistoryEntries('model-1');
        expect(entries).toHaveLength(2);
    });

    it('合并窗口断裂后新建条目', () => {
        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        vi.advanceTimersByTime(600); // 超出 500ms 窗口
        pushHistory('model-1', 'mod1', 'tilt', 5, 10, makeBuilder());

        const entries = getHistoryEntries('model-1');
        expect(entries).toHaveLength(2);
    });
});

// ═════════════════════════════════════════════════════════════════════
// [doc:adr-125 P3] jumpToHistory 测试
// ═════════════════════════════════════════════════════════════════════

describe('jumpToHistory', () => {
    beforeEach(() => {
        clearHistory('model-1');
        _snapId = 0;
        vi.useFakeTimers();
    });

    it('跳转到指定条目', () => {
        const log: string[] = [];
        const applier = makeApplier(log);

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder(false));
        vi.advanceTimersByTime(600);
        pushHistory('model-1', 'mod1', 'tilt', 5, 10, makeBuilder(true));
        vi.advanceTimersByTime(600);
        pushHistory('model-1', 'mod1', 'tilt', 10, 15, makeBuilder(false));

        // 跳转到第 0 条（第一条）
        jumpToHistory('model-1', 0, applier);
        expect(log).toHaveLength(1);
        expect(JSON.parse(log[0]).mod1.enabled).toBe(false);
        expect(getHistoryCursor('model-1')).toBe(0);
    });

    it('跳转到初始状态（-1）', () => {
        const log: string[] = [];
        const applier = makeApplier(log);

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        jumpToHistory('model-1', -1, applier);
        expect(log).toHaveLength(1);
        expect(log[0]).toBe('{}');
        expect(getHistoryCursor('model-1')).toBe(-1);
    });

    it('已在目标位置时返回 false', () => {
        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        expect(jumpToHistory('model-1', 0, () => {})).toBe(false);
    });

    it('越界时返回 false', () => {
        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        expect(jumpToHistory('model-1', 5, () => {})).toBe(false);
        expect(jumpToHistory('model-1', -2, () => {})).toBe(false);
    });

    it('跳转后 canUndo/canRedo 正确', () => {
        const applier = () => {};

        pushHistory('model-1', 'mod1', 'tilt', 0, 5, makeBuilder());
        vi.advanceTimersByTime(600);
        pushHistory('model-1', 'mod1', 'tilt', 5, 10, makeBuilder());
        vi.advanceTimersByTime(600);
        pushHistory('model-1', 'mod1', 'tilt', 10, 15, makeBuilder());

        // cursor=2（最新），跳转到 0
        jumpToHistory('model-1', 0, applier);
        expect(canUndo('model-1')).toBe(true); // cursor=0，可 undo 到 -1
        expect(canRedo('model-1')).toBe(true); // cursor=0 < entries.length-1=2

        // 跳转到 -1（初始态）
        jumpToHistory('model-1', -1, applier);
        expect(canUndo('model-1')).toBe(false);
        expect(canRedo('model-1')).toBe(true);
    });
});
