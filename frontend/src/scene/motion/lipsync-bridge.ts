// [doc:architecture] LipSync — 口型同步
// 规范文档: docs/architecture.md §LipSync
// 职责: 人声频段能量检测 → morph 权重映射
// 依赖: initLipSync(mm) 注入 ModelManager，由 scene.ts 在 initScene 中调用

import {
    LipSyncState as LipSyncStateType,
    DEFAULT_LIPSYNC_STATE,
    findLipMorph,
    findAllLipMorphs,
    amplitudeToWeight,
} from '../../motion-algos/lipsync';
import { focusedModelId, triggerAutoSave } from '../../core/config';
import { isAudioPlaying } from '../../outfit/audio';
import { setModelMorphWeight } from '../scene';
import { getProcBeatDetector } from './proc-motion-bridge';

let _modelManager: import('../manager/model-manager').ModelManager | null = null;

export function initLipSync(mm: import('../manager/model-manager').ModelManager): void {
    _modelManager = mm;
}

let lipSyncState: LipSyncStateType = { ...DEFAULT_LIPSYNC_STATE };
let lipSyncMorphName: string | null = null;
let lipSyncMorphSet: { open: string | null; close: string | null; pucker: string | null; smile: string | null } | null = null;
let lastFocusedId: string | null = null;

// morphName 缓存：避免每帧 O(M) 扫描 morphs 数组 + 数组分配
let _lastCachedModelId: string | null = null;
let _lastMorphNames: string[] = [];
let _lastMorphNameSet = new Set<string>();

// 平滑滤波器状态（低通滤波，减少 morph 权重抖动）
let _smoothLow = 0;
let _smoothHigh = 0;

const VOICE_BIN_START = 10;
const VOICE_BIN_END = 50;
// 高频频段（用于 smile morph 驱动）
const HIGH_BIN_START = 25;
const HIGH_BIN_END = 50;

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

export function setLipSyncMultiMorphEnabled(v: boolean): void {
    lipSyncState.multiMorphEnabled = v;
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
    lipSyncMorphSet = null;
}

function resetLipMorph(): void {
    if (lipSyncMorphName && focusedModelId) {
        setModelMorphWeight(focusedModelId, lipSyncMorphName, 0);
    }
    // 重置 smile morph
    if (lipSyncMorphSet?.smile && focusedModelId) {
        setModelMorphWeight(focusedModelId, lipSyncMorphSet.smile, 0);
    }
}

export function updateLipSync(): void {
    if (!lipSyncState.enabled) {
        return;
    }
    if (!isAudioPlaying()) {
        resetLipMorph();
        _smoothLow = 0;
        _smoothHigh = 0;
        return;
    }
    const modelId = focusedModelId;
    // 聚焦变化时自动重置 morph 名，消除对外部 resetLipSyncOnFocusChange 的依赖
    if (modelId !== lastFocusedId) {
        lipSyncMorphName = null;
        lipSyncMorphSet = null;
        lastFocusedId = modelId;
    }
    if (!modelId) {
        lipSyncMorphName = null;
        lipSyncMorphSet = null;
        return;
    }
    const inst = _modelManager?.modelRegistry.get(modelId);
    if (!inst) {
        lipSyncMorphName = null;
        lipSyncMorphSet = null;
        return;
    }
    if (!inst.mmdModel.morph) {
        lipSyncMorphName = null;
        lipSyncMorphSet = null;
        return;
    }

    const morphs = inst.mmdModel.morph.morphs;
    // morphName 缓存：仅 modelId 变化时重建，消除每帧 O(M) 扫描 + 数组分配
    if (modelId !== _lastCachedModelId) {
        _lastCachedModelId = modelId;
        _lastMorphNames = morphs.map((m) => m.name);
        _lastMorphNameSet = new Set(_lastMorphNames);
    }
    if (!lipSyncMorphName || !_lastMorphNameSet.has(lipSyncMorphName)) {
        lipSyncMorphName = findLipMorph(_lastMorphNames);
        lipSyncMorphSet = findAllLipMorphs(_lastMorphNames);
    }
    if (!lipSyncMorphName) {
        return;
    }

    const beatDetector = getProcBeatDetector();
    const lowLevel = beatDetector ? beatDetector.getLevel(VOICE_BIN_START, VOICE_BIN_END) : 0;
    const highLevel = beatDetector ? beatDetector.getLevel(HIGH_BIN_START, HIGH_BIN_END) : 0;

    // 低通滤波（平滑抖动，系数 0.7 旧值 + 0.3 新值）
    _smoothLow = _smoothLow * 0.7 + lowLevel * 0.3;
    _smoothHigh = _smoothHigh * 0.7 + highLevel * 0.3;

    const openWeight = amplitudeToWeight(_smoothLow, lipSyncState.sensitivity, lipSyncState.intensity);
    setModelMorphWeight(modelId, lipSyncMorphName, openWeight);

    // 多 Morph LipSync：驱动多个口型 morph
    if (lipSyncState.multiMorphEnabled && lipSyncMorphSet) {
        // close：与 open 反比（嘴开时 close=0，嘴闭时 close=1）
        if (lipSyncMorphSet.close) {
            const closeWeight = amplitudeToWeight(1 - _smoothLow, lipSyncState.sensitivity, lipSyncState.intensity);
            setModelMorphWeight(modelId, lipSyncMorphSet.close, closeWeight);
        }
        // pucker：由高频能量驱动（模拟「う」口型）
        if (lipSyncMorphSet.pucker) {
            const puckerWeight = amplitudeToWeight(_smoothHigh * 0.8, lipSyncState.sensitivity, lipSyncState.intensity);
            setModelMorphWeight(modelId, lipSyncMorphSet.pucker, puckerWeight);
        }
    }

    // 高频能量大时轻微微笑（模拟说话表情）
    if (lipSyncMorphSet?.smile) {
        const smileWeight = Math.max(0, openWeight * 0.3 - 0.1);
        setModelMorphWeight(modelId, lipSyncMorphSet.smile, smileWeight);
    }
}
