// ADR-147 Phase 1 — 显式动作管线调度器
//
// 治理根因 R1（双观察者隐式定序）与 R2（帧钩子插入序决定同骨获胜者）：
// 所有骨骼写入层**显式注册**并声明 `stage`，调度器按 (stageIndex, order) 升序统一执行，
// 注册时序与 import / await 顺序彻底解耦。
//
// 注意：本文件仅定义调度器内核，不持有任何 Babylon 运行时对象，便于纯逻辑单测。
// 接入 scene.ts（将裸 onBeforeRenderObservable 迁移为 pipeline.register）属 Phase 1 step 2，
// 需待与 motion-modules/* 写者协调后再动，避免多写者源码碰撞。

import type { Scene } from '@babylonjs/core/scene';

/** 帧上下文，由各层按需取用。调度器内核不依赖其中任何字段。 */
export interface FrameContext {
    scene: Scene;
}

/**
 * 管线阶段。顺序来自 ADR-116 §一 的 6 层动作管线；
 * Ragdoll(④) 已于 ADR-061 永久移除，此处省略。
 * 同帧内「后注册阶段」覆盖「先注册阶段」的骨骼写入。
 */
export type PipelineStage =
    | 'vmd-base' // ① VMD 基础动画
    | 'vmd-layers' // ② VMD 图层叠加
    | 'proc-motion' // ③ 程序化动作
    | 'bone-override' // ⑤ Bone Override 引擎（含模块层 bake 与帧钩子）
    | 'perception'; // ⑥ Perception 层（呼吸/眨眼/视线跟随）

/** 单个管线层。 */
export interface PipelineLayer {
    /** 唯一标识，用于 unregister 与调试追踪。 */
    readonly id: string;
    /** 阶段；决定粗粒度执行序。 */
    readonly stage: PipelineStage;
    /** 同阶段内的细粒度序，升序优先。 */
    readonly order: number;
    /** 每帧回调。 */
    run(ctx: FrameContext): void;
}

/** 阶段固有顺序（索引越小越先执行）。 */
const STAGE_ORDER: readonly PipelineStage[] = [
    'vmd-base',
    'vmd-layers',
    'proc-motion',
    'bone-override',
    'perception',
];

export class MotionPipeline {
    private layers: PipelineLayer[] = [];
    private sorted = false;

    /**
     * 注册一个管线层，返回 unregister 函数。
     * 注册顺序不影响最终执行序，仅 stage + order 决定。
     */
    register(layer: PipelineLayer): () => void {
        const i = this.layers.findIndex((l) => l.id === layer.id);
        if (i >= 0) {
            this.layers[i] = layer; // 同 id 覆盖，保证 startBoneOverride 等幂等重入安全
        } else {
            this.layers.push(layer);
        }
        this.sorted = false;
        return () => this.unregister(layer.id);
    }

    /** 按 id 注销某层。 */
    unregister(id: string): void {
        const i = this.layers.findIndex((l) => l.id === id);
        if (i >= 0) {
            this.layers.splice(i, 1);
            this.sorted = false;
        }
    }

    /** 当前已注册层数量（测试 / 调试用）。 */
    get size(): number {
        return this.layers.length;
    }

    private ensureSorted(): void {
        if (this.sorted) {
            return;
        }
        this.layers.sort((a, b) => {
            const sa = STAGE_ORDER.indexOf(a.stage);
            const sb = STAGE_ORDER.indexOf(b.stage);
            if (sa !== sb) {
                return sa - sb;
            }
            return a.order - b.order;
        });
        this.sorted = true;
    }

    /** 返回按 (stage, order) 升序排列的只读层列表。 */
    getOrderedLayers(): readonly PipelineLayer[] {
        this.ensureSorted();
        return this.layers;
    }

    /** 按序执行所有层。 */
    runFrame(ctx: FrameContext): void {
        this.ensureSorted();
        // 快照迭代：允许 run 内 unregister（如 perception 模型销毁时自注销），避免迭代中修改数组导致跳过
        const snapshot = this.layers.slice();
        for (const layer of snapshot) {
            // 异常隔离：单 layer 抛错不影响后续层
            // （与 Babylon 单 observer 抛错不影响其他 observer 行为一致；否则单个新层异常会静默掐断下游所有层）
            try {
                layer.run(ctx);
            } catch (err) {
                console.error(`[MotionPipeline] layer "${layer.id}" run 抛错，已跳过：${String(err)}`);
            }
        }
    }
}

/**
 * 全局唯一管线实例（scene 级单例）。
 * 所有骨骼写入层通过本实例 register/unregister，调度顺序由 stage 声明决定，
 * 与 import / await / onBeforeRenderObservable 注册时序彻底解耦（治理 R1）。
 */
let _instance: MotionPipeline | null = null;
export function getMotionPipeline(): MotionPipeline {
    if (!_instance) {
        _instance = new MotionPipeline();
    }
    return _instance;
}
