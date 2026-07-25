// [doc:architecture] Load-Refresh Registry — 模型加载完成后菜单刷新注册表
// 替代 load-manager.ts 中硬编码的动态 import 列表。
// 各菜单在模块级注册自己的刷新回调，load-manager.load() 完成后统一触发。
//
// 用法：
//   import { registerLoadRefreshHook } from '@/core/load-refresh-registry';
//   registerLoadRefreshHook(() => { if (getEnvMenu()) refreshEnvRoot(); });

/** 所有注册的加载后刷新回调 */
const _hooks = new Set<() => void>();

/**
 * 注册一个「模型加载后刷新」钩子。
 * 钩子仅在对应菜单已初始化且存活时执行刷新操作。
 * 返回取消注册函数，供 dispose 时清理。
 */
export function registerLoadRefreshHook(hook: () => void): () => void {
    _hooks.add(hook);
    return () => { _hooks.delete(hook); };
}

/**
 * 执行所有已注册的加载后刷新钩子。
 * 由 load-manager 在每次 load() 完成后调用。
 * 每个钩子带 try/catch，单个失败不影响其余。
 */
export function runLoadRefreshHooks(): void {
    for (const hook of _hooks) {
        try {
            hook();
        } catch (e) {
            console.error('[load-refresh] hook error:', e);
        }
    }
}
