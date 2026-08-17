/**
 * [doc:adr-273] 运动子系统启动接线 —— plan 中 'feet-adjustment' / 'footstep' /
 * 'bone-override' / 'wasm-ik-resolver' / 'motion-modules' 五个步骤的实现体。
 *
 * 这些代码原先挤在 `scene/scene.ts` 的 `_initMotionSubsystems()` 里，五件事靠**语句
 * 顺序**维持两条注释契约：
 *   - 脚步声明明消费脚部跟随的落地事件 → 必须在 `startFeetAdjustment` 之后注册；
 *   - WASM IK 重解回调会在骨骼覆盖重建时被清空 → 必须在 `startBoneOverride` 之后注入。
 * 现在顺序住在 `scene/boot-steps.ts` 的 `requires` 里（plan 静态校验会拦下乱序），
 * 本文件只负责"做这件事"，不再负责"排这件事"。
 *
 * 依赖一律显式 import / 显式动态 import：`mmdRuntime` 是 @/core/config 的 live binding，
 * 别在本文件缓存它的值——HMR 重入后要读到新实例，缓存快照正是旧代码踩过的坑。
 */

import type { Scene } from '@babylonjs/core/scene';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import { focusedModelId, mmdRuntime, modelRegistry } from '@/core/config';
import { createDefaultFeetState } from '@/core/scene-state';
import type { FeetState } from '@/core/types';

/**
 * 脚部地面跟随（ADR-085 / ADR-116）：always-on 基础设施，不再由动作覆盖模块控制。
 *
 * 注意 getter 里的 `enabled: false` 是**现状原样**（`createDefaultFeetState()` 的默认值
 * 也是 false），注释里"enabled=true"与代码不符——这是行为问题、不是顺序问题，
 * 迁移时保持逐字节一致，另案处理。
 */
export async function bootFeetAdjustment(): Promise<void> {
    const { startFeetAdjustment } = await import('./motion/feet-adjustment');
    startFeetAdjustment(
        (): { id: string; feet: FeetState; runtimeBones: readonly IMmdRuntimeBone[] }[] => {
            const out: { id: string; feet: FeetState; runtimeBones: readonly IMmdRuntimeBone[] }[] = [];
            for (const inst of modelRegistry.values()) {
                const bones = inst.mmdModel?.runtimeBones;
                if (bones && bones.length > 0) {
                    out.push({
                        id: inst.id,
                        feet: { ...createDefaultFeetState(), enabled: false },
                        runtimeBones: bones,
                    });
                }
            }
            return out;
        }
    );
}

/**
 * 脚步声（ADR-088）：消费 feet-adjustment 的落地事件发声。
 *
 * plan 里 `'footstep'` 声明 `requires: ['feet-adjustment']`——乱序时静态校验报错，
 * 而不是"脚步突然没声音、控制台一片安静"。
 */
export async function bootFootstep(scene: Scene): Promise<void> {
    const { startFootstep } = await import('./motion/footstep');
    startFootstep(scene);
}

/** Bone Override（ADR-116）：注册 onBeforeRender 回调，在动画应用后逐骨骼覆盖。 */
export async function bootBoneOverride(scene: Scene): Promise<void> {
    const { startBoneOverride } = await import('./motion/bone-override');
    startBoneOverride(() => {
        const id = focusedModelId;
        if (!id) {
            return [];
        }
        const inst = modelRegistry.get(id);
        return inst?.mmdModel?.runtimeBones ?? [];
    }, scene);
}

/**
 * [ADR-202 A-class] WASM IK 重解回调注入。
 *
 * 在 WASM 模式下，applyBoneOverrideIK 通过此回调调用 mmdModelSolveIk 导出重解 IK。
 * `mmdRuntime` 是 live binding（setMmdRuntime 后即指向当前运行时实例；HMR 重入时
 * stopBoneOverride 清除旧 resolver、_initMmdRuntime 设新 mmdRuntime 后由本函数重注）。
 * plan 里 `requires: ['bone-override', 'mmd-runtime']` 正是这两条前提。
 */
export async function bootWasmIkResolver(): Promise<void> {
    const { setWasmIkResolver } = await import('./motion/bone-override');
    const { solveIkNative, getPhysicsImpl } = await import('@/core/mmd-adapter');
    setWasmIkResolver((modelId: string, ikSolverIndex: number, usePhysics: boolean) => {
        const inst = modelRegistry.get(modelId);
        if (!inst?.mmdModel) {
            return;
        }
        const impl = getPhysicsImpl(mmdRuntime);
        if (!impl) {
            return;
        }
        solveIkNative(impl.wasmInstance, inst.mmdModel, ikSolverIndex, usePhysics);
    });
}

/**
 * Motion Override Modules 注册（ADR-116）：主初始化路径。
 *
 * 必须在 `focusModel` 可能被调用之前完成；registry 内 setTargetModel/createModule
 * 也有幂等兜底。这条约束无法用资源表达（focusModel 由用户操作触发），因此留在注释里，
 * 由本步骤排在 loader/playback 之后、任何交互之前的位置来满足。
 */
export async function bootMotionModules(): Promise<void> {
    const { initMotionModules } = await import('./motion/motion-modules/registry');
    initMotionModules();
}
