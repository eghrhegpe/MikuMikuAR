// [doc:architecture] Barrel re-export — preserves all imports from pre-split config.ts.
// See individual modules for actual implementation:
//   types.ts — type definitions
//   state.ts — mutable global state + setters
//   dom.ts   — DOM element references
//   utils.ts — utility functions

export * from './types';
export * from './state';
export * from './dom';
export * from './utils';
