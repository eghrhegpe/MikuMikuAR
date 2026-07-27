/**
 * 格式化日期为 HH:MM:SS.mmm 字符串。
 * @param d 可选的日期对象，默认使用当前时间
 * @returns 格式化后的时间字符串
 */
export function formatTimestamp(d: Date = new Date()): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}
