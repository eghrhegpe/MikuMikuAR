// [doc:adr-085/116] Feet Adjustment Module — 将脚部地面跟随接入动作覆盖模块体系
// 职责: 把 ADR-085 的脚部 IK 约束封装为 MotionOverrideModule，使其出现在「动作覆盖」模块列表、
//       可纳入动作预设(ADR-145)、参与模块撤销/重做(ADR-125)与骨骼冲突仲裁。
// 引擎读取: scene.ts 的 startFeetAdjustment provider 通过 getFeetStateForModel 从模块状态
//           (随动作走, ADR-129) 构建 FeetState 喂给 feet-adjustment.ts；本模块只负责状态的
//           enable/disable/setParam 写入（写入路径与 body-posture 等 6 模块一致：per-motion intent）。
// 注意: 脚部 IK 由 feet-adjustment.ts 每帧直接驱动左/右足IK 世界坐标 + ikSolver.solve 重解，
//       不经 BoneOverrideStore 写引擎 slot；MANAGED_BONES 仅用于冲突可见性(claimBones 登记所有权)。

import type { ParamValue, FeetState } from '@/core/types';
import type { MotionOverrideModule, ModuleMeta, ModuleDef } from './types';
import { createModuleBase, createModuleShell, prepareBake } from './module-base';
import { createDefaultFeetState } from '@/core/state';
import { getActiveMotion } from '../motion-intent';

const MODULE_ID = 'feet-adjustment';

/** 模块参数默认值（来自 FeetState Phase A 引擎读取字段；不含 bodySmooth/Phase B 字段） */
const DEFAULTS: Record<string, ParamValue> = {
    intensity: 1,
    soleHeight: 0,
    jumpThreshold: 0.5,
    footSmooth: 0.5,
    maxAngle: 30,
    reachAngle: 15,
};

const META: ModuleMeta = {
    labelKey: 'motion.override.module.feetAdjustment',
    icon: 'lucide:footprints',
    defaults: DEFAULTS,
};

/**
 * 声明拥有的骨骼（仅用于冲突可见性 / 冲突 banner 展示）。
 * 注意：脚 IK 每帧由 feet-adjustment.ts 引擎直写 左/右足IK 世界坐标 + ikSolver.solve 重解，
 * 实际优先级恒为「脚 IK 胜出」，不服从 BoneOverrideStore 的 claimBones 优先级仲裁。
 * 因此 claimBones 仅让用户在手动 Override 同骨时看到冲突提示，但手动覆盖运行时会被脚 IK 覆盖。
 * 这是 ADR-085 的设计（脚必须贴地），非可达成的抢占。
 */
const MANAGED_BONES = ['左足IK', '右足IK'];

/**
 * 从模块状态(随动作走, ADR-129)只读构建 FeetState，供 scene.ts 的 feet-adjustment provider 使用。
 * 只读：不调用 findOrCreate，避免渲染循环每帧 mutate intent。
 */
export function getFeetStateForModel(modelId: string): FeetState {
    const def = createDefaultFeetState();
    const intent = getActiveMotion();
    if (!intent?.motionModules) {
        return { ...def, enabled: false };
    }
    const entry = intent.motionModules.find((m) => m.id === MODULE_ID);
    if (!entry) {
        return { ...def, enabled: false };
    }
    // 参数类型安全收敛：schema 仅写入 number，但若存档/反序列化误带非 number 值，
    // 退回默认值而非静默误用（NaN/string）。不使用 `Number(v) ?? def`，因 Number(undefined) 为 NaN 且 ?? 不兜底。
    const num = (v: ParamValue | undefined, d: number): number =>
        typeof v === 'number' ? v : d;
    return {
        enabled: entry.enabled,
        intensity: num(entry.params.intensity, def.intensity),
        soleHeight: num(entry.params.soleHeight, def.soleHeight),
        jumpThreshold: num(entry.params.jumpThreshold, def.jumpThreshold),
        bodySmooth: def.bodySmooth,
        footSmooth: num(entry.params.footSmooth, def.footSmooth),
        maxAngle: num(entry.params.maxAngle, def.maxAngle),
        reachAngle: num(entry.params.reachAngle, def.reachAngle),
    };
}

/** 烘焙：声明骨骼所有权(仅冲突可见性)，脚部 IK 由引擎每帧重解，无需此处写骨 */
function bake(modelId: string): void {
    const prep = prepareBake(modelId, MODULE_ID, MANAGED_BONES);
    if (!prep) {
        return;
    }
    // claimed 已在 prepareBake 内登记；脚 IK 实际由 feet-adjustment.ts 驱动
    void prep;
}

/** 创建脚部调整模块实例 */
export function createFeetAdjustmentModule(modelId: string): MotionOverrideModule {
    const base = createModuleBase(modelId, MODULE_ID, DEFAULTS, bake);
    return createModuleShell({
        id: MODULE_ID,
        meta: META,
        priority: 8,
        managedBones: MANAGED_BONES,

        buildSchema: () => [
            {
                id: 'feet-adjustment:intensity',
                kind: 'slider',
                label: 'motion.feet.intensity',
                icon: 'lucide:gauge',
                control: {
                    bind: `motionModule.${MODULE_ID}.intensity`,
                    min: 0,
                    max: 1,
                    step: 0.05,
                    onChange: (v) => base.setParam('intensity', v as number),
                },
            },
            {
                id: 'feet-adjustment:soleHeight',
                kind: 'slider',
                label: 'motion.feet.soleHeight',
                icon: 'lucide:ruler',
                control: {
                    bind: `motionModule.${MODULE_ID}.soleHeight`,
                    min: -0.1,
                    max: 0.1,
                    step: 0.01,
                    onChange: (v) => base.setParam('soleHeight', v as number),
                },
            },
            {
                id: 'feet-adjustment:jumpThreshold',
                kind: 'slider',
                label: 'motion.feet.jumpThreshold',
                icon: 'lucide:arrow-up-from-line',
                control: {
                    bind: `motionModule.${MODULE_ID}.jumpThreshold`,
                    min: 0.1,
                    max: 2,
                    step: 0.05,
                    onChange: (v) => base.setParam('jumpThreshold', v as number),
                },
            },
            {
                id: 'feet-adjustment:footSmooth',
                kind: 'slider',
                label: 'motion.feet.footSmooth',
                icon: 'lucide:wind',
                control: {
                    bind: `motionModule.${MODULE_ID}.footSmooth`,
                    min: 0,
                    max: 1,
                    step: 0.05,
                    onChange: (v) => base.setParam('footSmooth', v as number),
                },
            },
            {
                id: 'feet-adjustment:maxAngle',
                kind: 'slider',
                label: 'motion.feet.maxAngle',
                icon: 'lucide:compass',
                control: {
                    bind: `motionModule.${MODULE_ID}.maxAngle`,
                    min: 0,
                    max: 60,
                    step: 1,
                    onChange: (v) => base.setParam('maxAngle', v as number),
                },
            },
            {
                id: 'feet-adjustment:reachAngle',
                kind: 'slider',
                label: 'motion.feet.reachAngle',
                icon: 'lucide:move-vertical',
                control: {
                    bind: `motionModule.${MODULE_ID}.reachAngle`,
                    min: 0,
                    max: 45,
                    step: 1,
                    onChange: (v) => base.setParam('reachAngle', v as number),
                },
            },
        ],

        base,
    });
}

/** 脚部调整模块注册定义（供 registry BUILTIN_MODULE_DEFS 批量注册） */
export const FEET_ADJUSTMENT_DEF: ModuleDef = {
    id: MODULE_ID,
    meta: META,
    priority: 8,
    factory: createFeetAdjustmentModule,
};
