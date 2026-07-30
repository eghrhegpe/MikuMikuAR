// [doc:architecture] Pure math/geometry helpers.
// Extracted from @/core/utils as part of ADR-191 de-barreling.
// Zero dependencies: 仅使用原生 Math，禁止 import 应用层模块。

/** 2D 欧几里得距离。 */
export function dist2d(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/** 3D 欧几里得距离。 */
export function dist3d(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }
): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 角度 → 弧度。 */
export function degToRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

/** 弧度 → 角度。 */
export function radToDeg(rad: number): number {
    return (rad * 180) / Math.PI;
}
