// [doc:adr-190-followup][doc:adr-191] 零依赖数学钳制叶子。
// 神桶 @/core/utils 曾会引入 dom/state/menus 等，纯几何/物理模块从桶导入会被拖起整套
// 应用工具层，在 vitest fork 下导致整桶加载挂起（EXIT=124）。神桶已于 ADR-191 F 档删除。
// 其他模块须从此处直接导入 clamp 系列。

export function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

export function clampInt(v: number, lo: number, hi: number): number {
    return Math.round(clamp(v, lo, hi));
}

export function clamp01(v: number): number {
    return clamp(v, 0, 1);
}

/** 线性插值。 */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** 逐元素线性插值数组。 */
export function lerpArray(a: number[], b: number[], t: number): number[] {
    return a.map((v, i) => lerp(v, b[i], t));
}

/** 百分比钳制到 [0, 100]。 */
export function clampPct(v: number): number {
    return Math.max(0, Math.min(100, v));
}
