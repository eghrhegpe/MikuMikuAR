// library.ts — 入口：注册表初始化 + re-export

// Re-export 保持外部 API 不变
export {
    showModelPopup,
    initLibrary,
    rescanAndSync,
    reloadConfig,
    refreshLibrary,
} from './library-core';
export { showMotionPopup, hideMotionPopup } from './motion-popup';
export type { ModelPresetFile } from './model-preset';
export { serializeModelPreset, applyModelPreset } from './model-preset';
