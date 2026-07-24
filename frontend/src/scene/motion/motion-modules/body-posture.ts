// [doc:adr-116] Body Posture Module — 身体姿态模块
// 职责: 将语义参数烘焙为骨骼覆盖
//   - 倾斜/弯曲/扭曲 → 上半身/上半身2 旋转覆盖（静态 bake）
//   - 身体高度/身体前后 → センター 位置偏移（帧钩子每帧驱动，世界空间）
// 脚不动机制: 脚 IK 目标（左足IK/右足IK）由 feet-adjustment 引擎每帧钉死在地面（世界坐标），
//   センター 是「脚 IK 目标之上、整个躯干+髋部之父」，平移它 → 髋部/躯干移动而脚原地，
//   腿部 IK 自动重解弯曲 → 下蹲（高度↓）/ 跪姿·后躺（前后）。位置覆盖不写旋转，
//   故无 WASM 旋转传播带动腿骨之虞（与原「不加 腰」注释针对的旋转场景不同）。

import type { ParamValue } from '@/core/types';
import { modelRegistry } from '@/core/state';
import {
    setBoneOverride,
    setBoneOverridePosition,
    registerBoneOverrideFrameHook,
    FRAME_HOOK_ORDER,
} from '../bone-override';
import { matchBone, BONE_CENTER_CANDIDATES } from '@/motion-algos/proc-motion-shared';
import { getModuleState } from './registry';
import type { MotionOverrideModule, ModuleMeta, ModuleDef } from './types';
import {
    createModuleBase,
    createModuleShell,
    prepareBake,
    createFrameHookManager,
} from './module-base';

const MODULE_ID = 'body-posture';

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    tilt: 0, // 上半身 pitch: -15~15
    bend: 0, // 上半身 pitch（与 tilt 累加）: -30~30
    twist: 0, // 上半身2 yaw: -30~30
    bodyHeight: 0, // センター Y 偏移（世界空间）: 负值下蹲
    bodyDepth: 0, // センター Z 偏移（世界空间）: 正值前移跪姿，负值后躺
};

/** 模块元信息（注册用，与实例 meta 同源） */
const META: ModuleMeta = {
    labelKey: 'motion.override.module.bodyPosture',
    icon: 'lucide:user',
    defaults: DEFAULTS,
};

/**
 * 管理的骨骼：
 * - 上半身/上半身2：旋转骨（tilt/bend/twist）。不加 腰，避免 WASM 旋转传播带动腿骨。
 * - センター：仅位置偏移（bodyHeight/bodyDepth），不写旋转，故不触发上述传播问题。
 */
const MANAGED_BONES = ['上半身', '上半身2', 'センター'];

// ── 帧钩子管理器 + センター 骨名缓存（per-model）──

const _bodyFrameHooks = createFrameHookManager();
const _centerBoneCache = new Map<string, string | null>();

/** 烘焙：将旋转语义参数写入引擎（仅 enabled 时生效，通过 claimBones 仲裁冲突） */
function bake(modelId: string): void {
    const prep = prepareBake(modelId, MODULE_ID, MANAGED_BONES);
    if (!prep) {
        return; // 门控：未启用时不烘焙（P1-2 修复）
    }
    const { state, claimed } = prep;
    const tilt = (state.params.tilt as number) ?? 0;
    const bend = (state.params.bend as number) ?? 0;
    const twist = (state.params.twist as number) ?? 0;

    if (claimed.includes('上半身')) {
        // tilt + bend 合并为上半身总俯仰角（避免操作 腰 带动腿骨旋转）
        setBoneOverride('上半身', [tilt + bend, 0, 0], 1, true, modelId);
    }
    if (claimed.includes('上半身2')) {
        setBoneOverride('上半身2', [0, twist, 0], 1, true, modelId);
    }
    // センター 位置偏移由帧钩子驱动（每帧重写，供 feet-adjustment 在其后补偿贴地）
}

/** 解析并缓存模型的 センター 骨名（首次惰性匹配） */
function _resolveCenterBone(modelId: string): string | null {
    if (_centerBoneCache.has(modelId)) {
        return _centerBoneCache.get(modelId) ?? null;
    }
    const inst = modelRegistry.get(modelId);
    const bones = inst?.mmdModel?.runtimeBones;
    const name = bones?.length
        ? matchBone(
              bones.map((b) => b.name),
              BONE_CENTER_CANDIDATES
          )
        : null;
    _centerBoneCache.set(modelId, name);
    return name;
}

/** 启用时注册帧钩子，每帧写入 センター 位置偏移（在 feet-adjustment 之前执行） */
function ensureActive(modelId: string): void {
    if (_bodyFrameHooks.has(modelId)) {
        return;
    }
    bake(modelId);

    const unregister = registerBoneOverrideFrameHook((_t, mid) => {
        if (mid !== modelId) {
            return;
        }
        const st = getModuleState(modelId, MODULE_ID);
        if (!st.enabled) {
            return;
        }
        const height = (st.params.bodyHeight as number) ?? 0;
        const depth = (st.params.bodyDepth as number) ?? 0;
        if (height === 0 && depth === 0) {
            return;
        }
        const centerName = _resolveCenterBone(modelId);
        if (!centerName) {
            return;
        }
        // 世界空间偏移：X 不动，Y=高度，Z=前后
        setBoneOverridePosition(centerName, [0, height, depth], 1, true, modelId);
    }, FRAME_HOOK_ORDER.BODY_POSITION);
    _bodyFrameHooks.set(modelId, unregister);
}

/** 创建身体姿态模块实例 */
export function createBodyPostureModule(modelId: string): MotionOverrideModule {
    const base = createModuleBase(modelId, MODULE_ID, DEFAULTS, bake, {
        action: ensureActive,
        onDisable: (mid) => {
            _bodyFrameHooks.unregister(mid);
        },
    });
    return createModuleShell({
        id: MODULE_ID,
        meta: META,
        priority: 1,
        managedBones: MANAGED_BONES,

        buildSchema: () => {
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
                // ── 身体位置偏移（センター 平移，脚 IK 不动）──
                {
                    id: 'body-posture:bodyPosSection',
                    kind: 'sectionTitle',
                    label: 'section.bodyPosition',
                },
                {
                    id: 'body-posture:bodyHeight',
                    kind: 'slider',
                    label: 'param.bodyHeight',
                    icon: 'lucide:move-vertical',
                    control: {
                        bind: `motionModule.${MODULE_ID}.bodyHeight`,
                        min: -12,
                        max: 4,
                        step: 0.1,
                        onChange: (v) => {
                            base.setParam('bodyHeight', v as number);
                        },
                    },
                },
                {
                    id: 'body-posture:bodyDepth',
                    kind: 'slider',
                    label: 'param.bodyDepth',
                    icon: 'lucide:move-horizontal',
                    control: {
                        bind: `motionModule.${MODULE_ID}.bodyDepth`,
                        min: -12,
                        max: 12,
                        step: 0.1,
                        onChange: (v) => {
                            base.setParam('bodyDepth', v as number);
                        },
                    },
                },
            ];
        },

        base,
    });
}

/** 身体姿态模块注册定义（供 registry BUILTIN_MODULE_DEFS 批量注册） */
export const BODY_POSTURE_DEF: ModuleDef = {
    id: MODULE_ID,
    meta: META,
    priority: 1,
    factory: createBodyPostureModule,
};
