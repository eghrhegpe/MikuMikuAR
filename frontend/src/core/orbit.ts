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

/** 轨道距离下限：distance<=0 或非有限时钳制到此值，避免塌缩到原点或 NaN。 */
export const MIN_ORBIT_DISTANCE = 0.001;

/**
 * 钳制一组原始轨道参数为合法值域。
 * - distance 必须 > 0 且有限，否则取 MIN_ORBIT_DISTANCE
 * - elevation 收敛到 [-90, 90]
 * - azimuth 必须有限，否则取 0
 * 合法输入原样返回，因此对正常工作流零影响。供 model-manager / props 的 setter 复用，
 * 确保持久化的 orbit 字段始终合法（损坏场景文件反序列化也不会写入退化值）。
 */
export function normalizeOrbit(azimuth: number, elevation: number, distance: number): OrbitCoords {
    const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : MIN_ORBIT_DISTANCE;
    const safeElevation = Number.isFinite(elevation) ? Math.max(-90, Math.min(90, elevation)) : 0;
    const safeAzimuth = Number.isFinite(azimuth) ? azimuth : 0;
    return { azimuth: safeAzimuth, elevation: safeElevation, distance: safeDistance };
}

/**
 * 球面坐标 → 笛卡尔坐标。
 * 以原点为中心：azimuth 决定水平朝向，elevation 决定高低，distance 决定半径。
 * 自带边界保护：elevation 收敛到 [-90,90]，distance 非有限或 <=0 时钳制到最小值，
 * 任何输入均返回有限坐标，绝不产生 NaN。
 */
export function orbitToCartesian(
    azimuthDeg: number,
    elevationDeg: number,
    distance: number
): [number, number, number] {
    const safeElevation = Number.isFinite(elevationDeg)
        ? Math.max(-90, Math.min(90, elevationDeg))
        : 0;
    const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : MIN_ORBIT_DISTANCE;
    const safeAzimuth = Number.isFinite(azimuthDeg) ? azimuthDeg : 0;
    const az = (safeAzimuth * Math.PI) / 180;
    const el = (safeElevation * Math.PI) / 180;
    const x = safeDistance * Math.cos(el) * Math.sin(az);
    const y = safeDistance * Math.sin(el);
    const z = safeDistance * Math.cos(el) * Math.cos(az);
    return [x, y, z];
}

/**
 * 笛卡尔坐标 → 球面坐标。
 * 公式与 `lighting.ts` 对齐：azimuth = atan2(x, z)，elevation = asin(y / len)。
 * 距离下限取 0.1，避免原点处 asin 除零；len 非有限时返回原点轨道坐标（有限值）。
 */
export function cartesianToOrbit(x: number, y: number, z: number): OrbitCoords {
    const len = Math.sqrt(x * x + y * y + z * z);
    if (!Number.isFinite(len)) {
        return { azimuth: 0, elevation: 0, distance: 0 };
    }
    const azimuth = (Math.atan2(x, z) * 180) / Math.PI;
    const elevation = (Math.asin(y / Math.max(0.1, len)) * 180) / Math.PI;
    return { azimuth, elevation, distance: len };
}
