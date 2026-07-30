// hash-noise.ts — 确定性哈希与值噪声纯函数
//
// 从 scene/env/env-noise.ts 迁入（ADR-212：命名 vs 功能审计）
// 设计目标：集中「整数哈希 + 值噪声」这一族纯函数，供水面细节法线、焦散 Voronoi、地形 FBM 共用。
// 此模块无状态、零依赖，属纯叶子。

/**
 * 确定性整数哈希 → [0,1]。seed 相同则结果可复现。
 * 采用 xorshift-mix + Math.imul，避免大坐标下 32 位乘法溢出丢精度。
 */
export function hash2(ix: number, iy: number, seed = 0): number {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295;
}

/**
 * 二元组哈希 → [[0,1],[0,1]]。供 Voronoi 需要两个独立随机偏移的场景（焦散网状亮纹）。
 * 第二个分量用 seed 偏移派生，保证与第一分量去相关。
 */
export function hash2v(ix: number, iy: number, seed = 0): [number, number] {
    return [hash2(ix, iy, seed), hash2(ix, iy, seed + 0x9e3779b1)];
}

/**
 * 平滑值噪声 → [0,1]。四角哈希 + smoothstep 双线性插值。
 * @param seed 相同 seed 产出可复现的连续噪声场。
 */
export function valueNoise(x: number, y: number, seed = 0): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed);
    const b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed);
    const d = hash2(ix + 1, iy + 1, seed);
    const top = a + (b - a) * ux;
    const bot = c + (d - c) * ux;
    return top + (bot - top) * uy;
}