// [doc:adr-116] Riding Model Module — 骑行模型模块
// 职责: 模拟骑行姿态（自行车/摩托车/马匹），调整腰+腿+足骨骼
// 优先级 P3=3
//
// 参数:
//   - preset: 骑行类型（'bicycle'|'motorcycle'|'horse'）
//   - saddleHeight: 鞍高（0-1，相对腿长的比例），决定膝盖弯曲程度
//   - pedalAngle: 踏板角（0-360 度），决定左右脚交替位置
//
// 骨骼映射:
//   - 腰: 前倾角度（bicycle=20°, motorcycle=10°, horse=5°）
//   - 腿: 左ひざ/右ひざ 膝盖弯曲（saddleHeight 越高弯曲越小）
//   - 足: 左足/右足 踏板位置（pedalAngle 决定左右交替）
//   候选骨名覆盖常见 PMX 变体（左ひざ/左膝 等）

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

const MODULE_ID = 'riding-model';

type RidingPreset = 'bicycle' | 'motorcycle' | 'horse';

/** 预设：腰前倾角度（度） */
const PRESET_LEAN: Record<RidingPreset, number> = {
    bicycle: 20,
    motorcycle: 10,
    horse: 5,
};

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    preset: 'bicycle',
    saddleHeight: 0.6, // 0=最低（膝盖全弯）, 1=最高（膝盖伸直）
    pedalAngle: 0, // 0-360 度
};

const META: ModuleMeta = {
    labelKey: 'motion.override.module.ridingModel',
    icon: 'lucide:bike',
    defaults: DEFAULTS,
};

/** 管理的骨骼（腰 + 左右膝 + 左右足，覆盖常见命名变体） */
const MANAGED_BONES = ['腰', '左ひざ', '右ひざ', '左膝', '右膝', '左足', '右足'];

/** 烘焙：将骑行姿态写入骨骼 */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    if (!state.enabled) {
        return;
    }
    const presetName = (state.params.preset as string) ?? 'bicycle';
    const saddleHeight = (state.params.saddleHeight as number) ?? 0.6;
    const pedalAngle = (state.params.pedalAngle as number) ?? 0;
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

    // 足部踏板：pedalAngle 决定左右脚上下交替
    // 左足 pitch = sin(pedalAngle) * 20，右足 pitch = sin(pedalAngle + 180) * 20
    const rad = (pedalAngle * Math.PI) / 180;
    const leftFootPitch = Math.sin(rad) * 20;
    const rightFootPitch = Math.sin(rad + Math.PI) * 20;
    if (claimed.includes('左足')) {
        setBoneOverride('左足', [leftFootPitch, 0, 0], 1, true, modelId);
    }
    if (claimed.includes('右足')) {
        setBoneOverride('右足', [rightFootPitch, 0, 0], 1, true, modelId);
    }
}

/** 创建骑行模型模块实例 */
export function createRidingModelModule(modelId: string): MotionOverrideModule {
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
                            createRidingModelModule(modelId).setParam('preset', v as string);
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
                            createRidingModelModule(modelId).setParam('saddleHeight', v as number);
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
                            createRidingModelModule(modelId).setParam('pedalAngle', v as number);
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

/** 注册骑行模型模块 */
export function registerRidingModel(): void {
    registerModule(MODULE_ID, META, 3, createRidingModelModule);
}
