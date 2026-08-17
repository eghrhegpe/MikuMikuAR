/**
 * frame-registry.ts — 每帧回调的单一调度注册表
 *
 * 背景（治理 R1）：场景里曾散落 ~22 处裸 `observe(scene.onBeforeRenderObservable, ...)`，
 * 每个子系统各自挂一个观察者，既无统一错误隔离，也无统一生命周期。此模块是那场
 * 收敛的唯一收口：一个 scene 对应一个 registry，内部只持有**一条** observer，
 * 按 key 分发给多个每帧回调。
 *
 * 原来这份代码住在 `scene/physics/physics-bridge.ts`（抽取自原 XPBD 的 repeated
 * observer 模式），但其依赖只有 core 层的 `observe` / `safeCallVoid` 与 type-only
 * 的 `Scene`，没有任何物理语义——**通用机制不该寄住在专业模块里**，否则其它子系统
 * （相机/环境/灯光）想复用就得先 import 物理桥。故上移至 core。
 *
 * 用法：
 *   const registry = new PerFrameUpdateRegistry(scene);
 *   registry.register('mySubsystem', (dt) => { ... });   // dt 单位：秒
 *   registry.unregister('mySubsystem');
 *   // scene 销毁时自动 dispose；也可显式 registry.dispose()
 *
 * 多子系统共享（推荐）：各业务模块不要各自 new 一个 registry——那会把「22 条
 * observer」稀释成「N 个 registry 各持 1 条 observer」，observer 数量没降下来，
 * 只是换了主人。用 `getFrameRegistry(scene)` 拿同一张表，全场景仍只有一条 observer：
 *   import { getFrameRegistry } from '@/core/frame-registry';
 *   getFrameRegistry(scene).register('env.water.update', cb);
 *
 * 排序契约（重要，两套顺序别混）：
 *  1. **表内顺序**：同一张表里 callback 的执行顺序 = `register` 的先后序（Map 保序）。
 *  2. **表外顺序**：这张表只挂**一条** observer，它在 `scene.onBeforeRenderObservable`
 *     里的位置 = 本表**首次 register() 的时刻**。Babylon 按 observer 插入序执行，
 *     所以本表的回调整体排在「首次 register 之后才注册」的 observer **之前**。
 *
 * 由此得出使用禁忌：**不要把「依赖 bone-override 覆盖之后」的回调放进本表**。
 * 场景初始化期的 observer 插入序（`scene/scene.ts`）：
 *   ① mmd `_afterPhysicsBinded`（写本帧骨骼矩阵，scene.ts:434 → runtime.register:839）
 *      ② 本表 observer（首次 register 落在 scene.ts:435 `initLighting` → lighting.ts:193）
 *      ③ personalLightTick / ④ stageFollowTick / ⑤ footstep-fallback
 *      ⑥ bone-override driver（**写** override 覆盖，scene.ts:731）
 *      ⑦ 运行时创建的 bone-override 后置回调（camera-bone-lock / 骨骼叠加 / virtual-skirt）
 * ⇒ 本表排在 ⑥ **之前**：表内回调读到的是**本帧、但尚未应用 override** 的骨骼矩阵。
 *   「需要 override 后骨骼」的回调（⑦ 那批）目前留在自己的 observer 上，
 *   等「阶段锚点」机制落地后再迁（ADR-263）。
 */

import type { Scene } from '@babylonjs/core/scene';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeCallVoid } from '@/core/safe-call';

// ============================================================================
// 每帧 update 编排（抽取自原 XPBD 在 model-manager 中重复的 observer 模式）
// ============================================================================

export type FrameUpdateFn = (dtSeconds: number) => void;

/**
 * 单一 onBeforeRenderObservable 调度多个按 key 注册的每帧回调。
 * 原 XPBD 的 ensureClothUpdateObserver / ensureRagdollUpdateObserver 是同一模式的副本，
 * 此处统一为可复用的注册表。dt 做了非有限值/后台恢复钳制。
 */
export class PerFrameUpdateRegistry {
    private observer: ObserverHandle | null = null;
    private readonly fns = new Map<string, FrameUpdateFn>();
    private _disposeHandle: ObserverHandle | null = null;
    private _disposed = false;

    constructor(private readonly scene: Scene) {
        // P2-fix: 绑定 scene.onDisposeObservable，scene 销毁时自动清理，
        // 避免 HMR 重建场景时旧注册表残留 observer 挂在已销毁 scene 上
        // 防御：部分 mock scene（单测）无 onDisposeObservable，容忍跳过
        this._bindDisposeHandle();
    }

    private _bindDisposeHandle(): void {
        if (this._disposeHandle || !this.scene.onDisposeObservable) {
            return;
        }
        this._disposeHandle = observe(this.scene.onDisposeObservable, () => this.dispose());
    }

    register(key: string, fn: FrameUpdateFn): void {
        if (this._disposed) {
            // 允许 dispose 后重新使用：恢复生命周期绑定，避免新 observer 失去
            // scene.onDisposeObservable 自动清理而泄漏。
            this._disposed = false;
            this._bindDisposeHandle();
        }
        this.fns.set(key, fn);
        this.ensure();
    }

    unregister(key: string): void {
        if (this._disposed) {
            return;
        }
        if (!this.fns.delete(key)) {
            return;
        }
        if (this.fns.size === 0) {
            // [fix P3] 仅停 observer，不释放 _disposeHandle：dispose() 会置 null
            // onDispose 绑定，导致「unregister 清空 → 再 register」后 scene 销毁时
            // 自动清理永久丢失。onDispose 生命周期应与 scene 对齐，而非 fns 空否。
            this._removeObserver();
        }
    }

    private _removeObserver(): void {
        if (this.observer) {
            this.observer.dispose();
            this.observer = null;
        }
    }

    private ensure(): void {
        if (this._disposed || this.observer) {
            return;
        }
        this.observer = observe(this.scene.onBeforeRenderObservable, () => {
            const rawDt = this.scene.deltaTime / 1000; // ms -> s
            if (!isFinite(rawDt) || rawDt <= 0) {
                return; // 非有限值 / 非正数：跳过
            }
            // 钳制最大步长（50ms），避免后台标签页恢复后极大 dt 导致物理/动画失稳或脱节
            const dt = Math.min(rawDt, 0.05);
            // [fix:round16 P2] 快照迭代：防止回调内 register/unregister 修改 Map 导致迭代器行为不确定
            for (const fn of [...this.fns.values()]) {
                // dispose 可能在回调内被调用（如 virtual-skirt 自毁）：置位后立即停止
                // 本帧剩余回调，避免已释放注册表继续调度。
                if (this._disposed) {
                    break;
                }
                safeCallVoid('PerFrameUpdateRegistry', 'update error', () => fn(dt));
            }
        });
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._removeObserver();
        if (this._disposeHandle) {
            this._disposeHandle.dispose();
            this._disposeHandle = null;
        }
        this.fns.clear();
    }
}

// ============================================================================
// 场景键共享注册表
// ============================================================================

/**
 * 每个 Scene 一张共享分发表的访问器。
 *
 * 为什么需要它：`new PerFrameUpdateRegistry(scene)` 是「一次性」用法，适合单一
 * 所有者（如 virtual-skirt 自持自销）。但相机/环境/灯光等多个子系统若各自 new，
 * 每条 observer 只是从「业务模块」搬到了「模块私有 registry」—— observer 总数
 * 没变，治理 R1 的收口目标（全场景一条 onBeforeRenderObservable）就没达成。
 *
 * WeakMap 以 Scene 为键：scene 被 GC 时表项自动消失，无需手动清理；
 * HMR / scene 重建走的是新 Scene 对象，天然拿到新表，不会串味。
 * 已 dispose 的表项由 `register()` 内的 _disposed 复位逻辑自愈（见上）。
 */
const _sceneRegistries = new WeakMap<Scene, PerFrameUpdateRegistry>();

/** 取（或惰性创建）该 scene 的共享每帧分发表。 */
export function getFrameRegistry(scene: Scene): PerFrameUpdateRegistry {
    let reg = _sceneRegistries.get(scene);
    if (!reg) {
        reg = new PerFrameUpdateRegistry(scene);
        _sceneRegistries.set(scene, reg);
    }
    return reg;
}
