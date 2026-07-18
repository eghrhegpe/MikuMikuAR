// [doc:architecture] Procedural Motion — 程序化动作系统
// 规范文档: docs/architecture.md §程序化动作
// 职责: Idle / Auto Dance VMD 生成调度、节拍联动
// 视线追踪已迁移至 perception.ts（ADR-071）

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
import { clamp01, logWarn } from '@/core/utils';
import { getActiveMotion } from './motion-intent';
import { rebuildCompositeAnimation } from './vmd-layers';
import type { ProcMotionConfig } from '@/core/types';

// [fix:ghost-state] 模块私有状态：所有外部修改必须通过 setProcMotion* setter，
// 读取必须通过 getProcMotionState()（返回浅拷贝，防止外部 mutate 内部引用）。
// 不可变更新模式（{ ...procState, ...patch }）保证每次变更生成新引用，便于追踪。
//
// [adr-XX per-motion] 参数存储优先级：
//   1. activeMotion.procMotion（随动作走，多角色共享参数）
//   2. _fallbackProcState（无动作时的本地默认值，向后兼容）
// 读取时取优先值，写入时写入 activeMotion（若存在）并同步 fallback。
let _fallbackProcState: ProcMotionState = { ...DEFAULT_PROC_STATE };
let procBeatDetector: BeatDetector | null = null;
let _procVmdActive = false;
let lastBeatBpm = 120;
let procStarting = false;
let _stopRequested = false; // await 期间被 stop 时置位，防止 start 完成后重新激活
let _regeneratePending = false;
let procActiveKind: ProcMotionMode = 'idle';
let procModelId: string | null = null;

/** [adr-XX per-motion] 获取当前生效的程序化配置引用（读优先：activeMotion > fallback）。
 *  返回的是可变引用，内部使用；外部读取用 getProcMotionState()（深拷贝）。 */
function _refProcState(): ProcMotionState {
    const intent = getActiveMotion();
    if (intent?.procMotion) {
        return intent.procMotion as ProcMotionState;
    }
    return _fallbackProcState;
}

/** [adr-XX per-motion] 写入程序化配置：同步写入 activeMotion（若存在）+ fallback。
 *  保证无动作时的本地状态也与最新设置一致，切换动作后参数不丢失。 */
function _writeProcState(patch: Partial<ProcMotionState>): void {
    const intent = getActiveMotion();
    if (intent) {
        if (!intent.procMotion) {
            intent.procMotion = { ...DEFAULT_PROC_STATE } as ProcMotionConfig;
        }
        intent.procMotion = { ...intent.procMotion, ...patch } as ProcMotionConfig;
    }
    _fallbackProcState = { ..._fallbackProcState, ...patch };
}

/** 只读访问器，外部不可直接修改程序化动作激活状态。 */
export function isProcVmdActive(): boolean {
    return _procVmdActive;
}

export function getProcBeatDetector(): BeatDetector | null {
    return procBeatDetector;
}

export function createProcBeatDetector(): BeatDetector {
    procBeatDetector = new BeatDetector();
    return procBeatDetector;
}

/** 清除模型上的 vmdData/vmdName（两分支复用）。 */
function _clearVmdData(inst: import('../../core/config').ModelInstance | null | undefined): void {
    if (inst) {
        inst.vmdData = null;
        inst.vmdName = '';
    }
}

async function startProcMotion(
    targetMode: ProcMotionMode,
    bpm?: number,
    /** [P5 per-slot] 显式指定目标模型；不传时回退到焦点模型（向后兼容）。 */
    modelIdOverride?: string
): Promise<void> {
    if (procStarting) {
        return;
    }
    procStarting = true;
    _stopRequested = false;

    // 保存加载前的模型 ID，防止 await 后焦点切换导致操作错配（Issue #3）
    // [P5 per-slot] 优先使用显式传入的 modelIdOverride，使非焦点模型也能驱动程序化
    const modelAtStart =
        modelIdOverride !== undefined
            ? (modelManager.get(modelIdOverride)?.mmdModel ?? null)
            : focusedMmdModel();
    const modelIdAtStart = modelIdOverride ?? focusedModelId ?? null;
    if (!modelAtStart) {
        procStarting = false;
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
        buf = generateAutoDanceVmd(_refProcState(), bpm!, morphNames, boneNames);
        lastBeatBpm = bpm!;
        procActiveKind = 'autodance';
    } else {
        buf = generateIdleVmd(_refProcState(), boneNames);
        procActiveKind = targetMode;
    }

    // 【已移除 debug 下载代码】

    _procVmdActive = true;
    procModelId = modelIdAtStart;
    // [P5 per-slot] 显式指定目标时跳过焦点校验：调用方已决定目标，焦点切换不应取消该模型的程序化
    const isExplicitTarget = modelIdOverride !== undefined;
    try {
        // D4: 仅在未显式指定目标时检查焦点切换，避免无意义的 VMD 生成
        if (!isExplicitTarget && focusedModelId !== modelIdAtStart) {
            logWarn('proc-motion', '焦点已在生成期间切换，取消本次程序化动作');
            procStarting = false;
            return;
        }
        const inst = modelManager.get(modelIdAtStart);
        if (!inst) {
            procStarting = false;
            return;
        }
        // [adr-XX per-motion] 程序化 base 走 vmdLayers 管线：写入 vmdData + rebuild
        // 替代旧的直写 loadVMDMotion/setRuntimeAnimation，避免与图层叠加冲突
        const procVmdName = targetMode === 'autodance' && bpmValid ? PROC_VMD_NAME_AUTODANCE : PROC_VMD_NAME_IDLE;
        inst.vmdData = buf;
        inst.vmdName = procVmdName;
        inst.vmdPath = null; // 程序化无文件路径
        rebuildCompositeAnimation(modelIdAtStart);

        // 同步写入后校验：仅在未显式指定目标时检查焦点是否仍在该模型上
        const currentId = focusedModelId ?? null;
        if (!isExplicitTarget && currentId !== modelIdAtStart) {
            logWarn('proc-motion', '生成后焦点已切换，丢弃本次程序化动作结果');
            // 清除刚写入的程序化数据
            inst.vmdData = null;
            inst.vmdName = '';
            rebuildCompositeAnimation(modelIdAtStart);
            _procVmdActive = false;
            procModelId = null;
            procActiveKind = 'idle';
        } else if (_stopRequested) {
            // 生成期间用户调用了 stopProcMotion，丢弃结果
            logWarn('proc-motion', '生成完成但已被 stop，丢弃结果');
            inst.vmdData = null;
            inst.vmdName = '';
            rebuildCompositeAnimation(modelIdAtStart);
            _procVmdActive = false;
            procModelId = null;
            procActiveKind = 'idle';
        } else {
            // 成功：重新断言 _procVmdActive=true
            _procVmdActive = true;
            // 感知层独立激活，不依赖程序化动作生命周期
        }
    } catch (err) {
        logWarn('proc-motion', '程序化动作生成失败:', err);
        _procVmdActive = false;
        _clearVmdData(focusedModel());
    } finally {
        procStarting = false;
    }

    // Re-trigger check after finally (cannot use return inside finally — no-unsafe-finally)
    if (_regeneratePending) {
        _regeneratePending = false;
        // [P5 per-slot] 不再要求 focusedModelId === procModelId，
        // 因为程序化目标已由调用方显式指定；只要 procModelId 仍存在就重触发。
        if (procModelId) {
            const mode = _refProcState().mode === 'autodance' ? 'autodance' : 'idle';
            const bpm = procBeatDetector?.getBPM() ?? 120;
            // fire-and-forget 需 catch 防止 unhandled rejection
            void startProcMotion(mode, mode === 'autodance' ? bpm : undefined, procModelId).catch((e) => {
                logWarn('proc-motion', 'Re-trigger startProcMotion 失败:', e);
            });
        } else {
            logWarn(
                'proc-motion',
                'Re-trigger skipped: procModelId cleared'
            );
        }
    }
}

export function stopProcMotion(): void {
    _procVmdActive = false;
    _stopRequested = true;
    // 感知层独立于程序化动作，不再随 stopProcMotion 注销
    // gaze 由 perception.ts 管理，always-on
    if (procModelId) {
        const inst = modelManager.get(procModelId);
        if (inst) {
            // [fix] 若用户已在程序化动作 active 期间加载了真实 VMD（vmdPath 非空），
            // 不可盲目清除 vmdData —— 否则会覆盖用户刚点击的动作。
            // 仅在模型未持有用户真实 VMD 时才清除程序化数据并 rebuild 到静止姿。
            const userVmdPresent = inst.vmdPath !== null && inst.vmdPath !== undefined && inst.vmdPath !== '';
            if (!userVmdPresent) {
                inst.vmdData = null;
                inst.vmdName = '';
                inst.vmdPath = null;
                rebuildCompositeAnimation(procModelId);
            }
        }
        procModelId = null;
    }
}

export function onModelRemoved(id: string): void {
    if (procModelId === id) {
        _procVmdActive = false;
        procModelId = null;
    }
    // 感知层清理
    onPerceptionModelRemoved(id);
}

export async function updateProcMotion(): Promise<void> {
    const st = _refProcState();
    if (st.mode === 'off' && !st.autoSwitch) {
        if (_procVmdActive) {
            stopProcMotion();
        }
        return;
    }

    // Issue #1: focusedModel() 可能为 null/undefined
    const model = focusedModel();
    const audioOn = isAudioPlaying();
    // [fix:adr-129/proc-slot] 程序化动作现已写入 inst.vmdData（替代旧直写 setRuntimeAnimation，
    // 见 startProcMotion 内注），故不能再用 vmdData 判定"用户/场景 VMD 是否存在"——
    // 否则每帧 onBeforeRender 调用的 updateProcMotion 会把程序化数据误判为"用户 VMD"，
    // 触发 stopProcMotion() 清空 vmdData，导致动作1（基础槽位）程序化瞬间失效。
    // 正确判别依据：inst.vmdPath。程序化动作 vmdPath 恒为 null（startProcMotion 显式置空），
    // 用户/场景 VMD 则必有非空 vmdPath（applyIntentToModel / loadVMDFromPath 写入）。
    const hasUserVmd = !!model?.vmdPath;
    const mode = st.mode;
    const autoOk = mode !== 'off' || st.autoSwitch;
    const wantAutoDance = shouldAutoDance(audioOn, mode) && autoOk;
    const wantIdle = shouldIdle(audioOn, hasUserVmd, mode) && autoOk;

    if (hasUserVmd && _procVmdActive) {
        stopProcMotion();
        return;
    }

    if (wantAutoDance && !hasUserVmd && procBeatDetector) {
        const bpm = procBeatDetector.getBPM() ?? 120;
        if (!_procVmdActive || procActiveKind !== 'autodance' || Math.abs(bpm - lastBeatBpm) > 10) {
            await startProcMotion('autodance', bpm);
        }
        return;
    }

    if (wantIdle && !hasUserVmd) {
        if (!_procVmdActive || procActiveKind !== 'idle') {
            await startProcMotion('idle');
        }
        return;
    }
}

export function setProcMotionMode(mode: ProcMotionMode): void {
    _writeProcState({ mode });
    if (mode === 'off') {
        stopProcMotion();
    }
    triggerAutoSave();
}

export function setProcMotionIntensity(v: number): void {
    _writeProcState({ intensity: clamp01(v) });
    triggerAutoSave();
}

export function setProcMotionSpeed(v: number): void {
    _writeProcState({ speed: Math.max(0.5, Math.min(2, v)) });
    triggerAutoSave();
}

export function setProcMotionAutoSwitch(on: boolean): void {
    _writeProcState({ autoSwitch: on });
    triggerAutoSave();
}

export function getProcMotionState(): ProcMotionState {
    return { ..._refProcState() };
}

/** 设置程序化动作状态（从存储恢复时使用，不触发自动保存以免干扰反序列化）。
 *  外部直接调用此函数时，请确保调用者在合适时机手动触发保存。 */
export function setProcMotionState(s: ProcMotionState): void {
    const intent = getActiveMotion();
    if (intent) {
        intent.procMotion = { ...s } as ProcMotionConfig;
    }
    _fallbackProcState = { ...s };
}

// ======== 新增开关 Getter/Setter（P0/P1） ========

/** 设置单个微动效果的开关 */
export function setProcMotionBoneToggle(cat: ProcMotionBoneCategory, v: boolean): void {
    if (!PROC_MOTION_BONE_CATEGORIES.includes(cat)) {
        logWarn('proc-motion', `invalid bone category: ${cat}`);
        return;
    }
    if (typeof v !== 'boolean') {
        logWarn('proc-motion', 'setProcMotionBoneToggle: invalid value type, expected boolean');
        return;
    }
    const bt = { ..._refProcState().boneToggles };
    bt[cat] = v;
    _writeProcState({ boneToggles: bt });
    triggerAutoSave();
}

/** 批量设置微动效果开关 */
export function setProcMotionBoneToggles(
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
    const cur = _refProcState();
    _writeProcState({ boneToggles: { ...cur.boneToggles, ...bt } });
    triggerAutoSave();
}

export function setProcMotionVpdApplyEnabled(v: boolean): void {
    if (typeof v !== 'boolean') {
        logWarn(
            'proc-motion',
            'setProcMotionVpdApplyEnabled: invalid value type, expected boolean'
        );
        return;
    }
    _writeProcState({ vpdApplyEnabled: v });
    triggerAutoSave();
}

export function setProcMotionInterpOverride(v: ProcMotionState['interpOverride']): void {
    const valid = ['auto', 'sharp', 'ease-in-out', 'ease-out'] as const;
    if (!valid.includes(v as (typeof valid)[number])) {
        logWarn('proc-motion', `setProcMotionInterpOverride: invalid value "${v}"`);
        return;
    }
    _writeProcState({ interpOverride: v });
    triggerAutoSave();
}

/** 设置 BPM 量化开关 */
export function setBpmQuantizeEnabled(v: boolean): void {
    if (typeof v !== 'boolean') {
        logWarn('proc-motion', 'setBpmQuantizeEnabled: invalid value type, expected boolean');
        return;
    }
    setUIState({ bpmQuantizeEnabled: v });
    if (procBeatDetector) {
        procBeatDetector.setBpmQuantizeEnabled(v);
    }
}

export function getBpmQuantizeEnabled(): boolean {
    return procBeatDetector?.getBpmQuantizeEnabled() ?? true;
}

/** 通用视线/头部追踪设定（重建追踪以应用新值）。 */
function _setGazeTrackingSetting(
    field: 'eyeTrackingEnabled' | 'headTrackingEnabled',
    value: boolean
): void {
    _writeProcState({ [field]: value } as Partial<ProcMotionState>);
    // 同步到 perception.ts（内部已调用 triggerAutoSave）
    const st = _refProcState();
    setGazeConfig(st.headTrackingEnabled, st.eyeTrackingEnabled);
    // 重新激活感知层（应用新配置）
    activatePerception();
}

/** 设置眼部跟随开关（实时效果，不重新生成 VMD）。 */
export function setProcMotionEyeTrackingEnabled(v: boolean): void {
    _setGazeTrackingSetting('eyeTrackingEnabled', v);
}

/** 设置头部跟随开关（实时效果，不重新生成 VMD）。 */
export function setProcMotionHeadTrackingEnabled(v: boolean): void {
    _setGazeTrackingSetting('headTrackingEnabled', v);
}

/** 自动激活视线追踪 observer（不依赖程序化动作生命周期）。
 *  由模型加载 / 焦点切换路径在 mmdModel 就绪后调用，使默认 gaze 配置立即生效。 */
export function activateGazeTracking(): void {
    activatePerception();
}

/** 图层驱动的视线/头部控制。
 *  由 vmd-layers 在调整 gaze 图层时调用。
 *  - intensity > 0 且 active → 启用眼部追踪
 *  - intensity >= 0.5 且 active → 同时启用头部追踪
 *  - 否则禁用两者。
 *  不干涉 _setGazeTrackingSetting 内部重建逻辑。 */
export function setGazeLayerActive(active: boolean, intensity: number): void {
    const shouldEnable = active && intensity > 0;
    setProcMotionEyeTrackingEnabled(shouldEnable);
    setProcMotionHeadTrackingEnabled(shouldEnable && intensity >= 0.5);
}

export function regenerateProcMotion(
    /** [P5 per-slot] 显式指定目标模型；不传时回退到焦点模型（向后兼容）。 */
    modelId?: string
): void {
    if (!_procVmdActive && _refProcState().mode === 'off') {
        return;
    }
    // [P5 per-slot] 优先使用传入的 modelId；否则回退到焦点
    const targetModel = modelId
        ? (modelManager.get(modelId)?.mmdModel ?? null)
        : focusedMmdModel();
    if (!targetModel) {
        logWarn('proc-motion', 'regenerateProcMotion: 无目标 MMD 模型，跳过');
        return;
    }
    // Issue #4: 如果 regenerate 调用时正在生成，标记 deferred 重跑
    if (procStarting) {
        _regeneratePending = true;
        return;
    }
    const mode = _refProcState().mode === 'autodance' ? ('autodance' as const) : ('idle' as const);
    // Issue #5: procBeatDetector 可能为 null
    const bpm = procBeatDetector?.getBPM() ?? 120;
    startProcMotion(mode, mode === 'autodance' ? bpm : undefined, modelId);
}
