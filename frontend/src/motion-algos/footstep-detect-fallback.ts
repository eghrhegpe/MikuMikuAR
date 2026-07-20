// footstep-detect-fallback.ts — 独立 IK 骨骼 Y 轴落地检测（ADR-088 Phase B）
//
// [doc:adr-088] 当 feet-adjustment（ADR-085）未开启时，本模块作为降级路径：
// 直接监听模型的 IK 骨骼世界 Y 相对 groundHeight 的上升沿，复用 detectFootLanding 纯函数。
// 无需 Babylon 场景对象依赖（仅通过 Scene.onBeforeRenderObservable 驱动）。
//
// 每帧遍历所有模型，对每只脚：
//   1. 通过 BONE_LEG_IK_L/R_CANDIDATES 匹配 IK 骨骼
//   2. 取 ik.getWorldTranslation() 的 Y 值
//   3. 查询 getGroundHeightAt(worldX, worldZ) 得到 groundY
//   4. 判定 grounded = (footY - groundY) < SOLE_THRESHOLD
//   5. 复用 detectFootLanding() 检测上升沿 + 去抖
//   6. 触发回调

import { type Scene } from '@babylonjs/core/scene';
import { getGroundHeightAt } from '@/scene/env/env-impl';
import {
    BONE_LEG_IK_L_CANDIDATES,
    BONE_LEG_IK_R_CANDIDATES,
    matchBone,
} from './proc-motion-shared';
import { detectFootLanding } from './footstep-detect';
import type { FootLandEvent } from '@/scene/motion/feet-adjustment';
import { modelRegistry } from '@/core/config';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';

/** 脚底贴地判定阈值（世界单位）：脚 IK Y 低于 groundY + 此值即视为贴地 */
const SOLE_THRESHOLD = 0.05;

/** 最小落地间隔（ms），复用 feet-adjustment 相同的去抖值 */
const MIN_STEP_INTERVAL = 120;

/** 每只脚的状态缓存 */
interface _FootState {
    prevGrounded: boolean;
    footYPrev: number;
    lastLandTime: number;
    ikName: string | null;
}

/** 每个模型的状态缓存 */
interface _ModelState {
    l: _FootState;
    r: _FootState;
    resolved: boolean;
}

let _observerHandle: ObserverHandle | null = null;
const _modelStates = new Map<string, _ModelState>();
let _callback: ((e: FootLandEvent) => void) | null = null;
let _lastTickTime = 0;

/**
 * 启动独立落地检测（fallback 模式）。
 * 注册 onBeforeRenderObservable，每帧遍历模型 IK 骨骼检测落地上升沿。
 */
export function startFallbackDetection(scene: Scene, onFootLand: (e: FootLandEvent) => void): void {
    if (_observerHandle) {
        return; // 已启动
    }
    _callback = onFootLand;
    _modelStates.clear();
    _lastTickTime = 0;

    const tick = () => {
        if (!_callback) {
            return;
        }
        const now = performance.now();
        const dt = _lastTickTime ? Math.min((now - _lastTickTime) / 1000, 0.1) : 1 / 60;
        _lastTickTime = now;

        // 通过 modelRegistry 遍历所有模型
        for (const [modelId, inst] of modelRegistry) {
            const bones = inst.mmdModel?.runtimeBones;
            if (!bones || bones.length === 0) {
                continue;
            }
            let state = _modelStates.get(modelId);
            if (!state) {
                state = {
                    l: { prevGrounded: false, footYPrev: 0, lastLandTime: 0, ikName: null },
                    r: { prevGrounded: false, footYPrev: 0, lastLandTime: 0, ikName: null },
                    resolved: false,
                };
                _modelStates.set(modelId, state);
            }

            // 惰性解析 IK 骨骼名
            if (!state.resolved) {
                const names = bones.map((b) => b.name);
                state.l.ikName = matchBone(names, BONE_LEG_IK_L_CANDIDATES);
                state.r.ikName = matchBone(names, BONE_LEG_IK_R_CANDIDATES);
                state.resolved = true;
            }

            _checkFoot(bones, state.l, 'L', modelId, dt, now);
            _checkFoot(bones, state.r, 'R', modelId, dt, now);
        }
    };

    _observerHandle = observe(scene.onBeforeRenderObservable, tick);
}

/** 停止独立落地检测。 */
export function stopFallbackDetection(): void {
    _observerHandle = safeDispose(_observerHandle);
    _modelStates.clear();
    _callback = null;
    _lastTickTime = 0;
}

/** 对单只脚做落地检测。 */
function _checkFoot(
    bones: readonly {
        name: string;
        getWorldTranslationToRef?(v: { x: number; y: number; z: number }): void;
    }[],
    footState: _FootState,
    side: 'L' | 'R',
    modelId: string,
    dt: number,
    now: number
): void {
    const ikName = footState.ikName;
    if (!ikName) {
        return;
    }
    const ik = bones.find((b) => b.name === ikName);
    if (!ik || !ik.getWorldTranslationToRef) {
        return;
    }
    const pos = { x: 0, y: 0, z: 0 };
    ik.getWorldTranslationToRef(pos);
    const groundY = getGroundHeightAt(pos.x, pos.z);
    const grounded = pos.y - groundY < SOLE_THRESHOLD;

    const det = detectFootLanding({
        prevGrounded: footState.prevGrounded,
        grounded,
        footYPrev: footState.footYPrev,
        footY: pos.y,
        dt,
        prevStepTime: footState.lastLandTime,
        now,
        minInterval: MIN_STEP_INTERVAL,
    });

    // 更新状态（无论是否触发都更新，供下一帧判定）
    footState.prevGrounded = grounded;
    footState.footYPrev = pos.y;
    if (det.landed) {
        footState.lastLandTime = now;
    }

    if (det.landed && _callback) {
        _callback({
            modelId,
            foot: side,
            groundY,
            impactSpeed: det.impactSpeed,
            worldX: pos.x,
            worldZ: pos.z,
        });
    }
}
