// [doc:architecture] Procedural Motion — 程序化动作系统
// 规范文档: docs/architecture.md §程序化动作
// 职责: Idle / Auto Dance VMD 生成调度、节拍联动
// 视线追踪已迁移至 perception.ts（ADR-071）
//
// [refactor] 8 个模块级 let 收口为 ProcMotionController 类实例。
// 状态封装在类私有字段中，外部不可直接访问；导出函数签名不变，
// 委托到模块级懒单例，外部调用方零改动。
// dispose() 一键清零全部状态并销毁单例，生命周期跟 scene 绑定。
//
// [adr-XX per-motion] 参数存储优先级：
//   1. activeMotion.procMotion（随动作走，多角色共享参数）
//   2. _fallbackProcState（无动作时的本地默认值，向后兼容）
// 读取时取优先值，写入时写入 activeMotion（若存在）并同步 fallback。

import {
    ProcMotionState,
    ProcMotionMode,
    ProcMotionBoneCategory,
    PROC_MOTION_BONE_CATEGORIES,
    DEFAULT_PROC_STATE,
    generateIdleVmd,
    generateAutoDanceVmd,
    shouldAutoDance,
    shouldIdle,
    PROC_VMD_NAME_IDLE,
    PROC_VMD_NAME_AUTODANCE,
} from '@/motion-algos/procedural-motion';
import { BeatDetector } from '@/motion-algos/beat-detector';
import { mmdRuntime, triggerAutoSave, focusedModelId, setUIState } from '@/core/config';
import { isAudioPlaying } from '@/outfit/audio';
import { modelManager, focusedMmdModel, focusedModel, loadVMDMotion } from '../scene';
import { setGazeConfig, onPerceptionModelRemoved, activatePerception } from './perception';
import { clamp01 } from '@/core/utils';
import { logWarn } from '@/core/logger';
import { safeDispose } from '@/core/dispose-helpers';
import { getActiveMotion } from './motion-intent';
import { rebuildCompositeAnimation } from './vmd-layers';
import type { ProcMotionConfig } from '@/core/types';

/** 清除模型上的 vmdData/vmdName（纯工具函数，无状态依赖）。 */
function _clearVmdData(inst: import('../../core/config').ModelInstance | null | undefined): void {
    if (inst) {
        inst.vmdData = null;
        inst.vmdName = '';
    }
}

// ═══════════════════════════════════════════════════════════
// ProcMotionController — 程序化动作状态 + 逻辑收口
// ═══════════════════════════════════════════════════════════

class ProcMotionController {
    // ── 私有状态（原 8 个模块级 let，外部不可直接访问）──
    private _fallbackProcState: ProcMotionState = { ...DEFAULT_PROC_STATE };
    private _beatDetector: BeatDetector | null = null;
    private _lastBeatBpm = 120;
    private _starting = false;
    private _stopRequested = false; // await 期间被 stop 时置位，防止 start 完成后重新激活
    private _regeneratePending = false;
    private _activeKind: ProcMotionMode = 'idle';
    /** [fix:P1] Set 支持多模型并发程序化，替代原 procModelId 单值 */
    private _activeModels = new Set<string>();

    // ── 内部工具 ──

    private _procVmdActive(): boolean {
        return this._activeModels.size > 0;
    }

    /** [adr-XX per-motion] 获取当前生效的程序化配置引用。
     *  读取优先级：显式 modelId 的 per-model 状态 > activeMotion > fallback。
     *  [P5 per-slot] 显式 modelId 时优先读 modelManager 中的 per-model 状态，
     *  使 regenerateProcMotion(modelId) 正确读取该模型独有参数（如 boneToggles）。
     *  返回的是可变引用，内部使用；外部读取用 getProcMotionState()（浅拷贝）。 */
    private _refProcState(modelId?: string): ProcMotionState {
        // [P5 per-slot] 显式 modelId → 读 per-model 状态（UI 写入 modelRegistry 的源）
        if (modelId) {
            const inst = modelManager.get(modelId);
            if (inst?.procMotion) {
                return inst.procMotion as ProcMotionState;
            }
        }
        const intent = getActiveMotion();
        if (intent?.procMotion) {
            return intent.procMotion as ProcMotionState;
        }
        return this._fallbackProcState;
    }

    /** [adr-XX per-motion] 写入程序化配置：同步写入 activeMotion（若存在）+ fallback。
     *  保证无动作时的本地状态也与最新设置一致，切换动作后参数不丢失。 */
    private _writeProcState(patch: Partial<ProcMotionState>): void {
        const intent = getActiveMotion();
        if (intent) {
            if (!intent.procMotion) {
                intent.procMotion = { ...DEFAULT_PROC_STATE } as ProcMotionConfig;
            }
            intent.procMotion = { ...intent.procMotion, ...patch } as ProcMotionConfig;
        }
        this._fallbackProcState = { ...this._fallbackProcState, ...patch };
    }

    /** 通用视线/头部追踪设定（重建追踪以应用新值）。 */
    private _setGazeTrackingSetting(
        field: 'eyeTrackingEnabled' | 'headTrackingEnabled',
        value: boolean
    ): void {
        this._writeProcState({ [field]: value } as Partial<ProcMotionState>);
        // 同步到 perception.ts（内部已调用 triggerAutoSave）
        const st = this._refProcState();
        setGazeConfig(st.headTrackingEnabled, st.eyeTrackingEnabled);
        // 重新激活感知层（应用新配置）
        activatePerception();
    }

    // ── 公共 API ──

    /** 只读访问器，外部不可直接修改程序化动作激活状态。 */
    isProcVmdActive(): boolean {
        return this._procVmdActive();
    }

    getProcBeatDetector(): BeatDetector | null {
        return this._beatDetector;
    }

    createProcBeatDetector(): BeatDetector {
        this._beatDetector = new BeatDetector();
        return this._beatDetector;
    }

    private async _startProcMotion(
        targetMode: ProcMotionMode,
        bpm?: number,
        /** [P5 per-slot] 显式指定目标模型；不传时回退到焦点模型（向后兼容）。 */
        modelIdOverride?: string
    ): Promise<void> {
        if (this._starting) {
            return;
        }
        this._starting = true;
        this._stopRequested = false;

        // 保存加载前的模型 ID，防止 await 后焦点切换导致操作错配（Issue #3）
        // [P5 per-slot] 优先使用显式传入的 modelIdOverride，使非焦点模型也能驱动程序化
        const modelAtStart =
            modelIdOverride !== undefined
                ? (modelManager.get(modelIdOverride)?.mmdModel ?? null)
                : focusedMmdModel();
        const modelIdAtStart = modelIdOverride ?? focusedModelId ?? null;
        if (!modelAtStart) {
            this._starting = false;
            return;
        }
        const morphNames = modelAtStart.morph.morphs.map((m) => m.name) ?? [];
        const boneNames = modelAtStart.runtimeBones.map((b) => b.name);
        logWarn(
            'proc-motion',
            `bones: [${boneNames.slice(0, 10).join(', ')}${boneNames.length > 10 ? '...' : ''}]`
        );
        logWarn(
            'proc-motion',
            `morphs: [${morphNames.slice(0, 5).join(', ')}${morphNames.length > 5 ? '...' : ''}]`
        );
        let buf: ArrayBuffer;

        // Issue #2: bpm 无效时直接抛错，保持状态一致
        const bpmValid = bpm !== null && bpm !== undefined && bpm > 0 && Number.isFinite(bpm);
        if (targetMode === 'autodance' && !bpmValid) {
            throw new Error('proc-motion: autodance 模式需要有效 BPM，当前 BPM 无效');
        }
        if (targetMode === 'autodance' && bpmValid) {
            buf = generateAutoDanceVmd(
                this._refProcState(modelIdOverride),
                bpm!,
                morphNames,
                boneNames
            );
            this._lastBeatBpm = bpm!;
            this._activeKind = 'autodance';
        } else {
            buf = generateIdleVmd(this._refProcState(modelIdOverride), boneNames);
            this._activeKind = targetMode;
        }

        // [P5 per-slot] 显式指定目标时跳过焦点校验：调用方已决定目标，焦点切换不应取消该模型的程序化
        // [fix] _procVmdActive/procModelId 移至成功分支内赋值（P1: 防止 early return 后状态泄漏）
        const isExplicitTarget = modelIdOverride !== undefined;
        try {
            // D4: 仅在未显式指定目标时检查焦点切换，避免无意义的 VMD 生成
            if (!isExplicitTarget && focusedModelId !== modelIdAtStart) {
                logWarn('proc-motion', '焦点已在生成期间切换，取消本次程序化动作');
                this._starting = false;
                return;
            }
            const inst = modelManager.get(modelIdAtStart);
            if (!inst) {
                this._starting = false;
                return;
            }
            // [adr-XX per-motion] 程序化 base 走 vmdLayers 管线：写入 vmdData + rebuild
            // 替代旧的直写 loadVMDMotion/setRuntimeAnimation，避免与图层叠加冲突
            const procVmdName =
                targetMode === 'autodance' && bpmValid
                    ? PROC_VMD_NAME_AUTODANCE
                    : PROC_VMD_NAME_IDLE;
            inst.vmdData = buf;
            inst.vmdName = procVmdName;
            inst.vmdPath = null; // 程序化无文件路径
            rebuildCompositeAnimation(modelIdAtStart);

            // 同步写入后校验：仅在未显式指定目标时检查焦点是否仍在该模型上
            const currentId = focusedModelId ?? null;
            if (!isExplicitTarget && currentId !== modelIdAtStart) {
                logWarn('proc-motion', '生成后焦点已切换，丢弃本次程序化动作结果');
                inst.vmdData = null;
                inst.vmdName = '';
                rebuildCompositeAnimation(modelIdAtStart);
                this._activeModels.delete(modelIdAtStart);
                this._activeKind = 'idle';
            } else if (this._stopRequested) {
                logWarn('proc-motion', '生成完成但已被 stop，丢弃结果');
                inst.vmdData = null;
                inst.vmdName = '';
                rebuildCompositeAnimation(modelIdAtStart);
                this._activeModels.delete(modelIdAtStart);
                this._activeKind = 'idle';
            } else {
                // 成功：加入活跃集合
                this._activeModels.add(modelIdAtStart);
                // 感知层独立激活，不依赖程序化动作生命周期
            }
        } catch (err) {
            logWarn('proc-motion', '程序化动作生成失败:', err);
            this._activeModels.delete(modelIdAtStart);
            _clearVmdData(modelManager.get(modelIdAtStart));
        } finally {
            this._starting = false;
        }

        // Re-trigger check after finally (cannot use return inside finally — no-unsafe-finally)
        if (this._regeneratePending) {
            this._regeneratePending = false;
            // 取最后一个活跃模型重触发
            const lastModel = [...this._activeModels].pop();
            if (lastModel) {
                const mode =
                    this._refProcState(lastModel).mode === 'autodance' ? 'autodance' : 'idle';
                const bpm = this._beatDetector?.getBPM() ?? 120;
                void this._startProcMotion(
                    mode,
                    mode === 'autodance' ? bpm : undefined,
                    lastModel
                ).catch((e) => {
                    logWarn('proc-motion', 'Re-trigger startProcMotion 失败:', e);
                });
            } else {
                logWarn('proc-motion', 'Re-trigger skipped: no active models');
            }
        }
    }

    stopProcMotion(): void {
        this._stopRequested = true;
        // 感知层独立于程序化动作，不再随 stopProcMotion 注销
        // gaze 由 perception.ts 管理，always-on
        // [fix:P1] 遍历所有活跃模型，逐一清理
        for (const modelId of this._activeModels) {
            const inst = modelManager.get(modelId);
            if (inst) {
                // [fix] 若用户已在程序化动作 active 期间加载了真实 VMD（vmdPath 非空），
                // 不可盲目清除 vmdData —— 否则会覆盖用户刚点击的动作。
                // 仅在模型未持有用户真实 VMD 时才清除程序化数据并 rebuild 到静止姿。
                const userVmdPresent =
                    inst.vmdPath !== null && inst.vmdPath !== undefined && inst.vmdPath !== '';
                if (!userVmdPresent) {
                    inst.vmdData = null;
                    inst.vmdName = '';
                    inst.vmdPath = null;
                    rebuildCompositeAnimation(modelId);
                }
            }
        }
        this._activeModels.clear();
    }

    onModelRemoved(id: string): void {
        this._activeModels.delete(id);
        // 感知层清理
        onPerceptionModelRemoved(id);
    }

    async updateProcMotion(): Promise<void> {
        const st = this._refProcState(focusedModelId ?? undefined);
        if (st.mode === 'off') {
            if (this._procVmdActive()) {
                this.stopProcMotion();
            }
            return;
        }

        // Issue #1: focusedModel() 可能为 null/undefined
        const model = focusedModel();
        const audioOn = isAudioPlaying();
        // [fix:adr-129/proc-slot] 程序化动作现已写入 inst.vmdData（替代旧直写 setRuntimeAnimation，
        // 见 _startProcMotion 内注），故不能再用 vmdData 判定"用户/场景 VMD 是否存在"——
        // 否则每帧 onBeforeRender 调用的 updateProcMotion 会把程序化数据误判为"用户 VMD"，
        // 触发 stopProcMotion() 清空 vmdData，导致动作1（基础槽位）程序化瞬间失效。
        // 正确判别依据：inst.vmdPath。程序化动作 vmdPath 恒为 null（_startProcMotion 显式置空），
        // 用户/场景 VMD 则必有非空 vmdPath（applyIntentToModel / loadVMDFromPath 写入）。
        const hasUserVmd = !!model?.vmdPath;
        const mode = st.mode;
        const wantAutoDance = shouldAutoDance(audioOn, mode);
        const wantIdle = shouldIdle(audioOn, hasUserVmd, mode);

        if (hasUserVmd && this._procVmdActive()) {
            this.stopProcMotion();
            return;
        }

        if (wantAutoDance && !hasUserVmd && this._beatDetector) {
            const bpm = this._beatDetector.getBPM() ?? 120;
            if (
                !this._procVmdActive() ||
                this._activeKind !== 'autodance' ||
                Math.abs(bpm - this._lastBeatBpm) > 10
            ) {
                await this._startProcMotion('autodance', bpm);
            }
            return;
        }

        if (wantIdle && !hasUserVmd) {
            if (!this._procVmdActive() || this._activeKind !== 'idle') {
                await this._startProcMotion('idle');
            }
            return;
        }
    }

    setProcMotionMode(mode: ProcMotionMode): void {
        this._writeProcState({ mode });
        if (mode === 'off') {
            this.stopProcMotion();
        }
        triggerAutoSave();
        // [fix P2] 模式变更需重生成 VMD — 由调用方在外部调用 regenerateProcMotion
        // （移除内部无参数 regenerateProcMotion 以消除双重重生成竞态，model-detail.ts/
        //  motion-popup.ts/motion-procmotion-levels.ts 均已持有显式 regenerate 调用）
    }

    setProcMotionIntensity(v: number): void {
        this._writeProcState({ intensity: clamp01(v) });
        triggerAutoSave();
        // [fix P2] 强度变更需重生成 VMD
        this.regenerateProcMotion();
    }

    setProcMotionSpeed(v: number): void {
        this._writeProcState({ speed: Math.max(0.5, Math.min(2, v)) });
        triggerAutoSave();
        // [fix P2] 速度变更需重生成 VMD
        this.regenerateProcMotion();
    }

    getProcMotionState(): ProcMotionState {
        return { ...this._refProcState() };
    }

    /** 设置程序化动作状态（从存储恢复时使用，不触发自动保存以免干扰反序列化）。
     *  外部直接调用此函数时，请确保调用者在合适时机手动触发保存。 */
    setProcMotionState(s: ProcMotionState): void {
        const intent = getActiveMotion();
        if (intent) {
            intent.procMotion = { ...s } as ProcMotionConfig;
        }
        this._fallbackProcState = { ...s };
    }

    // ======== 开关 Getter/Setter（P0/P1） ========

    /** 设置单个微动效果的开关 */
    setProcMotionBoneToggle(cat: ProcMotionBoneCategory, v: boolean): void {
        if (!PROC_MOTION_BONE_CATEGORIES.includes(cat)) {
            logWarn('proc-motion', `invalid bone category: ${cat}`);
            return;
        }
        if (typeof v !== 'boolean') {
            logWarn('proc-motion', 'setProcMotionBoneToggle: invalid value type, expected boolean');
            return;
        }
        const bt = { ...this._refProcState().boneToggles };
        bt[cat] = v;
        this._writeProcState({ boneToggles: bt });
        triggerAutoSave();
        // [fix] 程序化调用必须触发 VMD 重生成，否则 toggle 新值不生效（UI 层已包含此调用）
        this.regenerateProcMotion();
    }

    /** 批量设置微动效果开关 */
    setProcMotionBoneToggles(bt: Partial<Record<ProcMotionBoneCategory, boolean>>): void {
        for (const [k, v] of Object.entries(bt)) {
            if (typeof v !== 'boolean') {
                logWarn(
                    'proc-motion',
                    `setProcMotionBoneToggles: invalid value type for key "${k}", expected boolean`
                );
                return;
            }
        }
        const cur = this._refProcState();
        this._writeProcState({ boneToggles: { ...cur.boneToggles, ...bt } });
        triggerAutoSave();
        // [fix] 批量设置同样需要重生成 VMD
        this.regenerateProcMotion();
    }

    setProcMotionVpdApplyEnabled(v: boolean): void {
        if (typeof v !== 'boolean') {
            logWarn(
                'proc-motion',
                'setProcMotionVpdApplyEnabled: invalid value type, expected boolean'
            );
            return;
        }
        this._writeProcState({ vpdApplyEnabled: v });
        triggerAutoSave();
        // [fix P2] VPD 应用开关影响 VMD 生成结果
        this.regenerateProcMotion();
    }

    setProcMotionInterpOverride(v: ProcMotionState['interpOverride']): void {
        const valid = ['auto', 'sharp', 'ease-in-out', 'ease-out'] as const;
        if (!valid.includes(v as (typeof valid)[number])) {
            logWarn('proc-motion', `setProcMotionInterpOverride: invalid value "${v}"`);
            return;
        }
        this._writeProcState({ interpOverride: v });
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

    regenerateProcMotion(
        /** [P5 per-slot] 显式指定目标模型；不传时回退到焦点模型（向后兼容）。 */
        modelId?: string
    ): void {
        const st = this._refProcState(modelId);
        // [fix] mode === 'off' 时立刻停掉程序化，不继续往下走到 idle 重启动
        if (st.mode === 'off') {
            if (this._procVmdActive()) {
                this.stopProcMotion();
            }
            return;
        }
        // 以下执行 regenerate（冷启动或热更新均走此路径）
        // [P5 per-slot] 优先使用传入的 modelId；否则回退到焦点
        const targetModel = modelId
            ? (modelManager.get(modelId)?.mmdModel ?? null)
            : focusedMmdModel();
        if (!targetModel) {
            logWarn('proc-motion', 'regenerateProcMotion: 无目标 MMD 模型，跳过');
            return;
        }
        // Issue #4: 如果 regenerate 调用时正在生成，标记 deferred 重跑
        if (this._starting) {
            this._regeneratePending = true;
            return;
        }
        const mode =
            this._refProcState(modelId).mode === 'autodance'
                ? ('autodance' as const)
                : ('idle' as const);
        // Issue #5: _beatDetector 可能为 null
        const bpm = this._beatDetector?.getBPM() ?? 120;
        this._startProcMotion(mode, mode === 'autodance' ? bpm : undefined, modelId);
    }

    /** 释放全部资源，重置为初始状态。 */
    dispose(): void {
        this.stopProcMotion();
        this._beatDetector = safeDispose(this._beatDetector);
        this._fallbackProcState = { ...DEFAULT_PROC_STATE };
        this._regeneratePending = false;
        this._stopRequested = false;
        this._starting = false;
        this._activeKind = 'idle';
        this._lastBeatBpm = 120;
    }
}

// ═══════════════════════════════════════════════════════════
// 模块级懒单例 + 导出委托（外部调用方零改动）
// ═══════════════════════════════════════════════════════════

let _ctrl: ProcMotionController | null = null;
function _getCtrl(): ProcMotionController {
    if (!_ctrl) {
        _ctrl = new ProcMotionController();
    }
    return _ctrl;
}

export function isProcVmdActive(): boolean {
    return _getCtrl().isProcVmdActive();
}
export function getProcBeatDetector(): BeatDetector | null {
    return _getCtrl().getProcBeatDetector();
}
export function createProcBeatDetector(): BeatDetector {
    return _getCtrl().createProcBeatDetector();
}
export function stopProcMotion(): void {
    _getCtrl().stopProcMotion();
}
export function onModelRemoved(id: string): void {
    _getCtrl().onModelRemoved(id);
}
export async function updateProcMotion(): Promise<void> {
    return _getCtrl().updateProcMotion();
}
export function setProcMotionMode(mode: ProcMotionMode): void {
    _getCtrl().setProcMotionMode(mode);
}
export function setProcMotionIntensity(v: number): void {
    _getCtrl().setProcMotionIntensity(v);
}
export function setProcMotionSpeed(v: number): void {
    _getCtrl().setProcMotionSpeed(v);
}
export function getProcMotionState(): ProcMotionState {
    return _getCtrl().getProcMotionState();
}
export function setProcMotionState(s: ProcMotionState): void {
    _getCtrl().setProcMotionState(s);
}
export function setProcMotionBoneToggle(cat: ProcMotionBoneCategory, v: boolean): void {
    _getCtrl().setProcMotionBoneToggle(cat, v);
}
export function setProcMotionBoneToggles(
    bt: Partial<Record<ProcMotionBoneCategory, boolean>>
): void {
    _getCtrl().setProcMotionBoneToggles(bt);
}
export function setProcMotionVpdApplyEnabled(v: boolean): void {
    _getCtrl().setProcMotionVpdApplyEnabled(v);
}
export function setProcMotionInterpOverride(v: ProcMotionState['interpOverride']): void {
    _getCtrl().setProcMotionInterpOverride(v);
}
export function setBpmQuantizeEnabled(v: boolean): void {
    _getCtrl().setBpmQuantizeEnabled(v);
}
export function getBpmQuantizeEnabled(): boolean {
    return _getCtrl().getBpmQuantizeEnabled();
}
export function setProcMotionEyeTrackingEnabled(v: boolean): void {
    _getCtrl().setProcMotionEyeTrackingEnabled(v);
}
export function setProcMotionHeadTrackingEnabled(v: boolean): void {
    _getCtrl().setProcMotionHeadTrackingEnabled(v);
}
export function activateGazeTracking(): void {
    _getCtrl().activateGazeTracking();
}
export function setGazeLayerActive(active: boolean, intensity: number): void {
    _getCtrl().setGazeLayerActive(active, intensity);
}
export function regenerateProcMotion(modelId?: string): void {
    _getCtrl().regenerateProcMotion(modelId);
}

/** 释放程序化动作模块全部资源并销毁单例。应用关闭 / 模块卸载时调用。 */
export function disposeProcMotion(): void {
    if (_ctrl) {
        _ctrl.dispose();
        _ctrl = null;
    }
}
