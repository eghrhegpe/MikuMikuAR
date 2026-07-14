// [doc:architecture] LipSync — 口型同步
// 规范文档: docs/architecture.md §LipSync
// 职责: 人声频段能量检测 → morph 权重映射
// 依赖: initLipSync(mm) 注入 ModelManager，由 scene.ts 在 initScene 中调用

import {
    LipSyncState as LipSyncStateType,
    DEFAULT_LIPSYNC_STATE,
} from '@/motion-algos/lipsync';
import { clamp01 } from '@/core/utils';
import { focusedModelId, triggerAutoSave } from '@/core/config';
import { setModelMorphWeight } from '../scene';

export function initLipSync(_mm: import('../manager/model-manager').ModelManager): void {
}

let lipSyncState: LipSyncStateType = { ...DEFAULT_LIPSYNC_STATE };
let lipSyncMorphName: string | null = null;
let lipSyncMorphSet: {
    open: string | null;
    close: string | null;
    pucker: string | null;
    smile: string | null;
} | null = null;

export function setLipSyncEnabled(on: boolean): void {
    lipSyncState.enabled = on;
    if (!on) {
        resetLipMorph();
        lipSyncMorphName = null; // 立即失效，防止后续误用
    }
    triggerAutoSave();
}

export function setLipSyncSensitivity(v: number): void {
    lipSyncState.sensitivity = clamp01(v);
    triggerAutoSave();
}

export function setLipSyncIntensity(v: number): void {
    lipSyncState.intensity = clamp01(v);
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
