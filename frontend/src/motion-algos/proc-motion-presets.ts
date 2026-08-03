// proc-motion-presets.ts — 程序化动作参数预设（纯数据 + 纯函数，零依赖叶子）
// 仿 env-ground-presets 范式：预设是「参数快照」，非新生成器——
// 复用现有 per-mode 写入/重生成/持久化链路，零新状态、零迁移。
// UI 应用：菜单层 _applyProcParam(modelId, mode, preset.params) + regenerateProcMotion。

import { type ProcModeKey, type ProcMotionParams } from './proc-motion-shared';

export interface ProcParamsPreset {
    /** 预设名（i18n key） */
    label: string;
    /** 完整参数快照（boneToggles 全键，应用时整体覆盖） */
    params: ProcMotionParams;
}

/** idle 预设使用的默认 boneToggles 基底（全开，个别预设关闭部分类别） */
const IDLE_ALL_ON: ProcMotionParams['boneToggles'] = {
    center: true,
    upper: true,
    upper2: true,
    waist: true,
    head: true,
    arm: true,
    groove: true,
    shoulder: true,
    allParent: true,
    wrist: true,
    footIk: true,
    blink: true,
    emotion: true,
};

/** autodance 预设基底：舞蹈场景关闭微表情/眨眼（情绪轮由舞蹈表达承载） */
const DANCE_BASE: ProcMotionParams['boneToggles'] = {
    ...IDLE_ALL_ON,
    blink: false,
    emotion: false,
};

const mk = (
    label: string,
    partial: Partial<Omit<ProcMotionParams, 'boneToggles'>> & {
        boneToggles?: Partial<ProcMotionParams['boneToggles']>;
    },
    base: ProcMotionParams['boneToggles'] = IDLE_ALL_ON
): ProcParamsPreset => ({
    label,
    params: {
        intensity: 0.5,
        speed: 1.0,
        vpdApplyEnabled: false,
        interpOverride: 'auto',
        ...partial,
        // 完整 Record 基底 + Partial 覆盖：显式放最后，避免 ...partial 的
        // Partial<boneToggles> 类型覆盖；合并结果必含全部类别键
        boneToggles: { ...base, ...(partial.boneToggles ?? {}) } as ProcMotionParams['boneToggles'],
    },
});

/** idle（待机呼吸）预设集 */
export const PROC_IDLE_PRESETS: Record<string, ProcParamsPreset> = {
    gentleBreath: mk('procPreset.idle.gentleBreath', {
        intensity: 0.25,
        speed: 0.6,
        interpOverride: 'ease-out',
    }),
    standard: mk('procPreset.idle.standard', {
        intensity: 0.5,
        speed: 1.0,
        interpOverride: 'auto',
    }),
    tense: mk('procPreset.idle.tense', {
        intensity: 0.75,
        speed: 1.3,
        interpOverride: 'sharp',
        boneToggles: { blink: false, emotion: false }, // 紧张僵立：少眨眼、无表情
    }),
    relaxed: mk('procPreset.idle.relaxed', {
        intensity: 0.35,
        speed: 0.8,
        interpOverride: 'ease-in-out',
        boneToggles: { groove: true },
    }),
};

/** autodance（自动舞蹈）预设集 */
export const PROC_AUTODANCE_PRESETS: Record<string, ProcParamsPreset> = {
    standardGroove: mk(
        'procPreset.autodance.standardGroove',
        { intensity: 0.5, speed: 1.0, interpOverride: 'auto' },
        DANCE_BASE
    ),
    energetic: mk(
        'procPreset.autodance.energetic',
        { intensity: 0.9, speed: 1.5, interpOverride: 'sharp' },
        DANCE_BASE
    ),
    lightBeat: mk(
        'procPreset.autodance.lightBeat',
        { intensity: 0.4, speed: 0.85, interpOverride: 'ease-in-out' },
        DANCE_BASE
    ),
    robotic: mk(
        'procPreset.autodance.robotic',
        {
            intensity: 0.7,
            speed: 1.2,
            interpOverride: 'sharp',
            boneToggles: { groove: true, arm: true, wrist: true, shoulder: false },
        },
        DANCE_BASE
    ),
};

/** 指定模式的预设集（无则空表） */
export function getProcPresetSet(mode: ProcModeKey): Record<string, ProcParamsPreset> {
    return mode === 'idle' ? PROC_IDLE_PRESETS : PROC_AUTODANCE_PRESETS;
}

/** 取单个预设（缺失返回 undefined，UI 层需兜底） */
export function getProcParamsPreset(
    mode: ProcModeKey,
    id: string
): ProcParamsPreset | undefined {
    return getProcPresetSet(mode)[id];
}

// ======== 自定义预设（用户保存的参数快照）纯操作 ========

let _presetIdCounter = 0;
/** 生成唯一预设 ID（仿 preset-types.generatePresetId，避免跨模块 import 耦合） */
export function generateProcPresetId(): string {
    _presetIdCounter++;
    return `procPreset_${Date.now()}_${_presetIdCounter}`;
}

/** 由当前参数构造自定义预设快照（深拷贝，防与运行时状态共引用） */
export function makeProcPreset(
    mode: ProcModeKey,
    name: string,
    params: ProcMotionParams
): { id: string; mode: ProcModeKey; name: string; params: ProcMotionParams } {
    return {
        id: generateProcPresetId(),
        mode,
        name,
        params: {
            ...params,
            boneToggles: { ...params.boneToggles },
        },
    };
}

/** 增改自定义预设（同 id 覆盖，否则追加；返回新数组） */
export function upsertProcPreset(
    presets: Array<{ id: string; mode: ProcModeKey; name: string; params: ProcMotionParams }>,
    preset: { id: string; mode: ProcModeKey; name: string; params: ProcMotionParams }
): Array<{ id: string; mode: ProcModeKey; name: string; params: ProcMotionParams }> {
    const idx = presets.findIndex((p) => p.id === preset.id);
    if (idx >= 0) {
        const next = [...presets];
        next[idx] = preset;
        return next;
    }
    return [...presets, preset];
}

/** 按 id 删除自定义预设（返回新数组） */
export function removeProcPreset(
    presets: Array<{ id: string; mode: ProcModeKey; name: string; params: ProcMotionParams }>,
    id: string
): Array<{ id: string; mode: ProcModeKey; name: string; params: ProcMotionParams }> {
    return presets.filter((p) => p.id !== id);
}
