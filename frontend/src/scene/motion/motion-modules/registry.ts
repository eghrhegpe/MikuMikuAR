// [doc:adr-116] Motion Override Module Registry — 模块注册表 + per-model 状态管理
// 职责: 注册模块工厂、创建模块实例、管理 per-model 模块状态、ownedBones 冲突仲裁
// 冲突仲裁: 每条骨骼同一时刻只能被一个模块 owned；bake 时若骨骼已被其他模块占用，console.warn 跳过

import type { MotionModuleState, ParamValue } from '@/core/types';
import { modelRegistry } from '@/core/state';
import type { MotionOverrideModule, ModuleFactory, ModuleMeta } from './types';
import { clearBoneOverride } from '../bone-override';
import { registerBodyPosture } from './body-posture';
import { registerHandSymmetry } from './hand-symmetry';
import { registerHeadTracking } from './head-tracking';
import { registerSwayMotion } from './sway-motion';
import { registerFingerPose } from './finger-pose';
import { registerRidingModel } from './riding-model';

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
    initMotionModules(); // 幂等兜底：确保注册表已就绪（P1-1 修复）
    const entry = _registry.get(id);
    if (!entry) {
        return null;
    }
    return entry.factory(modelId);
}

// ── per-model 状态管理 ──

/** 获取指定模型的模块状态（不存在则创建默认状态，种入 defaults） */
export function getModuleState(modelId: string, moduleId: string): MotionModuleState {
    initMotionModules(); // 幂等兜底
    const inst = modelRegistry.get(modelId);
    if (!inst) {
        return { id: moduleId, enabled: false, params: {} };
    }
    if (!inst.motionOverrideModules) {
        inst.motionOverrideModules = [];
    }
    let state = inst.motionOverrideModules.find((m) => m.id === moduleId);
    if (!state) {
        // 将模块注册的默认值种入 params，避免 schema 首次渲染读到 undefined
        const entry = _registry.get(moduleId);
        const defs = entry?.meta.defaults;
        state = {
            id: moduleId,
            enabled: false,
            params: defs ? { ...defs } : {},
        };
        inst.motionOverrideModules.push(state);
    }
    return state;
}

/** 写入模块参数到 ModelInstance */
export function setModuleParam(
    modelId: string,
    moduleId: string,
    param: string,
    value: ParamValue
): void {
    const state = getModuleState(modelId, moduleId);
    state.params[param] = value;
}

/** 设置模块启用/禁用状态到 ModelInstance */
export function setModuleEnabled(modelId: string, moduleId: string, enabled: boolean): void {
    const state = getModuleState(modelId, moduleId);
    state.enabled = enabled;
}

// ── ownedBones 运行时追踪（P2 冲突仲裁 + 精确清除） ──
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
                        `[adr-116] bone "${bone}" 被模块 "${moduleId}"(priority=${myPriority}) 从 "${conflictOwner}"(priority=${otherPriority}) 抢占`
                    );
                }
                // 继续执行 claim 逻辑
            } else {
                // 落败：跳过并 console.warn
                console.warn(
                    `[adr-116] bone "${bone}" 已被模块 "${conflictOwner}"(priority=${otherPriority}) 占用，模块 "${moduleId}"(priority=${myPriority}) 跳过该骨骼`
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
 * 应在 focusModel 时调用。
 */
export function setTargetModel(modelId: string | null): void {
    initMotionModules(); // 幂等兜底：确保注册表已就绪（P1-1 修复）
    if (_currentModelId === modelId) {
        return;
    }

    // 禁用当前模型的所有模块（精确清除 ownedBones，不误伤手动覆盖）
    if (_currentModelId) {
        for (const moduleId of _registry.keys()) {
            const state = getModuleState(_currentModelId, moduleId);
            if (state.enabled) {
                createModule(moduleId, _currentModelId)?.disable();
            }
        }
    }

    _currentModelId = modelId;

    // 启用新模型已保存的模块
    if (modelId) {
        for (const moduleId of _registry.keys()) {
            const state = getModuleState(modelId, moduleId);
            if (state.enabled) {
                createModule(moduleId, modelId)?.enable();
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
    const inst = modelRegistry.get(modelId);
    if (inst) {
        inst.motionOverrideModules = [];
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
    registerHeadTracking();
    registerSwayMotion();
    registerFingerPose();
    registerRidingModel();
    _initialized = true;
}
