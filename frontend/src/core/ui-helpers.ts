// [doc:architecture] UI Helpers — barrel re-export
// 拆分后的各组件均从独立文件 re-export，调用方无需改 import

export type { ControlOptions } from './ui-types';
export { slideRow } from './ui-slide-row';
export type { SlideRowExtra, HeaderToggleConfig } from './ui-slide-row';
export {
    addToggleRow,
    addSliderRow,
    addModeRow,
    sliderRow,
    toggleRow,
    addDangerRow,
    addFieldRow,
} from './ui-rows';
export {
    addColorSliderRow,
    addModeSlider,
} from './ui-advanced-rows';
export {
    addCollapsible,
    addSectionTitle,
    addPresetChip,
} from './ui-collapsible';
