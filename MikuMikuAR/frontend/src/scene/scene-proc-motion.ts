// [doc:architecture] Procedural Motion — 程序化动作系统
// 规范文档: docs/architecture.md §程序化动作
// 职责: Idle / Auto Dance 状态管理、VMD 生成调度、节拍联动
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import {
    ProcMotionState,
    ProcMotionMode,
    DEFAULT_PROC_STATE,
    generateIdleVmd,
    generateAutoDanceVmd,
    shouldAutoDance,
    shouldIdle,
} from '../motion/procedural-motion';
import { BeatDetector } from '../motion/beat-detector';
import { mmdRuntime, triggerAutoSave, focusedModelId } from '../core/config';
import { isAudioPlaying } from '../outfit/audio';
import { modelManager, focusedMmdModel, focusedModel, loadVMDMotion } from './scene';

let procState: ProcMotionState = { ...DEFAULT_PROC_STATE };
let procBeatDetector: BeatDetector | null = null;
export let procVmdActive = false;
let lastBeatBpm = 120;
let procStarting = false;
let procActiveKind: ProcMotionMode = 'idle';
let procModelId: string | null = null;

export function getProcBeatDetector(): BeatDetector | null {
    return procBeatDetector;
}

export function createProcBeatDetector(): BeatDetector {
    procBeatDetector = new BeatDetector();
    return procBeatDetector;
}

async function startProcMotion(targetMode: ProcMotionMode, bpm?: number): Promise<void> {
    if (procStarting) {
        return;
    }
    procStarting = true;
    const model = focusedMmdModel();
    if (!model) {
        procStarting = false;
        return;
    }
    const morphNames = model.morph.morphs.map((m: any) => m.name) ?? [];
    let buf: ArrayBuffer;
    if (targetMode === 'autodance' && bpm) {
        buf = generateAutoDanceVmd(procState, bpm, morphNames);
        lastBeatBpm = bpm;
    } else {
        buf = generateIdleVmd(procState, morphNames);
    }
    procActiveKind = targetMode;
    procVmdActive = true;
    procModelId = focusedModelId ?? null;
    try {
        await loadVMDMotion(buf, targetMode === 'autodance' ? 'AutoDance' : 'IdleMotion');
        const inst = focusedModel();
        if (inst) {
            inst.vmdData = null;
            inst.vmdName = '';
        }
    } catch {
        procVmdActive = false;
        const inst = focusedModel();
        if (inst) {
            inst.vmdData = null;
            inst.vmdName = '';
        }
    } finally {
        procStarting = false;
    }
}

export function stopProcMotion(): void {
    procVmdActive = false;
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
        procVmdActive = false;
        procModelId = null;
    }
}

export async function updateProcMotion(): Promise<void> {
    if (procState.mode === 'off' && !procState.autoSwitch) {
        if (procVmdActive) {
            stopProcMotion();
        }
        return;
    }

    const audioOn = isAudioPlaying();
    const hasUserVmd = focusedModel().vmdData != null;
    const mode = procState.mode;
    const autoOk = mode !== 'off' || procState.autoSwitch;
    const wantAutoDance = shouldAutoDance(audioOn, mode) && autoOk;
    const wantIdle = shouldIdle(audioOn, hasUserVmd, mode) && autoOk;

    if (hasUserVmd && procVmdActive) {
        stopProcMotion();
        return;
    }

    if (wantAutoDance && !hasUserVmd && procBeatDetector) {
        const bpm = procBeatDetector.getBPM();
        if (!procVmdActive || procActiveKind !== 'autodance' || Math.abs(bpm - lastBeatBpm) > 10) {
            await startProcMotion('autodance', bpm);
        }
        return;
    }

    if (wantIdle && !hasUserVmd) {
        if (!procVmdActive || procActiveKind !== 'idle') {
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
    procState = { ...procState, intensity: Math.max(0, Math.min(1, v)) };
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

export function setProcMotionState(s: ProcMotionState): void {
    procState = { ...s };
}

export function regenerateProcMotion(): void {
    if (!procVmdActive && procState.mode === 'off') {
        return;
    }
    const mode = procState.mode === 'autodance' ? ('autodance' as const) : ('idle' as const);
    const bpm = procBeatDetector.getBPM() ?? 120;
    startProcMotion(mode, mode === 'autodance' ? bpm : undefined);
}
