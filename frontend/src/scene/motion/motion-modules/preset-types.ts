// [doc:adr-145] Motion Preset — 多模块协同预设：一键启用组合姿态
// 职责：定义 applyMotionPreset + 转换函数
// MotionPreset / PresetModuleState 类型定义在 core/types.ts（因 ModelInstance 引用）

import type { MotionModuleState, MotionPreset, PresetModuleState } from '@/core/types';
import { setModuleEnabled, setModuleParam, createModule } from './registry';

/** 序列化格式（含版本号，用于文件/库存储） */
export interface MotionPresetFile {
    version: 1;
    presetName?: string;
    preset: MotionPreset;
}

/** MotionModuleState[] → MotionPreset['modules'] */
export function modulesToPresetMap(states: MotionModuleState[]): MotionPreset['modules'] {
    const map: MotionPreset['modules'] = {};
    for (const s of states) {
        map[s.id] = { enabled: s.enabled, params: { ...s.params } };
    }
    return map;
}

/** MotionPreset['modules'] → MotionModuleState[] */
export function presetMapToModules(map: MotionPreset['modules']): MotionModuleState[] {
    return Object.entries(map).map(([id, state]) => ({
        id,
        enabled: state.enabled,
        params: { ...state.params },
    }));
}

/**
 * 应用预设到指定模型。
 * 命名加「Motion」前缀，避免与 model-preset.ts 的 applyPresetFromLib 命名冲突。
 * 遍历 preset.modules → setModuleEnabled + setModuleParam + createModule().enable()
 */
export function applyMotionPreset(modelId: string, preset: MotionPreset): void {
    for (const [moduleId, mod] of Object.entries(preset.modules)) {
        if (!mod) continue;
        setModuleEnabled(modelId, moduleId, mod.enabled);
        for (const [key, value] of Object.entries(mod.params)) {
            setModuleParam(modelId, moduleId, key, value);
        }
        const instance = createModule(moduleId, modelId);
        if (instance) {
            if (mod.enabled) {
                instance.enable();
            } else {
                instance.disable();
            }
        }
    }
}

/** 生成唯一预设 ID */
let _presetIdCounter = 0;
export function generatePresetId(): string {
    _presetIdCounter++;
    return `preset_${Date.now()}_${_presetIdCounter}`;
}
