// [doc:adr-116] Motion Override Module Registry — 模块注册表 + per-model 状态管理
// 职责: 注册模块工厂、创建模块实例、管理 per-model 模块状态

import type { MotionModuleState, ParamValue } from '@/core/types';
import { modelRegistry, focusedModelId } from '@/core/state';
import type { MotionOverrideModule, ModuleFactory, ModuleMeta } from './types';
import { clearBoneOverride } from '../bone-override';

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
    const entry = _registry.get(id);
    if (!entry) {
        return null;
    }
    return entry.factory(modelId);
}

// ── per-model 状态管理 ──

/** 获取指定模型的模块状态（不存在则创建默认状态） */
export function getModuleState(modelId: string, moduleId: string): MotionModuleState {
    const inst = modelRegistry.get(modelId);
    if (!inst) {
        return { id: moduleId, enabled: false, params: {} };
    }
    if (!inst.motionOverrideModules) {
        inst.motionOverrideModules = [];
    }
    let state = inst.motionOverrideModules.find((m) => m.id === moduleId);
    if (!state) {
        state = { id: moduleId, enabled: false, params: {} };
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

// ── 模型切换管理 ──

let _currentModelId: string | null = null;

/**
 * 切换目标模型：禁用当前模型的所有模块覆盖，启用新模型已保存的模块状态。
 * 应在 focusModel 时调用。
 */
export function setTargetModel(modelId: string | null): void {
    if (_currentModelId === modelId) {
        return;
    }

    // 禁用当前模型的所有模块
    if (_currentModelId) {
        for (const moduleId of _registry.keys()) {
            const state = getModuleState(_currentModelId, moduleId);
            if (state.enabled) {
                const mod = createModule(moduleId, _currentModelId);
                mod?.disable();
            }
        }
    }

    _currentModelId = modelId;

    // 启用新模型已保存的模块
    if (modelId) {
        for (const moduleId of _registry.keys()) {
            const state = getModuleState(modelId, moduleId);
            if (state.enabled) {
                const mod = createModule(moduleId, modelId);
                mod?.enable();
            }
        }
    }
}

/** 获取当前目标模型 ID */
export function getCurrentModelId(): string | null {
    return _currentModelId ?? focusedModelId;
}

/** 清除指定模型的所有模块覆盖（删除模型时调用） */
export function clearAllModulesForModel(modelId: string): void {
    for (const moduleId of _registry.keys()) {
        const entry = _registry.get(moduleId)!;
        // 使用工厂创建实例获取 managedBones，然后清除
        const mod = entry.factory(modelId);
        for (const bone of mod.managedBones) {
            clearBoneOverride(bone, modelId);
        }
    }
    const inst = modelRegistry.get(modelId);
    if (inst) {
        inst.motionOverrideModules = [];
    }
}

// ── 内置模块自动注册 ──

import { registerBodyPosture } from './body-posture';
import { registerHandSymmetry } from './hand-symmetry';

let _initialized = false;

/** 注册所有内置模块（幂等，重复调用安全） */
export function initMotionModules(): void {
    if (_initialized) {
        return;
    }
    registerBodyPosture();
    registerHandSymmetry();
    _initialized = true;
}
