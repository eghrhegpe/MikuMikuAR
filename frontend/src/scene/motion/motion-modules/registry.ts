// [doc:adr-129] Motion Override Module Registry — 模块注册表 + 场景级配置管理
// 职责: 注册模块工厂、创建模块实例、管理场景级模块配置、ownedBones 冲突仲裁
// 架构变更: 配置存储从 per-model 改为 per-motion（随动作走）
// 冲突仲裁: 每条骨骼同一时刻只能被一个模块 owned；bake 时若骨骼已被其他模块占用，console.warn 跳过

import type { MotionModuleState, ParamValue, SceneMotionIntent } from '@/core/types';
import { modelRegistry } from '@/core/state';
import { triggerAutoSave } from '@/core/utils';
import type { MotionOverrideModule, ModuleFactory, ModuleMeta } from './types';
import { clearBoneOverride } from '../bone-override';
import { registerBodyPosture } from './body-posture';
import { registerHandSymmetry } from './hand-symmetry';
import { registerSwayMotion } from './sway-motion';
import { registerFingerPose } from './finger-pose';
import { registerRidingModel } from './riding-model';
import { registerPositionOffset } from './position-offset';

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

import { getActiveMotion } from '../motion-intent';

/** 获取当前动作的模块配置（不存在则创建默认状态，种入 defaults） */
export function getModuleState(_modelId: string, moduleId: string): MotionModuleState {
    initMotionModules(); // 幂等兜底
    const intent = getActiveMotion();

    // 无动作时返回默认状态
    if (!intent) {
        return { id: moduleId, enabled: false, params: {} };
    }

    // 确保配置数组存在
    if (!intent.motionModules) {
        intent.motionModules = [];
    }

    let state = intent.motionModules.find((m) => m.id === moduleId);
    if (!state) {
        // 将模块注册的默认值种入 params，避免 schema 首次渲染读到 undefined
        const entry = _registry.get(moduleId);
        const defs = entry?.meta.defaults;
        state = {
            id: moduleId,
            enabled: false,
            params: defs ? { ...defs } : {},
        };
        intent.motionModules.push(state);
    }
    return state;
}

/**
 * [doc:adr-116] 读取模块注册的默认参数值。
 * 供菜单滑块在未 seed（inst.motionOverrideModules 为空）时回退，
 * 避免 getStateValue 返回 undefined 导致滑块显示成负值 min（Q2 修复）。
 */
export function getModuleDefaultParam(
    moduleId: string,
    paramKey: string
): ParamValue | undefined {
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

// ── ownedBones 运行时追踪（per-model，用于骨骼冲突仲裁）──
// 结构: modelId -> moduleId -> Set<boneName>
// 语义: 每条骨骼同一时刻只能被一个模块 owned；bake 时检测冲突，disable 时仅清自有骨
const _ownedBones = new Map<string, Map<string, Set<string>>>();

function _ownedMap(modelId: string): Map<string, Set<string>> {
    let m = _ownedBones.get(modelId);
    if (!m) {
        m = new Map();
        _ownedBones.set(modelId, m);
    }
    return m;
}

/**
 * 为模块声明对一组骨骼的所有权（bake 前调用）。
 * 冲突仲裁: 按 priority 抢占（数值越小优先级越高）。
 * - 若新模块 priority < 冲突方，则抢占（清落败方 ownedBones + 引擎 slot）
 * - 否则跳过并 console.warn
 * 返回实际成功 claim 的骨骼列表。
 */
export function claimBones(modelId: string, moduleId: string, bones: readonly string[]): string[] {
    const owned = _ownedMap(modelId);
    let mySet = owned.get(moduleId);
    if (!mySet) {
        mySet = new Set();
        owned.set(moduleId, mySet);
    }

    // 查询新模块的 priority
    const myEntry = _registry.get(moduleId);
    const myPriority = myEntry?.priority ?? 999;

    const claimed: string[] = [];
    for (const bone of bones) {
        if (mySet.has(bone)) {
            claimed.push(bone);
            continue;
        }
        // 检查是否被其他模块占用
        let conflictOwner: string | null = null;
        for (const [otherId, otherSet] of owned) {
            if (otherId !== moduleId && otherSet.has(bone)) {
                conflictOwner = otherId;
                break;
            }
        }
        if (conflictOwner) {
            // 比较 priority：数值越小优先级越高
            const otherEntry = _registry.get(conflictOwner);
            const otherPriority = otherEntry?.priority ?? 999;
            if (myPriority < otherPriority) {
                // 抢占：清落败方的 ownedBones + 引擎 slot
                const otherSet = owned.get(conflictOwner);
                if (otherSet?.has(bone)) {
                    otherSet.delete(bone);
                    clearBoneOverride(bone, modelId);
                    console.warn(
                        `[adr-129] bone "${bone}" 被模块 "${moduleId}"(priority=${myPriority}) 从 "${conflictOwner}"(priority=${otherPriority}) 抢占`
                    );
                }
                // 继续执行 claim 逻辑
            } else {
                // 落败：跳过并 console.warn
                console.warn(
                    `[adr-129] bone "${bone}" 已被模块 "${conflictOwner}"(priority=${otherPriority}) 占用，模块 "${moduleId}"(priority=${myPriority}) 跳过该骨骼`
                );
                continue;
            }
        }
        mySet.add(bone);
        claimed.push(bone);
    }
    return claimed;
}

/** 获取模块当前 owned 的骨骼（disable 时用于精确清除） */
export function getOwnedBones(modelId: string, moduleId: string): Set<string> {
    return _ownedMap(modelId).get(moduleId) ?? new Set();
}

/**
 * [doc:adr-116 P3] 判定指定骨骼是否被「其他模块」占用（无副作用、不 warn）。
 * 用于时间驱动模块（sway/riding）的帧钩子做让位判定：
 * 若被高优先级模块（如 position-offset 占用 センター）占用则让位，
 * 否则可安全重新认领。区别于 claimBones（会触发 warn / 抢占副作用）。
 */
export function isBoneOwnedByOther(modelId: string, moduleId: string, bone: string): boolean {
    const owned = _ownedMap(modelId);
    for (const [otherId, otherSet] of owned) {
        if (otherId !== moduleId && otherSet.has(bone)) {
            return true;
        }
    }
    return false;
}

/** 释放模块的 ownedBones 记录（不清除骨骼覆盖本身，由调用方负责） */
export function releaseOwnedBones(modelId: string, moduleId: string): Set<string> {
    const owned = _ownedMap(modelId);
    const set = owned.get(moduleId);
    if (!set) {
        return new Set();
    }
    owned.delete(moduleId);
    return set;
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
    // 释放并清除所有 ownedBones（精确清除，不误伤手动覆盖）
    const owned = _ownedBones.get(modelId);
    if (owned) {
        for (const [, boneSet] of owned) {
            for (const bone of boneSet) {
                clearBoneOverride(bone, modelId);
            }
        }
        owned.clear();
    }
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

/** 注册所有内置模块（幂等，重复调用安全） */
export function initMotionModules(): void {
    if (_initialized) {
        return;
    }
    registerBodyPosture();
    registerHandSymmetry();
    registerSwayMotion();
    registerFingerPose();
    registerRidingModel();
    registerPositionOffset();
    _initialized = true;
}