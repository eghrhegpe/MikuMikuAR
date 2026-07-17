// [doc:adr-116] Position Offset Module — 位置偏移模块
// 职责: 将三轴位移参数（sideShift/vertShift/depthShift）烘焙为センター位置覆盖
// 从 body-posture 拆分而来，使「姿态」与「位置偏移」职责分离

import type { MenuNode } from '@/menus/menu-schema';
import type { MotionModuleState, ParamValue } from '@/core/types';
import { setBoneOverridePosition, clearBoneOverride } from '../bone-override';
import {
    registerModule,
    getModuleState,
    setModuleParam,
    claimBones,
    releaseOwnedBones,
} from './registry';
import type { MotionOverrideModule, ModuleMeta } from './types';

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
                            createPositionOffsetModule(modelId).setParam('sideShift', v as number);
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
                            createPositionOffsetModule(modelId).setParam('vertShift', v as number);
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
                            createPositionOffsetModule(modelId).setParam('depthShift', v as number);
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

/** 注册位置偏移模块 */
export function registerPositionOffset(): void {
    registerModule(MODULE_ID, META, 1, createPositionOffsetModule);
}
