// [doc:adr-116] Finger Pose Module — 手指姿势模块
// 职责: 左右手 10×3 指骨姿态预设，通过预设选择器一键应用
// 优先级 P3=3
//
// 预设策略:
//   - preset: 预设名（'relax'|'fist'|'point'|'peace'|'rock'）
//   - 每个预设定 10 指的弯曲程度（0=伸直, 1=完全弯曲）
//   - 烘焙为指骨 rotation pitch（弯曲）
//
// 骨骼映射（MMD 标准命名）:
//   左: 左親指/左人差指/左中指/左薬指/左小指（各 3 节: 第一/第二/第三）
//   右: 右親指/右人差指/右中指/右薬指/右小指（各 3 节）
//   实际 PMX 骨骼名可能为「左親指０/左親指１/左親指２」等变体，
//   bake() 内 candidate 列表按优先级匹配，缺失则跳过

import type { MenuNode } from '@/menus/menu-schema';
import type { MotionModuleState, ParamValue } from '@/core/types';
import { setBoneOverride, clearBoneOverride } from '../bone-override';
import {
    registerModule,
    getModuleState,
    setModuleParam,
    claimBones,
    releaseOwnedBones,
} from './registry';
import type { MotionOverrideModule, ModuleMeta } from './types';

const MODULE_ID = 'finger-pose';

type FingerPreset = 'relax' | 'fist' | 'point' | 'peace' | 'rock';

/** 预设定义：每指弯曲度（0=伸直, 1=完全弯曲），顺序: 親指/人差指/中指/薬指/小指 */
const PRESETS: Record<FingerPreset, number[]> = {
    relax: [0.2, 0.3, 0.3, 0.3, 0.3], // 自然放松
    fist: [0.8, 1.0, 1.0, 1.0, 1.0], // 握拳
    point: [0.2, 0.0, 1.0, 1.0, 1.0], // 指向（食指伸直）
    peace: [0.2, 0.0, 0.0, 1.0, 1.0], // 剪刀手（食指+中指）
    rock: [0.2, 0.0, 1.0, 1.0, 0.0], // 摇滚（食指+小指）
};

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    preset: 'relax',
    // intensity: 整体弯曲强度倍率（0-1），允许用户微调预设效果
    intensity: 1,
};

const META: ModuleMeta = {
    labelKey: 'motion.override.module.fingerPose',
    icon: 'lucide:hand',
    defaults: DEFAULTS,
};

/** 手指基础名（不含 左/右 前缀） */
const FINGER_BASES = ['親指', '人差指', '中指', '薬指', '小指'];

/** 指骨节后缀（按优先级匹配，覆盖常见 PMX 命名变体） */
const PHALANX_SUFFIXES = ['０', '１', '２', '第一', '第二', '第三'];

/**
 * 生成所有候选骨骼名（左手 + 右手，各 5 指 × 多节）。
 * 实际烘焙时 claimBones 会跳过模型中不存在的骨骼。
 */
function buildCandidateBones(): string[] {
    const bones: string[] = [];
    for (const side of ['左', '右']) {
        for (const base of FINGER_BASES) {
            for (const suffix of PHALANX_SUFFIXES) {
                bones.push(`${side}${base}${suffix}`);
            }
        }
    }
    return bones;
}

const MANAGED_BONES = buildCandidateBones();

/** 烘焙：将预设写入指骨 */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    if (!state.enabled) {
        return;
    }
    const presetName = (state.params.preset as string) ?? 'relax';
    const intensity = (state.params.intensity as number) ?? 1;
    const preset = PRESETS[presetName as FingerPreset] ?? PRESETS.relax;

    const claimed = claimBones(modelId, MODULE_ID, MANAGED_BONES);
    if (claimed.length === 0) {
        return;
    }

    // 对每根手指的每节指骨写入弯曲角度
    // 弯曲角度 = preset[fingerIndex] * intensity * 90 度（pitch）
    for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
        const side = sideIdx === 0 ? '左' : '右';
        for (let fingerIdx = 0; fingerIdx < FINGER_BASES.length; fingerIdx++) {
            const base = FINGER_BASES[fingerIdx];
            const curl = preset[fingerIdx] * intensity;
            const pitchDeg = curl * 90; // 0=伸直, 90=完全弯曲
            // 对该手指的所有节指骨写入相同 pitch（简化模型）
            for (const suffix of PHALANX_SUFFIXES) {
                const boneName = `${side}${base}${suffix}`;
                if (claimed.includes(boneName)) {
                    setBoneOverride(boneName, [pitchDeg, 0, 0], 1, true, modelId);
                }
            }
        }
    }
}

/** 创建手指姿势模块实例 */
export function createFingerPoseModule(modelId: string): MotionOverrideModule {
    return {
        id: MODULE_ID,
        meta: META,
        priority: 3,
        managedBones: MANAGED_BONES,

        buildSchema(): MenuNode[] {
            return [
                {
                    id: 'finger-pose:preset',
                    kind: 'modeSlider',
                    label: 'motion.preset',
                    icon: 'lucide:list',
                    control: {
                        bind: `motionModule.${MODULE_ID}.preset`,
                        options: [
                            { value: 'relax', label: 'motion.fingerPreset.relax' },
                            { value: 'fist', label: 'motion.fingerPreset.fist' },
                            { value: 'point', label: 'motion.fingerPreset.point' },
                            { value: 'peace', label: 'motion.fingerPreset.peace' },
                            { value: 'rock', label: 'motion.fingerPreset.rock' },
                        ],
                        onChange: (v) => {
                            createFingerPoseModule(modelId).setParam('preset', v as string);
                        },
                    },
                },
                {
                    id: 'finger-pose:intensity',
                    kind: 'slider',
                    label: 'motion.intensity',
                    icon: 'lucide:gauge',
                    control: {
                        bind: `motionModule.${MODULE_ID}.intensity`,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: (v) => {
                            createFingerPoseModule(modelId).setParam('intensity', v as number);
                        },
                    },
                },
            ];
        },

        getState(): MotionModuleState {
            const state = getModuleState(modelId, MODULE_ID);
            return {
                id: MODULE_ID,
                enabled: state.enabled,
                params: { ...DEFAULTS, ...state.params },
            };
        },

        setState(s: MotionModuleState): void {
            const state = getModuleState(modelId, MODULE_ID);
            state.enabled = s.enabled;
            state.params = { ...s.params };
        },

        setParam(name: string, value: ParamValue): void {
            setModuleParam(modelId, MODULE_ID, name, value);
            const st = getModuleState(modelId, MODULE_ID);
            if (!st.enabled) {
                st.enabled = true;
            }
            bake(modelId);
        },

        enable(): void {
            const state = getModuleState(modelId, MODULE_ID);
            state.enabled = true;
            bake(modelId);
        },

        disable(): void {
            const state = getModuleState(modelId, MODULE_ID);
            state.enabled = false;
            const bones = releaseOwnedBones(modelId, MODULE_ID);
            for (const bone of bones) {
                clearBoneOverride(bone, modelId);
            }
        },
    };
}

/** 注册手指姿势模块 */
export function registerFingerPose(): void {
    registerModule(MODULE_ID, META, 3, createFingerPoseModule);
}
