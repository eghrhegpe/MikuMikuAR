// lighting-tween.test.ts — tween 逐帧驱动的注册表化（治理 R1 收口）
//
// 背景：tween 原实现每个活跃 tween 自持一条 `onBeforeRenderObservable.addOnce(tick)`
// 自续帧 —— N 个 tween = N 条一次性 observer，且 tick 未包 safeCallVoid，
// 回调抛错会冒泡进 Babylon render loop，污染整帧的其它 observer。
// 现改为走 core/frame-registry 的场景键共享表（全场景唯一一条 observer）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Scene } from '@babylonjs/core/scene';
import { lightingState } from '@/scene/render/lighting-state';
import { _tweenValue, _cancelAllLightingTweens } from '@/scene/render/lighting-tween';

function makeScene(deltaTime = 16.7): Scene {
    return {
        deltaTime,
        onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        onDisposeObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
    } as unknown as Scene;
}

/** 手动触发一帧：取出注册表挂在 scene 上的那唯一一条 observer 回调并调用。 */
function fireFrame(scene: Scene): void {
    const add = (scene as any).onBeforeRenderObservable.add as ReturnType<typeof vi.fn>;
    const cb = add.mock.calls[0][0];
    cb();
}

function addCallCount(scene: Scene): number {
    return ((scene as any).onBeforeRenderObservable.add as ReturnType<typeof vi.fn>).mock.calls
        .length;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('lighting tween — 走 frame-registry 共享表', () => {
    beforeEach(() => {
        _cancelAllLightingTweens();
        lightingState.scene = null;
    });

    afterEach(() => {
        _cancelAllLightingTweens();
        lightingState.scene = null;
        vi.restoreAllMocks();
    });

    it('多个并发 tween 共用同一条 observer（不再一 tween 一条）', () => {
        const scene = makeScene();
        lightingState.scene = scene;

        _tweenValue(0, 1, 10_000, vi.fn());
        _tweenValue(0, 1, 10_000, vi.fn());
        _tweenValue(0, 1, 10_000, vi.fn());

        expect(addCallCount(scene)).toBe(1);
    });

    it('tween 随帧推进，未到期时不跳到终值', () => {
        const scene = makeScene();
        lightingState.scene = scene;
        const values: number[] = [];

        _tweenValue(0, 10, 10_000, (v) => values.push(v));

        fireFrame(scene);

        expect(values.length).toBe(1);
        expect(values[0]).toBeLessThan(10);
    });

    it('到期后落到终值、调用 onComplete 一次并摘除自己', async () => {
        const scene = makeScene();
        lightingState.scene = scene;
        const onUpdate = vi.fn();
        const onComplete = vi.fn();

        _tweenValue(0, 10, 1, onUpdate, onComplete);
        await sleep(10);
        fireFrame(scene);

        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate.mock.calls[0][0]).toBeCloseTo(10, 5);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(lightingState.activeTweens.size).toBe(0);
        // 表已空 → observer 被摘掉（Babylon 侧走延迟移除）
        expect((scene as any).onBeforeRenderObservable.remove).toHaveBeenCalled();
    });

    it('onUpdate 抛错不冒泡进 render loop：tween 被摘除、onComplete 仍被调用', () => {
        const scene = makeScene();
        lightingState.scene = scene;
        const onComplete = vi.fn();

        _tweenValue(
            0,
            1,
            10_000,
            () => {
                throw new Error('boom');
            },
            onComplete
        );

        expect(() => fireFrame(scene)).not.toThrow();
        // onComplete 必须被调用：applyLightingPresetFromEnv 的 pendingTweens 靠它归零，
        // 否则 skipLightAutoSave 永久为 true（自动保存永久失效）
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(lightingState.activeTweens.size).toBe(0);

        // 下一帧不再重复抛错（tween 已摘除）
        expect(() => fireFrame(scene)).not.toThrow();
    });

    it('cancel() 立即摘除注册，后续帧不再回调', () => {
        const scene = makeScene();
        lightingState.scene = scene;
        const onUpdate = vi.fn();

        const tw = _tweenValue(0, 1, 10_000, onUpdate);
        fireFrame(scene);
        expect(onUpdate).toHaveBeenCalledTimes(1);

        tw.cancel();
        fireFrame(scene);

        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(lightingState.activeTweens.size).toBe(0);
    });

    it('无场景时直接落到终值并结束，不抛错', () => {
        lightingState.scene = null;
        const onUpdate = vi.fn();
        const onComplete = vi.fn();

        expect(() => _tweenValue(0, 5, 100, onUpdate, onComplete)).not.toThrow();
        expect(onUpdate).toHaveBeenCalledWith(5);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(lightingState.activeTweens.size).toBe(0);
    });

    it('_cancelAllLightingTweens 清空全部活跃 tween', () => {
        const scene = makeScene();
        lightingState.scene = scene;
        const onUpdate = vi.fn();

        _tweenValue(0, 1, 10_000, onUpdate);
        _tweenValue(0, 1, 10_000, onUpdate);
        expect(lightingState.activeTweens.size).toBe(2);

        _cancelAllLightingTweens();

        expect(lightingState.activeTweens.size).toBe(0);
        fireFrame(scene);
        expect(onUpdate).not.toHaveBeenCalled();
    });
});
