// [doc:architecture] LipSync — 口型同步
// 规范文档: docs/architecture.md §LipSync
// 职责: 人声频段能量检测 → morph 权重映射
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import {
    LipSyncState as LipSyncStateType,
    DEFAULT_LIPSYNC_STATE,
    findLipMorph,
    amplitudeToWeight,
} from '../motion/lipsync';
import { modelRegistry, focusedModelId, triggerAutoSave } from '../core/config';
import { isAudioPlaying } from '../outfit/audio';
import { setModelMorphWeight } from './scene';
import { getProcBeatDetector } from './scene-proc-motion';

let lipSyncState: LipSyncStateType = { ...DEFAULT_LIPSYNC_STATE };
let lipSyncMorphName: string | null = null;

const VOICE_BIN_START = 10;
const VOICE_BIN_END = 50;

export function setLipSyncEnabled(on: boolean): void {
    lipSyncState.enabled = on;
    if (!on) {
        resetLipMorph();
    }
    triggerAutoSave();
}

export function setLipSyncSensitivity(v: number): void {
    lipSyncState.sensitivity = Math.max(0, Math.min(1, v));
    triggerAutoSave();
}

export function setLipSyncIntensity(v: number): void {
    lipSyncState.intensity = Math.max(0, Math.min(1, v));
    triggerAutoSave();
}

export function getLipSyncState(): LipSyncStateType {
    return { ...lipSyncState };
}

export function setLipSyncState(s: LipSyncStateType): void {
    lipSyncState = { ...s };
}

export function resetLipSyncOnFocusChange(): void {
    lipSyncMorphName = null;
}

function resetLipMorph(): void {
    if (lipSyncMorphName && focusedModelId) {
        setModelMorphWeight(focusedModelId, lipSyncMorphName, 0);
    }
}

export function updateLipSync(): void {
    if (!lipSyncState.enabled) {
        return;
    }
    if (!isAudioPlaying()) {
        resetLipMorph();
        return;
    }
    const modelId = focusedModelId;
    if (!modelId) {
        lipSyncMorphName = null;
        return;
    }
    const inst = modelRegistry.get(modelId);
    if (!inst.mmdModel.morph) {
        lipSyncMorphName = null;
        return;
    }

    const morphs = inst.mmdModel.morph.morphs;
    if (!lipSyncMorphName || !morphs.some((m: any) => m.name === lipSyncMorphName)) {
        lipSyncMorphName = findLipMorph(morphs.map((m: any) => m.name));
    }
    if (!lipSyncMorphName) {
        return;
    }

    const beatDetector = getProcBeatDetector();
    const level = beatDetector ? beatDetector.getLevel(VOICE_BIN_START, VOICE_BIN_END) : 0;
    const weight = amplitudeToWeight(level, lipSyncState.sensitivity, lipSyncState.intensity);
    setModelMorphWeight(modelId, lipSyncMorphName, weight);
}
