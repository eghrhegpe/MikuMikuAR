/**
 * physics-bridge.ts — 与物理后端无关的骨骼桥 + 挂件 auto-fit 几何工具
 *
 * 起源：原 XPBD(TS) 物理栈已删除（仅保留 WASM MMD 原生物理）。其中部分构件与物理
 * 求解器无关、可在任意后端（WASM / 将来其它引擎）之上复用。此处把它们抽成独立工具，
 * 避免重蹈「测试物理寄生 MMD 加载主链」的覆辙——本模块**不被任何启动期代码 eager 导入**，
 * 仅作为将来实现挂载布料 / ragdoll / attachment 时的基础设施备用。
 *
 * 职责边界：
 *  - 骨骼 READ（锚点跟随）：读取 runtimeBones 的世界矩阵/位置，后端无关。
 *  - auto-fit：从模型尺寸推算挂件几何参数（纯数学，无求解器依赖）。
 *  - PerFrameUpdateRegistry：原 XPBD 在 model-manager 中重复的「每帧 update observer」编排模式抽取。
 *  - 不在此处：求解器内部的步进/写回（writeBack），因其随后端语义不同，应在具体实现里处理。
 */

import type { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import { clamp, clampInt } from '@/core/utils';
import { logWarn } from '@/core/logger';

// ============================================================================
// 骨骼 READ 桥（锚点跟随）
// ============================================================================

/**
 * 在模型 runtimeBones 中按名查找。WASM / JS runtime 都暴露 runtimeBones，故后端无关。
 */
export function findRuntimeBone(
    model: IMmdModel | null | undefined,
    boneName: string
): IMmdRuntimeBone | null {
    if (!model?.runtimeBones) {
        return null;
    }
    return model.runtimeBones.find((b) => b.name === boneName) ?? null;
}

/** 取骨骼世界矩阵（列主序 Float32Array[16]），用于挂件锚点跟随。 */
export function getBoneWorldMatrix(
    model: IMmdModel | null | undefined,
    boneName: string
): Float32Array | null {
    return findRuntimeBone(model, boneName)?.worldMatrix ?? null;
}

/** 从骨骼世界矩阵提取世界位置（米，场景单位）。 */
export function getBoneWorldPosition(
    model: IMmdModel | null | undefined,
    boneName: string
): Vector3 | null {
    const m = getBoneWorldMatrix(model, boneName);
    if (!m) {
        return null;
    }
    return new Vector3(m[12], m[13], m[14]);
}

// ============================================================================
// 挂件 auto-fit 几何（纯数学，无求解器依赖）
// ============================================================================

export type AttachmentTopology = 'grid' | 'radial';

export interface AttachmentAnchors {
    /** 模型整体包围盒尺寸 {x,y,z}（米，场景单位） */
    modelSize: { x: number; y: number; z: number };
    /** 拓扑：'radial' = 环绕锚点骨的环带（裙摆/披风）；'grid' = 平面网格 */
    topology?: AttachmentTopology;
}

export interface AttachmentFit {
    segmentsH: number;
    segmentsV: number;
    /** 锚点环半径（米） */
    innerRadius: number;
    /** 挂件下垂长度（米） */
    length: number;
    /** 粒子半径（米） */
    particleRadius: number;
    /** 期望粒子间距（米） */
    particleSpacing: number;
}

// clamp / clampInt 已收敛至 @/core/utils

/**
 * 从模型尺寸启发式推算挂件几何参数。
 * 注意：此为与物理后端无关的几何起点。原 XPBD 的 auto-fit 算法已随删除遗失，
 * 这里基于模型高度给出合理默认；具体物理材质参数（compliance/mass/damping 等）不在此范围。
 */
export function autoFitAttachment(
    anchor: AttachmentAnchors,
    opts?: { density?: number }
): AttachmentFit {
    const density = opts?.density ?? 0.06; // 期望粒子间距（米）
    const h = Math.max(anchor.modelSize.y, 1e-3);
    const length = clamp(h * 0.3, 0.1, 2.0); // 挂件下垂长度 ≈ 模型高度 30%
    const innerRadius = clamp(h * 0.12, 0.03, 0.6); // 锚点环半径
    const segmentsV = clampInt(length / density, 4, 32);
    const circumference = 2 * Math.PI * innerRadius;
    const segmentsH = clampInt(circumference / density, 6, 64);
    const particleRadius = density * 0.5;
    return { segmentsH, segmentsV, innerRadius, length, particleRadius, particleSpacing: density };
}

// ============================================================================
// 每帧 update 编排（抽取自原 XPBD 在 model-manager 中重复的 observer 模式）
// ============================================================================

export type FrameUpdateFn = (dtSeconds: number) => void;

/**
 * 单一 onBeforeRenderObservable 调度多个按 key 注册的每帧回调。
 * 原 XPBD 的 ensureClothUpdateObserver / ensureRagdollUpdateObserver 是同一模式的副本，
 * 此处统一为可复用的注册表。dt 做了非有限值/后台恢复钳制。
 */
export class PerFrameUpdateRegistry {
    private observer: ObserverHandle | null = null;
    private readonly fns = new Map<string, FrameUpdateFn>();

    constructor(private readonly scene: Scene) {}

    register(key: string, fn: FrameUpdateFn): void {
        this.fns.set(key, fn);
        this.ensure();
    }

    unregister(key: string): void {
        if (!this.fns.delete(key)) {
            return;
        }
        if (this.fns.size === 0) {
            this.dispose();
        }
    }

    private ensure(): void {
        if (this.observer) {
            return;
        }
        this.observer = observe(this.scene.onBeforeRenderObservable, () => {
            const rawDt = this.scene.deltaTime / 1000; // ms -> s
            if (!isFinite(rawDt) || rawDt <= 0) {
                return; // 非有限值 / 非正数：跳过
            }
            // 钳制最大步长（50ms），避免后台标签页恢复后极大 dt 导致物理/动画失稳或脱节
            const dt = Math.min(rawDt, 0.05);
            for (const fn of this.fns.values()) {
                try {
                    fn(dt);
                } catch (e) {
                    logWarn('PerFrameUpdateRegistry', 'update error', e);
                }
            }
        });
    }

    dispose(): void {
        if (this.observer) {
            this.observer.dispose();
            this.observer = null;
        }
        this.fns.clear();
    }
}
