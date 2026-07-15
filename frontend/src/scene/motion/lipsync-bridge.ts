// [doc:architecture] LipSync — 口型同步桥接层
// 规范文档: docs/architecture.md §LipSync
// 职责: 保持外部导入路径兼容，所有 setter/getter 转发到 perception.ts
// 运行时逻辑已由 perception.ts 的 _applyLipSync 负责，本文件仅做状态桥接。

import { LipSyncState as LipSyncStateType } from '@/motion-algos/lipsync';
import {
    setLipSyncEnabled as _setPerceptionLipSyncEnabled,
    setLipSyncSensitivity as _setPerceptionLipSyncSensitivity,
    setLipSyncIntensity as _setPerceptionLipSyncIntensity,
    setLipSyncMultiMorphEnabled as _setPerceptionLipSyncMultiMorph,
    getPerceptionState,
    setPerceptionState,
} from './perception';
import type { PerceptionState } from './perception-shared';

export function initLipSync(_mm: import('../manager/model-manager').ModelManager): void {
    // no-op: 逻辑已迁入 perception.ts
}

/** 从 PerceptionState 提取 LipSyncState（兼容旧序列化格式） */
function _toLipSyncState(p: PerceptionState): LipSyncStateType {
    return {
        enabled: p.lipSyncEnabled,
        sensitivity: p.lipSyncSensitivity,
        intensity: p.lipSyncIntensity,
        multiMorphEnabled: p.lipSyncMultiMorphEnabled,
    };
}

/** 从 LipSyncState 写回 PerceptionState 的 lip-sync 字段 */
function _fromLipSyncState(s: LipSyncStateType): Partial<PerceptionState> {
    return {
        lipSyncEnabled: s.enabled,
        lipSyncSensitivity: s.sensitivity,
        lipSyncIntensity: s.intensity,
        lipSyncMultiMorphEnabled: s.multiMorphEnabled,
    };
}

export function setLipSyncEnabled(on: boolean): void {
    _setPerceptionLipSyncEnabled(on);
}

export function setLipSyncSensitivity(v: number): void {
    _setPerceptionLipSyncSensitivity(v);
}

export function setLipSyncIntensity(v: number): void {
    _setPerceptionLipSyncIntensity(v);
}

export function setLipSyncMultiMorphEnabled(v: boolean): void {
    _setPerceptionLipSyncMultiMorph(v);
}

export function getLipSyncState(): LipSyncStateType {
    return _toLipSyncState(getPerceptionState());
}

export function setLipSyncState(s: LipSyncStateType): void {
    setPerceptionState(_fromLipSyncState(s));
}

export function resetLipSyncOnFocusChange(): void {
    // no-op: morph 缓存由 perception-lipsync.ts 按 modelId 自动重建
}

/**
 * @deprecated 已迁入 perception.ts 的 _applyLipSync。
 * 保留空壳避免外部引用断裂，实际逻辑已由 perception observer 调度。
 */
export function updateLipSync(): void {
    // no-op: 逻辑已迁入 perception.ts
}
