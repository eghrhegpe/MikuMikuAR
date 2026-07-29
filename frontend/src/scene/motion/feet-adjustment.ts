// [doc:adr-085] Feet Adjustment — 脚部地面跟随（MMD-native IK + 方案C WASM 手动 IK）
// 职责: 每帧驱动左/右足IK 骨骼世界坐标到地面 + 重解该腿 IK
// 注册为 MotionPipeline bone-override 层（order=5），在帧钩子（RIDING=10）之前执行，
// 脚 IK 为自动约束基础，手动 Override 叠加其上。
// 依赖: env-impl.getGroundHeightAt / proc-motion-shared 骨骼候选 / babylon-mmd IkSolver
//       / two-bone-ik（WASM 模式手动 IK）
//
// 关键机制（2026-07-11 复核, 2026-07-27 方案C补充）:
//   MMD 模型自带腿部 IK —— 左足IK/右足IK 是 IK 目标骨骼，babylon-mmd 的 IkSolver 在
//   MmdRuntimeModel._update() 内、动画应用后同帧解出。本模块在动画解算后，把 IK 目标骨骼的
//   世界坐标 setWorldTranslation 到地面，再重解该腿 IK。
//   - JS 模式：调用 ikSolver.solve()（solve 内部回写踝 + 链骨骼 worldMatrix）
//   - WASM 模式：ikSolver 不可用（始终为 null），改用方案C手动两骨骼 IK（余弦定理求解
//     髋/膝增量旋转 + 递归传播子骨骼 worldMatrix）。详见 ADR-085 方案C。

import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended, FeetState } from '@/core/types';
import { getGroundHeightAt } from '@/scene/env/env-impl';
import {
    BONE_LEG_IK_L_CANDIDATES,
    BONE_LEG_IK_R_CANDIDATES,
    matchBone,
} from '@/motion-algos/proc-motion-shared';
// [doc:adr-085 方案C] WASM 手动两骨骼 IK 求解（ikSolver 不可用时的临时替代）
import { solveTwoBoneIK, applyRotationToWorldMatrix } from '@/motion-algos/two-bone-ik';
// [ADR-202 §六] 方案A 新路径：经 mmdModelSolveIk 重解原生 IK 链
import { getWasmIkResolver } from './bone-override';
// 纯数学解算（无 Babylon 依赖，便于单测）见 motion-algos/feet-adjustment-math.ts
import { solveFootTarget } from '@/motion-algos/feet-adjustment-math';
// 落地判定（无 Babylon 依赖，便于单测）见 motion-algos/footstep-detect.ts
import { detectFootLanding } from '@/motion-algos/footstep-detect';
import { logWarn } from '../../core/logger';
import { getMotionPipeline } from './motion-pipeline';
import { isWasmRuntime } from './perception-shared';
export { solveFootTarget };
export type { SolveFootInput, SolveFootOutput } from '@/motion-algos/feet-adjustment-math';

// ======== WASM 调试开关 ========
// 从控制台启用：__feetDebug.value = true （或 __feetDebug.value = false 关闭）
// 本文件加载后自动挂到 window.__feetDebug
export const feetDebug = { value: false };
(window as unknown as Record<string, unknown>).__feetDebug = feetDebug;
// [ADR-202 §六] 强制 IK 运行开关（验证方案A 用）：绕过 jumpThreshold skip，
// 从控制台启用：__feetForceIk.value = true
export const feetForceIk = { value: false };
(window as unknown as Record<string, unknown>).__feetForceIk = feetForceIk;

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
    /** 模型中心骨骼（センター）世界 Y，用于自然脚高推算 */
    centerY: number | null;
    // 落地事件检测状态（ADR-088）：脚 IK 贴地上升沿 + 去抖
    lPrevGrounded: boolean;
    rPrevGrounded: boolean;
    lFootYPrev: number;
    rFootYPrev: number;
    lLastLandTime: number;
    rLastLandTime: number;
}

const _cache = new Map<string, _ModelCache>();
let _unregisterHandle: (() => void) | null = null;
// ADR-088 落地事件回调（setOnFootLand 注入）；脚步声消费此事件
let _onFootLand: ((e: FootLandEvent) => void) | null = null;
// 帧间隔计时（供落地垂直速度估算）
let _lastTickTime = 0;
// 同脚两次落地最小间隔（ms），去抖防抖动误触发
const FOOT_STEP_MIN_INTERVAL = 120;

let _feetDbgFrame = 0;
let _feetTick = 0;

// 大腿根候选（用于估算髋位置与腿长）
// 日文 PMX 标准名：左足/右足（MMD 惯例）；部分模型用 左大腿/右大腿 或 左腿/右腿
const BONE_THIGH_L = ['左足', '左大腿', '左腿', 'left leg', 'LeftLeg', 'LeftThigh', 'left thigh'];
const BONE_THIGH_R = [
    '右足',
    '右大腿',
    '右腿',
    'right leg',
    'RightLeg',
    'RightThigh',
    'right thigh',
];

// [doc:adr-085 方案C] 膝盖骨候选（两骨骼 IK 的 knee 端）
const BONE_KNEE_L = ['左ひざ', '左膝', 'left knee', 'LeftKnee', 'L_Knee', '左ひざＩＫ'];
const BONE_KNEE_R = ['右ひざ', '右膝', 'right knee', 'RightKnee', 'R_Knee', '右ひざＩＫ'];

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
            centerY: null,
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

/** 查询脚部跟随系统是否正在运行（observer 已注册）。 */
export function isFeetAdjustmentRunning(): boolean {
    return _unregisterHandle !== null;
}

/** 找大腿根骨骼（用于估算髋世界坐标与腿长）。
 *  优先沿 IK 骨 parent 链向上找（兼容非标准层级）；
 *  降级到全量 bone list 按名匹配（标准 MMD：IK 骨 direct child of 全ての親）。 */
function _findHip(
    ik: IMmdRuntimeBone,
    allBones: readonly IMmdRuntimeBone[],
    side: 'L' | 'R'
): IMmdRuntimeBone | null {
    const cands = side === 'L' ? BONE_THIGH_L : BONE_THIGH_R;

    // 1) 沿 IK 骨 parent 链向上
    let cur: IMmdRuntimeBone | null = ik.parentBone;
    let depth = 0;
    while (cur && depth < 6) {
        if (cands.includes(cur.name)) {
            return cur;
        }
        cur = cur.parentBone;
        depth++;
    }

    // 2) 全量搜索——标准 MMD 中左足ＩＫ的 parent 是全ての親，不是左足
    for (const b of allBones) {
        if (cands.includes(b.name)) {
            return b;
        }
    }

    // 3) 回退：取 ik 上方第 3 级父
    cur = ik.parentBone;
    for (let i = 0; i < 2 && cur; i++) {
        cur = cur.parentBone;
    }
    return cur;
}

/** [doc:adr-085 方案C] 找膝盖骨骼（两骨骼 IK 的 knee 端）。
 *  沿 IK 骨 parent 链向上找（MMD 标准：左足ＩＫ → 左足首 → 左ひざ → 左足）；
 *  降级到全量 bone list 按名匹配。 */
function _findKnee(
    ik: IMmdRuntimeBone,
    allBones: readonly IMmdRuntimeBone[],
    side: 'L' | 'R'
): IMmdRuntimeBone | null {
    const cands = side === 'L' ? BONE_KNEE_L : BONE_KNEE_R;

    // 1) 沿 IK 骨 parent 链向上
    let cur: IMmdRuntimeBone | null = ik.parentBone;
    let depth = 0;
    while (cur && depth < 6) {
        if (cands.includes(cur.name)) {
            return cur;
        }
        cur = cur.parentBone;
        depth++;
    }

    // 2) 全量搜索
    for (const b of allBones) {
        if (cands.includes(b.name)) {
            return b;
        }
    }
    return null;
}

// ── [doc:adr-085 方案C] WASM 手动两骨骼 IK ──

// 复用 Vector3（_solveWasmLegIK 每帧调用 2 次，避免重复分配）
const _vHipPos = new Vector3();
const _vKneePos = new Vector3();

/**
 * 递归传播子骨骼变换（WASM 模式，非池版本）。
 * 与 bone-override._propagateChildrenWasm 等价，但使用临时 Matrix 分配
 * （feet-adjustment 在 order=5 执行，不能复用 bone-override 的帧级 _mPool）。
 * 腿链深度 ≤4（髋→膝→踝→趾），每帧 2 条腿 × 2 次传播，分配量可控。
 */
function _propagateChildrenWasmSimple(
    parent: IMmdRuntimeBone,
    parentOldMat: Matrix,
    parentNewMat: Matrix
): void {
    const invMat = parentOldMat.clone();
    invMat.invert();
    for (const child of parent.childBones) {
        const childBuf = (child as MmdRuntimeBoneExtended).worldMatrix;
        if (!childBuf) {
            continue;
        }
        const childOldMat = Matrix.FromArray(childBuf, 0);
        const localMat = childOldMat.multiply(invMat);
        const childNewMat = localMat.multiply(parentNewMat);
        childNewMat.copyToArray(childBuf, 0);
        _propagateChildrenWasmSimple(child, childOldMat, childNewMat);
    }
}

/**
 * [doc:adr-085 方案C] WASM 模式手动两骨骼 IK 求解。
 * 在 feet-adjustment order=5 层独立求解，不依赖 bone-override 的 overrideMap / _mPool。
 *
 * 流程（与 bone-override._solveManualLegIK 等价，非池版本）：
 *   1. 读 hip/knee worldMatrix buffer
 *   2. solveTwoBoneIK → hipDelta, kneeDelta
 *   3. 应用 hipDelta + 传播子骨骼（含 knee、踝、趾）
 *   4. 应用 kneeDelta + 传播子骨骼（含踝、趾）
 *
 * @param endEffectorPos IK 骨动画位置（setWorldTranslation 之前的值 = _vFoot）
 * @param targetPos     IK 骨目标位置（setWorldTranslation 写入的值 = _vTarget）
 */
function _solveWasmLegIK(
    bones: readonly IMmdRuntimeBone[],
    ikBone: IMmdRuntimeBone,
    hipBone: IMmdRuntimeBone | null,
    side: 'L' | 'R',
    endEffectorPos: Readonly<Vector3>,
    targetPos: Readonly<Vector3>
): void {
    if (!hipBone) {
        return;
    }
    const kneeBone = _findKnee(ikBone, bones, side);
    if (!kneeBone) {
        return;
    }

    const hipBuf = (hipBone as MmdRuntimeBoneExtended).worldMatrix;
    const kneeBuf = (kneeBone as MmdRuntimeBoneExtended).worldMatrix;
    if (!hipBuf || !kneeBuf) {
        return;
    }

    // 提取 translation 作为 IK 输入位置（列主序：m[12..14] = translation）
    _vHipPos.set(hipBuf[12], hipBuf[13], hipBuf[14]);
    _vKneePos.set(kneeBuf[12], kneeBuf[13], kneeBuf[14]);

    const result = solveTwoBoneIK({
        hipPos: _vHipPos,
        kneePos: _vKneePos,
        endEffectorPos,
        targetPos,
    });
    if (!result.changed) {
        return;
    }

    // —— 应用 hipDelta 并传播 ——
    const hipOldMat = Matrix.FromArray(hipBuf, 0);
    applyRotationToWorldMatrix(hipBuf, result.hipDelta);
    const hipNewMat = Matrix.FromArray(hipBuf, 0);
    _propagateChildrenWasmSimple(hipBone, hipOldMat, hipNewMat);

    // —— 应用 kneeDelta 并传播 ——
    // 此时 kneeBuf 已被 hip 传播更新为 kneeLocalMat × hipNewMat
    const kneeOldMat = Matrix.FromArray(kneeBuf, 0);
    applyRotationToWorldMatrix(kneeBuf, result.kneeDelta);
    const kneeNewMat = Matrix.FromArray(kneeBuf, 0);
    _propagateChildrenWasmSimple(kneeBone, kneeOldMat, kneeNewMat);
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
    let hipToFootDist = 0;
    let legLength = 1;
    let hip: IMmdRuntimeBone | null = null;
    {
        const h = _findHip(ik, bones, side);
        if (h) {
            h.getWorldTranslationToRef(_vHip);
            hipToFootDist = Vector3.Distance(_vFoot, _vHip);
            legLength = Math.max(hipToFootDist, 1e-3);
            hip = h;
        }
    }

    const res = solveFootTarget({
        footY: _vFoot.y,
        groundY,
        hipToFootDist,
        legLength,
        centerY: cache.centerY ?? 0,
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

    if (feetDebug.value && _feetDbgFrame++ % 60 === 0) {
        const solver = (ik as MmdRuntimeBoneExtended).ikSolver;
        logWarn(
            'feet',
            `[WASM] ${modelId} ${side} ` +
                `ik=${ikName} ` +
                `footY=${_vFoot.y.toFixed(3)} ` +
                `groundY=${groundY.toFixed(3)} ` +
                `targetY=${res.targetY.toFixed(3)} ` +
                `skip=${res.skip} ` +
                `solver=${solver ? 'present' : 'null'} ` +
                `hip=${hip ? hip.name : 'null<-fallback'} ` +
                `centerY=${cache.centerY !== null ? cache.centerY.toFixed(3) : '?'} ` +
                `legLen=${legLength.toFixed(3)}`
        );
    }

    if (res.skip && !feetForceIk.value) {
        if (side === 'L') {
            cache.lTargetY = null;
        } else {
            cache.rTargetY = null;
        }
        return;
    }

    // [ADR-202 §六] feetForceIk 模式：绕过 skip，强制把脚拉到地面验证 IK 路径
    const forceTargetY = feetForceIk.value ? groundY + feet.soleHeight : res.targetY;

    // 驱动 IK 目标骨骼世界坐标（保留 XZ，仅调整 Y）
    _vTarget.set(_vFoot.x, forceTargetY, _vFoot.z);
    ik.setWorldTranslation(_vTarget);

    // [doc:adr-085 方案C] 重解该腿 IK
    // JS 模式：原版 ikSolver.solve()（solve 内部回写踝 + 链骨骼 worldMatrix）
    // WASM 模式：ikSolver 不可用（始终为 null）
    if (isWasmRuntime(bones[0])) {
        // [ADR-202 §六] 验证：方案C→A 迁移的关键环节
        // 1. 验证 setWorldTranslation 写入后，WASM bone buffer 是否同步更新
        const ikSolverIndex = (ik as { ikSolverIndex?: number }).ikSolverIndex;
        const buf = (ik as MmdRuntimeBoneExtended).worldMatrix;
        const bufAfter = buf ? [buf[12], buf[13], buf[14]] : null;
        const resolver = getWasmIkResolver();

        if (feetDebug.value && _feetDbgFrame % 60 === 0) {
            logWarn(
                'feet',
                `[A-verify] ${side} setWorldTranslation后: ` +
                    `target=(${_vTarget.x.toFixed(3)}, ${_vTarget.y.toFixed(3)}, ${_vTarget.z.toFixed(3)}) ` +
                    `buf=(${bufAfter?.[0]?.toFixed(3)}, ${bufAfter?.[1]?.toFixed(3)}, ${bufAfter?.[2]?.toFixed(3)}) ` +
                    `match=${bufAfter ? _vTarget.y === bufAfter[1] : '?'} ` +
                    `ikSolverIndex=${ikSolverIndex ?? 'null'} ` +
                    `resolver=${resolver ? 'present' : 'null'}`
            );
        }

        // 2. 方案A 新路径：经 mmdModelSolveIk 重解原生 IK 链
        //    与方案C（TwoBoneIK 余弦定理）并列执行，便于对比验证。
        //    debug 模式下两条路径都跑；非 debug 模式仅跑方案A（新路径），
        //    旧方案C 逐步淘汰。
        if (resolver && typeof ikSolverIndex === 'number' && ikSolverIndex >= 0) {
            // 方案A：mmdModelSolveIk 直接读 WASM bone buffer（setWorldTranslation 已写入同一 buffer）
            const resolvedMid = modelId; // _adjustFoot 已收到 modelId，直接透传
            resolver(resolvedMid, ikSolverIndex, false);

            if (feetDebug.value && _feetDbgFrame % 60 === 0) {
                // 重解后读 buffer 验证结果
                const postBuf = buf ? [buf[12], buf[13], buf[14]] : null;
                logWarn(
                    'feet',
                    `[A-verify] ${side} mmdModelSolveIk后 buf=(${postBuf?.[0]?.toFixed(3)}, ${postBuf?.[1]?.toFixed(3)}, ${postBuf?.[2]?.toFixed(3)})`
                );
            }
        } else {
            if (feetDebug.value && _feetDbgFrame % 60 === 0) {
                logWarn('feet', `[A-verify] ${side} 方案A 不可用: resolver=${resolver ? 'ok' : 'null'}, ikSolverIndex=${ikSolverIndex ?? 'null'}`);
            }
            // 回退：方案C TwoBoneIK
            _solveWasmLegIK(bones, ik, hip, side, _vFoot, _vTarget);
        }
    } else {
        const solver = (ik as MmdRuntimeBoneExtended).ikSolver;
        if (solver) {
            // 腿部链通常为 FollowBone（骨骼驱动刚体），usePhysics=false 即正确；
            // 物理驱动模式下 canSkipWhenPhysicsEnabled=true → solve 自动跳过（已知限制）
            solver.solve(false);
        }
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
 * 启动脚部调整系统：注册为 MotionPipeline bone-override 层（order=5）。
 * 在帧钩子（RIDING=10）之前执行：脚 IK 为自动约束基础，手动 Override 叠加其上。
 */
export function startFeetAdjustment(getModels: FeetModelProvider): void {
    if (_unregisterHandle) {
        return;
    }

    const callback = () => {
        const now = performance.now();
        const dt = _lastTickTime ? Math.min((now - _lastTickTime) / 1000, 0.1) : 1 / 60;
        _lastTickTime = now;
        if (feetDebug.value && _feetTick++ % 90 === 0) {
            const summary = [...getModels()]
                .map((m) => `${m.id}:en=${m.feet.enabled},n=${m.runtimeBones.length}`)
                .join(' ');
            logWarn('feet', '[WASM] models', summary);
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
                // 缓存中心骨骼世界 Y（用于 solveFootTarget 推算自然脚高）
                const centerBone =
                    m.runtimeBones.find((b) => b.name === 'センター') ??
                    m.runtimeBones.find((b) => b.name === '全ての親');
                if (centerBone) {
                    const v = new Vector3();
                    centerBone.getWorldTranslationToRef(v);
                    cache.centerY = v.y;
                } else {
                    cache.centerY = null;
                }
                // 启动诊断：始终输出，不论 debug 开关
                const lMatchResult = cache.lName ?? '<null>';
                const rMatchResult = cache.rName ?? '<null>';
                const centerYStr = cache.centerY !== null ? cache.centerY.toFixed(3) : '?';
                logWarn(
                    'feet',
                    `[WASM] IK 匹配结果 for ${m.id}: L="${lMatchResult}" R="${rMatchResult}" ` +
                        `(total bones=${names.length}) ` +
                        `centerWorldY=${centerYStr}`
                );
                if (cache.lName === null || cache.rName === null) {
                    const hints = names
                        .filter((n) => /足|ＩＫ|IK|Leg|leg|Foot|foot/.test(n))
                        .slice(0, 16);
                    logWarn('feet', '  模型中含"足/IK"的骨骼名：', hints);
                }
            }
            _adjustFoot(m.runtimeBones, cache.lName, 'L', cache, feet, m.id, dt);
            _adjustFoot(m.runtimeBones, cache.rName, 'R', cache, feet, m.id, dt);
        }
    };

    _unregisterHandle = getMotionPipeline().register({
        id: 'feet-adjustment',
        stage: 'bone-override',
        order: 5,
        run: callback,
    });
}

/** 停止脚部调整系统并清空缓存。 */
export function stopFeetAdjustment(): void {
    if (_unregisterHandle) {
        _unregisterHandle();
        _unregisterHandle = null;
    }
    _cache.clear();
    _lastTickTime = 0; // 重置时间戳，避免重启后首帧 dt 异常
}
