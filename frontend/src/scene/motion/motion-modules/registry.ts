// [doc:adr-129] Motion Override Module Registry — 内置模块装配层
// 职责: 聚合内置模块 DEF、幂等注册、把 initMotionModules 注入状态机钩子。
// [doc:adr-271] 状态机在 registry-core.ts（叶子）；本文件是唯一 import DEF 工厂的地方，
// 因此 DEF 工厂不再反向依赖装配层，6 元强连通分量消失。
// 对外 API 与拆分前一致：下方 export * 转发状态机，外部消费者无需改动。

import type { ModuleDef } from './types';
import { registerModule, registerInitHook } from './registry-core';
import { BODY_POSTURE_DEF } from './body-posture';
import { LEFT_HAND_DEF, RIGHT_HAND_DEF } from './hand-modules';
import { RIDING_MODEL_DEF } from './riding-model';
import { LEFT_FOOT_DEF, RIGHT_FOOT_DEF } from './foot-modules';

export * from './registry-core';

// ── 内置模块自动注册 ──

let _initialized = false;

/**
 * 内置模块定义聚合（供 initMotionModules 批量注册，消除 6 个 registerXxx 分散调用）。
 * 使用惰性求值函数而非顶层数组字面量：模块求值期捕获 DEF 值会因求值顺序出现 TDZ
 * （典型：测试先 import hand-modules 再 import registry → LEFT_HAND_DEF 为 undefined）。
 */
export function getBuiltinModuleDefs(): ModuleDef[] {
    return [
        BODY_POSTURE_DEF,
        LEFT_HAND_DEF,
        RIGHT_HAND_DEF,
        RIDING_MODEL_DEF,
        LEFT_FOOT_DEF,
        RIGHT_FOOT_DEF,
    ];
}

/** 注册所有内置模块（幂等，重复调用安全） */
export function initMotionModules(): void {
    if (_initialized) {
        return;
    }
    for (const def of getBuiltinModuleDefs()) {
        registerModule(def.id, def.meta, def.priority, def.factory);
    }
    _initialized = true;
}

registerInitHook(initMotionModules);
