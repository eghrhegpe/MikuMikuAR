// [doc:adr-238] 落地事件类型叶（Phase 2：切断 motion-algos → scene/motion 的 type-only 边）
// 纯类型、零依赖。原定义于 scene/motion/feet-adjustment.ts（ADR-088 供脚步声消费），
// 下沉到 motion-algos 内部后：
//   - scene/motion/feet-adjustment.ts（生产者）从这里 import 并 re-export
//   - scene/motion/footstep-detect-fallback.ts（消费者）直接从 './feet-event' 取
// 使 motion-algos 不再反向依赖 scene/motion（check-circular 11 个环的枢纽边）。

/** 落地事件：脚从空中接触地面的瞬间（ADR-088 供脚步声消费）。 */
export interface FootLandEvent {
    modelId: string;
    foot: 'L' | 'R';
    groundY: number;
    /** 落地垂直速度（单位/秒），>=0，用于脚步声音量映射 */
    impactSpeed: number;
    worldX: number;
    worldZ: number;
}
