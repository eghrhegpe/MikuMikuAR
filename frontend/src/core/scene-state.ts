/**
 * [doc:architecture] Scene runtime store — ADR-141 split from core/state.ts.
 *
 * 状态访问规约（[fix:ghost-state] P3 防御）：
 * - 本文件所有 `export let` 仅供读取，外部模块禁止直接赋值。
 * - 修改必须走对应的 `setXxx()` 写入点，保证状态变更可追踪（单一写入点原则）。
 * - 引用类型变量（Map/Set/数组）**内容**可被 mutate，但**引用本身**替换必须走 setter。
 */

import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { ModelInstance, FeetState } from './types';

// ======== MMD Runtime ========

export let mmdRuntime: IMmdRuntime | null = null;
export function setMmdRuntime(r: IMmdRuntime | null): void {
    mmdRuntime = r;
}

// ======== MMD Runtime Type Switch (WASM 物理 / JS 调试) ========
// [doc:adr-105] Fail-Fast：localStorage 不可用直接抛错，不再静默回落 env

const MMD_RUNTIME_TYPE_KEY = 'mmdRuntimeType';

export function getMmdRuntimeType(): 'wasm' | 'js' {
    const v = localStorage.getItem(MMD_RUNTIME_TYPE_KEY);
    if (v === 'js' || v === 'wasm') {
        return v;
    }
    return import.meta.env.VITE_MMD_RUNTIME === 'js' ? 'js' : 'wasm';
}

export function setMmdRuntimeType(v: 'wasm' | 'js'): void {
    // [doc:adr-105] Fail-Fast：运行时输入校验，非法值直接抛错，避免污染持久化状态
    if (v !== 'wasm' && v !== 'js') {
        throw new TypeError(`[scene-state] invalid mmd runtime type: ${String(v)}`);
    }
    localStorage.setItem(MMD_RUNTIME_TYPE_KEY, v);
}

// ======== Model Registry ========

export let modelRegistry = new Map<string, ModelInstance>();
export function setModelRegistry(m: Map<string, ModelInstance>): void {
    modelRegistry = m;
}

// ======== Feet Adjustment (ADR-085) Default ========

/** [doc:adr-085] 脚部地面跟随默认状态（Phase A 参数） */
export function createDefaultFeetState(): FeetState {
    return {
        enabled: false,
        intensity: 1,
        soleHeight: 0,
        jumpThreshold: 9999,
        bodySmooth: 0.5,
        footSmooth: 0.5,
        maxAngle: 30,
        reachAngle: 15,
    };
}

// ======== Focused Model ========

export let focusedModelId: string | null = null;
export function setFocusedModelId(id: string | null): void {
    focusedModelId = id;
}
