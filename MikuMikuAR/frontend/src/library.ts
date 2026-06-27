// library.ts — 入口：注册表初始化 + re-export
import { stackRegistry } from "./config";
import { getSceneStack } from "./scene-menu";

// 注册 sceneStack getter
stackRegistry.sceneStackGetter = getSceneStack;

// Re-export 保持外部 API 不变
export { togglePopup, showPopup, hidePopup, initLibrary,
         rescanAndSync, reloadConfig, refreshLibrary,
         handlePopupSearchInput } from "./library-core";
export { showMotionPopup, hideMotionPopup } from "./motion-popup";
export type { ModelPresetFile } from "./model-preset";
export { serializeModelPreset, applyModelPreset } from "./model-preset";
