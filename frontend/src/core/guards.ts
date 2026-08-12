/**
 * 将 undefined/NaN/非数字归一为 fallback，防止 NaN 污染 Babylon.js 数学类型与 CSS 串。
 * 替代 `??` 的空值合并（?? 不挡 NaN）。
 */
export function guardNum(v: unknown, fallback = 0): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
