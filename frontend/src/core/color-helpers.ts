// [doc:architecture] Color helpers for MikuMikuAR.
// 收敛颜色相关的散落实现，与 utils.ts 的纯函数 helper 分层：
// - col3FromTriple：替代 `new Color3(arr[0], arr[1], arr[2])`，统一三元组构造入口。
// - hexToRgb / rgbToString：主题色解析唯一实现（原散落于 core/main.ts 与 menus/settings-shared.ts）。

import { Color3 } from '@babylonjs/core/Maths/math.color';
// [audit:round16 P2] 收敛数字守卫到 guards.ts 单一出口（本地版 `!Number.isNaN` 放行
// Infinity，会污染 Color3 与 CSS rgb 串；guards.ts 用 Number.isFinite 拦截语义更完整）。
import { guardNum } from './guards';

/**
 * 从 `[r, g, b]` 三元组构造 Color3。
 * 接受元组或 number[]；索引缺失或 NaN 时回退 0，兼容 noUncheckedIndexedAccess。
 */
export function col3FromTriple(t: readonly number[]): Color3 {
    return new Color3(guardNum(t[0]), guardNum(t[1]), guardNum(t[2]));
}

const HEX_RGB_RE = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

/** 将 #rrggbb 解析为 {r,g,b}（0–255）。非法输入回退主题默认 74,108,247。 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const m = HEX_RGB_RE.exec(hex);
    if (!m) {
        return { r: 74, g: 108, b: 247 };
    }
    return {
        r: parseInt(m[1], 16),
        g: parseInt(m[2], 16),
        b: parseInt(m[3], 16),
    };
}

/** 将 {r,g,b} 转为 CSS rgb 字符串 "r, g, b"（供 --accent-rgb 等 CSS 变量）。 */
export function rgbToString(rgb: { r: number; g: number; b: number }): string {
    return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

/** 将 Color3 转为 CSS `rgb(r, g, b)` 字符串（0–255 整数，clamp 到 [0,255]）。 */
export function rgbString(c: Color3): string {
    const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(guardNum(v) * 255)));
    return `rgb(${clamp8(c.r)}, ${clamp8(c.g)}, ${clamp8(c.b)})`;
}
