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
 * 用 Proxy 包裹对象，拦截 set 操作。
 * 任何属性赋值都会自动触发 scheduleRefresh()。
 * 深度代理：嵌套对象也会被包裹。
 */
export function reactive<T extends object>(obj: T): T {
    return new Proxy(obj, {
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
            const result = Reflect.set(target, key, value, receiver);
            scheduleRefresh();
            return result;
        },
    }) as T;
}

/**
 * Passthrough readonly — store 层通过约定保证不可变，不做深冻结。
 */
export function readonly<T>(obj: T): T {
    return obj;
}
