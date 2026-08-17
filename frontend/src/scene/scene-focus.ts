// SceneFocus — 场景「焦点/装配器访问」窄门面
//
// [doc:adr-269 补充] 存在理由：
// scene/scene.ts 是装配器（938 行，import 47 个子系统）。scene/camera 与 scene/motion 的若干
// 文件原先直接从 scene.ts 取 modelManager / focusedModel / focusModel / reattachPipeline /
// getProcBeatDetector，而 scene.ts 又装配它们 —— 双向引用把装配器拖进一个 12 文件的强连通
// 分量。装配器一旦在环里，任何初始化顺序调整都可能踩到「部分初始化模块」。
//
// 本门面把「需要从装配器反向取的少量运行期访问器」收敛到一处，模块归属仍是 `scene`，
// 因此不新增任何模块级有向对（scene→core / scene/manager / scene/render / scene/motion 均已存在）。
//
// 与 core/config.ts 那类大 barrel 的区别：本文件只聚合 8 个语义同族的访问器，
// 不转发子系统实现；新增导出必须先问「它是不是焦点/装配访问器」，否则直接引叶子定义处。
//
// 只允许 re-export，不得在本文件写任何逻辑或模块顶层求值 —— 它在环里，顶层副作用会放大初始化风险。

// 共享槽（零运行时出边的 scene-context）
export { modelManager } from './scene-context';
// 焦点模型状态与动作
export { focusModel, focusedModel, focusedMmdModel } from './manager/model-ops';
// 渲染管线重挂（camera 切模式后重建 pipeline）
export { reattachPipeline } from './render/renderer';
// [doc:adr-269 补充] 节拍检测器不再经本门面转发——camera-auto 已改走 scene-action-bridge，
// 门面到 motion 的出边一旦消失，scene 与 scene/motion 就不再互相可达。
// 焦点 id 与自动保存触发器（真叶子定义处，不经 core/config barrel）
export { focusedModelId } from '@/core/scene-state';
export { triggerAutoSave } from '@/core/auto-save';
