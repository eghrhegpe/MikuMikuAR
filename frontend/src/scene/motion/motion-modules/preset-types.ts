// [doc:adr-145] Motion Preset — 多模块协同预设：一键启用组合姿态
// 职责：定义 applyMotionPreset + 转换函数
// MotionPreset / PresetModuleState 类型定义在 core/types.ts（因 ModelInstance 引用）

import type { MotionModuleState, MotionPreset } from '@/core/types';
import { setModuleEnabled, setModuleParam, createModule } from './registry';

/** MotionModuleState[] → MotionPreset['modules'] */
export function modulesToPresetMap(states: MotionModuleState[]): MotionPreset['modules'] {
    const map: MotionPreset['modules'] = {};
    for (const s of states) {
        map[s.id] = { enabled: s.enabled, params: { ...s.params } };
    }
    return map;
}

/**
 * 应用预设到指定模型。
 * 命名加「Motion」前缀，避免与 model-preset.ts 的 applyPresetFromLib 命名冲突。
 * 遍历 preset.modules → setModuleEnabled + setModuleParam + createModule().enable()
 * [fix:P2] actionId 可选：UI 查看指定动作时传入，预设落到该动作而非激活动作
 */
export function applyMotionPreset(modelId: string, preset: MotionPreset, actionId?: string): void {
    for (const [moduleId, mod] of Object.entries(preset.modules)) {
        if (!mod) {
            continue;
        }
        setModuleEnabled(modelId, moduleId, mod.enabled, actionId);
        for (const [key, value] of Object.entries(mod.params)) {
            setModuleParam(modelId, moduleId, key, value, actionId);
        }
        const instance = createModule(moduleId, modelId, actionId);
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
