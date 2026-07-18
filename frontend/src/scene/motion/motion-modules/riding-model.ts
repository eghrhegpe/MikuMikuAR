// [doc:adr-116] Riding Model Module — 骑行模型模块
// 职责: 模拟骑行姿态（自行车/摩托车/马匹），调整腰+腿+足骨骼
// 优先级 P3=3
//
// 参数:
//   - preset: 骑行类型（'bicycle'|'motorcycle'|'horse'）
//   - saddleHeight: 鞍高（0-1，相对腿长的比例），决定膝盖弯曲程度
//   - pedalAngle: 静止踏板相位（0-360 度），autoPedal 关闭时决定左右脚姿态
//   - autoPedal: true=踏板自动循环（pedalSpeed 驱动，P3 已落地），false=静态 pedalAngle
//   - pedalSpeed: 踏板循环速度（Hz，0.1-2）
//
// 骨骼映射:
//   - 腰: 前倾角度（bicycle=20°, motorcycle=10°, horse=5°）
//   - 腿: 左ひざ/右ひざ 膝盖弯曲（saddleHeight 越高弯曲越小）
//   - 足: 左足/右足 踏板位置（autoPedal 时由每帧钩子按 pedalSpeed 循环驱动，否则用 pedalAngle）
//   候选骨名覆盖常见 PMX 变体（左ひざ/左膝 等）

import type { MenuNode } from '@/menus/menu-schema';
import type { ParamValue } from '@/core/types';
import { setBoneOverride, registerBoneOverrideFrameHook } from '../bone-override';
import { registerModule, getModuleState, claimBones, getOwnedBones } from './registry';
import type { MotionOverrideModule, ModuleMeta } from './types';
import { computePedalPhase, computeFootPitch } from './motion-math';
import { createModuleBase, createFrameHookManager } from './module-base';

const MODULE_ID = 'riding-model';

type RidingPreset = 'bicycle' | 'motorcycle' | 'horse';

/** 预设：腰前倾角度（度） */
const PRESET_LEAN: Record<RidingPreset, number> = {
    bicycle: 20,
    motorcycle: 10,
    horse: 5,
};

/** [doc:adr-116 P3] 每模型每帧踏板钩子管理器 */
const _ridingFrameHooks = createFrameHookManager();
/** 每模型已认领的足部骨名（左/右），供帧钩子驱动 */
const _ridingFeet = new Map<string, string[]>();

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    preset: 'bicycle',
    saddleHeight: 0.6, // 0=最低（膝盖全弯）, 1=最高（膝盖伸直）
    pedalAngle: 0, // 0-360 度（autoPedal 关闭时的静态踏板相位）
    autoPedal: false, // true=踏板自动循环（Pedal Speed 生效），false=静态 pedalAngle
    pedalSpeed: 0.5, // 踏板循环速度（Hz，0.1-2）
};

const META: ModuleMeta = {
    labelKey: 'motion.override.module.ridingModel',
    icon: 'lucide:bike',
    defaults: DEFAULTS,
};

/** 管理的骨骼（腰 + 左右膝 + 左右足，覆盖常见命名变体） */
const MANAGED_BONES = ['腰', '左ひざ', '右ひざ', '左膝', '右膝', '左足', '右足'];

/** 烘焙：将骑行静态姿态（腰/膝）写入骨骼；足部由 ensureActive 决定是否交给帧钩子 */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    if (!state.enabled) {
        return;
    }
    const presetName = (state.params.preset as string) ?? 'bicycle';
    const saddleHeight = (state.params.saddleHeight as number) ?? 0.6;
    const pedalAngle = (state.params.pedalAngle as number) ?? 0;
    const autoPedal = (state.params.autoPedal as boolean) ?? false;
    const lean = PRESET_LEAN[presetName as RidingPreset] ?? 20;

    const claimed = claimBones(modelId, MODULE_ID, MANAGED_BONES);
    if (claimed.length === 0) {
        return;
    }

    // 腰前倾（pitch = lean）
    if (claimed.includes('腰')) {
        setBoneOverride('腰', [lean, 0, 0], 1, true, modelId);
    }

    // 膝盖弯曲：saddleHeight 越高弯曲越小
    // 弯曲角度 = (1 - saddleHeight) * 90 度（0=伸直, 90=全弯）
    const kneePitch = (1 - saddleHeight) * 90;
    if (claimed.includes('左ひざ')) {
        setBoneOverride('左ひざ', [kneePitch, 0, 0], 1, true, modelId);
    }
    if (claimed.includes('右ひざ')) {
        setBoneOverride('右ひざ', [kneePitch, 0, 0], 1, true, modelId);
    }
    // 命名变体兜底
    if (claimed.includes('左膝') && !claimed.includes('左ひざ')) {
        setBoneOverride('左膝', [kneePitch, 0, 0], 1, true, modelId);
    }
    if (claimed.includes('右膝') && !claimed.includes('右ひざ')) {
        setBoneOverride('右膝', [kneePitch, 0, 0], 1, true, modelId);
    }

    // 足部：记录已认领的足骨（供帧钩子驱动）；autoPedal 关闭时写静态 pedalAngle
    const feet: string[] = [];
    if (claimed.includes('左足')) {
        feet.push('左足');
    }
    if (claimed.includes('右足')) {
        feet.push('右足');
    }
    _ridingFeet.set(modelId, feet);

    if (!autoPedal) {
        // 静态踏板相位（原行为）：左足 = sin(deg)*20，右足 = sin(deg+180)*20
        const rad = (pedalAngle * Math.PI) / 180;
        const leftFootPitch = Math.sin(rad) * 20;
        const rightFootPitch = Math.sin(rad + Math.PI) * 20;
        if (feet.includes('左足')) {
            setBoneOverride('左足', [leftFootPitch, 0, 0], 1, true, modelId);
        }
        if (feet.includes('右足')) {
            setBoneOverride('右足', [rightFootPitch, 0, 0], 1, true, modelId);
        }
    }
    // autoPedal 开启时不写静态足骨，交由 ensureActive 注册的每帧钩子驱动
}

/**
 * [doc:adr-116 P3] 确保踏板帧钩子状态与 autoPedal 一致。
 * autoPedal=true → 注册钩子（每帧按 pedalSpeed 推进相位，驱动左右足交替循环）；
 * autoPedal=false → 注销钩子（足部回退为 bake 写入的静态 pedalAngle）。
 * 足部骨被其他模块占用时让位，不争抢。
 */
function ensureActive(modelId: string): void {
    bake(modelId); // 写静态骨骼 + 记录认领足骨
    const st = getModuleState(modelId, MODULE_ID);
    const autoPedal = (st.params.autoPedal as boolean) ?? false;
    const hasHook = _ridingFrameHooks.has(modelId);
    if (autoPedal && !hasHook) {
        const unregister = registerBoneOverrideFrameHook((t, mid) => {
            if (mid !== modelId) {
                return;
            }
            const s = getModuleState(modelId, MODULE_ID);
            if (!s.enabled) {
                return;
            }
            const feet = _ridingFeet.get(modelId) ?? [];
            if (feet.length === 0) {
                return;
            }
            const owned = getOwnedBones(modelId, MODULE_ID);
            const pedalSpeed = (s.params.pedalSpeed as number) ?? 0.5;
            // pedalAngle(t) = (t · pedalSpeed · 360)° ，自然循环
            const phaseDeg = computePedalPhase(t, pedalSpeed);
            for (const bone of feet) {
                if (!owned.has(bone)) {
                    continue; // 被抢占则跳过该足
                }
                const isLeft = bone.startsWith('左');
                const pitch = computeFootPitch(phaseDeg, isLeft);
                setBoneOverride(bone, [pitch, 0, 0], 1, true, modelId);
            }
        });
        _ridingFrameHooks.set(modelId, unregister);
    } else if (!autoPedal && hasHook) {
        _ridingFrameHooks.unregister(modelId);
    }
}

/** 创建骑行模型模块实例 */
export function createRidingModelModule(modelId: string): MotionOverrideModule {
    const base = createModuleBase(modelId, MODULE_ID, DEFAULTS, bake, {
        action: ensureActive,
        onDisable: (mid) => {
            _ridingFrameHooks.unregister(mid);
        },
    });
    return {
        id: MODULE_ID,
        meta: META,
        priority: 3,
        managedBones: MANAGED_BONES,

        buildSchema(): MenuNode[] {
            return [
                {
                    id: 'riding-model:preset',
                    kind: 'modeSlider',
                    label: 'motion.preset',
                    icon: 'lucide:list',
                    control: {
                        bind: `motionModule.${MODULE_ID}.preset`,
                        options: [
                            { value: 'bicycle', label: 'motion.ridingPreset.bicycle' },
                            { value: 'motorcycle', label: 'motion.ridingPreset.motorcycle' },
                            { value: 'horse', label: 'motion.ridingPreset.horse' },
                        ],
                        onChange: (v) => {
                            base.setParam('preset', v as string);
                        },
                    },
                },
                {
                    id: 'riding-model:saddleHeight',
                    kind: 'slider',
                    label: 'motion.saddleHeight',
                    icon: 'lucide:arrow-up-from-line',
                    control: {
                        bind: `motionModule.${MODULE_ID}.saddleHeight`,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: (v) => {
                            base.setParam('saddleHeight', v as number);
                        },
                    },
                },
                {
                    id: 'riding-model:pedalAngle',
                    kind: 'slider',
                    label: 'motion.pedalAngle',
                    icon: 'lucide:rotate-3d',
                    control: {
                        bind: `motionModule.${MODULE_ID}.pedalAngle`,
                        min: 0,
                        max: 360,
                        step: 5,
                        onChange: (v) => {
                            base.setParam('pedalAngle', v as number);
                        },
                    },
                },
                {
                    id: 'riding-model:autoPedal',
                    kind: 'toggle',
                    label: 'motion.autoPedal',
                    icon: 'lucide:refresh-cw',
                    control: {
                        bind: `motionModule.${MODULE_ID}.autoPedal`,
                        onChange: (v) => {
                            base.setParam('autoPedal', v as boolean);
                        },
                    },
                },
                {
                    id: 'riding-model:pedalSpeed',
                    kind: 'slider',
                    label: 'motion.pedalSpeed',
                    icon: 'lucide:gauge',
                    control: {
                        bind: `motionModule.${MODULE_ID}.pedalSpeed`,
                        min: 0.1,
                        max: 2,
                        step: 0.1,
                        onChange: (v) => {
                            base.setParam('pedalSpeed', v as number);
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

/** 注册骑行模型模块 */
export function registerRidingModel(): void {
    registerModule(MODULE_ID, META, 3, createRidingModelModule);
}
