import { describe, it, expect, vi } from 'vitest';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { observe } from '@/core/observer-handle';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { IMmdBindableModelAnimation } from 'babylon-mmd/esm/Runtime/Animation/IMmdBindableAnimation';
import type { MmdWasmPhysicsRuntimeImpl } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl';
import type { StreamAudioPlayer } from 'babylon-mmd/esm/Runtime/Audio/streamAudioPlayer';
import type { RuntimeModel } from '@/core/types';
import {
    getPhysicsImpl,
    getRigidBodyBundleMap,
    getStreamAudio,
    applyForceToModelRigidBodies,
    CapabilityProbe,
    onBoneMatricesUpdated,
    transformWorldToRootLocal,
    getBoneWorldMatrix,
    switchAnimation,
} from '../core/mmd-adapter';

// 最小 mock 模拟上游私有字段（与生产逻辑解耦，不引入真实 babylon-mmd 实例）
function mockPhysicsImpl(overrides: Record<string, unknown> = {}): MmdWasmPhysicsRuntimeImpl {
    return {
        rigidBodyBundleReferenceCountMap: new Map(),
        ...overrides,
    } as unknown as MmdWasmPhysicsRuntimeImpl;
}
function mockRuntime(impl?: MmdWasmPhysicsRuntimeImpl | null): IMmdRuntime {
    const physics = impl === undefined ? undefined : { impl };
    return { physics } as unknown as IMmdRuntime;
}
function mockPlayer(audio?: HTMLAudioElement): StreamAudioPlayer {
    // ADR-202 P2: fork 暴露公开 get audio()，adapter 现读 player.audio（不再反射 _audio）
    return { audio } as unknown as StreamAudioPlayer;
}

describe('MmdAdapter — babylon-mmd 私有字段网关（ADR-192）', () => {
    describe('getRigidBodyBundleMap（条目3 内化：公开 API）', () => {
        it('返回公开属性 rigidBodyBundleReferenceCountMap 的 keys', () => {
            const a = {};
            const b = {};
            const impl = mockPhysicsImpl({
                rigidBodyBundleReferenceCountMap: new Map([
                    [a, 1],
                    [b, 2],
                ]),
            });
            expect([...getRigidBodyBundleMap(impl)]).toEqual([a, b]);
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

        it('被动 .impl 为 null 但有 getImpl 时主动创建（ADR-200 lazy impl 修复）', () => {
            const created = mockPhysicsImpl();
            const getImpl = vi.fn(() => created);
            const runtime = {
                physics: { impl: null, getImpl },
            } as unknown as IMmdRuntime;
            expect(getPhysicsImpl(runtime)).toBe(created);
            expect(getImpl).toHaveBeenCalledTimes(1);
        });
    });

    describe('applyForceToModelRigidBodies（条目 — ADR-200 守卫式反射施力）', () => {
        function mockModel(rigidBodyData: Array<{ physicsMode: number }> | null): RuntimeModel {
            if (rigidBodyData === null) {
                return {} as unknown as RuntimeModel; // 无 _physicsModel
            }
            const applyCentralForce = vi.fn();
            const bundle = { count: rigidBodyData.length, rigidBodyData, applyCentralForce };
            return {
                _physicsModel: { _bundle: bundle },
                // 暴露供断言
                __bundle: bundle,
            } as unknown as RuntimeModel;
        }

        it('仅对真物理刚体施力（Physics=1 / PhysicsWithBone=2），跳过 FollowBone=0', () => {
            const model = mockModel([
                { physicsMode: 0 }, // FollowBone — 跳过
                { physicsMode: 1 }, // Physics — 施力
                { physicsMode: 2 }, // PhysicsWithBone — 施力
                { physicsMode: 0 }, // FollowBone — 跳过
            ]);
            const force = new Vector3(1, 0, 0);
            const applied = applyForceToModelRigidBodies(model, force);
            expect(applied).toBe(2);
            const bundle = (model as unknown as { __bundle: { applyCentralForce: ReturnType<typeof vi.fn> } })
                .__bundle;
            expect(bundle.applyCentralForce).toHaveBeenCalledTimes(2);
            // 施力的 index 为 1 和 2
            expect(bundle.applyCentralForce.mock.calls[0][0]).toBe(1);
            expect(bundle.applyCentralForce.mock.calls[1][0]).toBe(2);
        });

        it('_physicsModel 缺失时返回 0（降级，不抛异常）', () => {
            const model = mockModel(null);
            expect(applyForceToModelRigidBodies(model, new Vector3(1, 0, 0))).toBe(0);
        });
    });

    describe('getStreamAudio', () => {
        it('audio 存在时返回', () => {
            const el = new Audio();
            expect(getStreamAudio(mockPlayer(el))).toBe(el);
        });

        it('audio 缺失时返回 null（降级）', () => {
            expect(getStreamAudio(mockPlayer(undefined))).toBeNull();
        });
    });

    describe('CapabilityProbe', () => {
        it('hasStreamAudio 探测字段存在性', () => {
            expect(CapabilityProbe.hasStreamAudio(mockPlayer(new Audio()))).toBe(true);
            expect(CapabilityProbe.hasStreamAudio(mockPlayer(undefined))).toBe(false);
        });
    });
});

describe('MmdAdapter — Phase 1 时序/坐标系契约 + 切换契约（ADR-192）', () => {
    describe('onBoneMatricesUpdated（条目 12 时序）', () => {
        function mockScene() {
            const observers: Array<() => void> = [];
            const obs = {
                add: (cb: () => void) => {
                    observers.push(cb);
                    return cb as unknown as ReturnType<typeof observe>;
                },
                _notify: () => observers.forEach((o) => o()),
            };
            return { scene: { onBeforeRenderObservable: obs } as unknown as Scene, obs };
        }

        it('注册回调到 onBeforeRenderObservable，触发时调用一次', () => {
            const { scene, obs } = mockScene();
            let called = 0;
            const handle = onBoneMatricesUpdated(scene, () => {
                called++;
            });
            expect(handle).toBeDefined();
            obs._notify();
            expect(called).toBe(1);
        });
    });

    describe('transformWorldToRootLocal（条目 12 坐标系）', () => {
        it('把世界坐标点转换到 rootMesh 局部坐标', () => {
            const root = Matrix.Translation(10, 0, 0);
            const mesh = { getWorldMatrix: () => root };
            const target = new Vector3(10, 0, 0); // 世界 (10,0,0) 在平移 mesh 局部为原点
            const ok = transformWorldToRootLocal(mesh, target);
            expect(ok).toBe(true);
            expect(target.x).toBeCloseTo(0);
            expect(target.y).toBeCloseTo(0);
            expect(target.z).toBeCloseTo(0);
        });

        it('mesh 无 getWorldMatrix 时返回 false（降级不转换）', () => {
            const target = new Vector3(1, 2, 3);
            const ok = transformWorldToRootLocal({}, target);
            expect(ok).toBe(false);
        });
    });

    describe('getBoneWorldMatrix（条目 12 坐标系）', () => {
        it('返回骨骼世界系矩阵 = 局部 × rootWorld', () => {
            const local = Matrix.Identity();
            const bone = { worldMatrix: Array.from(local.m) } as unknown as IMmdRuntimeBone;
            const rootWorld = Matrix.Translation(5, 0, 0);
            const mesh = { getWorldMatrix: () => rootWorld };
            const result = getBoneWorldMatrix(bone, mesh);
            expect(result.m[12]).toBeCloseTo(5);
        });
    });

    describe('switchAnimation（条目 14 切换+重置）', () => {
        function mockModel(seq: string[], hasPrev: boolean) {
            const prev = hasPrev ? { dispose: () => seq.push('dispose') } : null;
            const model = {
                currentAnimation: prev,
                setRuntimeAnimation: (h: unknown) =>
                    seq.push(`set:${h === null ? 'null' : 'handle'}`),
                createRuntimeAnimation: () => {
                    seq.push('create');
                    return 'handle';
                },
            } as unknown as RuntimeModel;
            return { model, seq };
        }
        function mockRuntime(seq: string[]) {
            return {
                seekAnimation: () => {
                    seq.push('seek');
                    return Promise.resolve();
                },
            } as unknown as IMmdRuntime;
        }

        it('执行 解绑 → dispose 旧 → 创建 → 绑定 → seek(0,true) 序列', async () => {
            const { model, seq } = mockModel(['__init__'], true);
            await switchAnimation(mockRuntime(seq), model, {} as IMmdBindableModelAnimation);
            expect(seq).toEqual([
                '__init__',
                'set:null',
                'dispose',
                'create',
                'set:handle',
                'seek',
            ]);
        });

        it('currentAnimation 为 null 时跳过 dispose', async () => {
            const { model, seq } = mockModel(['__init__'], false);
            await switchAnimation(mockRuntime(seq), model, {} as IMmdBindableModelAnimation);
            expect(seq).toEqual(['__init__', 'set:null', 'create', 'set:handle', 'seek']);
        });

        it('seekAnimation 抛错不阻断切换', async () => {
            const { model, seq } = mockModel(['__init__'], false);
            const runtime = {
                seekAnimation: () => {
                    seq.push('seek');
                    return Promise.reject(new Error('boom'));
                },
            } as unknown as IMmdRuntime;
            await expect(
                switchAnimation(runtime, model, {} as IMmdBindableModelAnimation)
            ).resolves.toBeUndefined();
            expect(seq).toEqual(['__init__', 'set:null', 'create', 'set:handle', 'seek']);
        });
    });
});
