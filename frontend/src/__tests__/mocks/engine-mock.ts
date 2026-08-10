// Minimal Engine mock — replaces @babylonjs/core/Engines/engine
// to avoid esbuild parsing the real source (which has _renderLoops
// class fields that CI esbuild cannot handle).
//
// 收敛单一源：Engine 类直接 re-export babylon-classes 的 MockEngine，
// 不再各自内联（此前 3 份拷贝：babylon-classes / 本文件 / setup-wails 内联，
// renderPassId 行为不一——计数器 vs 恒 0）。vitest.config.ts 的 alias 与本文件
// 目标一致；setup-wails.ts 的 vi.mock 也引用这里，三处同源。
export { MockEngine as Engine } from './babylon-classes';
