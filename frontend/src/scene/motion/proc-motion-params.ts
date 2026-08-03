// [doc:architecture] Procedural Motion — 参数 setter 群 mixin
// 从 proc-motion-bridge.ts 拆出（ADR-237 P1：ProcMotionController 575 行单类瘦身）。
// 职责: 程序化动作的参数读写（per-mode params / 顶层开关 / gaze 设定），
//       经 mixin 混入 ProcMotionControllerBase，私有状态经 protected 字段共享。
// 设计: 转发层（proc-motion-bridge.ts 的 26 个导出委托）保持不动，调用方零改动。
//
// [adr-XX per-motion] 参数存储优先级（与 bridge 基类 _refProcState 一致）：
//   1. activeMotion.procMotion（随动作走，多角色共享参数）
//   2. _fallbackProcState（无动作时的本地默认值，向后兼容）

import {
    ProcMotionState,
    ProcMotionMode,
    ProcModeKey,
    ProcMotionParams,
    ProcMotionBoneCategory,
    PROC_MOTION_BONE_CATEGORIES,
    DEFAULT_PROC_STATE,
    migrateProcState,
} from '@/motion-algos/procedural-motion';
import { BeatDetector } from '@/motion-algos/beat-detector';
import { triggerAutoSave, setUIState } from '@/core/config';
import { setGazeConfig, activatePerception } from './perception';
import { clamp01 } from '@/core/clamp';
import { logWarn } from '@/core/logger';
import { getActiveMotion } from './motion-intent';
import type { ProcMotionControllerBase } from './proc-motion-controller';
import type { ProcMotionConfig } from '@/core/types';

/** 构造器类型（mixin 泛型约束）。
 *  [ADR-237 P1] 必须用 `any[]`（TS mixin 规范：mixin 类构造器须为单 rest 参数 any[]），
 *  用 unknown[] 会触发 TS2545。 */
type Constructor<T = object> = new (...args: any[]) => T;

/** [fix:P3] per-mode 兜底参数的独立副本（含 boneToggles 深拷贝）。
 *  兜底不可用 `{}`：patch 后会得到缺 boneToggles 的残缺 params，下游
 *  `params.boneToggles.center` 直接 TypeError；也不可直接复用 DEFAULT_PROC_STATE
 *  的 boneToggles 引用，否则调用方原地写入会穿透污染模块级默认常量。 */
function _defaultParamsFor(mode: ProcModeKey): ProcMotionParams {
    const d = DEFAULT_PROC_STATE.params[mode];
    return { ...d, boneToggles: { ...d.boneToggles } };
}

/**
 * 参数 setter 群 mixin —— 混入 ProcMotionControllerBase。
 * 访问基类 protected 字段/方法：_refProcState / _fallbackProcState / _beatDetector /
 * regenerateProcMotion / stopProcMotion。基类独立文件（proc-motion-controller.ts）
 * 提供全部状态机核心，本 mixin 仅含参数读写 setter。
 */
export function ProcMotionParamsMixin<TBase extends Constructor<ProcMotionControllerBase>>(
    Base: TBase
) {
    // [ADR-237 P1] 类名不可与 import 的 ProcMotionParams 接口同名，否则类方法内
    // `Partial<ProcMotionParams>` 解析为局部类而非接口（TS2353 遮蔽 bug）。
    return class ParamsMixin extends Base {
        /** [adr-XX per-motion] 写入程序化配置：同步写入 activeMotion（若存在）+ fallback。
         *  保证无动作时的本地状态也与最新设置一致，切换动作后参数不丢失。
         *  [audit] per-mode：patch 写入指定模式的 params（idle / autodance 各自独立）。
         *  [audit] 写入边界：bridge setter 族（setProcMotionIntensity/Speed/BoneToggle/BoneToggles/
         *  VpdApplyEnabled/InterpOverride）均无 modelId 参数，仅服务全局路径（activeMotion + fallback）；
         *  per-model 写入由菜单层 motion-procmotion-levels.ts 的 _setProcParams/_applyProcParam 直写
         *  modelRegistry（经 _refProcState(modelId) 读取），勿在 bridge 侧另开 per-model 写入口。 */
        private _writeProcState(mode: ProcModeKey, patch: Partial<ProcMotionParams>): void {
            const intent = getActiveMotion();
            if (intent) {
                if (!intent.procMotion) {
                    intent.procMotion = { ...DEFAULT_PROC_STATE } as ProcMotionConfig;
                }
                const cur = intent.procMotion as ProcMotionState;
                intent.procMotion = {
                    ...cur,
                    params: {
                        ...cur.params,
                        [mode]: { ..._defaultParamsFor(mode), ...(cur.params?.[mode] ?? {}), ...patch },
                    },
                } as ProcMotionConfig;
            }
            this._fallbackProcState = {
                ...this._fallbackProcState,
                params: {
                    ...this._fallbackProcState.params,
                    [mode]: {
                        ..._defaultParamsFor(mode),
                        ...(this._fallbackProcState.params?.[mode] ?? {}),
                        ...patch,
                    },
                },
            };
        }

        /** 写入顶层字段（mode / 感知层开关），不经过 per-mode params。 */
        private _writeTopLevel(
            patch: Partial<Pick<ProcMotionState, 'mode' | 'eyeTrackingEnabled' | 'headTrackingEnabled'>>
        ): void {
            const intent = getActiveMotion();
            if (intent) {
                if (!intent.procMotion) {
                    intent.procMotion = { ...DEFAULT_PROC_STATE } as ProcMotionConfig;
                }
                intent.procMotion = {
                    ...(intent.procMotion as ProcMotionState),
                    ...patch,
                } as ProcMotionConfig;
            }
            this._fallbackProcState = { ...this._fallbackProcState, ...patch };
        }

        /** 通用视线/头部追踪设定（重建追踪以应用新值）。 */
        private _setGazeTrackingSetting(
            field: 'eyeTrackingEnabled' | 'headTrackingEnabled',
            value: boolean
        ): void {
            this._writeTopLevel({ [field]: value });
            // 同步到 perception.ts（内部已调用 triggerAutoSave）
            const st = this._refProcState();
            setGazeConfig(st.headTrackingEnabled, st.eyeTrackingEnabled);
            // 重新激活感知层（应用新配置）
            activatePerception();
        }

        setProcMotionMode(mode: ProcMotionMode): void {
            this._writeTopLevel({ mode });
            if (mode === 'off') {
                this.stopProcMotion();
            }
            triggerAutoSave();
            // [fix P2] 模式变更需重生成 VMD — 由调用方在外部调用 regenerateProcMotion
            // （移除内部无参数 regenerateProcMotion 以消除双重重生成竞态，model-detail.ts/
            //  motion-popup.ts/motion-procmotion-levels.ts 均已持有显式 regenerate 调用）
        }

        /** [audit] per-mode：写入指定程序化模式的强度。 */
        setProcMotionIntensity(mode: ProcModeKey, v: number): void {
            this._writeProcState(mode, { intensity: clamp01(v) });
            triggerAutoSave();
            // [fix P2] 强度变更需重生成 VMD
            this.regenerateProcMotion();
        }

        /** [audit] per-mode：写入指定程序化模式的速度。 */
        setProcMotionSpeed(mode: ProcModeKey, v: number): void {
            this._writeProcState(mode, { speed: Math.max(0.5, Math.min(2, v)) });
            triggerAutoSave();
            // [fix P2] 速度变更需重生成 VMD
            this.regenerateProcMotion();
        }

        getProcMotionState(): ProcMotionState {
            const st = this._refProcState();
            // [audit] 深层拷贝 params（idle/autodance + 各自 boneToggles），
            // 防调用方 mutate 返回对象污染内部状态（浅拷贝会共享 params 引用）。
            return {
                ...st,
                params: {
                    idle: { ...st.params.idle, boneToggles: { ...st.params.idle.boneToggles } },
                    autodance: {
                        ...st.params.autodance,
                        boneToggles: { ...st.params.autodance.boneToggles },
                    },
                },
            };
        }

        /** 设置程序化动作状态（从存储恢复时使用，不触发自动保存以免干扰反序列化）。
         *  外部直接调用此函数时，请确保调用者在合适时机手动触发保存。
         *  [audit] 入口统一过 migrateProcState，兼容旧扁平存档与新嵌套结构。 */
        setProcMotionState(s: ProcMotionState): void {
            const migrated = migrateProcState(s);
            const intent = getActiveMotion();
            if (intent) {
                intent.procMotion = { ...migrated } as ProcMotionConfig;
            }
            this._fallbackProcState = { ...migrated };
        }

        // ======== 开关 Getter/Setter（P0/P1） ========

        /** 设置单个微动效果的开关（per-mode：写入指定模式） */
        setProcMotionBoneToggle(mode: ProcModeKey, cat: ProcMotionBoneCategory, v: boolean): void {
            if (!PROC_MOTION_BONE_CATEGORIES.includes(cat)) {
                logWarn('proc-motion', `invalid bone category: ${cat}`);
                return;
            }
            if (typeof v !== 'boolean') {
                logWarn('proc-motion', 'setProcMotionBoneToggle: invalid value type, expected boolean');
                return;
            }
            const bt = { ...this._refProcState().params[mode].boneToggles };
            bt[cat] = v;
            this._writeProcState(mode, { boneToggles: bt });
            triggerAutoSave();
            // [fix] 程序化调用必须触发 VMD 重生成，否则 toggle 新值不生效（UI 层已包含此调用）
            this.regenerateProcMotion();
        }

        /** 批量设置微动效果开关（per-mode：写入指定模式） */
        setProcMotionBoneToggles(
            mode: ProcModeKey,
            bt: Partial<Record<ProcMotionBoneCategory, boolean>>
        ): void {
            for (const [k, v] of Object.entries(bt)) {
                if (typeof v !== 'boolean') {
                    logWarn(
                        'proc-motion',
                        `setProcMotionBoneToggles: invalid value type for key "${k}", expected boolean`
                    );
                    return;
                }
            }
            const cur = this._refProcState().params[mode];
            this._writeProcState(mode, { boneToggles: { ...cur.boneToggles, ...bt } });
            triggerAutoSave();
            // [fix] 批量设置同样需要重生成 VMD
            this.regenerateProcMotion();
        }

        /** [audit] per-mode：写入指定模式的 VPD 应用开关。 */
        setProcMotionVpdApplyEnabled(mode: ProcModeKey, v: boolean): void {
            if (typeof v !== 'boolean') {
                logWarn(
                    'proc-motion',
                    'setProcMotionVpdApplyEnabled: invalid value type, expected boolean'
                );
                return;
            }
            this._writeProcState(mode, { vpdApplyEnabled: v });
            triggerAutoSave();
            // [fix P2] VPD 应用开关影响 VMD 生成结果
            this.regenerateProcMotion();
        }

        /** [audit] per-mode：写入指定模式的插值覆写。 */
        setProcMotionInterpOverride(mode: ProcModeKey, v: ProcMotionParams['interpOverride']): void {
            const valid = ['auto', 'sharp', 'ease-in-out', 'ease-out'] as const;
            if (!valid.includes(v as (typeof valid)[number])) {
                logWarn('proc-motion', `setProcMotionInterpOverride: invalid value "${v}"`);
                return;
            }
            this._writeProcState(mode, { interpOverride: v });
            triggerAutoSave();
            // [fix P2] 插值模式变更需重生成 VMD（UI 层已包含此调用）
            this.regenerateProcMotion();
        }

        /** 设置 BPM 量化开关 */
        setBpmQuantizeEnabled(v: boolean): void {
            if (typeof v !== 'boolean') {
                logWarn('proc-motion', 'setBpmQuantizeEnabled: invalid value type, expected boolean');
                return;
            }
            setUIState({ bpmQuantizeEnabled: v });
            if (this._beatDetector) {
                this._beatDetector.setBpmQuantizeEnabled(v);
            }
        }

        getBpmQuantizeEnabled(): boolean {
            return this._beatDetector?.getBpmQuantizeEnabled() ?? true;
        }

        /** 设置眼部跟随开关（实时效果，不重新生成 VMD）。 */
        setProcMotionEyeTrackingEnabled(v: boolean): void {
            this._setGazeTrackingSetting('eyeTrackingEnabled', v);
        }

        /** 设置头部跟随开关（实时效果，不重新生成 VMD）。 */
        setProcMotionHeadTrackingEnabled(v: boolean): void {
            this._setGazeTrackingSetting('headTrackingEnabled', v);
        }

        /** 自动激活视线追踪 observer（不依赖程序化动作生命周期）。
         *  由模型加载 / 焦点切换路径在 mmdModel 就绪后调用，使默认 gaze 配置立即生效。 */
        activateGazeTracking(): void {
            activatePerception();
        }

        /** 图层驱动的视线/头部控制。
         *  由 vmd-layers 在调整 gaze 图层时调用。
         *  - intensity > 0 且 active → 启用眼部追踪
         *  - intensity >= 0.5 且 active → 同时启用头部追踪
         *  - 否则禁用两者。
         *  不干涉 _setGazeTrackingSetting 内部重建逻辑。 */
        setGazeLayerActive(active: boolean, intensity: number): void {
            const shouldEnable = active && intensity > 0;
            this.setProcMotionEyeTrackingEnabled(shouldEnable);
            this.setProcMotionHeadTrackingEnabled(shouldEnable && intensity >= 0.5);
        }
    };
}
