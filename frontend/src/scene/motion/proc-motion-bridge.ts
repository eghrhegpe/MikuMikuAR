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
import {
    setGazeConfig,
    onPerceptionModelRemoved,
    activatePerception,
} from './perception';
import { clamp01, logWarn } from '@/core/utils';

let procState: ProcMotionState = { ...DEFAULT_PROC_STATE };
let procBeatDetector: BeatDetector | null = null;
let _procVmdActive = false;
let lastBeatBpm = 120;
let procStarting = false;
let _regeneratePending = false;
let procActiveKind: ProcMotionMode = 'idle';
let procModelId: string | null = null;

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

async function startProcMotion(targetMode: ProcMotionMode, bpm?: number): Promise<void> {
    if (procStarting) {
        return;
    }
    procStarting = true;

    // 保存加载前的模型 ID，防止 await 后焦点切换导致操作错配（Issue #3）
    const modelAtStart = focusedMmdModel();
    const modelIdAtStart = focusedModelId ?? null;
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

    // Issue #2: bpm 无效时降级为 idle，保持状态一致
    const bpmValid = bpm !== null && bpm !== undefined && bpm > 0 && Number.isFinite(bpm);
    if (targetMode === 'autodance' && bpmValid) {
        buf = generateAutoDanceVmd(procState, bpm!, morphNames, boneNames);
        lastBeatBpm = bpm!;
        procActiveKind = 'autodance';
    } else {
        buf = generateIdleVmd(procState, morphNames, boneNames);
        procActiveKind = targetMode === 'autodance' ? 'idle' : targetMode;
    }

    // 【已移除 debug 下载代码】

    _procVmdActive = true;
    procModelId = modelIdAtStart;
    try {
        // D4: await 前检查焦点是否已切换，避免无意义的 VMD 加载（CPU 浪费）
        if (focusedModelId !== modelIdAtStart) {
            logWarn('proc-motion', '焦点已在生成期间切换，取消本次程序化动作');
            procStarting = false;
            return;
        }
        await loadVMDMotion(
            buf,
            targetMode === 'autodance' && bpmValid ? PROC_VMD_NAME_AUTODANCE : PROC_VMD_NAME_IDLE
        );

        // Issue #3: 验证焦点模型是否在异步期间被切换
        const currentId = focusedModelId ?? null;
        // Issue #4: 验证异步期间用户是否加载了真实 VMD（竞态时序保护）
        // 对比 vmdData 与当前生成的 buf：若不同且非空，说明用户加载了其他 VMD
        const curInst = modelManager.get(modelIdAtStart);
        const vmdDataAfter = curInst?.vmdData;
        const userVmdDuringAsync =
            vmdDataAfter !== buf && vmdDataAfter !== null && vmdDataAfter !== undefined;
        if (currentId !== modelIdAtStart) {
            logWarn('proc-motion', '异步期间模型焦点已切换，丢弃本次程序化动作结果');
            // 卸载刚加载的程序化动画
            const inst = modelManager.get(currentId);
            if (inst && inst.mmdModel && mmdRuntime) {
                inst.mmdModel.setRuntimeAnimation(null);
            }
            _procVmdActive = false;
            procModelId = null;
            procActiveKind = 'idle';
        } else if (userVmdDuringAsync) {
            // 异步期间用户加载了真实 VMD，不覆盖 vmdData
            logWarn('proc-motion', '异步期间用户加载了 VMD，跳过本次程序化动作');
            _procVmdActive = false;
            procModelId = null;
            procActiveKind = 'idle';
        } else {
            _clearVmdData(focusedModel());
            // 感知层独立激活，不依赖程序化动作生命周期
            // gaze 由 perception.ts 管理，在模型加载后自动激活
        }
    } catch {
        _procVmdActive = false;
        _clearVmdData(focusedModel());
    } finally {
        procStarting = false;
    }

    // Re-trigger check after finally (cannot use return inside finally — no-unsafe-finally)
    if (_regeneratePending) {
        _regeneratePending = false;
        if (procModelId && focusedModelId === procModelId) {
            const mode = procState.mode === 'autodance' ? 'autodance' : 'idle';
            const bpm = procBeatDetector?.getBPM() ?? 120;
            startProcMotion(mode, mode === 'autodance' ? bpm : undefined);
        } else {
            logWarn(
                'proc-motion',
                'Re-trigger skipped: focusedModelId changed or procModelId cleared'
            );
        }
    }
}

export function stopProcMotion(): void {
    _procVmdActive = false;
    // 感知层独立于程序化动作，不再随 stopProcMotion 注销
    // gaze 由 perception.ts 管理，always-on
    if (procModelId) {
        const inst = modelManager.get(procModelId);
        if (inst && inst.mmdModel && mmdRuntime) {
            inst.mmdModel.setRuntimeAnimation(null);
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
    if (procState.mode === 'off' && !procState.autoSwitch) {
        if (_procVmdActive) {
            stopProcMotion();
        }
        return;
    }

    // Issue #1: focusedModel() 可能为 null/undefined
    const model = focusedModel();
    const audioOn = isAudioPlaying();
    const hasUserVmd = model?.vmdData !== null && model?.vmdData !== undefined;
    const mode = procState.mode;
    const autoOk = mode !== 'off' || procState.autoSwitch;
    const wantAutoDance = shouldAutoDance(audioOn, mode) && autoOk;
    const wantIdle = shouldIdle(audioOn, hasUserVmd, mode) && autoOk;

    if (hasUserVmd && _procVmdActive) {
        stopProcMotion();
        return;
    }

    if (wantAutoDance && !hasUserVmd && procBeatDetector) {
        const bpm = procBeatDetector.getBPM();
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
    procState = { ...procState, mode };
    if (mode === 'off') {
        stopProcMotion();
    }
    triggerAutoSave();
}

export function setProcMotionIntensity(v: number): void {
    procState = { ...procState, intensity: clamp01(v) };
    triggerAutoSave();
}

export function setProcMotionSpeed(v: number): void {
    procState = { ...procState, speed: Math.max(0.5, Math.min(2, v)) };
    triggerAutoSave();
}

export function setProcMotionAutoSwitch(on: boolean): void {
    procState = { ...procState, autoSwitch: on };
    triggerAutoSave();
}

export function getProcMotionState(): ProcMotionState {
    return { ...procState };
}

/** 设置程序化动作状态（从存储恢复时使用，不触发自动保存以免干扰反序列化）。
 *  外部直接调用此函数时，请确保调用者在合适时机手动触发保存。 */
export function setProcMotionState(s: ProcMotionState): void {
    procState = { ...s };
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
    const bt = { ...procState.boneToggles };
    bt[cat] = v;
    procState = { ...procState, boneToggles: bt };
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
    procState = { ...procState, boneToggles: { ...procState.boneToggles, ...bt } };
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
    procState = { ...procState, vpdApplyEnabled: v };
    triggerAutoSave();
}

export function setProcMotionInterpOverride(v: ProcMotionState['interpOverride']): void {
    const valid = ['auto', 'sharp', 'ease-in-out', 'ease-out'] as const;
    if (!valid.includes(v as (typeof valid)[number])) {
        logWarn('proc-motion', `setProcMotionInterpOverride: invalid value "${v}"`);
        return;
    }
    procState = { ...procState, interpOverride: v };
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
    procState = { ...procState, [field]: value };
    // 同步到 perception.ts（内部已调用 triggerAutoSave）
    setGazeConfig(procState.headTrackingEnabled, procState.eyeTrackingEnabled);
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

let _gazeLayerActive = false;

/** 图层驱动的视线/头部控制。
 *  由 vmd-layers 在调整 gaze 图层时调用。
 *  - intensity > 0 且 active → 启用眼部追踪
 *  - intensity >= 0.5 且 active → 同时启用头部追踪
 *  - 否则禁用两者。
 *  不干涉 _setGazeTrackingSetting 内部重建逻辑。 */
export function setGazeLayerActive(active: boolean, intensity: number): void {
    _gazeLayerActive = active;
    const shouldEnable = active && intensity > 0;
    setProcMotionEyeTrackingEnabled(shouldEnable);
    setProcMotionHeadTrackingEnabled(shouldEnable && intensity >= 0.5);
}

export function regenerateProcMotion(): void {
    if (!_procVmdActive && procState.mode === 'off') {
        return;
    }
    // 无焦点模型时静默返回，添加警告辅助调试
    if (!focusedMmdModel()) {
        logWarn('proc-motion', 'regenerateProcMotion: 无焦点 MMD 模型，跳过');
        return;
    }
    // Issue #4: 如果 regenerate 调用时正在生成，标记 deferred 重跑
    if (procStarting) {
        _regeneratePending = true;
        return;
    }
    const mode = procState.mode === 'autodance' ? ('autodance' as const) : ('idle' as const);
    // Issue #5: procBeatDetector 可能为 null
    const bpm = procBeatDetector?.getBPM() ?? 120;
    startProcMotion(mode, mode === 'autodance' ? bpm : undefined);
}
