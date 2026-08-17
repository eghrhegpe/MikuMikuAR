// library.ts — 入口：注册表初始化 + re-export
//
// [doc:adr-271] 转发目标改直连真实定义处：library-core 的转发边已删
// （library-core ↔ library-browse/library-actions/library-setup 的转发把
//  library 子系统 8 个文件闭合成一个 SCC）。本文件因此也不能再经 library-core 借符号。

export { showModelPopup } from './library-browse';
export { initLibrary, refreshLibrary } from './library-setup';
export { showMotionPopup } from './motion-popup';
export type { ModelPresetFile } from './model-preset';
export { serializeModelPreset, applyModelPreset } from './model-preset';
