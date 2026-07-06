// [doc:adr-049] 球面坐标轨道控制 — 笛卡尔 ↔ 球面坐标统一转换工具
// 与灯光系统 `lighting.ts` 的 orbit 公式保持完全一致（atan2(x, z) / asin(y/len)）。
// 模型与道具共用此模块，避免各子系统重复实现导致漂移。

export interface OrbitCoords {
    /** 水平方位角，度，绕 Y 轴，范围 -180~180 */
    azimuth: number;
    /** 垂直仰角，度，范围 -90~90 */
    elevation: number;
    /** 距原点距离，> 0 */
    distance: number;
}

/**
 * 球面坐标 → 笛卡尔坐标。
 * 以原点为中心：azimuth 决定水平朝向，elevation 决定高低，distance 决定半径。
 */
export function orbitToCartesian(
    azimuthDeg: number,
    elevationDeg: number,
    distance: number,
): [number, number, number] {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const x = distance * Math.cos(el) * Math.sin(az);
    const y = distance * Math.sin(el);
    const z = distance * Math.cos(el) * Math.cos(az);
    return [x, y, z];
}

/**
 * 笛卡尔坐标 → 球面坐标。
 * 公式与 `lighting.ts` 对齐：azimuth = atan2(x, z)，elevation = asin(y / len)。
 * 距离下限取 0.1，避免原点处 asin 除零。
 */
export function cartesianToOrbit(x: number, y: number, z: number): OrbitCoords {
    const len = Math.sqrt(x * x + y * y + z * z);
    const azimuth = (Math.atan2(x, z) * 180) / Math.PI;
    const elevation = (Math.asin(y / Math.max(0.1, len)) * 180) / Math.PI;
    return { azimuth, elevation, distance: len };
}
