import { describe, it, expect, vi } from 'vitest';
import type { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import {
    findRuntimeBone,
    getBoneWorldMatrix,
    getBoneWorldPosition,
    autoFitAttachment,
    PerFrameUpdateRegistry,
} from '../physics/physics-bridge';

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
    });

    it('getBoneWorldMatrix returns the bone matrix or null', () => {
        const mm = getBoneWorldMatrix(model, 'Waist');
        expect(mm).not.toBeNull();
        expect(mm![12]).toBe(1);
        expect(mm![13]).toBe(2);
        expect(mm![14]).toBe(3);
        expect(getBoneWorldMatrix(model, 'Nope')).toBeNull();
    });

    it('getBoneWorldPosition extracts translation', () => {
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
        expect(fit.length).toBeGreaterThan(0.1);
        expect(fit.innerRadius).toBeGreaterThan(0.03);
        expect(fit.segmentsV).toBeGreaterThanOrEqual(4);
        expect(fit.segmentsH).toBeGreaterThanOrEqual(6);
        expect(fit.particleRadius).toBeCloseTo(0.03);
        expect(fit.particleSpacing).toBeCloseTo(0.06);
    });

    it('clamps results within bounds for oversized models', () => {
        const fit = autoFitAttachment({ modelSize: { x: 99, y: 99, z: 99 } });
        expect(fit.length).toBeLessThanOrEqual(2.0);
        expect(fit.segmentsV).toBeLessThanOrEqual(32);
        expect(fit.segmentsH).toBeLessThanOrEqual(64);
    });

    it('honors custom density', () => {
        const fit = autoFitAttachment({ modelSize: { x: 0.5, y: 1.6, z: 0.3 } }, { density: 0.1 });
        expect(fit.particleSpacing).toBeCloseTo(0.1);
        expect(fit.particleRadius).toBeCloseTo(0.05);
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
});
