/**
 * 泛型键值写入工具，避免大量 `obj[key] = value` 重复。
 *
 * @param obj 目标对象
 * @param key 键名
 * @param value 要设置的值
 */
export function setKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  obj[key] = value;
}
