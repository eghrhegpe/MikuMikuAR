// [doc:adr-269] 场景共享状态槽 — 把「谁都需要的那几个可变引用」从 938 行的装配器里拆出来。
//
// 为什么需要这个文件：
//   `scene/scene.ts` 是纯装配器（文件头自述），它 import 了全部子系统与 Babylon 副作用入口
//   （physicsEngineComponent / webgl2ParticleSystem / mmdOutlineRenderer / sharedToonTextures /
//   mmdWasmRuntimeModelAnimation …）。任何只想读一个 `scene` 或 `modelManager` 的模块，此前都必须
//   import 整个装配器，于是被拖进整张场景图 —— 既拉长了测试的模块初始化，也让 scene.ts 成为
//   文件级强连通分量（SCC）里被指最密的节点，25 个文件的环群全挂在它身上。
//
// 口径（关键，改这个文件前先读）：
//   - 本文件**只能有 `import type`**，不得引入任何 Babylon 运行时值或子系统模块。
//     这条约束是它存在的理由：零运行时出边 ⇒ 它永远进不了任何环，成为一个安全的汇点。
//     若在此文件加一条运行时 import，SCC 会立刻把它卷回去，收益全部作废。
//   - 槽是 `let` + setter：ESM 的 import 绑定是只读的，装配器无法直接赋值，只能经 setter 写入。
//     读取方拿到的是 live binding，setter 写入后立刻可见（HMR 重建 scene/engine 依赖此语义）。
//   - 语义与迁移前完全一致：仍是模块级单例，仍在模块求值时创建，仍在 HMR 时被替换。
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import type { ModelManager } from './manager/model-manager';

/** vitest 测试态（MODE==='test'）。测试态无 WebGL，装配器据此跳过相机系统与 SDEF 注入。 */
export const isTestEnv = import.meta.env.MODE === 'test';

// [doc:adr-229] Headless E2E 模式：URL 带 ?e2e=1（vitePage fixture 导航时注入）即走 NullEngine。
// 测试态在前短路：vitest MODE==='test' 永不触发 headless 判定。
export const isHeadless =
    !isTestEnv &&
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).has('e2e');

/** Babylon 渲染引擎。由 `scene/scene.ts` 在模块求值时写入，HMR 重入时被替换。 */
export let engine: Engine;

/** Babylon 场景。由 `scene/scene.ts` 在模块求值时写入，HMR 重入时被替换。 */
export let scene: Scene;

/** 模型管理器。由 `scene/scene.ts` 的 `initScene()` 创建（依赖 MMD runtime，晚于 scene/engine）。 */
export let modelManager: ModelManager;

/** 写入引擎槽。仅供 `scene/scene.ts` 装配器与 HMR 重建路径调用。 */
export function setEngine(next: Engine): void {
    engine = next;
}

/** 写入场景槽。仅供 `scene/scene.ts` 装配器与 HMR 重建路径调用。 */
export function setScene(next: Scene): void {
    scene = next;
}

/** 写入模型管理器槽。仅供 `scene/scene.ts` 的 `initScene()` 调用。 */
export function setModelManager(next: ModelManager): void {
    modelManager = next;
}
