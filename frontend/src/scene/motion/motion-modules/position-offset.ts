// [doc:adr-116] Position Offset Module — 位置偏移模块
// 职责: 将三轴位移参数（sideShift/vertShift/depthShift）烘焙为センター位置覆盖
// 从 body-posture 拆分而来，使「姿态」与「位置偏移」职责分离

import type { MenuNode } from '@/menus/menu-schema';
import type { ParamValue } from '@/core/types';
import { setBoneOverridePosition } from '../bone-override';
import { registerModule, getModuleState, claimBones } from './registry';
import type { MotionOverrideModule, ModuleMeta } from './types';
import { createModuleBase } from './module-base';

const MODULE_ID = 'position-offset';

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    sideShift: 0, // センター position.x: -50~50（左右）
    vertShift: 0, // センター position.y: -50~50（上下）
    depthShift: 0, // センター position.z: -50~50（前后）
};

/** 模块元信息 */
const META: ModuleMeta = {
    labelKey: 'motion.override.module.positionOffset',
    icon: 'lucide:move',
    defaults: DEFAULTS,
};

/** 管理的骨骼 */
const MANAGED_BONES = ['センター'];

/** 烘焙：将三轴位移写入引擎 */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    if (!state.enabled) {
        return;
    }
    const side = (state.params.sideShift as number) ?? 0;
    const vert = (state.params.vertShift as number) ?? 0;
    const depth = (state.params.depthShift as number) ?? 0;

    const claimed = claimBones(modelId, MODULE_ID, MANAGED_BONES);
    if (claimed.includes('センター')) {
        setBoneOverridePosition('センター', [side, vert, depth], 1, true, modelId);
    }
}

/** 创建位置偏移模块实例 */
export function createPositionOffsetModule(modelId: string): MotionOverrideModule {
    const base = createModuleBase(modelId, MODULE_ID, DEFAULTS, bake);
    return {
        id: MODULE_ID,
        meta: META,
        priority: 1,
        managedBones: MANAGED_BONES,

        buildSchema(): MenuNode[] {
            return [
                {
                    id: 'position-offset:sideShift',
                    kind: 'slider',
                    label: 'param.sideShift',
                    icon: 'lucide:arrow-left-right',
                    control: {
                        bind: `motionModule.${MODULE_ID}.sideShift`,
                        min: -50,
                        max: 50,
                        step: 1,
                        onChange: (v) => {
                            base.setParam('sideShift', v as number);
                        },
                    },
                },
                {
                    id: 'position-offset:vertShift',
                    kind: 'slider',
                    label: 'param.vertShift',
                    icon: 'lucide:arrow-up',
                    control: {
                        bind: `motionModule.${MODULE_ID}.vertShift`,
                        min: -50,
                        max: 50,
                        step: 1,
                        onChange: (v) => {
                            base.setParam('vertShift', v as number);
                        },
                    },
                },
                {
                    id: 'position-offset:depthShift',
                    kind: 'slider',
                    label: 'param.depthShift',
                    icon: 'lucide:arrow-right',
                    control: {
                        bind: `motionModule.${MODULE_ID}.depthShift`,
                        min: -50,
                        max: 50,
                        step: 1,
                        onChange: (v) => {
                            base.setParam('depthShift', v as number);
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

/** 注册位置偏移模块 */
export function registerPositionOffset(): void {
    registerModule(MODULE_ID, META, 1, createPositionOffsetModule);
}
