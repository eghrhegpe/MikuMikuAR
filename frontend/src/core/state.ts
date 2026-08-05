/**
 * [doc:architecture] Shared mutable state barrel for MikuMikuAR.
 *
 * ADR-141: 原 state.ts 已拆分为 scene / playback / library / ui 四个独立 store，
 * 本文件仅作 barrel re-export，保持 `from '@/core/state'` 与 `from '@/core/config'`
 * 的外部 import 路径零变化。各 store 的内部结构与访问规约见对应文件头部注释。
 *
 * 状态访问规约（[fix:ghost-state] P3 防御）：
 * - 所有 `export let` 仅供读取，外部模块禁止直接赋值。
 * - 修改必须通过对应的 `setXxx()` setter（单一写入点原则）。
 * - 引用类型变量（Map/Set/数组）**内容**可被 mutate，但**引用本身**替换必须走 setter。
 */

export * from './scene-state';
export * from './playback-state';
export * from './library-state';
export * from './ui-state';

// ======== Environment State (ADR-137 single source of truth) ========

import { reactive } from './reactivity';
import type { EnvState } from './types';
import { deriveDefaultEnvState } from './env-state-defaults';

// [doc:adr-243] 默认值从 schema 自动推导（原手工 148 字段映射已删除）。
// tuple3 字段在 derive 内部 slice() 克隆，保证 reactive 深层追踪不共享 schema 引用。
export const envState: EnvState = reactive<EnvState>(deriveDefaultEnvState());
