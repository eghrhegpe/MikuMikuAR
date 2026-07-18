// [doc:adr-125] Motion History — 模块层 setParam 撤销/重做历史栈
// 职责: per-model 历史快照管理（push / undo / redo / applySnapshot）
// 设计: 与 registry 解耦——pushHistory 接受 snapshotBuilder 回调，
//       由 module-base.ts 闭包捕获 registry 函数，避免循环依赖。

import type { ParamValue } from '@/core/types';

// ── 类型 ──

export interface MotionHistoryEntry {
    timestamp: number;
    snapshot: Record<string, { enabled: boolean; params: Record<string, ParamValue> }>;
    description: string;
}

interface ModelHistoryState {
    entries: MotionHistoryEntry[];
    cursor: number;
}

// ── 常量 ──

const MAX_HISTORY = 50;

// ── 内部状态 ──

const _historyMap = new Map<string, ModelHistoryState>();

function _getState(modelId: string): ModelHistoryState {
    let s = _historyMap.get(modelId);
    if (!s) {
        s = { entries: [], cursor: -1 };
        _historyMap.set(modelId, s);
    }
    return s;
}

// ── 外部回调类型（由 module-base 闭包提供） ──

/** 构建当前全量快照的回调（调用方负责从 registry 读状态） */
export type SnapshotBuilder = () => MotionHistoryEntry['snapshot'];

/** 应用快照到引擎的回调（调用方负责从 registry 读模块实例并 setState/enable/disable） */
export type SnapshotApplier = (snapshot: MotionHistoryEntry['snapshot']) => void;

// ── 合并窗口（时间窗口 + 同参数合并，per-model 隔离） ──

interface MergeState {
    lastPushTime: number;
    lastModuleId: string;
    lastParamName: string;
    pendingEntry: MotionHistoryEntry | null;
}

const _mergeMap = new Map<string, MergeState>();

function _getMerge(modelId: string): MergeState {
    let m = _mergeMap.get(modelId);
    if (!m) {
        m = { lastPushTime: 0, lastModuleId: '', lastParamName: '', pendingEntry: null };
        _mergeMap.set(modelId, m);
    }
    return m;
}

function _shouldMerge(modelId: string, moduleId: string, paramName: string): boolean {
    const m = _getMerge(modelId);
    const now = Date.now();
    const withinWindow = now - m.lastPushTime < 500;
    const sameParam = m.lastModuleId === moduleId && m.lastParamName === paramName;
    return withinWindow && sameParam;
}

function _recordLast(modelId: string, moduleId: string, paramName: string): void {
    const m = _getMerge(modelId);
    m.lastPushTime = Date.now();
    m.lastModuleId = moduleId;
    m.lastParamName = paramName;
}

// ── 公开 API ──

/**
 * 记录一次参数变更到历史栈。
 * @param modelId  目标模型
 * @param moduleId  模块 ID
 * @param paramName  参数名
 * @param prev  变更前的值
 * @param next  变更后的值
 * @param buildSnapshot  构建当前全量快照的回调
 */
export function pushHistory(
    modelId: string,
    moduleId: string,
    paramName: string,
    prev: ParamValue,
    next: ParamValue,
    buildSnapshot: SnapshotBuilder
): void {
    const merge = _getMerge(modelId);
    if (_shouldMerge(modelId, moduleId, paramName)) {
        if (merge.pendingEntry) {
            merge.pendingEntry.description = `${moduleId}.${paramName}: ${prev} → ${next}`;
            merge.pendingEntry.snapshot = buildSnapshot();
            _recordLast(modelId, moduleId, paramName);
            return;
        }
    }
    const entry: MotionHistoryEntry = {
        timestamp: Date.now(),
        snapshot: buildSnapshot(),
        description: `${moduleId}.${paramName}: ${prev} → ${next}`,
    };
    _writeEntry(modelId, entry);
    merge.pendingEntry = entry;
    _recordLast(modelId, moduleId, paramName);
}

function _writeEntry(modelId: string, entry: MotionHistoryEntry): void {
    const state = _getState(modelId);
    // 截断 redo 分支
    state.entries = state.entries.slice(0, state.cursor + 1);
    state.entries.push(entry);
    // 上限裁剪
    if (state.entries.length > MAX_HISTORY) {
        state.entries.splice(0, state.entries.length - MAX_HISTORY);
    }
    state.cursor = state.entries.length - 1;
}

/** 撤销一步（恢复到上一条快照），返回是否成功 */
export function undo(modelId: string, applySnapshot: SnapshotApplier): boolean {
    const state = _getState(modelId);
    if (state.cursor < 0) return false;
    const nextCursor = state.cursor - 1;
    if (nextCursor < 0) {
        // 退回到初始状态：恢复所有模块到默认（禁用 + 空 params）
        applySnapshot({});
    } else {
        applySnapshot(state.entries[nextCursor].snapshot);
    }
    state.cursor = nextCursor;
    return true;
}

/** 重做一步（恢复到下一条快照），返回是否成功 */
export function redo(modelId: string, applySnapshot: SnapshotApplier): boolean {
    const state = _getState(modelId);
    if (state.cursor >= state.entries.length - 1) return false;
    const nextCursor = state.cursor + 1;
    applySnapshot(state.entries[nextCursor].snapshot);
    state.cursor = nextCursor;
    return true;
}

/** 是否有可撤销的记录 */
export function canUndo(modelId: string): boolean {
    return _getState(modelId).cursor >= 0;
}

/** 是否有可重做的记录 */
export function canRedo(modelId: string): boolean {
    const state = _getState(modelId);
    return state.cursor < state.entries.length - 1;
}

/** 获取历史条目列表（UI 显示用） */
export function getHistoryEntries(modelId: string): readonly MotionHistoryEntry[] {
    return _getState(modelId).entries;
}

/** 获取当前游标位置（UI 高亮用） */
export function getHistoryCursor(modelId: string): number {
    return _getState(modelId).cursor;
}

/**
 * [doc:adr-125 P3] 跳转到指定历史位置。
 * targetIndex 为 -1 表示回到初始状态，0..n 表示应用对应条目的快照。
 * 返回是否成功。
 */
export function jumpToHistory(
    modelId: string,
    targetIndex: number,
    applySnapshot: SnapshotApplier
): boolean {
    const state = _getState(modelId);
    if (targetIndex < -1 || targetIndex >= state.entries.length) return false;
    if (targetIndex === state.cursor) return false; // 已在目标位置
    if (targetIndex === -1) {
        applySnapshot({});
    } else {
        applySnapshot(state.entries[targetIndex].snapshot);
    }
    state.cursor = targetIndex;
    return true;
}

/** 清除指定模型的历史（删除模型时调用） */
export function clearHistory(modelId: string): void {
    _historyMap.delete(modelId);
    _mergeMap.delete(modelId);
}
