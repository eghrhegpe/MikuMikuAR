/**
 * 深拷贝对象（基于 JSON 序列化）。
 * 注意：不支持函数、undefined、Symbol、RegExp 等特殊类型。
 * 适合纯数据对象的克隆。
 *
 * @param x 要克隆的对象
 * @returns 深拷贝后的新对象
 */
export function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
