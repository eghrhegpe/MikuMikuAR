/**
 * wind-utils.ts — 统一风场辅助函数
 *
 * 各子系统（粒子/水面/布料/云）通过此模块获取统一的风矢量，
 * 避免各自重复实现 windDirection × windSpeed 的读取逻辑。
 *
 * 使用方式：
 *   import { getWindVector } from '../core/wind-utils';
 *   const wind = getWindVector(); // Vector3
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { envState } from './config';

/** 风场强度倍率（各系统可在此统一调节灵敏度） */
const WIND_STRENGTH_SCALE = 1.0;

/**
 * 风向是否生效（windEnabled 且 windSpeed > 0.01，过滤浮点噪声 / 滑条零位残留）。
 *
 * 作为 getWindVector() 的统一守卫，保证两者在所有边界（包括 windSpeed=0.01）
 * 行为完全对称——isWindActive()=false 时 getWindVector() 必返回零向量。
 */
export function isWindActive(): boolean {
    return envState.windEnabled && envState.windSpeed > 0.01;
}

/**
 * 返回当前风矢量（方向 × 速度），风未生效时返回零向量。
 *
 * 守卫委托 isWindActive()，确保与 Bullet/粒子/云的跳过判断共用同一阈值，
 * 消除原 getWindVector 只查 windEnabled 而 isWindActive 额外查 windSpeed>0.01
 * 的边界不对称（P4 修复，ADR-194）。
 */
export function getWindVector(): Vector3 {
    if (!isWindActive()) {
        return Vector3.Zero();
    }
    const { windDirection, windSpeed } = envState;
    return new Vector3(
        windDirection[0] * windSpeed * WIND_STRENGTH_SCALE,
        windDirection[1] * windSpeed * WIND_STRENGTH_SCALE,
        windDirection[2] * windSpeed * WIND_STRENGTH_SCALE
    );
}
