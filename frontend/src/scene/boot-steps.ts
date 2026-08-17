/**
 * [doc:adr-273] 场景启动 plan 的**内容**：24 个步骤的顺序、依赖与产出。
 *
 * 这个文件只描述"谁先谁后、谁给谁什么"，不含任何 scene 内部实现——真正干活的是
 * {@link BootHooks} 里的回调，由 `scene/scene.ts` 注入。这样拆的理由：
 *   - 顺序表可以单测（不需要拉起 Babylon / 整张场景图）；
 *   - 想调换两个步骤，改的是这里的数组、跑的是 `validateBootPlan()`，而不是
 *     "把两行代码拖上去，希望没人发现"。
 *
 * 顺序与原 `_doInitScene()` 逐行等价（2026-10 迁移时的现状）：每一步的注释保留了
 * 原先写在语句上方的约束说明，这些约束现在同时被 `requires` 声明强制。
 */

import { defineBootStep, type BootResource, type BootStep } from './boot-plan';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { BeatDetector } from '@/motion-algos/beat-detector';
import type { ModelManager } from './manager/model-manager';

/**
 * 每一步真正要干的活，由装配器（`scene/scene.ts`）注入。
 *
 * 参数只在**确有资源流动**的地方声明：`initLoader` 需要 runtime 与 modelManager，
 * 就有两个参数；`initLighting` 只依赖闭包里的 `scene`，因此无参。别为了"整齐"
 * 给每个钩子都塞一个 ctx——那样等于把隐式依赖重新糊回一个对象里。
 */
export interface BootHooks {
    /** 注册 PMX / 纹理 loader 与材质构建器（必须早于任何一次模型加载）。 */
    initMmdLoaders(): Promise<void>;
    /** 创建 MMD 运行时（MPR/SPR、WASM 物理、HDR 徽标、setMmdRuntime）。 */
    initMmdRuntime(): Promise<IMmdRuntime>;
    /** 给刚建好的运行时挂风力注入（仅 WASM 运行时生效，JS 运行时是空操作）。 */
    startWindPhysics(runtime: IMmdRuntime): void;
    /** 按当前 envState 还原地面碰撞——读的是 mmdRuntime live binding，晚调用即静默失效。 */
    applyGroundCollision(): void;
    /** 初始化光照（含 `_envSys.shadow` 的 ShadowGenerator 接线）。 */
    initLighting(): void;
    /** 初始化渲染管线（后处理、阴影、`pipeline` 全局单例在此被填充）。 */
    initRenderer(): void;
    /** 初始化环境门面（体积云 / 天空 / 水面等，依赖上面的 `pipeline`）。 */
    initEnvFacade(): void;
    /** 创建节拍检测器（不接线，只造对象）。 */
    createBeatDetector(): BeatDetector;
    /** 把节拍检测器挂到场景动作上（消费上面的对象）。 */
    attachBeatDetector(beat: BeatDetector): void;
    /** 绑定指针 / 拖拽等场景事件。 */
    bindSceneEvents(): void;
    /** 注入运行时回调（模型加载完成、动画更新等钩子）。 */
    injectRuntimeCallbacks(runtime: IMmdRuntime): Promise<void>;
    /** 创建 ModelManager 并写入 scene-context 槽（须在 Loader 之前）；返回刚写入的实例。 */
    initModelManager(runtime: IMmdRuntime): ModelManager;
    /** 注入模型层回调（`triggerAutoSave` 递归保护在此注册）。 */
    injectModelCallbacks(manager: ModelManager, runtime: IMmdRuntime): void;
    /** 初始化 Loader（必须拿到已就绪的 runtime、modelManager 与已注册的 loader）。 */
    initLoader(runtime: IMmdRuntime, manager: ModelManager): void;
    /** 初始化播放 observables，返回 dispose 句柄。 */
    initPlayback(runtime: IMmdRuntime, manager: ModelManager): () => void;
    /** 脚部地面跟随（ADR-085 / ADR-116，always-on 基础设施）。 */
    initFeetAdjustment(): Promise<void>;
    /** 脚步声系统（ADR-088）：消费脚部跟随产生的落地事件。 */
    initFootstep(): Promise<void>;
    /** 骨骼覆盖系统（ADR-116）：动画应用后逐骨骼覆盖。 */
    initBoneOverride(): Promise<void>;
    /** WASM IK 重解回调注入（ADR-202），依赖骨骼覆盖已启动 + 运行时已就绪。 */
    initWasmIkResolver(): Promise<void>;
    /** Motion Override Modules 注册（ADR-116），必须在任何 focusModel 之前完成。 */
    initMotionModules(): Promise<void>;
    /** 应用初始环境状态（须在光照与环境门面之后）。 */
    applyEnvState(): void;
    /** 刷新太阳/天空圆盘（须在光照之后）。 */
    updateSunDisc(): void;
    /** 注册渲染桥（性能面板读写 render/light 状态）。 */
    registerRenderBridge(): void;
    /** 注册 AI 快照桥（惰性 getter，HMR 重建后仍读最新实例）。 */
    registerAiBridge(): void;
}

/**
 * 构建启动 plan。返回值可以直接交给 `runBootPlan()`，也可以先交给
 * `validateBootPlan()` 做静态检查（测试里就是这么用的）。
 *
 * 每次调用都产生**全新的** plan 与资源表：`runBootPlan()` 的 `satisfied` 是局部变量，
 * 所以 HMR 重入时不会因为"上一轮已经 provide 过"而跳过步骤——这是设计使然，别把它
 * 提到模块作用域去共享。
 */
export function buildBootPlan(hooks: BootHooks): readonly BootStep<BootResource>[] {
    return [
        defineBootStep({
            id: 'mmd-loaders',
            // 注册的是"以后加载 PMX 时用哪个 loader"；必须在任何一次模型加载之前。
            requires: [],
            provides: ['mmd-loaders'],
            run: async () => {
                await hooks.initMmdLoaders();
                return { 'mmd-loaders': undefined };
            },
        }),
        defineBootStep({
            id: 'mmd-runtime',
            requires: [],
            provides: ['mmd-runtime'],
            run: async () => ({ 'mmd-runtime': await hooks.initMmdRuntime() }),
        }),
        defineBootStep({
            id: 'wind-physics',
            // initWindPhysics(runtime) 的参数类型本身已经钉住了"运行时先于风"；这一行
            // 仍写成独立的步，是为了让"风注入发生过"在 plan 里可见（dispose 侧要对应）。
            requires: ['mmd-runtime'],
            provides: ['wind-physics'],
            run: (deps) => {
                hooks.startWindPhysics(deps['mmd-runtime']);
                return { 'wind-physics': undefined };
            },
        }),
        defineBootStep({
            id: 'ground-collision',
            // 地面碰撞经 mmdRuntime live binding 取 physics impl：早于 setMmdRuntime 调用时
            // impl 为 null，函数体 return 得干干净净——没有异常、没有日志、地板就是不存在。
            requires: ['mmd-runtime'],
            provides: ['ground-collision'],
            run: () => {
                hooks.applyGroundCollision();
                return { 'ground-collision': undefined };
            },
        }),
        defineBootStep({
            id: 'lighting',
            requires: [],
            provides: ['lighting'],
            run: () => {
                hooks.initLighting();
                return { lighting: undefined };
            },
        }),
        defineBootStep({
            id: 'renderer',
            requires: [],
            provides: ['renderer'],
            run: () => {
                hooks.initRenderer();
                return { renderer: undefined };
            },
        }),
        defineBootStep({
            id: 'env-facade',
            // 环境门面吃的是 renderer 模块里的 pipeline 单例：renderer 没跑，pipeline 就是 undefined。
            requires: ['renderer'],
            provides: ['env'],
            run: () => {
                hooks.initEnvFacade();
                return { env: undefined };
            },
        }),
        defineBootStep({
            id: 'beat-detector',
            requires: [],
            provides: ['beat'],
            run: () => ({ beat: hooks.createBeatDetector() }),
        }),
        defineBootStep({
            id: 'beat-attach',
            requires: ['beat'],
            provides: ['beat-attach'],
            run: (deps) => {
                hooks.attachBeatDetector(deps.beat);
                return { 'beat-attach': undefined };
            },
        }),
        defineBootStep({
            id: 'scene-events',
            requires: ['env'],
            provides: ['scene-events'],
            run: () => {
                hooks.bindSceneEvents();
                return { 'scene-events': undefined };
            },
        }),
        defineBootStep({
            id: 'runtime-callbacks',
            requires: ['mmd-runtime'],
            provides: ['runtime-callbacks'],
            run: async (deps) => {
                await hooks.injectRuntimeCallbacks(deps['mmd-runtime']);
                return { 'runtime-callbacks': undefined };
            },
        }),
        defineBootStep({
            id: 'model-manager',
            requires: ['mmd-runtime'],
            provides: ['model-manager'],
            // 槽在这里被 setModelManager 填充；后续步骤拿到的就是这个实例（由钩子返回，
            // 而不是让它们各自去读模块级 let——那正是"类型撒谎"的老路）。
            run: (deps) => ({ 'model-manager': hooks.initModelManager(deps['mmd-runtime']) }),
        }),
        defineBootStep({
            id: 'model-callbacks',
            requires: ['model-manager', 'mmd-runtime'],
            provides: ['model-callbacks'],
            run: (deps) => {
                hooks.injectModelCallbacks(deps['model-manager'], deps['mmd-runtime']);
                return { 'model-callbacks': undefined };
            },
        }),
        defineBootStep({
            id: 'loader',
            // [doc:adr-273] 原注释：Loader 必须在 modelManager + setTriggerAutoSave 之后。
            // 'mmd-loaders' 是新声明的第二条：模型加载器没注册就加载 PMX，报错信息会指向
            // "没有对应的 loader"，与真正原因（注册被挪后）隔着一整层。
            requires: ['mmd-loaders', 'mmd-runtime', 'model-manager'],
            provides: ['loader'],
            run: (deps) => {
                hooks.initLoader(deps['mmd-runtime'], deps['model-manager']);
                return { loader: undefined };
            },
        }),
        defineBootStep({
            id: 'playback',
            requires: ['mmd-runtime', 'model-manager'],
            provides: ['playback'],
            run: (deps) => {
                hooks.initPlayback(deps['mmd-runtime'], deps['model-manager']);
                return { playback: undefined };
            },
        }),
        defineBootStep({
            id: 'feet-adjustment',
            // 脚部跟随不依赖 ModelManager（它读 modelRegistry 的 runtimeBones），所以原先
            // _initMotionSubsystems(modelManager) 的形参其实没人用——这里不留假依赖。
            requires: [],
            provides: ['feet-adjustment'],
            run: async () => {
                await hooks.initFeetAdjustment();
                return { 'feet-adjustment': undefined };
            },
        }),
        defineBootStep({
            id: 'footstep',
            // [doc:adr-273] 原注释：必须在 startFeetAdjustment 之后注册（落地事件由脚部跟随产生）。
            requires: ['feet-adjustment'],
            provides: ['footstep'],
            run: async () => {
                await hooks.initFootstep();
                return { footstep: undefined };
            },
        }),
        defineBootStep({
            id: 'bone-override',
            requires: [],
            provides: ['bone-override'],
            run: async () => {
                await hooks.initBoneOverride();
                return { 'bone-override': undefined };
            },
        }),
        defineBootStep({
            id: 'wasm-ik-resolver',
            // [doc:adr-273] 原注释：HMR 重入时 stopBoneOverride 清除旧 resolver，_initMmdRuntime
            // 设新 mmdRuntime 后重注。所以两条前提都必须在场：骨骼覆盖已注册、运行时已就绪。
            requires: ['bone-override', 'mmd-runtime'],
            provides: ['wasm-ik-resolver'],
            run: async () => {
                await hooks.initWasmIkResolver();
                return { 'wasm-ik-resolver': undefined };
            },
        }),
        defineBootStep({
            id: 'motion-modules',
            // [doc:adr-273] 原注释：必须在 focusModel 可能被调用之前完成。focusModel 由用户
            // 操作触发，无法用资源表达，故只保留"排在交互之前"的位置约束。
            // 实测 initMotionModules()（motion-modules/registry.ts:37）只往表里注册模块定义，
            // 不读 mmdRuntime——所以这里**不留假依赖**（同理于 feet-adjustment 不 require
            // model-manager）。它的约束是"位置"，不是"资源"。
            requires: [],
            provides: ['motion-modules'],
            run: async () => {
                await hooks.initMotionModules();
                return { 'motion-modules': undefined };
            },
        }),
        defineBootStep({
            id: 'env-state',
            requires: ['lighting', 'env'],
            provides: ['env-state'],
            run: () => {
                hooks.applyEnvState();
                return { 'env-state': undefined };
            },
        }),
        defineBootStep({
            id: 'sun-disc',
            requires: ['lighting'],
            provides: ['sun-disc'],
            run: () => {
                hooks.updateSunDisc();
                return { 'sun-disc': undefined };
            },
        }),
        defineBootStep({
            id: 'render-bridge',
            requires: ['lighting', 'renderer'],
            provides: ['render-bridge'],
            run: () => {
                hooks.registerRenderBridge();
                return { 'render-bridge': undefined };
            },
        }),
        defineBootStep({
            id: 'ai-bridge',
            requires: ['renderer', 'model-manager'],
            provides: ['ai-bridge'],
            run: () => {
                hooks.registerAiBridge();
                return { 'ai-bridge': undefined };
            },
        }),
    ];
}
