// [doc:architecture] Load-Refresh Registry — 模型加载/库扫描完成后菜单刷新注册表
// 替代：
// 1. load-manager.ts 中硬编码的动态 import 列表（由 runLoadRefreshHooks 驱动）
// 2. 各菜单文件独立注册的 mmar:library-scanned 监听器（由 registerLibraryScannedHook 驱动）
//
// 用法：
//   import { registerLoadRefreshHook, registerLibraryScannedHook } from '@/core/load-refresh-registry';
//   registerLoadRefreshHook(() => { if (getEnvMenu()) refreshEnvRoot(); });
//   registerLibraryScannedHook(() => { if (getEnvMenu()) getEnvMenu()?.reRender(); });

import { addDisposableListener } from './dom';

/** 所有注册的加载后刷新回调 */
const _hooks = new Set<() => void>();

/**
 * 注册一个「模型加载后刷新」钩子。
 * 钩子仅在对应菜单已初始化且存活时执行刷新操作。
 * 返回取消注册函数，供 dispose 时清理。
 */
export function registerLoadRefreshHook(hook: () => void): () => void {
    _hooks.add(hook);
    return () => {
        _hooks.delete(hook);
    };
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

// ======== 库扫描完成钩子（替代各菜单独立的 window event listener） ========

/** 注册的 mmar:library-scanned 回调 */
const _scannedHooks = new Set<() => void>();

/** 统一的 mmar:library-scanned 监听器（只注册一次） */
let _scannedListenerInstalled = false;

/**
 * 注册一个「库扫描完成」钩子。
 * 库扫描完成时（library-setup 扫描 allModels 完毕），统一触发所有已注册的钩子。
 * 替代各菜单文件各自添加 addDisposableListener(window, 'mmar:library-scanned', ...) 的重复模式。
 * 返回取消注册函数。
 */
export function registerLibraryScannedHook(hook: () => void): () => void {
    _scannedHooks.add(hook);
    if (!_scannedListenerInstalled) {
        _scannedListenerInstalled = true;
        // 惰性引用 window：node 下无 window 对象，跳过注册避免 import 期崩溃。
        // 浏览器/happy-dom 下 window 存在，正常注册事件监听。
        if (typeof window !== 'undefined') {
            addDisposableListener(window, 'mmar:library-scanned', () => {
                for (const h of _scannedHooks) {
                    try {
                        h();
                    } catch (e) {
                        console.error('[load-refresh] scanned hook error:', e);
                    }
                }
            });
        }
    }
    return () => {
        _scannedHooks.delete(hook);
    };
}
