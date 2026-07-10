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
} from '@/motion-algos/lipsync';
import { focusedModelId, triggerAutoSave } from '@/core/config';
import { isAudioPlaying, getAudioPath } from '@/outfit/audio';
import { setModelMorphWeight } from '../scene';
import { getProcBeatDetector } from './proc-motion-bridge';

let _modelManager: import('../manager/model-manager').ModelManager | null = null;

export function initLipSync(mm: import('../manager/model-manager').ModelManager): void {
    _modelManager = mm;
}

let lipSyncState: LipSyncStateType = { ...DEFAULT_LIPSYNC_STATE };
let lipSyncMorphName: string | null = null;
let lipSyncMorphSet: {
    open: string | null;
    close: string | null;
    pucker: string | null;
    smile: string | null;
} | null = null;
const lastFocusedId: string | null = null;

// morphName 缓存：避免每帧 O(M) 扫描 morphs 数组 + 数组分配
const _lastCachedModelId: string | null = null;
const _lastMorphNames: string[] = [];
const _lastMorphNameSet = new Set<string>();

// 平滑滤波器状态（低通滤波，减少 morph 权重抖动）
const _smoothLow = 0;
const _smoothHigh = 0;

// #10: Track last audio path to detect audio source changes
const _lastAudioPath = '';

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

/**
 * @deprecated 已迁入 perception.ts 的 _applyLipSync。
 * 保留空壳避免外部引用断裂，实际逻辑已由 perception observer 调度。
 */
export function updateLipSync(): void {
    // no-op: 逻辑已迁入 perception.ts
}
