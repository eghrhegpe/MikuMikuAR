// [doc:adr-116] Head Tracking Module — 头部追踪模块
// 职责: 作为 perception 层 head tracking 的 per-model 语义封装
// 关键约束（ADR §一/§三/§七）: 走 perception 通道而非 bone override，
//   不写 _overrideMap，不写 首/頭/head 骨骼的 rotationQuaternion；
//   enable/disable 联动 perceptionState.headTrackingEnabled；
//   细粒度参数（目标角色/范围/距离/权重）走模块层状态存储，预留 P3 接入 perception-gaze 配置
//
// 与 perception 层的关系:
//   - perceptionState.headTrackingEnabled 是全局开关（per-model 切换时通过本模块联动）
//   - 模块参数（targetModel/range/minDist/maxDist/weight）存储在 ModelInstance.motionOverrideModules
//   - 实际 gaze 行为由 perception-gaze.ts 实现，本模块仅做开关联动 + 参数持久化

import type { MenuNode } from '@/menus/menu-schema';
import type { MotionModuleState, ParamValue } from '@/core/types';
import { setHeadTrackingEnabled } from '../perception';
import { registerModule, getModuleState, setModuleParam } from './registry';
import type { MotionOverrideModule, ModuleMeta } from './types';

const MODULE_ID = 'head-tracking';

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    // targetModel: 目标角色 ID（空字符串=跟随相机，现有 perception 默认行为）
    targetModel: '',
    // range: 头部跟随角度范围（度，0-90），预留 P3 接入 perception-gaze 的 maxYaw/maxPitch
    range: 75,
    // minDist: 最小跟随距离（米），预留 P3
    minDist: 0.5,
    // maxDist: 最大跟随距离（米），预留 P3
    maxDist: 10,
    // weight: 跟随权重（0-1），预留 P3
    weight: 1,
};

/** 模块元信息 */
const META: ModuleMeta = {
    labelKey: 'motion.override.module.headTracking',
    icon: 'lucide:eye',
    defaults: DEFAULTS,
};

/**
 * 头部追踪模块不写 bone override，因此 managedBones 为空。
 * ADR §三: 「若将来头部追踪模块需写 head 骨骼，应走 perception 层通道（gaze 覆写方式），不走 bone override」
 */
const MANAGED_BONES: string[] = [];

/** 烘焙：联动 perception 层（无 bone override 写入） */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    if (state.enabled) {
        // 启用 perception head tracking（全局开关，per-model 切换时由 setTargetModel 联动）
        setHeadTrackingEnabled(true);
    }
    // 注意：禁用时不在此处调用 setHeadTrackingEnabled(false)，由 disable() 负责
    // 避免烘焙路径与 disable 路径重复调用导致状态不一致
}

/** 创建头部追踪模块实例 */
export function createHeadTrackingModule(modelId: string): MotionOverrideModule {
    return {
        id: MODULE_ID,
        meta: META,
        priority: 2,
        managedBones: MANAGED_BONES,

        buildSchema(): MenuNode[] {
            return [
                {
                    id: 'head-tracking:range',
                    kind: 'slider',
                    label: 'param.detectRange',
                    icon: 'lucide:move-horizontal',
                    control: {
                        bind: `motionModule.${MODULE_ID}.range`,
                        min: 0,
                        max: 90,
                        step: 1,
                        onChange: (v) => {
                            createHeadTrackingModule(modelId).setParam('range', v as number);
                        },
                    },
                },
                {
                    id: 'head-tracking:minDist',
                    kind: 'slider',
                    label: 'param.minDist',
                    icon: 'lucide:zoom-in',
                    control: {
                        bind: `motionModule.${MODULE_ID}.minDist`,
                        min: 0.1,
                        max: 5,
                        step: 0.1,
                        onChange: (v) => {
                            createHeadTrackingModule(modelId).setParam('minDist', v as number);
                        },
                    },
                },
                {
                    id: 'head-tracking:maxDist',
                    kind: 'slider',
                    label: 'param.maxDist',
                    icon: 'lucide:zoom-out',
                    control: {
                        bind: `motionModule.${MODULE_ID}.maxDist`,
                        min: 1,
                        max: 50,
                        step: 1,
                        onChange: (v) => {
                            createHeadTrackingModule(modelId).setParam('maxDist', v as number);
                        },
                    },
                },
                {
                    id: 'head-tracking:weight',
                    kind: 'slider',
                    label: 'motion.weight',
                    icon: 'lucide:scale',
                    control: {
                        bind: `motionModule.${MODULE_ID}.weight`,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: (v) => {
                            createHeadTrackingModule(modelId).setParam('weight', v as number);
                        },
                    },
                },
                // [doc:adr-116] TODO P3: 目标角色选择器（select 子页）需读 modelRegistry 生成选项，
                // 当前 perception 默认跟随相机，targetModel 留空即沿用默认行为
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
                st.enabled = true; // 拖滑块即视为启用意图（VRChat 行为）
            }
            bake(modelId);
        },

        enable(): void {
            const state = getModuleState(modelId, MODULE_ID);
            state.enabled = true;
            setHeadTrackingEnabled(true);
        },

        disable(): void {
            const state = getModuleState(modelId, MODULE_ID);
            state.enabled = false;
            setHeadTrackingEnabled(false);
            // 无 ownedBones 需要释放（本模块不写 bone override）
        },
    };
}

/** 注册头部追踪模块 */
export function registerHeadTracking(): void {
    registerModule(MODULE_ID, META, 2, createHeadTrackingModule);
}
