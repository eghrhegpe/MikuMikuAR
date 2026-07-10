// [doc:architecture] UI Helpers — barrel re-export
// 拆分后的各组件均从独立文件 re-export，调用方无需改 import

export type { ControlOptions } from './ui-types';
export { slideRow } from './ui-slide-row';
export type { SlideRowExtra, SlideAction, HeaderToggleConfig } from './ui-slide-row';
export {
    initControl,
    addToggleRow,
    addSliderRow,
    addModeRow,
    sliderRow,
    toggleRow,
    addDangerRow,
    addFieldRow,
    addEmptyRow,
    addWatchDirRow,
} from './ui-rows';
export { addColorSliderRow, addModeSlider } from './ui-advanced-rows';
export { addCollapsible, addSectionTitle, addPresetChip } from './ui-collapsible';
export { createResourcePanel } from './ui-resource-panel';
export type { ResourcePanelOptions, ResourcePanelHandle, ResourceItem } from './ui-resource-panel';
export { createVirtualGrid } from './ui-virtual-grid';
export type { VirtualGridOptions, VirtualGridHandle } from './ui-virtual-grid';
export {
    openFullscreen,
    closeFullscreen,
    getCurrentState,
    setCurrentState,
} from './ui-fullscreen-overlay';
export type {
    FullscreenOverlayOptions,
    FullscreenOverlayHandle,
    OverlayState,
} from './ui-fullscreen-overlay';
