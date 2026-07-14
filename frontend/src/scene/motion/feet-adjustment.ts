// [doc:adr-085] Feet Adjustment — 脚部地面跟随（MMD-native IK）
// 职责: 每帧驱动左/右足IK 骨骼世界坐标到地面 + 重解该腿 IK
// 与 ADR-061 bone-override 同构（逐帧后处理），注册顺序在 bone-override 之前
// 依赖: env-impl.getGroundHeightAt / proc-motion-shared 骨骼候选 / babylon-mmd IkSolver
//
// 关键机制（2026-07-11 复核）:
//   MMD 模型自带腿部 IK —— 左足IK/右足IK 是 IK 目标骨骼，babylon-mmd 的 IkSolver 在
//   MmdRuntimeModel._update() 内、动画应用后同帧解出。本模块在动画解算后，把 IK 目标骨骼的
//   世界坐标 setWorldTranslation 到地面，再调用 ikSolver.solve() 重解该腿 IK（solve 内部回写
//   踝 + 链骨骼 worldMatrix）。逐帧「覆盖→重解」与 bone-override 同构，VMD 下一帧覆盖 IK 骨骼
//   后由本模块再次重解，渲染帧内生效。

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended, FeetState } from '@/core/types';
import { getGroundHeightAt } from '@/scene/env/env-impl';
import {
    BONE_LEG_IK_L_CANDIDATES,
    BONE_LEG_IK_R_CANDIDATES,
    matchBone,
} from '@/motion-algos/proc-motion-shared';
// 纯数学解算（无 Babylon 依赖，便于单测）见 motion-algos/feet-adjustment-math.ts
import { solveFootTarget } from '@/motion-algos/feet-adjustment-math';
// 落地判定（无 Babylon 依赖，便于单测）见 motion-algos/footstep-detect.ts
import { detectFootLanding } from '@/motion-algos/footstep-detect';
import { logWarn } from '../../core/utils';
export { solveFootTarget };
export type { SolveFootInput, SolveFootOutput } from '@/motion-algos/feet-adjustment-math';

// ======== 引擎钩子 ========

/** 注入：返回需要处理脚部调整的模型及其 runtime bones */
export type FeetModelProvider = () => Iterable<{
    id: string;
    feet: FeetState;
    runtimeBones: readonly IMmdRuntimeBone[];
}>;

interface _ModelCache {
    lName: string | null;
    rName: string | null;
    lTargetY: number | null;
    rTargetY: number | null;
    // 落地事件检测状态（ADR-088）：脚 IK 贴地上升沿 + 去抖
    lPrevGrounded: boolean;
    rPrevGrounded: boolean;
    lFootYPrev: number;
    rFootYPrev: number;
    lLastLandTime: number;
    rLastLandTime: number;
}

const _cache = new Map<string, _ModelCache>();
let _observerHandle: (() => void) | null = null;
// ADR-088 落地事件回调（setOnFootLand 注入）；脚步声消费此事件
let _onFootLand: ((e: FootLandEvent) => void) | null = null;
// 帧间隔计时（供落地垂直速度估算）
let _lastTickTime = 0;
// 同脚两次落地最小间隔（ms），去抖防抖动误触发
const FOOT_STEP_MIN_INTERVAL = 120;

// 诊断日志开关（ADR-085 验证用，验证后已关闭）。改 true 可重新开启帧/落地诊断。
const FEET_DEBUG = false;
let _feetDbgFrame = 0;
let _feetTick = 0;

// 大腿根候选（用于估算髋位置与腿长）
const BONE_THIGH_L = ['左足', 'left leg', 'LeftLeg'];
const BONE_THIGH_R = ['右足', 'right leg', 'RightLeg'];

const _vFoot = new Vector3();
const _vHip = new Vector3();
const _vTarget = new Vector3();

function _getCache(id: string): _ModelCache {
    let c = _cache.get(id);
    if (!c) {
        c = {
            lName: '',
            rName: '',
            lTargetY: null,
            rTargetY: null,
            lPrevGrounded: false,
            rPrevGrounded: false,
            lFootYPrev: 0,
            rFootYPrev: 0,
            lLastLandTime: 0,
            rLastLandTime: 0,
        };
        _cache.set(id, c);
    }
    return c;
}

/** 落地事件：脚从空中接触地面的瞬间（ADR-088 供脚步声消费）。 */
export interface FootLandEvent {
    modelId: string;
    foot: 'L' | 'R';
    groundY: number;
    /** 落地垂直速度（单位/秒），>=0，用于脚步声音量映射 */
    impactSpeed: number;
    worldX: number;
    worldZ: number;
}

/** 注入落地事件回调（null 取消）。脚步声控制器调用。 */
export function setOnFootLand(cb: ((e: FootLandEvent) => void) | null): void {
    _onFootLand = cb;
}

/** 沿 parentBone 向上找大腿根骨骼（用于估算髋世界坐标与腿长） */
function _findHip(ik: IMmdRuntimeBone, side: 'L' | 'R'): IMmdRuntimeBone | null {
    const cands = side === 'L' ? BONE_THIGH_L : BONE_THIGH_R;
    let cur: IMmdRuntimeBone | null = ik.parentBone;
    let depth = 0;
    while (cur && depth < 6) {
        if (cands.includes(cur.name)) {
            return cur;
        }
        cur = cur.parentBone;
        depth++;
    }
    // 回退：取 ik 上方第 3 级父（典型大腿根）
    cur = ik.parentBone;
    for (let i = 0; i < 2 && cur; i++) {
        cur = cur.parentBone;
    }
    return cur;
}

function _adjustFoot(
    bones: readonly IMmdRuntimeBone[],
    ikName: string | null,
    side: 'L' | 'R',
    cache: _ModelCache,
    feet: FeetState,
    modelId: string,
    dt: number
): void {
    if (!ikName) {
        return;
    }
    const ik = bones.find((b) => b.name === ikName);
    if (!ik) {
        return;
    }

    ik.getWorldTranslationToRef(_vFoot); // 当前 IK 目标（动画驱动）世界坐标
    const groundY = getGroundHeightAt(_vFoot.x, _vFoot.z);

    // 估算髋世界坐标 + 腿长（用于 reachAngle / maxAngle）
    let hipY = _vFoot.y;
    let hipToFootDist = 0;
    let legLength = 1;
    const hip = _findHip(ik, side);
    if (hip) {
        hip.getWorldTranslationToRef(_vHip);
        hipY = _vHip.y;
        hipToFootDist = Vector3.Distance(_vFoot, _vHip);
        legLength = Math.max(hipToFootDist, 1e-3);
    }

    const res = solveFootTarget({
        footY: _vFoot.y,
        groundY,
        hipToFootDist,
        legLength,
        prevTargetY: side === 'L' ? cache.lTargetY : cache.rTargetY,
        feet,
    });

    // ADR-088：落地事件（贴地上升沿 + 去抖）。grounded = 本帧未跳过 IK 重解（脚被拉到地面）
    const grounded = !res.skip;
    const now = performance.now();
    const footYPrev = side === 'L' ? cache.lFootYPrev : cache.rFootYPrev;
    const prevGrounded = side === 'L' ? cache.lPrevGrounded : cache.rPrevGrounded;
    const prevStepTime = side === 'L' ? cache.lLastLandTime : cache.rLastLandTime;
    const det = detectFootLanding({
        prevGrounded,
        grounded,
        footYPrev,
        footY: _vFoot.y,
        dt,
        prevStepTime,
        now,
        minInterval: FOOT_STEP_MIN_INTERVAL,
    });
    if (det.landed && _onFootLand) {
        _onFootLand({
            modelId,
            foot: side,
            groundY,
            impactSpeed: det.impactSpeed,
            worldX: _vFoot.x,
            worldZ: _vFoot.z,
        });
    }
    // 更新上一帧状态（无论是否落地都更新，供下一帧上升沿判定）
    if (side === 'L') {
        cache.lPrevGrounded = grounded;
        cache.lFootYPrev = _vFoot.y;
        if (det.landed) {
            cache.lLastLandTime = now;
        }
    } else {
        cache.rPrevGrounded = grounded;
        cache.rFootYPrev = _vFoot.y;
        if (det.landed) {
            cache.rLastLandTime = now;
        }
    }

    if (FEET_DEBUG && _feetDbgFrame++ % 60 === 0) {
        console.log(
            `[feet] ${side} footY=${_vFoot.y.toFixed(3)} groundY=${groundY.toFixed(3)} ` +
                `targetY=${res.targetY.toFixed(3)} skip=${res.skip} ik=${ikName}`
        );
    }

    if (res.skip) {
        if (side === 'L') {
            cache.lTargetY = null;
        } else {
            cache.rTargetY = null;
        }
        return;
    }

    // 驱动 IK 目标骨骼世界坐标（保留 XZ，仅调整 Y）
    _vTarget.set(_vFoot.x, res.targetY, _vFoot.z);
    ik.setWorldTranslation(_vTarget);

    // 重解该腿 IK（solve 内部回写踝 + 链骨骼 worldMatrix）
    const solver = (ik as MmdRuntimeBoneExtended).ikSolver;
    if (solver) {
        // 腿部链通常为 FollowBone（骨骼驱动刚体），usePhysics=false 即正确；
        // 物理驱动模式下 canSkipWhenPhysicsEnabled=true → solve 自动跳过（已知限制）
        solver.solve(false);
    }

    // JS 运行时：通知 skeleton 重算蒙皮（WASM 直写 worldTransformMatrices buffer，无需）
    const lb = (
        ik as unknown as { linkedBone?: { getSkeleton?: () => { _markAsDirty?: () => void } } }
    ).linkedBone;
    lb?.getSkeleton?.()._markAsDirty?.();

    if (side === 'L') {
        cache.lTargetY = res.targetY;
    } else {
        cache.rTargetY = res.targetY;
    }
}

/**
 * 启动脚部调整系统：注册 onBeforeRenderObservable 回调。
 * 必须在 bone-override 之前注册（脚 IK 为自动约束基础，手动 Override 叠加其上）。
 */
export function startFeetAdjustment(
    getModels: FeetModelProvider,
    scene: import('@babylonjs/core/scene').Scene
): void {
    if (_observerHandle) {
        return;
    }

    const callback = () => {
        const now = performance.now();
        const dt = _lastTickTime ? Math.min((now - _lastTickTime) / 1000, 0.1) : 1 / 60;
        _lastTickTime = now;
        if (FEET_DEBUG && _feetTick++ % 90 === 0) {
            const summary = [...getModels()]
                .map((m) => `${m.id}:en=${m.feet.enabled},n=${m.runtimeBones.length}`)
                .join(' ');
            console.log('[feet] models', summary);
        }
        for (const m of getModels()) {
            const cache = _getCache(m.id);
            const feet = m.feet;
            if (!feet.enabled || feet.intensity <= 0 || m.runtimeBones.length === 0) {
                // 禁用时清空平滑状态，避免重新启用跳变
                cache.lTargetY = null;
                cache.rTargetY = null;
                cache.lPrevGrounded = false;
                cache.rPrevGrounded = false;
                cache.lLastLandTime = 0;
                cache.rLastLandTime = 0;
                continue;
            }
            // 解析 IK 骨骼名（按模型缓存，首次解析）
            if (cache.lName === '') {
                const names = m.runtimeBones.map((b) => b.name);
                cache.lName = matchBone(names, BONE_LEG_IK_L_CANDIDATES);
                cache.rName = matchBone(names, BONE_LEG_IK_R_CANDIDATES);
                if (FEET_DEBUG && (cache.lName === null || cache.rName === null)) {
                    const hints = names
                        .filter((n) => /足|ＩＫ|IK|Leg|leg|Foot|foot/.test(n))
                        .slice(0, 16);
                    logWarn(
                        'feet',
                        `IK bone not matched for ${m.id} (L=${cache.lName} R=${cache.rName}). leg/IK bones in model:`,
                        hints
                    );
                }
            }
            _adjustFoot(m.runtimeBones, cache.lName, 'L', cache, feet, m.id, dt);
            _adjustFoot(m.runtimeBones, cache.rName, 'R', cache, feet, m.id, dt);
        }
    };

    _observerHandle = () => {
        scene.onBeforeRenderObservable.removeCallback(callback);
    };
    scene.onBeforeRenderObservable.add(callback);
}

/** 停止脚部调整系统并清空缓存。 */
export function stopFeetAdjustment(): void {
    if (_observerHandle) {
        _observerHandle();
        _observerHandle = null;
    }
    _cache.clear();
}
