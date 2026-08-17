// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { Scene } from '@babylonjs/core/scene';
import { PerFrameUpdateRegistry, getFrameRegistry } from '@/core/frame-registry';

function makeScene(deltaTime = 16.7) {
    return {
        deltaTime,
        onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        onDisposeObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
    } as unknown as Scene;
}

describe('PerFrameUpdateRegistry', () => {
    it('registers, calls with clamped dt, and unregisters cleanly', () => {
        const fakeObserver = { tag: 'obs' };
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: {
                add: vi.fn(() => fakeObserver),
                remove: vi.fn(),
            },
        } as unknown as Scene;

        const reg = new PerFrameUpdateRegistry(scene as Scene);
        const fn = vi.fn();
        reg.register('a', fn);

        // 注册应只建立一次 observer
        const sceneAny = scene as any;
        expect(sceneAny.onBeforeRenderObservable.add).toHaveBeenCalledTimes(1);

        // 触发注册的回调（dt = 16.7ms -> 0.0167s）
        const cb = sceneAny.onBeforeRenderObservable.add.mock.calls[0][0];
        cb();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(0.0167);

        // 注销后 observer 被移除，且回调不再调用 fn
        reg.unregister('a');
        expect(sceneAny.onBeforeRenderObservable.remove).toHaveBeenCalledWith(fakeObserver);
        cb();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('clamps large dt to 0.05 and still updates (no skip)', () => {
        const scene = {
            deltaTime: 9999, // > 0.5s -> 钳制为 0.05 并仍调用
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        const fn = vi.fn();
        reg.register('a', fn);
        const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
        cb();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(0.05);
        reg.unregister('a');
    });

    it('skips update when dt is non-finite', () => {
        const scene = {
            deltaTime: NaN,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        const fn = vi.fn();
        reg.register('a', fn);
        const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
        cb();
        expect(fn).not.toHaveBeenCalled();
        reg.unregister('a');
    });

    it('skip update when dt === 0 or dt < 0', () => {
        for (const d of [0, -5]) {
            const scene = {
                deltaTime: d,
                onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
            } as unknown as Scene;
            const reg = new PerFrameUpdateRegistry(scene as Scene);
            const fn = vi.fn();
            reg.register('a', fn);
            const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
            cb();
            expect(fn).not.toHaveBeenCalled();
            reg.unregister('a');
        }
    });

    it('single observer dispatches to all registered keys', () => {
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        const a = vi.fn();
        const b = vi.fn();
        reg.register('a', a);
        reg.register('b', b);
        expect((scene as any).onBeforeRenderObservable.add).toHaveBeenCalledTimes(1);
        const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
        cb();
        expect(a).toHaveBeenCalledWith(0.0167);
        expect(b).toHaveBeenCalledWith(0.0167);
        reg.dispose();
    });

    it('unregistering one of two keeps observer alive for the other', () => {
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        const a = vi.fn();
        const b = vi.fn();
        reg.register('a', a);
        reg.register('b', b);
        reg.unregister('a');
        // observer 不应被移除（还有 b）
        expect((scene as any).onBeforeRenderObservable.remove).not.toHaveBeenCalled();
        const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
        cb();
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
        reg.dispose();
    });

    it('re-register after full unregister recreates the observer', () => {
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        const fn = vi.fn();
        reg.register('a', fn);
        reg.unregister('a');
        expect((scene as any).onBeforeRenderObservable.add).toHaveBeenCalledTimes(1);
        reg.register('b', fn);
        expect((scene as any).onBeforeRenderObservable.add).toHaveBeenCalledTimes(2);
        reg.dispose();
    });

    it('duplicate register replaces the callback without adding a second observer', () => {
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        const first = vi.fn();
        const second = vi.fn();
        reg.register('a', first);
        reg.register('a', second);
        expect((scene as any).onBeforeRenderObservable.add).toHaveBeenCalledTimes(1);
        const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
        cb();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledWith(0.0167);
        reg.dispose();
    });

    it('unregistering an unknown key is a no-op and keeps the observer', () => {
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        const fn = vi.fn();
        reg.register('a', fn);
        reg.unregister('nope');
        expect((scene as any).onBeforeRenderObservable.remove).not.toHaveBeenCalled();
        const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
        cb();
        expect(fn).toHaveBeenCalledTimes(1);
        reg.dispose();
    });

    it('a throwing fn does not block other registered fns (safeCallVoid)', () => {
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        const boom = vi.fn(() => {
            throw new Error('boom');
        });
        const ok = vi.fn();
        reg.register('boom', boom);
        reg.register('ok', ok);
        const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
        expect(() => cb()).not.toThrow();
        expect(boom).toHaveBeenCalledTimes(1);
        expect(ok).toHaveBeenCalledTimes(1);
        reg.dispose();
    });

    it('dispose removes observer, clears callbacks and disposes onDispose handle', () => {
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
            onDisposeObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        reg.register('a', vi.fn());
        reg.dispose();
        // observer 与 onDispose 句柄都被移除
        expect((scene as any).onBeforeRenderObservable.remove).toHaveBeenCalledTimes(1);
        expect((scene as any).onDisposeObservable.remove).toHaveBeenCalledTimes(1);
        // dispose 后回调整合（fns 已清空），不抛错且不产生新 observer
        const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
        expect(() => cb()).not.toThrow();
        expect((scene as any).onBeforeRenderObservable.add).toHaveBeenCalledTimes(1);
    });

    it('scene onDisposeObservable triggers automatic cleanup', () => {
        let disposeCb: (() => void) | null = null;
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
            onDisposeObservable: {
                add: vi.fn((cb: () => void) => {
                    disposeCb = cb;
                    return {};
                }),
                remove: vi.fn(),
            },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        reg.register('a', vi.fn());
        // 触发 scene 销毁 → 自动 dispose
        disposeCb!();
        expect((scene as any).onBeforeRenderObservable.remove).toHaveBeenCalledTimes(1);
        expect((scene as any).onDisposeObservable.remove).toHaveBeenCalledTimes(1);
    });

    it('dispose is idempotent and clears once', () => {
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
            onDisposeObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        reg.register('a', vi.fn());
        reg.dispose();
        reg.dispose();
        expect((scene as any).onBeforeRenderObservable.remove).toHaveBeenCalledTimes(1);
        expect((scene as any).onDisposeObservable.remove).toHaveBeenCalledTimes(1);
        const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
        expect(() => cb()).not.toThrow();
        expect((scene as any).onBeforeRenderObservable.add).toHaveBeenCalledTimes(1);
    });

    it('stops remaining callbacks in the same dispatch after reentrant dispose', () => {
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        const first = vi.fn(() => reg.dispose());
        const second = vi.fn();
        reg.register('first', first);
        reg.register('second', second);
        const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
        cb();
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
        expect((scene as any).onBeforeRenderObservable.remove).toHaveBeenCalledTimes(1);
    });

    it('register after dispose re-arms onDispose auto cleanup', () => {
        const disposeCbs: Array<() => void> = [];
        const scene = {
            deltaTime: 16.7,
            onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
            onDisposeObservable: {
                add: vi.fn((cb: () => void) => {
                    disposeCbs.push(cb);
                    return {};
                }),
                remove: vi.fn(),
            },
        } as unknown as Scene;
        const reg = new PerFrameUpdateRegistry(scene as Scene);
        reg.register('a', vi.fn());
        reg.dispose();
        reg.register('b', vi.fn());
        expect((scene as any).onDisposeObservable.add).toHaveBeenCalledTimes(2);
        disposeCbs[1]!();
        expect((scene as any).onBeforeRenderObservable.remove).toHaveBeenCalledTimes(2);
        expect((scene as any).onDisposeObservable.remove).toHaveBeenCalledTimes(2);
    });

    describe('getFrameRegistry（场景键共享表）', () => {
        it('同一 scene 多次获取返回同一实例，且只有一条 observer', () => {
            const scene = makeScene();
            const a = getFrameRegistry(scene);
            const b = getFrameRegistry(scene);
            expect(a).toBe(b);
            const fa = vi.fn();
            const fb = vi.fn();
            a.register('cam.freefly', fa);
            b.register('env.water.update', fb);
            // 两个子系统共享一张表 → scene 上只有一条 observer
            expect((scene as any).onBeforeRenderObservable.add).toHaveBeenCalledTimes(1);
            const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
            cb();
            expect(fa).toHaveBeenCalledWith(0.0167);
            expect(fb).toHaveBeenCalledWith(0.0167);
        });

        it('不同 scene 各拿各的表，互不串味', () => {
            const s1 = makeScene();
            const s2 = makeScene();
            const r1 = getFrameRegistry(s1);
            const r2 = getFrameRegistry(s2);
            expect(r1).not.toBe(r2);
            const f1 = vi.fn();
            const f2 = vi.fn();
            r1.register('only.in.s1', f1);
            r2.register('only.in.s2', f2);
            // 各自的 observer 独立建立
            expect((s1 as any).onBeforeRenderObservable.add).toHaveBeenCalledTimes(1);
            expect((s2 as any).onBeforeRenderObservable.add).toHaveBeenCalledTimes(1);
            // s1 的回调不应触发 s2 注册的 fn（反之同理）
            const cb1 = (s1 as any).onBeforeRenderObservable.add.mock.calls[0][0];
            cb1();
            expect(f1).toHaveBeenCalledTimes(1);
            expect(f2).not.toHaveBeenCalled();
        });

        it('某子系统只 unregister 自己的 key，不影响其他子系统的回调', () => {
            const scene = makeScene();
            const cam = vi.fn();
            const water = vi.fn();
            getFrameRegistry(scene).register('cam.freefly', cam);
            getFrameRegistry(scene).register('env.water.update', water);
            getFrameRegistry(scene).unregister('cam.freefly');
            // 表未空 → observer 仍在
            expect((scene as any).onBeforeRenderObservable.remove).not.toHaveBeenCalled();
            const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[0][0];
            cb();
            expect(cam).not.toHaveBeenCalled();
            expect(water).toHaveBeenCalledTimes(1);
        });

        it('scene dispose 后共享表自愈：再 register 能重新拿到可用 observer', () => {
            let disposeCb: (() => void) | null = null;
            const scene = {
                deltaTime: 16.7,
                onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
                onDisposeObservable: {
                    add: vi.fn((cb: () => void) => {
                        disposeCb = cb;
                        return {};
                    }),
                    remove: vi.fn(),
                },
            } as unknown as Scene;
            const reg = getFrameRegistry(scene);
            reg.register('a', vi.fn());
            disposeCb!(); // scene 销毁 → 表 dispose
            expect((scene as any).onBeforeRenderObservable.remove).toHaveBeenCalledTimes(1);
            // 同一 scene 对象被复用（极端情况）时，register 内部复位 _disposed 并重绑
            const fn = vi.fn();
            getFrameRegistry(scene).register('b', fn);
            const cb = (scene as any).onBeforeRenderObservable.add.mock.calls[1][0];
            cb();
            expect(fn).toHaveBeenCalledWith(0.0167);
        });
    });
});
