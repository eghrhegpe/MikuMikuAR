// [doc:adr-116 P3] 动作覆盖时间驱动纯数学函数（与渲染解耦，便于单测）
// 这些函数只做数值计算，不触碰引擎/状态，由 sway/riding 的每帧钩子调用。

/**
 * 摇摆正弦 yaw（度）。
 *   yaw(t) = amplitude * (1 - decay) * sin(2π · frequency · t)
 * - amplitude: 峰值幅度（度）
 * - decay: 衰减系数（0=满幅，1=静止）
 * - frequency: 频率（Hz）
 * - tSec: 时间（秒）
 */
export function computeSwayYaw(
    amplitude: number,
    decay: number,
    frequency: number,
    tSec: number
): number {
    return amplitude * (1 - decay) * Math.sin(2 * Math.PI * frequency * tSec);
}

/**
 * 踏板相位（度，0-360 自然循环）。
 *   phase(t) = (t · pedalSpeed · 360) mod 360
 * - pedalSpeed: 循环速度（Hz）
 * - tSec: 时间（秒）
 */
export function computePedalPhase(tSec: number, pedalSpeedHz: number): number {
    const deg = (tSec * pedalSpeedHz * 360) % 360;
    // 归一化到 [0,360)
    return deg < 0 ? deg + 360 : deg;
}

/**
 * 单足俯仰角（度）。
 * 左足 = sin(phase)，右足 = sin(phase + 180)（与左足反相）。
 * - phaseDeg: 踏板相位（度，来自 computePedalPhase）
 * - isLeftFoot: true=左足 / false=右足
 */
export function computeFootPitch(phaseDeg: number, isLeftFoot: boolean): number {
    const rad = (phaseDeg * Math.PI) / 180;
    const phase = isLeftFoot ? rad : rad + Math.PI;
    return Math.sin(phase) * 20;
}
