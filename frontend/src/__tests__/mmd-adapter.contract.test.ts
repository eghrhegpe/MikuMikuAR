import { describe, it, expect } from 'vitest';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { MmdWasmPhysicsRuntimeImpl } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl';
import type { StreamAudioPlayer } from 'babylon-mmd/esm/Runtime/Audio/streamAudioPlayer';
import { getPhysicsImpl, getRigidBodyBundleMap, getStreamAudio, CapabilityProbe } from '../core/mmd-adapter';

// 最小 mock 模拟上游私有字段（与生产逻辑解耦，不引入真实 babylon-mmd 实例）
function mockPhysicsImpl(overrides: Record<string, unknown> = {}): MmdWasmPhysicsRuntimeImpl {
    return { _rigidBodyBundleMap: new Map(), ...overrides } as unknown as MmdWasmPhysicsRuntimeImpl;
}
function mockRuntime(impl?: MmdWasmPhysicsRuntimeImpl | null): IMmdRuntime {
    const physics = impl === undefined ? undefined : { impl };
    return { physics } as unknown as IMmdRuntime;
}
function mockPlayer(audio?: HTMLAudioElement): StreamAudioPlayer {
    return { _audio: audio } as unknown as StreamAudioPlayer;
}

describe('MmdAdapter — babylon-mmd 私有字段网关（ADR-192）', () => {
    describe('getRigidBodyBundleMap', () => {
        it('返回 _rigidBodyBundleMap 的 keys 迭代器', () => {
            const a = {};
            const b = {};
            const impl = mockPhysicsImpl({ _rigidBodyBundleMap: new Map([[a, 1], [b, 2]]) });
            expect([...getRigidBodyBundleMap(impl)]).toEqual([a, b]);
        });

        it('字段缺失（undefined）时抛升级回归错误', () => {
            const impl = mockPhysicsImpl({ _rigidBodyBundleMap: undefined });
            expect(() => [...getRigidBodyBundleMap(impl)]).toThrow(/_rigidBodyBundleMap 不存在/);
        });

        it('字段类型异常（非 Map）时抛错误', () => {
            const impl = mockPhysicsImpl({ _rigidBodyBundleMap: 123 });
            expect(() => [...getRigidBodyBundleMap(impl)]).toThrow(/类型异常/);
        });
    });

    describe('getPhysicsImpl', () => {
        it('physics 存在时返回 impl', () => {
            const impl = mockPhysicsImpl();
            expect(getPhysicsImpl(mockRuntime(impl))).toBe(impl);
        });

        it('physics 为 null/undefined 时返回 null', () => {
            expect(getPhysicsImpl(mockRuntime(undefined))).toBeNull();
            expect(getPhysicsImpl(mockRuntime(null))).toBeNull();
        });
    });

    describe('getStreamAudio', () => {
        it('_audio 存在时返回', () => {
            const el = new Audio();
            expect(getStreamAudio(mockPlayer(el))).toBe(el);
        });

        it('_audio 缺失时返回 null（降级）', () => {
            expect(getStreamAudio(mockPlayer(undefined))).toBeNull();
        });
    });

    describe('CapabilityProbe', () => {
        it('hasRigidBodyBundleMap 探测字段存在性', () => {
            expect(CapabilityProbe.hasRigidBodyBundleMap(mockPhysicsImpl())).toBe(true);
            expect(CapabilityProbe.hasRigidBodyBundleMap(mockPhysicsImpl({ _rigidBodyBundleMap: undefined }))).toBe(false);
        });

        it('hasStreamAudio 探测字段存在性', () => {
            expect(CapabilityProbe.hasStreamAudio(mockPlayer(new Audio()))).toBe(true);
            expect(CapabilityProbe.hasStreamAudio(mockPlayer(undefined))).toBe(false);
        });
    });
});
