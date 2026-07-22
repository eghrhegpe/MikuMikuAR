// [doc:adr-129] Motion Override Module Registry — 模块注册表 + 场景级配置管理
// 职责: 注册模块工厂、创建模块实例、管理场景级模块配置、ownedBones 冲突仲裁
// 架构变更: 配置存储从 per-model 改为 per-motion（随动作走）
// 冲突仲裁: 每条骨骼同一时刻只能被一个模块 owned；bake 时若骨骼已被其他模块占用，console.warn 跳过
// [doc:adr-166] Perception 模块（perception.*）免于注册表管理，其骨骼由 perception.ts
// 的 _claimPerceptionBones / _releasePerceptionBones 直接通过 BoneOverrideStore 管理，
// 注册表仅作 releaseOwnedBones 的透传入口（claimBones 在 perception.ts 内部绕过本注册表）。

import type { MotionModuleState, ParamValue, SceneMotionIntent } from '@/core/types';
import { modelRegistry } from '@/core/state';
import { triggerAutoSave } from '@/core/utils';
import type { MotionOverrideModule, ModuleFactory, ModuleMeta } from './types';
import { getBoneOverrideStore } from '../bone-override-store';
import type { ModuleDef } from './types';
import { BODY_POSTURE_DEF } from './body-posture';
import { HAND_SYMMETRY_DEF } from './hand-symmetry';
import { SWAY_MOTION_DEF } from './sway-motion';
import { FINGER_POSE_DEF } from './finger-pose';
import { RIDING_MODEL_DEF } from './riding-model';
import { POSITION_OFFSET_DEF } from './position-offset';

// ── 注册表 ──

interface RegistryEntry {
    factory: ModuleFactory;
    meta: ModuleMeta;
    priority: number;
}

const _registry = new Map<string, RegistryEntry>();

/** 注册一个动作覆盖模块 */
export function registerModule(
    id: string,
    meta: ModuleMeta,
    priority: number,
    factory: ModuleFactory
): void {
    _registry.set(id, { factory, meta, priority });
}

/** 注销模块 */
export function unregisterModule(id: string): void {
    _registry.delete(id);
}

/** 获取所有已注册模块的元信息（按优先级排序） */
export function getRegisteredModules(): Array<{ id: string; meta: ModuleMeta; priority: number }> {
    return Array.from(_registry.entries())
        .map(([id, entry]) => ({ id, meta: entry.meta, priority: entry.priority }))
        .sort((a, b) => a.priority - b.priority);
}

/** 为指定模型创建模块实例 */
export function createModule(id: string, modelId: string): MotionOverrideModule | null {
    initMotionModules(); // 幂等兜底：确保注册表已就绪
    const entry = _registry.get(id);
    if (!entry) {
        return null;
    }
    return entry.factory(modelId);
}

// ── 场景级配置管理（per-motion，随动作走）──

import { getActiveMotion, findOrCreateModuleState } from '../motion-intent';

/**
 * 获取当前动作的模块配置（不存在则创建默认状态，种入 defaults）。
 * [doc:adr-121 P4-4] _modelId 未使用：ADR-129 将配置存储从 per-model 改为 per-motion（随动作走），
 * 保留参数仅为维持接口兼容（UI 调用方均传入 modelId）。
 */
export function getModuleState(_modelId: string, moduleId: string): MotionModuleState {
    initMotionModules(); // 幂等兜底
    const intent = getActiveMotion();

    // 无动作时返回临时默认状态（不写入 intent）
    if (!intent) {
        return { id: moduleId, enabled: false, params: {} };
    }

    // 快速路径：已存在则直接返回
    if (intent.motionModules) {
        const existing = intent.motionModules.find((m) => m.id === moduleId);
        if (existing) {
            return existing;
        }
    }

    // 创建路径：通过 findOrCreateModuleState 收敛 mutate 入口 [doc:adr-121 P4-1]
    const state = findOrCreateModuleState(intent, moduleId);

    // 将模块注册的默认值种入 params，避免 schema 首次渲染读到 undefined
    const entry = _registry.get(moduleId);
    const defs = entry?.meta.defaults;
    if (defs) {
        state.params = { ...defs };
    }
    return state;
}

/**
 * [doc:adr-116] 读取模块注册的默认参数值。
 * 供菜单滑块在未 seed（inst.motionOverrideModules 为空）时回退，
 * 避免 getStateValue 返回 undefined 导致滑块显示成负值 min（Q2 修复）。
 */
export function getModuleDefaultParam(moduleId: string, paramKey: string): ParamValue | undefined {
    const entry = _registry.get(moduleId);
    return entry?.meta.defaults?.[paramKey];
}

/** 写入模块参数到场景动作意图 */
export function setModuleParam(
    _modelId: string,
    moduleId: string,
    param: string,
    value: ParamValue
): void {
    const state = getModuleState(_modelId, moduleId);
    state.params[param] = value;
    // 仅持久化：配置已写入 intent.motionModules（随动作走）。
    // 注意：不再调用 setActiveMotion 重新广播——否则会触发 VMD 重载 + seekAnimation(0)，
    // 每次调参都把动画重启到帧 0，表现为角色持续抖动 + 进度重置（ADR-129 回归）。
    triggerAutoSave();
}

/** 设置模块启用/禁用状态到场景动作意图 */
export function setModuleEnabled(_modelId: string, moduleId: string, enabled: boolean): void {
    const state = getModuleState(_modelId, moduleId);
    state.enabled = enabled;
    // 仅持久化（原因同 setModuleParam：避免重新广播导致 VMD 重载抖动）
    triggerAutoSave();
}

/**
 * 为模块声明对一组骨骼的所有权（bake 前调用）。
 * 冲突仲裁: 按 priority 抢占（数值越小优先级越高）。
 * - 若新模块 priority < 冲突方，则抢占（清落败方 ownedBones + 引擎 slot）
 * - 否则跳过并 console.warn
 * 返回实际成功 claim 的骨骼列表。
 *
 * [doc:adr-147 Phase 2 step 2] 所有权与冲突状态现已委托 BoneOverrideStore 单例，
 * 本文件仅作 thin facade（保留旧公开签名与 {bone,byModule} 冲突形状，供 UI/测试兼容）。
 */
export function claimBones(modelId: string, moduleId: string, bones: readonly string[]): string[] {
    const myPriority = _registry.get(moduleId)?.priority ?? 999;
    return getBoneOverrideStore().claimBones(modelId, moduleId, myPriority, bones);
}

/** 获取模块当前 owned 的骨骼（disable 时用于精确清除） */
export function getOwnedBones(modelId: string, moduleId: string): Set<string> {
    return getBoneOverrideStore().getOwnedBones(modelId, moduleId);
}

// ── 骨骼冲突查询（供 UI 冲突可视化；[doc:adr-116 conflict-visibility]）──
// 冲突状态由 BoneOverrideStore 存储（store.getConflicts 返回 loser/winner 视角），
// 此处重新映射回旧 {bone, byModule} 形状并按 loser 分组，保持 UI/测试兼容。

export interface BoneConflict {
    /** 被抢占的骨骼名 */
    bone: string;
    /** 抢占方模块 id */
    byModule: string;
}

/** 获取某模块被其他模块抢占的骨骼明细（loser 视角：本模块想要但被谁抢） */
export function getModuleConflicts(modelId: string, moduleId: string): BoneConflict[] {
    return getBoneOverrideStore()
        .getConflicts(modelId)
        .filter((c) => c.loserModuleId === moduleId)
        .map((c) => ({ bone: c.bone, byModule: c.winnerModuleId }));
}

/** 获取某模型全部模块的冲突明细（按 loser 模块分组） */
export function getAllConflicts(
    modelId: string
): Array<{ moduleId: string; conflicts: BoneConflict[] }> {
    const byLoser = new Map<string, BoneConflict[]>();
    for (const c of getBoneOverrideStore().getConflicts(modelId)) {
        const entry: BoneConflict = { bone: c.bone, byModule: c.winnerModuleId };
        const list = byLoser.get(c.loserModuleId);
        if (list) list.push(entry);
        else byLoser.set(c.loserModuleId, [entry]);
    }
    return Array.from(byLoser.entries()).map(([mid, conflicts]) => ({ moduleId: mid, conflicts }));
}

/** 获取某模型冲突总数（骨骼数） */
export function getConflictCount(modelId: string): number {
    return getBoneOverrideStore().getConflicts(modelId).length;
}

/**
 * [doc:adr-116 P3] 判定指定骨骼是否被「其他模块」占用（无副作用、不 warn）。
 * 用于时间驱动模块（sway/riding）的帧钩子做让位判定：
 * 若被高优先级模块占用则让位，否则可安全重新认领。区别于 claimBones（会触发 warn / 抢占副作用）。
 */
export function isBoneOwnedByOther(modelId: string, moduleId: string, bone: string): boolean {
    const owner = getBoneOverrideStore().getBoneOwnerModule(modelId, bone);
    return owner !== null && owner !== moduleId;
}

/** 释放模块的 ownedBones 记录并级联清引擎槽（由 store.releaseBones 负责清除） */
export function releaseOwnedBones(modelId: string, moduleId: string): Set<string> {
    return getBoneOverrideStore().releaseBones(modelId, moduleId);
}

// ── 模型切换管理 ──

let _currentModelId: string | null = null;

/**
 * 切换目标模型：禁用当前模型的所有模块覆盖，启用新模型已保存的模块状态。
 * [doc:adr-129] 现在模块配置随动作走，此函数主要用于清理 ownedBones
 */
export function setTargetModel(modelId: string | null): void {
    initMotionModules(); // 幂等兜底：确保注册表已就绪
    if (_currentModelId === modelId) {
        return;
    }

    // 清理旧模型的 ownedBones（配置已随动作，不需要同步）
    if (_currentModelId) {
        for (const moduleId of _registry.keys()) {
            const mod = createModule(moduleId, _currentModelId);
            if (mod) {
                // 禁用模块，释放 ownedBones
                mod.disable();
            }
        }
    }

    _currentModelId = modelId;

    // 启用新模型的模块（从场景级配置读取状态）
    if (modelId) {
        const intent = getActiveMotion();
        if (intent?.motionModules) {
            for (const state of intent.motionModules) {
                if (state.enabled) {
                    const mod = createModule(state.id, modelId);
                    if (mod) {
                        mod.enable();
                        // 应用参数
                        for (const [key, value] of Object.entries(state.params)) {
                            mod.setParam?.(key, value);
                        }
                    }
                }
            }
        }
    }
}

/** 清除指定模型的所有模块覆盖（删除模型时调用） */
export function clearAllModulesForModel(modelId: string): void {
    // 释放并清除所有 ownedBones + 引擎槽（委托 store.disposeModel）
    getBoneOverrideStore().disposeModel(modelId);
}

/**
 * [doc:adr-129] 将场景级模块配置应用到指定模型
 * 用于动作广播时应用配置到所有 inherit 模型
 */
export function applyMotionModulesToModel(modelId: string): void {
    const intent = getActiveMotion();
    if (!intent?.motionModules) {
        return;
    }

    for (const state of intent.motionModules) {
        const mod = createModule(state.id, modelId);
        if (!mod) {
            continue;
        }

        if (state.enabled) {
            mod.enable();
            // 应用参数
            for (const [key, value] of Object.entries(state.params)) {
                mod.setParam?.(key, value);
            }
        } else {
            mod.disable();
        }
    }
}

// ── 内置模块自动注册 ──

let _initialized = false;

/**
 * 内置模块定义聚合（供 initMotionModules 批量注册，消除 6 个 registerXxx 分散调用）。
 * 使用惰性求值函数而非顶层数组字面量：registry 与工厂模块存在循环依赖
 * （工厂 import registry 取 getModuleState/claimBones，registry import 工厂取 DEF），
 * 若顶层字面量在模块求值期捕获 DEF 值，当某工厂被先于 registry 求值时会出现 TDZ
 * （典型：测试先 import sway-motion 再 import registry → SWAY_MOTION_DEF 为 undefined）。
 * 改为在 initMotionModules 调用时（所有模块已加载完成）读取绑定，规避求值顺序问题。
 */
export function getBuiltinModuleDefs(): ModuleDef[] {
    return [
        BODY_POSTURE_DEF,
        HAND_SYMMETRY_DEF,
        SWAY_MOTION_DEF,
        FINGER_POSE_DEF,
        RIDING_MODEL_DEF,
        POSITION_OFFSET_DEF,
    ];
}

/** 注册所有内置模块（幂等，重复调用安全） */
export function initMotionModules(): void {
    if (_initialized) {
        return;
    }
    for (const def of getBuiltinModuleDefs()) {
        registerModule(def.id, def.meta, def.priority, def.factory);
    }
    _initialized = true;
}
