// [doc:architecture] Barrel re-export — preserves all imports from pre-split config.ts.
// See individual modules for actual implementation:
//   types.ts      — type definitions
//   state.ts      — barrel re-export of the 4 state stores (ADR-141) + envState
//   scene-state.ts    — scene runtime (mmdRuntime / modelRegistry / propRegistry / focusedModelId)
//   playback-state.ts — playback control (isPlaying / autoLoop / seekDragging)
//   library-state.ts  — library / resource (paths / cache / sort / recent motions)
//   ui-state.ts       — UI persistent (popupOpen / uiState / activeTimeOfDayPreset)
//   dom.ts        — DOM element references
//   utils.ts      — utility functions
//   ui-helpers.ts — DOM/UI builder helpers
//   status-bar.ts — status bar + hint system
//   toast.ts      — error toast notifications

export * from './types';
export * from './state';
export * from './dom';
export * from './utils';
export * from './ui-helpers';
export * from './status-bar';
export * from './toast';
