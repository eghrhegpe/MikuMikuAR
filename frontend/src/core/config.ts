// [doc:architecture] Barrel re-export — preserves all imports from pre-split config.ts.
// See individual modules for actual implementation:
//   types.ts      — type definitions
//   state.ts      — mutable global state + setters
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
