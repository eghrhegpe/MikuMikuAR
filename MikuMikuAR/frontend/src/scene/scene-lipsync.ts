// [doc:architecture] LipSync — 口型同步
// 规范文档: docs/architecture.md §LipSync
// 职责: 人声频段能量检测 → morph 权重映射
// 依赖: initLipSync(mm) 注入 ModelManager，由 scene.ts 在 initScene 中调用

import {
    LipSyncState as LipSyncStateType,
    DEFAULT_LIPSYNC_STATE,
    findLipMorph,
    amplitudeToWeight,
} from '../motion/lipsync';
import { focusedModelId, triggerAutoSave } from '../core/config';
import { isAudioPlaying } from '../outfit/audio';
import { setModelMorphWeight } from './scene';
import { getProcBeatDetector } from './scene-proc-motion';

let _modelManager: import('./scene-model').ModelManager | null = null;

export function initLipSync(mm: import('./scene-model').ModelManager): void {
    _modelManager = mm;
}

let lipSyncState: LipSyncStateType = { ...DEFAULT_LIPSYNC_STATE };
let lipSyncMorphName: string | null = null;
let lastFocusedId: string | null = null;

const VOICE_BIN_START = 10;
const VOICE_BIN_END = 50;

export function setLipSyncEnabled(on: boolean): void {
    lipSyncState.enabled = on;
    if (!on) {
        resetLipMorph();
        lipSyncMorphName = null; // 立即失效，防止后续误用
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
    // 聚焦变化时自动重置 morph 名，消除对外部 resetLipSyncOnFocusChange 的依赖
    if (modelId !== lastFocusedId) {
        lipSyncMorphName = null;
        lastFocusedId = modelId;
    }
    if (!modelId) {
        lipSyncMorphName = null;
        return;
    }
    const inst = _modelManager?.modelRegistry.get(modelId);
    if (!inst) {
        lipSyncMorphName = null;
        return;
    }
    if (!inst.mmdModel.morph) {
        lipSyncMorphName = null;
        return;
    }

    const morphs = inst.mmdModel.morph.morphs;
    if (!lipSyncMorphName || !morphs.some((m) => m.name === lipSyncMorphName)) {
        lipSyncMorphName = findLipMorph(morphs.map((m) => m.name));
    }
    if (!lipSyncMorphName) {
        return;
    }

    const beatDetector = getProcBeatDetector();
    const level = beatDetector ? beatDetector.getLevel(VOICE_BIN_START, VOICE_BIN_END) : 0;
    const weight = amplitudeToWeight(level, lipSyncState.sensitivity, lipSyncState.intensity);
    setModelMorphWeight(modelId, lipSyncMorphName, weight);
}
