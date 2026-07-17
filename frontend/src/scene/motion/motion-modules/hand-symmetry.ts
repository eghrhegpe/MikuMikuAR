// [doc:adr-116] Hand Symmetry Module — 手对称模块
// 职责: 左手设值 → 右手自动镜像（Pitch/Roll 取反，Yaw 保持 + 偏移）
// 镜像规则: R:[-p, y+offset, -r]

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

const MODULE_ID = 'hand-symmetry';

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    wristYaw: 0, // 左腕 yaw: -90~90
    wristRoll: 0, // 左腕 roll: -90~90
    elbowBend: 0, // 左ひじ pitch: -135~0
    mirrorOffset: 0, // 右腕额外 yaw 偏移: -45~45
};

/** 模块元信息（注册用，与实例 meta 同源） */
const META: ModuleMeta = {
    labelKey: 'motion.override.module.handSymmetry',
    icon: 'lucide:hand',
    defaults: DEFAULTS,
};

/** 管理的骨骼（左+右） */
const MANAGED_BONES = ['左腕', '右腕', '左ひじ', '右ひじ'];

/** 烘焙：左手设值 → 右手镜像（仅 enabled 时生效，通过 claimBones 仲裁冲突） */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    if (!state.enabled) {
        return; // 门控：未启用时不烘焙（P1-2 修复）
    }
    const wristYaw = (state.params.wristYaw as number) ?? 0;
    const wristRoll = (state.params.wristRoll as number) ?? 0;
    const elbowBend = (state.params.elbowBend as number) ?? 0;
    const mirrorOffset = (state.params.mirrorOffset as number) ?? 0;

    // 声明骨骼所有权（已被其他模块占用的骨骼会被跳过并 warn）
    const claimed = claimBones(modelId, MODULE_ID, MANAGED_BONES);

    // 左手：直接设值
    if (claimed.includes('左腕')) {
        setBoneOverride('左腕', [0, wristYaw, wristRoll], 1, true, modelId);
    }
    if (claimed.includes('左ひじ')) {
        setBoneOverride('左ひじ', [elbowBend, 0, 0], 1, true, modelId);
    }

    // 右手：镜像（Pitch 取反, Yaw 保持+偏移, Roll 取反）
    if (claimed.includes('右腕')) {
        setBoneOverride('右腕', [0, wristYaw + mirrorOffset, -wristRoll], 1, true, modelId);
    }
    if (claimed.includes('右ひじ')) {
        setBoneOverride('右ひじ', [-elbowBend, 0, 0], 1, true, modelId);
    }
}

/** 创建手对称模块实例 */
export function createHandSymmetryModule(modelId: string): MotionOverrideModule {
    return {
        id: MODULE_ID,
        meta: META,
        priority: 1,
        managedBones: MANAGED_BONES,

        buildSchema(): MenuNode[] {
            return [
                {
                    id: 'hand-symmetry:wristYaw',
                    kind: 'slider',
                    label: 'param.wristYaw',
                    icon: 'lucide:move-horizontal',
                    control: {
                        bind: `motionModule.${MODULE_ID}.wristYaw`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => {
                            createHandSymmetryModule(modelId).setParam('wristYaw', v as number);
                        },
                    },
                },
                {
                    id: 'hand-symmetry:wristRoll',
                    kind: 'slider',
                    label: 'param.wristRoll',
                    icon: 'lucide:rotate-cw',
                    control: {
                        bind: `motionModule.${MODULE_ID}.wristRoll`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => {
                            createHandSymmetryModule(modelId).setParam('wristRoll', v as number);
                        },
                    },
                },
                {
                    id: 'hand-symmetry:elbowBend',
                    kind: 'slider',
                    label: 'param.elbowBend',
                    icon: 'lucide:arm-flex',
                    control: {
                        bind: `motionModule.${MODULE_ID}.elbowBend`,
                        min: -135,
                        max: 0,
                        step: 1,
                        onChange: (v) => {
                            createHandSymmetryModule(modelId).setParam('elbowBend', v as number);
                        },
                    },
                },
                {
                    id: 'hand-symmetry:mirrorOffset',
                    kind: 'slider',
                    label: 'param.mirrorOffset',
                    icon: 'lucide:flip-horizontal',
                    control: {
                        bind: `motionModule.${MODULE_ID}.mirrorOffset`,
                        min: -45,
                        max: 45,
                        step: 1,
                        onChange: (v) => {
                            createHandSymmetryModule(modelId).setParam('mirrorOffset', v as number);
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
                st.enabled = true; // 拖滑块即视为启用意图（VRChat 行为，P1-2 修复）
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
            // 仅清自有 ownedBones，不误伤用户手动覆盖（P2-1 修复）
            const bones = releaseOwnedBones(modelId, MODULE_ID);
            for (const bone of bones) {
                clearBoneOverride(bone, modelId);
            }
        },
    };
}

/** 注册手对称模块 */
export function registerHandSymmetry(): void {
    registerModule(MODULE_ID, META, 1, createHandSymmetryModule);
}
