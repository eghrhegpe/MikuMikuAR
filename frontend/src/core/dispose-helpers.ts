// dispose-helpers.ts — 统一「dispose 并置空」的模板（ADR-146 主题3）
//
// 替代项目中大量 `if (x) { x.dispose(); x = null; }` 手写重复（env/render
// 子系统累计 60-80 处）。调用形式：
//
//   _volCloudMat = safeDispose(_volCloudMat);
//   _envSys.water.mesh = safeDispose(_envSys.water.mesh, true);   // 透传 dispose 参数
//   pipeline = safeDispose(pipeline);                              // 返回 null，调用方重赋值
//
// 与手写模板语义严格等价：`obj?.dispose(...args)` 仅在 obj 非空时调用，
// 始终返回 null（调用方将自身引用置空）。Babylon 对象 dispose 幂等，
// safeDispose 在 obj 已是 null 时为 no-op。
//
// 注意：返回类型为 `null`。目标变量须为 `T | null`；若原代码置 `undefined`
// （如 `pipeline = undefined`），类型不兼容，请勿用本函数（保留原写法）。

/**
 * 安全释放对象并置空。
 * @param obj 待释放对象（可为 null）
 * @param args 透传给 `obj.dispose(...args)` 的参数（如 mesh.dispose(true) 的 recursive）
 * @returns null（调用方应将原引用赋值为此返回值以完成置空）
 */
export function safeDispose<T extends { dispose(...args: any[]): void }>(
    obj: T | null,
    ...args: any[]
): null {
    obj?.dispose(...args);
    return null;
}
