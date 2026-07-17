// [doc:adr-116] Body Posture Module — 身体姿态模块
// 职责: 将语义参数（倾斜/弯曲/扭曲）烘焙为上半身骨骼旋转覆盖
// P2 位置覆盖已拆分为独立 position-offset 模块

import type { MenuNode } from '@/menus/menu-schema';
import type { ParamValue } from '@/core/types';
import { setBoneOverride } from '../bone-override';
import {
    registerModule,
    getModuleState,
    claimBones,
} from './registry';
import type { MotionOverrideModule, ModuleMeta } from './types';
import { createModuleBase } from './module-base';

const MODULE_ID = 'body-posture';

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    tilt: 0, // 上半身 pitch: -15~15
    bend: 0, // 上半身 pitch（与 tilt 累加）: -30~30
    twist: 0, // 上半身2 yaw: -30~30
};

/** 模块元信息（注册用，与实例 meta 同源） */
const META: ModuleMeta = {
    labelKey: 'motion.override.module.bodyPosture',
    icon: 'lucide:user',
    defaults: DEFAULTS,
};

/** 管理的骨骼（旋转骨。不加 腰，避免 WASM 传播带动腿骨旋转） */
const MANAGED_BONES = ['上半身', '上半身2'];

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
        // tilt + bend 合并为上半身总俯仰角（避免操作 腰 带动腿骨旋转）
        setBoneOverride('上半身', [tilt + bend, 0, 0], 1, true, modelId);
    }
    if (claimed.includes('上半身2')) {
        setBoneOverride('上半身2', [0, twist, 0], 1, true, modelId);
    }
    // 注：センター位置偏移已拆分到独立 position-offset 模块
}

/** 创建身体姿态模块实例 */
export function createBodyPostureModule(modelId: string): MotionOverrideModule {
    const base = createModuleBase(modelId, MODULE_ID, DEFAULTS, bake);
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
                            base.setParam('tilt', v as number);
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
                            base.setParam('bend', v as number);
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
                            base.setParam('twist', v as number);
                        },
                    },
                },
            ];
        },

        getState: base.getState,
        setState: base.setState,
        setParam: base.setParam,
        enable: base.enable,
        disable: base.disable,
    };
}

/** 注册身体姿态模块 */
export function registerBodyPosture(): void {
    registerModule(MODULE_ID, META, 1, createBodyPostureModule);
}
