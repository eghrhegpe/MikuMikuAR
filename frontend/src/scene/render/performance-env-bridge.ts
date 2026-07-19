// performance-env-bridge.ts — ADR-130 Phase 2.3: 性能降级 ↔ 反射质量联动桥接
//
// 此模块用于打破 performance.ts ↔ env-bridge.ts 的循环依赖。
// performance.ts 设置标志，env-bridge.ts 读取标志。
// 同时提供 setEnvState 的延迟绑定，避免循环导入。

import type { EnvState } from '@/core/config';

/** 标志：当前反射质量变更来自自动降级（非用户手动） */
let _autoDegradingReflection = false;

/** performance.ts 调用此函数通知 env-bridge 当前反射质量变更来自自动降级 */
export function setAutoDegradingReflection(value: boolean): void {
    _autoDegradingReflection = value;
}

/** env-bridge.ts 调用此函数检查当前是否处于自动降级反射质量变更中 */
export function isAutoDegradingReflection(): boolean {
    return _autoDegradingReflection;
}

/** setEnvState 延迟绑定函数（由 env-bridge.ts 初始化时设置） */
let _setEnvState: ((partial: Partial<EnvState>, skipAutoSave?: boolean) => void) | null = null;

/** env-bridge.ts 初始化时注册 setEnvState 函数 */
export function registerSetEnvState(fn: (partial: Partial<EnvState>, skipAutoSave?: boolean) => void): void {
    _setEnvState = fn;
}

/** performance.ts 调用此函数设置 envState（延迟绑定，避免循环导入） */
export function setEnvStateForPerformance(partial: Partial<EnvState>, skipAutoSave?: boolean): void {
    if (_setEnvState) {
        _setEnvState(partial, skipAutoSave);
    }
}
