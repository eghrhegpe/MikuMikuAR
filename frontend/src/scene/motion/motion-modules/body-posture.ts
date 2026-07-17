// [doc:adr-116] Body Posture Module — 身体姿态模块
// 职责: 将语义参数（倾斜/弯曲/扭曲）烘焙为上半身骨骼覆盖
// P1 阶段仅支持旋转覆盖；height/fwdBack 需 P2 引擎扩展 position override

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

const MODULE_ID = 'body-posture';

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    tilt: 0, // 上半身 pitch: -15~15
    bend: 0, // 腰 pitch: -30~30
    twist: 0, // 上半身2 yaw: -30~30
};

/** 模块元信息（注册用，与实例 meta 同源） */
const META: ModuleMeta = {
    labelKey: 'motion.override.module.bodyPosture',
    icon: 'lucide:user',
    defaults: DEFAULTS,
};

/** 管理的骨骼 */
const MANAGED_BONES = ['上半身', '腰', '上半身2'];

/** 烘焙：将语义参数写入引擎（仅 enabled 时生效，通过 claimBones 仲裁冲突） */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    if (!state.enabled) {
        return; // 门控：未启用时不烘焙（P1-2 修复）
    }
    const tilt = (state.params.tilt as number) ?? 0;
    const bend = (state.params.bend as number) ?? 0;
    const twist = (state.params.twist as number) ?? 0;

    // 声明骨骼所有权（已被其他模块占用的骨骼会被跳过并 warn）
    const claimed = claimBones(modelId, MODULE_ID, MANAGED_BONES);
    if (claimed.includes('上半身')) {
        setBoneOverride('上半身', [tilt, 0, 0], 1, true, modelId);
    }
    if (claimed.includes('腰')) {
        setBoneOverride('腰', [bend, 0, 0], 1, true, modelId);
    }
    if (claimed.includes('上半身2')) {
        setBoneOverride('上半身2', [0, twist, 0], 1, true, modelId);
    }
}

/** 创建身体姿态模块实例 */
export function createBodyPostureModule(modelId: string): MotionOverrideModule {
    return {
        id: MODULE_ID,
        meta: META,
        priority: 1,
        managedBones: MANAGED_BONES,

        buildSchema(): MenuNode[] {
            return [
                {
                    id: 'body-posture:tilt',
                    kind: 'slider',
                    label: 'param.tilt',
                    icon: 'lucide:move',
                    control: {
                        bind: `motionModule.${MODULE_ID}.tilt`,
                        min: -15,
                        max: 15,
                        step: 0.5,
                        onChange: (v) => {
                            // 走 setParam：enabled 门控 + 拖滑块自动 enable（VRChat 行为）
                            createBodyPostureModule(modelId).setParam('tilt', v as number);
                        },
                    },
                },
                {
                    id: 'body-posture:bend',
                    kind: 'slider',
                    label: 'param.bend',
                    icon: 'lucide:arrow-down-up',
                    control: {
                        bind: `motionModule.${MODULE_ID}.bend`,
                        min: -30,
                        max: 30,
                        step: 0.5,
                        onChange: (v) => {
                            createBodyPostureModule(modelId).setParam('bend', v as number);
                        },
                    },
                },
                {
                    id: 'body-posture:twist',
                    kind: 'slider',
                    label: 'param.twist',
                    icon: 'lucide:rotate-cw',
                    control: {
                        bind: `motionModule.${MODULE_ID}.twist`,
                        min: -30,
                        max: 30,
                        step: 0.5,
                        onChange: (v) => {
                            createBodyPostureModule(modelId).setParam('twist', v as number);
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

/** 注册身体姿态模块 */
export function registerBodyPosture(): void {
    registerModule(MODULE_ID, META, 1, createBodyPostureModule);
}
