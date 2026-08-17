// bridge-slot.ts — [doc:adr-265] 通用注入桥原语（纯叶子，零依赖）。
// 破环三件套（scene-action-bridge / ui-action-bridge / e2e-state-bridge）的
// register/get/warnOnce 机械部分此前逐字重复三份；本叶收敛为单一实现。
// 不变量由原语统一保证，桥只保留接口（文档价值）+ 一行工厂调用：
//   - register 返回 identity-based 注销 token——覆盖注册后旧 token 不得误删新注册
//     （code_review P2：delete-by-key 在「新注册先于 dispose」顺序下删错致桥永久缺失）
//   - get 未注册一次性告警后静默返回 undefined，调用方 ?.() 兜底——防重构破坏静默跳过
//   - token 幂等：重复调用安全
// 不引入新依赖、不改任何桥的导出签名；65+26 个消费文件无感。

/** 多键动作桥（scene/ui 形态：一个接口表，分字段注册） */
export interface ActionBridge<A extends object> {
    /** 注册单个实现（可重复覆盖），返回 identity-based 注销 token */
    register<K extends keyof A>(key: K, fn: A[K]): () => void;
    /** 读取单个实现；未注册一次性告警后返回 undefined */
    get<K extends keyof A>(key: K): A[K] | undefined;
    /** 兼容旧调用点：按 key 注销（不区分注册实例，慎用；优先用 token） */
    unregister(key: keyof A): void;
    /** 键是否已注册（兼容层判定用） */
    has(key: keyof A): boolean;
    /** 当前已注册键的普通对象视图（兼容属性访问语义的旧调用点） */
    snapshot(): Partial<A>;
}

/**
 * 创建一个多键动作桥。label 用于缺失注册告警前缀（保持 '[桥名] key 未注册' 格式，
 * 存量日志/文档引用不断链）。
 */
export function createActionBridge<A extends object>(label: string): ActionBridge<A> {
    const map = new Map<keyof A, unknown>();
    const warned = new Set<string>();
    return {
        register<K extends keyof A>(key: K, fn: A[K]): () => void {
            map.set(key, fn);
            return () => {
                if (map.get(key) === fn) {
                    map.delete(key);
                }
            };
        },
        get<K extends keyof A>(key: K): A[K] | undefined {
            const fn = map.get(key) as A[K] | undefined;
            if (!fn && !warned.has(key as string)) {
                warned.add(key as string);
                console.warn(`[${label}] '${String(key)}' 未注册——调用将静默跳过`);
            }
            return fn;
        },
        unregister(key: keyof A): void {
            map.delete(key);
        },
        has(key: keyof A): boolean {
            return map.has(key);
        },
        snapshot(): Partial<A> {
            return Object.fromEntries(map) as Partial<A>;
        },
    };
}

/** 单槽注入点（e2e/snapshot 形态：一个实现，模块级 set/get） */
export interface Slot<T> {
    /** 注入实现（可重复覆盖），返回 identity-based 注销 token */
    set(value: T): () => void;
    /** 读取实现；未注入返回 null */
    get(): T | null;
    /** 清空（测试隔离用） */
    reset(): void;
}

/**
 * 创建一个单槽注入点。set 的 token 语义与 createActionBridge 一致：
 * 只删本实例注入的值，不误删后续覆盖者。
 */
export function createSlot<T>(): Slot<T> {
    let value: T | null = null;
    return {
        set(v: T): () => void {
            value = v;
            return () => {
                if (value === v) {
                    value = null;
                }
            };
        },
        get(): T | null {
            return value;
        },
        reset(): void {
            value = null;
        },
    };
}
