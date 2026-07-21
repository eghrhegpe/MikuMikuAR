// [doc:adr-169] replaceDefaultMotion 单测 — 原位替换默认动作
// 验收要求：四象限（有默认/无默认/空库/路径已存在）+ 原子广播（generation 单次递增）

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    replaceDefaultMotion,
    addSceneMotion,
    setDefaultMotion,
    clearAllSceneMotions,
    getSceneMotions,
    getActiveMotion,
    getActiveMotionId,
    getMotionGen,
    setBroadcastCallback,
} from '@/scene/motion/motion-intent';
import type { SceneMotionIntent } from '@/core/types';

/** setBroadcastCallback 的回调签名（与 motion-intent 内部类型一致） */
type BroadcastCb = (
    intent: SceneMotionIntent | null,
    gen: number,
    prev: SceneMotionIntent | null
) => void;

/** 构造最小合法 intent（vmdLayers 空、source='vmd'） */
function intent(vmdPath: string, vmdName = vmdPath): SceneMotionIntent {
    return { vmdPath, vmdName, vmdLayers: [], source: 'vmd' };
}

/** 添加一个主动作并返回其 id */
function add(path: string): string {
    return addSceneMotion(intent(path));
}

/** 当前场景库的 vmdPath 序列（用于断言顺序） */
function paths(): (string | null)[] {
    return getSceneMotions().map((m) => m.vmdPath);
}

describe('replaceDefaultMotion（ADR-169 原位替换默认动作）', () => {
    let broadcast: ReturnType<typeof vi.fn<BroadcastCb>>;

    beforeEach(() => {
        // 先摘掉回调再清库，避免清库广播打到上一个用例的 spy 上
        setBroadcastCallback(null);
        clearAllSceneMotions();
        broadcast = vi.fn<BroadcastCb>();
        setBroadcastCallback(broadcast);
    });

    // ── 四象限 ──

    it('有默认 + 新路径：旧默认被原位顶替，非默认动作保留', () => {
        add('a.vmd');
        const b = add('b.vmd');
        add('c.vmd');
        setDefaultMotion(b); // 默认 = B
        broadcast.mockClear();
        const genBefore = getMotionGen();

        const newId = replaceDefaultMotion(intent('d.vmd'));

        // D 插入到 B 原位置（index 1），B 被移除，A/C 保留
        expect(paths()).toEqual(['a.vmd', 'd.vmd', 'c.vmd']);
        expect(getActiveMotionId()).toBe(newId);
        expect(getSceneMotions().find((m) => m.id === b)).toBeUndefined();

        // 广播恰好一次：携新默认 + generation+1 + prev=旧默认B
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledWith(
            expect.objectContaining({ vmdPath: 'd.vmd' }),
            genBefore + 1,
            expect.objectContaining({ vmdPath: 'b.vmd' })
        );
    });

    it('有默认 + 路径已是库中候选：复用该候选（不重复添加），旧默认仍被移除', () => {
        const a = add('a.vmd');
        const b = add('b.vmd');
        setDefaultMotion(b); // 默认 = B
        broadcast.mockClear();

        const newId = replaceDefaultMotion(intent('a.vmd'));

        expect(newId).toBe(a); // 复用 A 的 id
        expect(paths()).toEqual(['a.vmd']); // B 被移除，A 保留
        expect(getActiveMotionId()).toBe(a);
    });

    it('无默认 + 库非空：新动作追加到末尾并设为默认', () => {
        add('a.vmd');
        add('b.vmd');
        setDefaultMotion(null); // 清默认，库保留
        broadcast.mockClear();

        const newId = replaceDefaultMotion(intent('d.vmd'));

        expect(paths()).toEqual(['a.vmd', 'b.vmd', 'd.vmd']);
        expect(getActiveMotionId()).toBe(newId);
    });

    it('空库：新动作加入并成为默认', () => {
        broadcast.mockClear();

        const newId = replaceDefaultMotion(intent('d.vmd'));

        expect(paths()).toEqual(['d.vmd']);
        expect(getActiveMotionId()).toBe(newId);
        expect(getActiveMotion()?.vmdPath).toBe('d.vmd');
    });

    // ── 边界与原子性 ──

    it('装载路径即当前默认：库与默认均不变（不误删）', () => {
        const a = add('a.vmd');
        add('b.vmd');
        setDefaultMotion(a); // 默认 = A
        broadcast.mockClear();

        const newId = replaceDefaultMotion(intent('a.vmd'));

        expect(newId).toBe(a);
        expect(paths()).toEqual(['a.vmd', 'b.vmd']); // 库不变
        expect(getActiveMotionId()).toBe(a);
    });

    it('原子广播：单次替换 generation 恰好 +1，广播恰好一次', () => {
        add('a.vmd');
        setDefaultMotion(null);
        broadcast.mockClear();
        const g0 = getMotionGen();

        replaceDefaultMotion(intent('x.vmd'));

        expect(getMotionGen()).toBe(g0 + 1);
        expect(broadcast).toHaveBeenCalledTimes(1);
    });
});
