// [doc:adr-085] Feet Adjustment — 脚部地面跟随（MMD-native IK，JS/WASM 统一走原生求解器）
// 职责: 每帧驱动左/右足IK 骨骼世界坐标到地面 + 重解该腿 IK
// 注册为 MotionPipeline bone-override 层（order=5），在帧钩子（RIDING=10）之前执行，
// 脚 IK 为自动约束基础，手动 Override 叠加其上。
// 依赖: env-impl.getGroundHeightAt / proc-motion-shared 骨骼候选 / babylon-mmd IkSolver
//       / bone-override.getWasmIkResolver（WASM 模式经 mmdModelSolveIk 重解）
//
// 关键机制（2026-07-11 复核, 2026-07-29 方案A 迁移）:
//   MMD 模型自带腿部 IK —— 左足IK/右足IK 是 IK 目标骨骼，babylon-mmd 的 IkSolver 在
//   MmdRuntimeModel._update() 内、动画应用后同帧解出。本模块在动画解算后，把 IK 目标骨骼的
//   世界坐标 setWorldTranslation 到地面，再重解该腿 IK。
//   - JS 模式：调用 ikSolver.solve()（solve 内部回写踝 + 链骨骼 worldMatrix）
//   - WASM 模式：经 mmdModelSolveIk 导出重解原生 IK 链（ADR-202 §六，方案C 已淘汰）

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended, FeetState } from '@/core/types';
import { getGroundHeightAt } from '@/scene/env/env-impl';
import {
    BONE_LEG_IK_L_CANDIDATES,
    BONE_LEG_IK_R_CANDIDATES,
    matchBone,
} from '@/motion-algos/proc-motion-shared';
// [ADR-202 §六] WASM 模式经 mmdModelSolveIk 重解原生 IK 链
import { getWasmIkResolver, getOverride } from './bone-override';
// 运动模块状态查询（用于 feet-adjustment 感知用户手动覆盖）
import { getModuleState } from './motion-modules/registry';
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
/** [ADR-202 §六] 一次性诊断已输出标记（避免刷屏） */
let _feetWarnOnce = false;

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

    // [ADR-202 §六] 如果对应脚的运动模块有非零参数，或 IK 目标骨有激活的 bone override，
    // 跳过自动贴地（用户手动覆盖优先于 always-on 地面跟随）
    const moduleId = side === 'L' ? 'left-foot' : 'right-foot';
    const st = getModuleState(modelId, moduleId);
    const fp = st?.params;
    const hasModParams =
        fp &&
        ((fp.pitch as number) !== 0 ||
            (fp.yaw as number) !== 0 ||
            (fp.roll as number) !== 0 ||
            (fp.footPosX as number) !== 0 ||
            (fp.footPosY as number) !== 0 ||
            (fp.footPosZ as number) !== 0);
    if (hasModParams) {
        return;
    }
    // 二重检查：遍历所有候选骨名，检测 _overrideMaps 是否有激活的覆盖
    const cands = side === 'L' ? BONE_LEG_IK_L_CANDIDATES : BONE_LEG_IK_R_CANDIDATES;
    let foundOverride = false;
    for (const cand of cands as string[]) {
        const ov = getOverride(cand, modelId);
        if (ov?.enabled) {
            foundOverride = true;
            break;
        }
    }
    if (foundOverride) {
        return;
    }
    // [ADR-202 §六 debug] 仅在 feetDebug 开启时输出一次诊断（_feetWarnOnce 跨帧复用）
    if (feetDebug.value && !_feetWarnOnce) {
        _feetWarnOnce = true;
        logWarn(
            'feet',
            `[A-skip] ${side} modParams=${hasModParams} cands=${cands.length} ` +
                `pitch=${fp?.pitch} yaw=${fp?.yaw} roll=${fp?.roll} ` +
                `posY=${fp?.footPosY} overrideFound=${foundOverride} ` +
                `skip=${res.skip}`
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

    // 重解该腿 IK（ADR-202 §六：JS/WASM 统一走原生求解器）
    // JS 模式：ikSolver.solve() 直接调用（solve 内部回写踝 + 链骨骼 worldMatrix）
    // WASM 模式：经 mmdModelSolveIk 导出重解原生 IK 链（setWorldTranslation 已写入同一 bone buffer）
    if (isWasmRuntime(bones[0])) {
        const ikSolverIndex = (ik as { ikSolverIndex?: number }).ikSolverIndex;
        const resolver = getWasmIkResolver();
        if (resolver && typeof ikSolverIndex === 'number' && ikSolverIndex >= 0) {
            resolver(modelId, ikSolverIndex, false);
        } else if (feetDebug.value && _feetDbgFrame % 60 === 0) {
            logWarn(
                'feet',
                `[WASM] ${modelId} ${side} IK 未重解: resolver=${resolver ? 'ok' : 'null'}, ikSolverIndex=${ikSolverIndex ?? 'null'}`
            );
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
