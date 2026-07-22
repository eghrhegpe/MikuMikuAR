// [doc:architecture] Reactivity — 轻量响应式系统
// Proxy 拦截 set → RAF 去抖 → 通知所有订阅者
// 订阅者通常是 SlideMenu.updateControls()

/** 所有活跃的刷新订阅者 */
const _subscribers = new Set<() => void>();

/** RAF 去抖标志 */
let _refreshScheduled = false;

/**
 * 安排一次刷新（RAF 去抖）。
 * 同帧内多次调用只触发一次刷新。
 */
export function scheduleRefresh(): void {
    if (_refreshScheduled) {
        return;
    }
    _refreshScheduled = true;
    requestAnimationFrame(() => {
        _refreshScheduled = false;
        for (const fn of _subscribers) {
            try {
                fn();
            } catch (e) {
                console.error('[reactivity] subscriber error:', e);
            }
        }
    });
}

/**
 * 注册一个刷新订阅者。返回取消订阅函数。
 * 订阅者会在 scheduleRefresh() 触发时被调用。
 */
export function subscribe(fn: () => void): () => void {
    _subscribers.add(fn);
    return () => {
        _subscribers.delete(fn);
    };
}

/**
 * 清空所有刷新订阅者。供 initScene 重入时调用（ADR-106 D3 HMR 清理入口）。
 */
export function unsubscribeAll(): void {
    _subscribers.clear();
}

/**
 * 用 Proxy 包裹对象，拦截 set 操作。
 * 任何属性赋值都会自动触发 scheduleRefresh()。
 * 深度代理：嵌套普通对象也会被包裹（WeakMap 缓存保证引用稳定）。
 *
 * ⚠️ 数组字段约定（如 envState.skyColorTop: [number, number, number]）：
 * Proxy 不代理数组（避免包装 push/pop/splice 等方法带来的复杂度与性能开销），
 * 因此 `envState.skyColorTop[0] = 0.5` 不会触发刷新。
 * 写入数组字段必须用整体替换：`envState.skyColorTop = [0.5, 0.6, 0.7]`
 * 或通过 setEnvState({ skyColorTop: [...] })（内部 Object.assign 整体赋值）。
 * Map/Set 同理：替换整个实例，不依赖内部变更触发刷新。
 */
const _proxyCache = new WeakMap<object, object>(); // [audit:P3] 缓存已创建的 Proxy，保证引用稳定
export function reactive<T extends object>(obj: T): T {
    const cached = _proxyCache.get(obj);
    if (cached) {
        return cached as T;
    }
    const proxy = new Proxy(obj, {
        get(target, key, receiver): unknown {
            const val = Reflect.get(target, key, receiver);
            // 只代理普通对象（不代理数组/Map/Set/DOM 等）
            if (
                val &&
                typeof val === 'object' &&
                !Array.isArray(val) &&
                !(val instanceof Map) &&
                !(val instanceof Set)
            ) {
                return reactive(val as object);
            }
            return val;
        },
        set(target, key, value, receiver): boolean {
            const old = Reflect.get(target, key, receiver);
            if (Object.is(old, value)) {
                return true;
            } // [audit:P3] 同值短路，避免不必要刷新
            const result = Reflect.set(target, key, value, receiver);
            scheduleRefresh();
            return result;
        },
    }) as T;
    _proxyCache.set(obj, proxy);
    return proxy;
}

/**
 * Passthrough readonly — store 层通过约定保证不可变，不做深冻结。
 */
export function readonly<T>(obj: T): T {
    return obj;
}
