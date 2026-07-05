/**
 * wind-utils.ts — 统一风场辅助函数
 *
 * 各子系统（粒子/水面/布料/云）通过此模块获取统一的风矢量，
 * 避免各自重复实现 windDirection × windSpeed 的读取逻辑。
 *
 * 使用方式：
 *   import { getWindVector } from '../core/physics/wind-utils';
 *   const wind = getWindVector(); // Vector3
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { envState } from '../config';

/** 风场强度倍率（各系统可在此统一调节灵敏度） */
const WIND_STRENGTH_SCALE = 1.0;

/**
 * 返回当前风矢量（方向 × 速度），windEnabled=false 时返回零向量。
 */
export function getWindVector(): Vector3 {
    if (!envState.windEnabled) {
        return Vector3.Zero();
    }
    const { windDirection, windSpeed } = envState;
    return new Vector3(
        windDirection[0] * windSpeed * WIND_STRENGTH_SCALE,
        windDirection[1] * windSpeed * WIND_STRENGTH_SCALE,
        windDirection[2] * windSpeed * WIND_STRENGTH_SCALE,
    );
}

/**
 * 返回当前风速标量（windEnabled=false 返回 0）。
 */
export function getWindStrength(): number {
    return envState.windEnabled ? envState.windSpeed : 0;
}

/**
 * 风向是否生效（快捷判空，避免 Vector3.Zero() 比较开销）。
 */
export function isWindActive(): boolean {
    return envState.windEnabled && envState.windSpeed > 0.01;
}
