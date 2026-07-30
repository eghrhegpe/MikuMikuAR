// [doc:architecture] Auto-save trigger hook.
// Extracted from @/core/utils as part of ADR-191 de-barreling.
// Zero dependencies: 仅保存一个函数指针，由 scene-serialize.ts 注册实现。
// 注：防抖下沉到 scene-serialize.ts 的 _autoSaveDebounced（500ms）统一处理，
// 此处只做函数指针注册，不再叠加 setTimeout，避免 1500ms + 500ms = 2000ms 双层延迟。

let _triggerAutoSaveImpl: (() => void) | null = null;

/** 注册自动保存的实现回调（由 scene-serialize.ts 在初始化时调用）。 */
export function setTriggerAutoSave(fn: () => void): void {
    _triggerAutoSaveImpl = fn;
}

/** 触发自动保存（由动作/菜单/UI 层调用）。 */
export function triggerAutoSave(): void {
    _triggerAutoSaveImpl?.();
}
