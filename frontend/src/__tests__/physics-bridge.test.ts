// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { Scene } from '@babylonjs/core/scene';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import {
    findRuntimeBone,
    getBoneLocalMatrix,
    getBoneWorldPosition,
    autoFitAttachment,
    PerFrameUpdateRegistry,
    type AttachmentAnchors,
} from '@/scene/physics/physics-bridge';

function makeModel(bones: { name: string; worldMatrix: Float32Array }[]): IMmdModel {
    return { runtimeBones: bones } as unknown as IMmdModel;
}

function matWithTranslation(x: number, y: number, z: number): Float32Array {
    const a = new Float32Array(16);
    a[0] = 1;
    a[5] = 1;
    a[10] = 1;
    a[15] = 1;
    a[12] = x;
    a[13] = y;
    a[14] = z;
    return a;
}

describe('physics-bridge bone read bridge', () => {
    const model = makeModel([
        { name: 'Center', worldMatrix: new Float32Array(16) },
        { name: 'Waist', worldMatrix: matWithTranslation(1, 2, 3) },
    ]);

    it('findRuntimeBone finds by name, handles missing/null', () => {
        expect(findRuntimeBone(model, 'Waist')?.name).toBe('Waist');
        expect(findRuntimeBone(model, 'Nope')).toBeNull();
        expect(findRuntimeBone(null, 'x')).toBeNull();
        expect(findRuntimeBone(undefined, 'x')).toBeNull();
        expect(findRuntimeBone(makeModel([]), 'x')).toBeNull();
    });

    it('getBoneLocalMatrix returns the bone matrix or null', () => {
        const mm = getBoneLocalMatrix(model, 'Waist');
        expect(mm).not.toBeNull();
        expect(mm![12]).toBe(1);
        expect(mm![13]).toBe(2);
        expect(mm![14]).toBe(3);
        expect(getBoneLocalMatrix(model, 'Nope')).toBeNull();
    });

    it('getBoneWorldPosition extracts local translation (legacy world-named API)', () => {
        const p = getBoneWorldPosition(model, 'Waist');
        expect(p).not.toBeNull();
        expect(p!.x).toBe(1);
        expect(p!.y).toBe(2);
        expect(p!.z).toBe(3);
        expect(getBoneWorldPosition(model, 'Nope')).toBeNull();
        expect(getBoneWorldPosition(null, 'x')).toBeNull();
    });
});

describe('physics-bridge autoFitAttachment', () => {
    it('produces sane geometry for a typical model', () => {
        const fit = autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } });
        expect(fit.length).toBeCloseTo(0.48);
        expect(fit.innerRadius).toBeCloseTo(0.192);
        expect(fit.segmentsV).toBe(8);
        expect(fit.segmentsH).toBe(20);
        expect(fit.particleRadius).toBeCloseTo(0.03);
        expect(fit.particleSpacing).toBeCloseTo(0.06);
    });

    it('clamps results within bounds for oversized models', () => {
        const fit = autoFitAttachment({ modelSize: { x: 99, y: 99, z: 99 } });
        expect(fit.length).toBe(2.0);
        expect(fit.innerRadius).toBe(0.6);
        expect(fit.segmentsV).toBe(32);
        expect(fit.segmentsH).toBe(63);
        expect(fit.particleRadius).toBeCloseTo(0.03);
        expect(fit.particleSpacing).toBeCloseTo(0.06);
    });

    it('honors custom density', () => {
        const fit = autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: 0.1 });
        expect(fit.particleSpacing).toBeCloseTo(0.1);
        expect(fit.particleRadius).toBeCloseTo(0.05);
    });

    it('falls back to default density for non-positive / non-finite density', () => {
        // density=0：旧实现会得到 particleRadius=0 的退化几何
        expect(
            autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: 0 })
                .particleRadius
        ).toBeCloseTo(0.03);
        // density 负数：旧实现会得到负 particleRadius
        expect(
            autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: -0.1 })
                .particleRadius
        ).toBeGreaterThan(0);
        // density NaN：旧实现会让 particleRadius 扩散为 NaN
        expect(
            autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: NaN })
                .particleRadius
        ).toBeCloseTo(0.03);
        // density Infinity：同样回退默认
        expect(
            autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: Infinity })
                .particleRadius
        ).toBeGreaterThan(0);
    });

    it('returns finite defaults for missing, empty, non-finite or non-positive model size', () => {
        const cases: unknown[] = [
            null,
            undefined,
            {},
            { modelSize: undefined },
            { modelSize: { y: NaN } },
            { modelSize: { y: Infinity } },
            { modelSize: { y: -Infinity } },
            { modelSize: { y: 0 } },
            { modelSize: { y: -1 } },
        ];
        for (const anchor of cases) {
            const fit = autoFitAttachment(anchor as AttachmentAnchors);
            expect(Number.isFinite(fit.length)).toBe(true);
            expect(Number.isFinite(fit.innerRadius)).toBe(true);
            expect(Number.isFinite(fit.segmentsV)).toBe(true);
            expect(Number.isFinite(fit.segmentsH)).toBe(true);
            expect(fit.length).toBeGreaterThan(0);
            expect(fit.innerRadius).toBeGreaterThan(0);
            expect(fit.particleRadius).toBeGreaterThan(0);
        }
    });
});

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
});
