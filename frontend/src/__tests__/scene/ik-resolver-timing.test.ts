// [doc:adr-202 §六] IK 重解双调用路径时序验证。
// 核心断言：bone-override 的 _solvePosSlotIkWasm 与 feet-adjustment 的 mmdModelSolveIk
// 在一帧内不会对同一条 IK 链同时调用——两者互斥（POS slot 有覆盖 → feet-adjustment skip）。
// 这保证 mmdModelSolveIk 的幂等性不是「碰运气」，而是由编排层面的互斥保证。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended, FeetState } from '@/core/types';
import { getMotionPipeline } from '@/scene/motion/motion-pipeline';
import {
    startBoneOverride,
    stopBoneOverride,
    setWasmIkResolver,
    setBoneOverridePosition,
    clearAllOverrides,
    getWasmIkResolver,
} from '@/scene/motion/bone-override';
import { startFeetAdjustment, stopFeetAdjustment } from '@/scene/motion/feet-adjustment';
import { feetDebug } from '@/scene/motion/perception-shared';

// 注入聚焦模型 ID
vi.mock('@/core/state', async (importActual) => ({
    ...(await importActual<typeof import('@/core/state')>()),
    focusedModelId: 'test-model',
}));

// mock getGroundHeightAt 返回 0（脚在地面高度）
// 注意：不能 importActual，因为 env-impl 是 barrel 会触发 Scene 构造
vi.mock('@/scene/env/env-impl', () => ({
    getGroundHeightAt: () => 0,
}));

// mock getModuleState 返回 null（无脚部模块激活）
vi.mock('@/scene/motion/motion-modules/registry', async (importActual) => ({
    ...(await importActual<typeof import('@/scene/motion/motion-modules/registry')>()),
    getModuleState: () => null,
}));

/** 构造最小 WASM 骨骼 mock（无 updateWorldMatrix → isWasmRuntime 返回 true） */
function makeWasmBone(
    name: string,
    translation: [number, number, number],
    ikSolverIndex?: number
): IMmdRuntimeBone {
    // worldMatrix: 4×4 单位矩阵，translation 在 [12,13,14]
    const worldMatrix = new Float32Array(16);
    worldMatrix[0] = 1;
    worldMatrix[5] = 1;
    worldMatrix[10] = 1;
    worldMatrix[15] = 1;
    worldMatrix[12] = translation[0];
    worldMatrix[13] = translation[1];
    worldMatrix[14] = translation[2];

    const bone = {
        name,
        parentBone: null,
        childBones: [] as IMmdRuntimeBone[],
        getWorldTranslationToRef(ref: { x: number; y: number; z: number }) {
            ref.x = worldMatrix[12];
            ref.y = worldMatrix[13];
            ref.z = worldMatrix[14];
            return ref;
        },
        getWorldTranslationToRef2: undefined,
        setWorldTranslation(ref: { x: number; y: number; z: number }) {
            worldMatrix[12] = ref.x;
            worldMatrix[13] = ref.y;
            worldMatrix[14] = ref.z;
        },
        worldMatrix,
        ikSolverIndex,
    } as unknown as IMmdRuntimeBone & MmdRuntimeBoneExtended;
    return bone;
}

const MODEL_ID = 'test-model';

function defaultFeet(overrides: Partial<FeetState> = {}): FeetState {
    return {
        enabled: true,
        intensity: 1,
        soleHeight: 0,
        jumpThreshold: 0.5,
        bodySmooth: 0.5,
        footSmooth: 0.5,
        maxAngle: 30,
        reachAngle: 15,
        ...overrides,
    };
}

let engine: NullEngine;
let scene: Scene;
let resolverCalls: { modelId: string; ikSolverIndex: number; usePhysics: boolean }[];

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    resolverCalls = [];
    clearAllOverrides(MODEL_ID);
    // 注入 spy resolver
    setWasmIkResolver((modelId, ikSolverIndex, usePhysics) => {
        resolverCalls.push({ modelId, ikSolverIndex, usePhysics });
    });
});

afterEach(() => {
    stopBoneOverride();
    stopFeetAdjustment();
    setWasmIkResolver(null);
    feetDebug.value = false; // 恢复 debug 开关，避免影响后续测试
    scene.dispose();
    engine.dispose();
});

describe('IK 重解双调用路径时序（ADR-202 §六）', () => {
    it('场景A：IK 目标骨有 POS 覆盖 → bone-override 调 resolver，feet-adjustment skip', () => {
        // 构造骨骼：左足IK 在 Y=1.8（高于 groundY=0，jumpThreshold=0.5 → skip=true）
        const ikBone = makeWasmBone('左足ＩＫ', [0, 1.8, 0], 0);
        // centerY=0 让 modelGroundY=max(0, 0-legLength)=0，
        // 这样 jumpThreshold 判定只看 footY 相对地面，不被「模型中心高于地面」扭曲
        const centerBone = makeWasmBone('センター', [0, 0, 0]);
        const bones: IMmdRuntimeBone[] = [ikBone, centerBone];

        startBoneOverride(() => bones, scene);
        startFeetAdjustment(() => [
            {
                id: MODEL_ID,
                feet: defaultFeet(),
                runtimeBones: bones,
            },
        ]);

        // 设置 IK 目标骨的 POS 覆盖（触发 _solvePosSlotIkWasm）
        setBoneOverridePosition('左足ＩＫ', [0, -1.8, 0], 1, true, MODEL_ID);

        getMotionPipeline().runFrame({ scene });

        // bone-override 调了 resolver
        expect(resolverCalls.length).toBe(1);
        expect(resolverCalls[0].modelId).toBe(MODEL_ID);
        expect(resolverCalls[0].ikSolverIndex).toBe(0);
        expect(resolverCalls[0].usePhysics).toBe(false);

        // feet-adjustment 因 foundOverride 跳过，不调 resolver
        // → resolverCalls 仍为 1（不新增）
    });

    it('场景B：IK 目标骨无覆盖、脚需贴地 → feet-adjustment 调 resolver，bone-override 不调', () => {
        // 构造骨骼：左足IK 在 Y=0.1（低于 jumpThreshold=0.5 → skip=false → 贴地）
        const ikBone = makeWasmBone('左足ＩＫ', [0, 0.1, 0], 0);
        // centerY=0 让 modelGroundY=max(0, 0-legLength)=0，
        // 这样 jumpThreshold 判定只看 footY 相对地面，不被「模型中心高于地面」扭曲
        const centerBone = makeWasmBone('センター', [0, 0, 0]);
        const bones: IMmdRuntimeBone[] = [ikBone, centerBone];

        startBoneOverride(() => bones, scene);
        startFeetAdjustment(() => [
            {
                id: MODEL_ID,
                feet: defaultFeet(),
                runtimeBones: bones,
            },
        ]);

        // 不设置任何覆盖

        getMotionPipeline().runFrame({ scene });

        // bone-override 的 _solvePosSlotIkWasm 找不到 POS slot → 不调
        // feet-adjustment 调 resolver（skip=false → setWorldTranslation + resolver）
        expect(resolverCalls.length).toBe(1);
        expect(resolverCalls[0].modelId).toBe(MODEL_ID);
        expect(resolverCalls[0].ikSolverIndex).toBe(0);
        expect(resolverCalls[0].usePhysics).toBe(false);
    });

    it('场景C：IK 目标骨无覆盖、脚在空中 → 两者都不调 resolver', () => {
        // 构造骨骼：左足IK 在 Y=1.8（高于 jumpThreshold=0.5 → skip=true）
        const ikBone = makeWasmBone('左足ＩＫ', [0, 1.8, 0], 0);
        // centerY=0 让 modelGroundY=max(0, 0-legLength)=0，
        // 这样 jumpThreshold 判定只看 footY 相对地面，不被「模型中心高于地面」扭曲
        const centerBone = makeWasmBone('センター', [0, 0, 0]);
        const bones: IMmdRuntimeBone[] = [ikBone, centerBone];

        startBoneOverride(() => bones, scene);
        startFeetAdjustment(() => [
            {
                id: MODEL_ID,
                feet: defaultFeet(),
                runtimeBones: bones,
            },
        ]);

        getMotionPipeline().runFrame({ scene });

        // 无 POS slot → bone-override 不调
        // skip=true → feet-adjustment 不调
        expect(resolverCalls.length).toBe(0);
    });

    it('互斥不变量：连续多帧不会出现 resolver 双调用', () => {
        // 左足IK 在 Y=0.1（贴地区间），右足IK 在 Y=1.8（空中）
        const ikBoneL = makeWasmBone('左足ＩＫ', [0, 0.1, 0], 0);
        const ikBoneR = makeWasmBone('右足ＩＫ', [0, 1.8, 0], 1);
        // centerY=0 让 modelGroundY=max(0, 0-legLength)=0，
        // 这样 jumpThreshold 判定只看 footY 相对地面，不被「模型中心高于地面」扭曲
        const centerBone = makeWasmBone('センター', [0, 0, 0]);
        const bones: IMmdRuntimeBone[] = [ikBoneL, ikBoneR, centerBone];

        startBoneOverride(() => bones, scene);
        startFeetAdjustment(() => [
            {
                id: MODEL_ID,
                feet: defaultFeet(),
                runtimeBones: bones,
            },
        ]);

        // 跑 10 帧，每帧断言 resolver 调用 ≤1 次（左脚贴地 = 1 次，右脚空中 = 0 次）
        for (let i = 0; i < 10; i++) {
            resolverCalls.length = 0;
            getMotionPipeline().runFrame({ scene });
            expect(resolverCalls.length).toBeLessThanOrEqual(1);
        }
    });

    it('守护：feetDebug 开启时同帧双调用触发 warn（帧内节流 + 时间窗口节流）', () => {
        // 守护目的：编排层互斥万一被破坏，运行时能捕获并节流 warn（不刷爆日志）
        const bones: IMmdRuntimeBone[] = [
            makeWasmBone('左足ＩＫ', [0, 0.1, 0], 0),
            makeWasmBone('センター', [0, 0, 0]),
        ];
        startBoneOverride(() => bones, scene);

        // 先 runFrame 一次，触发 callback 帧首的 _resetIkResolveGuard
        getMotionPipeline().runFrame({ scene });
        resolverCalls.length = 0;

        feetDebug.value = true;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // mock performance.now 返回大值，绕过 2 秒时间窗口节流（测试启动后可能 < 2s）
        const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(10000);

        const resolver = getWasmIkResolver()!;
        // 模拟编排层互斥被破坏：同帧对同一 (modelId, ikSolverIndex) 调用 3 次
        resolver(MODEL_ID, 0, false);
        resolver(MODEL_ID, 0, false);
        resolver(MODEL_ID, 0, false);

        // 守护不阻止调用，resolver 仍被调 3 次
        expect(resolverCalls.length).toBe(3);
        // 守护 warn 只触发 1 次（_ikResolveWarnSuppressed 帧内节流）
        const guardCalls = warnSpy.mock.calls.filter(
            (c) => typeof c[0] === 'string' && c[0].includes('[守护]')
        );
        expect(guardCalls.length).toBe(1);

        nowSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('守护：feetDebug 关闭时不 warn，开销 no-op', () => {
        const bones: IMmdRuntimeBone[] = [
            makeWasmBone('左足ＩＫ', [0, 0.1, 0], 0),
            makeWasmBone('センター', [0, 0, 0]),
        ];
        startBoneOverride(() => bones, scene);
        getMotionPipeline().runFrame({ scene }); // 重置守护状态
        resolverCalls.length = 0;

        // feetDebug.value 默认 false（afterEach 会恢复）
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const resolver = getWasmIkResolver()!;
        resolver(MODEL_ID, 0, false);
        resolver(MODEL_ID, 0, false);

        expect(resolverCalls.length).toBe(2);
        const guardCalls = warnSpy.mock.calls.filter(
            (c) => typeof c[0] === 'string' && c[0].includes('[守护]')
        );
        expect(guardCalls.length).toBe(0); // 关闭时无 warn

        warnSpy.mockRestore();
    });
});
