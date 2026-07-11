// footstep-detect.ts — 纯落地判定（无 Babylon 依赖，可单测）
//
// [doc:adr-088] 检测脚「贴地上升沿」：上一帧离地 → 本帧贴地。带最小间隔去抖，
// 并估算落地垂直速度（用于脚步声音量映射）。状态完全由调用方维护，本模块无副作用。

export interface StepDetectInput {
    /** 上一帧是否贴地 */
    prevGrounded: boolean;
    /** 当前帧是否贴地 */
    grounded: boolean;
    /** 上一帧脚 IK 世界 Y（离地时记录的值） */
    footYPrev: number;
    /** 当前帧脚 IK 世界 Y */
    footY: number;
    /** 帧间隔（秒） */
    dt: number;
    /** 上一落地时间戳（ms，performance.now） */
    prevStepTime: number;
    /** 当前时间戳（ms，performance.now） */
    now: number;
    /** 最小落地间隔（ms），去抖：同一只脚两次落地间隔过短则忽略 */
    minInterval: number;
}

export interface StepDetectOutput {
    /** 是否触发落地事件 */
    landed: boolean;
    /** 落地垂直速度（单位/秒），>=0 */
    impactSpeed: number;
}

/**
 * 落地判定核心。仅当出现「离地→贴地」上升沿、且去抖间隔满足时返回 landed=true。
 * impactSpeed = (footYPrev − footY) / dt，取非负（脚向下接触地面为正）。
 */
export function detectFootLanding(input: StepDetectInput): StepDetectOutput {
    const landedEdge = !input.prevGrounded && input.grounded;
    if (!landedEdge) {
        return { landed: false, impactSpeed: 0 };
    }
    // 去抖：同脚两次落地间隔过短（抖动/连续帧误判）忽略
    if (input.now - input.prevStepTime < input.minInterval) {
        return { landed: false, impactSpeed: 0 };
    }
    const safeDt = Math.max(input.dt, 1e-4);
    const impactSpeed = Math.max(0, (input.footYPrev - input.footY) / safeDt);
    return { landed: true, impactSpeed };
}
