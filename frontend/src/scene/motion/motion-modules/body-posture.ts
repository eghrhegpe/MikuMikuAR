// [doc:adr-116] Body Posture Module — 身体姿态模块
// 职责: 将语义参数（倾斜/弯曲/扭曲）烘焙为上半身骨骼覆盖
// P1 阶段仅支持旋转覆盖；height/fwdBack 需 P2 引擎扩展 position override

import type { MenuNode } from '@/menus/menu-schema';
import type { MotionModuleState, ParamValue } from '@/core/types';
import { setBoneOverride, clearBoneOverride } from '../bone-override';
import { registerModule, getModuleState, setModuleParam } from './registry';
import type { MotionOverrideModule } from './types';

const MODULE_ID = 'body-posture';

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    tilt: 0, // 上半身 pitch: -15~15
    bend: 0, // 腰 pitch: -30~30
    twist: 0, // 上半身2 yaw: -30~30
};

/** 管理的骨骼 */
const MANAGED_BONES = ['上半身', '腰', '上半身2'];

/** 烘焙：将语义参数写入引擎 */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    const tilt = (state.params.tilt as number) ?? 0;
    const bend = (state.params.bend as number) ?? 0;
    const twist = (state.params.twist as number) ?? 0;

    setBoneOverride('上半身', [tilt, 0, 0], 1, true, modelId);
    setBoneOverride('腰', [bend, 0, 0], 1, true, modelId);
    setBoneOverride('上半身2', [0, twist, 0], 1, true, modelId);
}

/** 创建身体姿态模块实例 */
export function createBodyPostureModule(modelId: string): MotionOverrideModule {
    return {
        id: MODULE_ID,
        meta: {
            labelKey: 'motion.override.module.bodyPosture',
            icon: 'lucide:user',
        },
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
                            setModuleParam(modelId, MODULE_ID, 'tilt', v as number);
                            bake(modelId);
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
                            setModuleParam(modelId, MODULE_ID, 'bend', v as number);
                            bake(modelId);
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
                            setModuleParam(modelId, MODULE_ID, 'twist', v as number);
                            bake(modelId);
                        },
                    },
                },
            ];
        },

        getState(): MotionModuleState {
            const state = getModuleState(modelId, MODULE_ID);
            // 合并默认值
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
            // 重新烘焙（仅烘焙变更的分量即可，但全量烘焙更安全且性能足够）
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
            for (const bone of MANAGED_BONES) {
                clearBoneOverride(bone, modelId);
            }
        },
    };
}

/** 注册身体姿态模块 */
export function registerBodyPosture(): void {
    registerModule(
        MODULE_ID,
        { labelKey: 'motion.override.module.bodyPosture', icon: 'lucide:user' },
        1,
        createBodyPostureModule
    );
}
