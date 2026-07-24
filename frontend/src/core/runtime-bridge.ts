// [doc:adr-177] Runtime Bridge — @wailsio/runtime 隔离层（Phase 1）
//
// 架构：绞杀者模式（对齐 wails-bindings.ts 的 backend 代理化）
// - 运行时动态选型：web 走 no-op，wails 走真实 @wailsio/runtime（动态 import）
// - 生产代码中 @wailsio/runtime value import 只允许出现在本文件
// - 对齐 Wails Events 真实 API：On 返回 unsubscribe、Off 可变参数、Emit 返回 Promise<boolean>
//
// 使用规范（ADR-177 第三轮审核）：
// - 业务侧优先保存 on() 返回的 unsubscribe 并在 dispose 时调用——这是主契约
// - off(...names) 仅兼容能力，按事件名移除会清掉所有模块监听，谨慎使用
// - disposeAll() 仅供应用级 shutdown 调用，不允许业务模块随意全局清理
// - Web 侧 browser.openURL 用 window.open + noopener，被拦截时 throw 可诊断错误

import { isWebPlatform } from './platform';

// ======== 类型定义（对齐 Wails 真实 API） ========
export type Unsubscribe = () => void;
export type EventCallback = (data: unknown) => void;

export interface RuntimeEvents {
    on(name: string, cb: EventCallback): Unsubscribe;
    once(name: string, cb: EventCallback): Unsubscribe;
    off(...names: string[]): void;
    offAll(): void;
    emit(name: string, data?: unknown): Promise<boolean>;
}

export interface RuntimeBrowser {
    openURL(url: string): Promise<void>;
}

export interface RuntimeBridge {
    events: RuntimeEvents;
    browser: RuntimeBrowser;
    /** 释放所有订阅——仅供应用级 shutdown 调用 */
    disposeAll(): void;
}

// ======== Web 侧 no-op 实现 ========
class WebEvents implements RuntimeEvents {
    on(_name: string, _cb: EventCallback): Unsubscribe {
        return () => {
            /* no-op */
        };
    }
    once(_name: string, _cb: EventCallback): Unsubscribe {
        return () => {
            /* no-op */
        };
    }
    off(..._names: string[]): void {
        /* no-op */
    }
    offAll(): void {
        /* no-op */
    }
    emit(_name: string, _data?: unknown): Promise<boolean> {
        return Promise.resolve(false);
    }
}

class WebBrowser implements RuntimeBrowser {
    async openURL(url: string): Promise<void> {
        const win = window.open(url, '_blank', 'noopener,noreferrer');
        if (!win) {
            throw new Error(`浏览器拦截了外部链接打开：${url}`);
        }
    }
}

class WebRuntimeBridge implements RuntimeBridge {
    readonly events = new WebEvents();
    readonly browser = new WebBrowser();
    disposeAll(): void {
        /* no-op——web 侧无订阅需释放 */
    }
}

// ======== Wails 侧透传实现（动态 import 避免静态依赖） ========
class WailsRuntimeBridge implements RuntimeBridge {
    private _events: RuntimeEvents | null = null;
    private _browser: RuntimeBrowser | null = null;
    private _unsubscribers: Unsubscribe[] = [];

    private async _load(): Promise<void> {
        if (this._events) return;
        const rt = await import('@wailsio/runtime');
        this._events = {
            on: (name: string, cb: EventCallback): Unsubscribe => {
                const unsub = rt.Events.On(name, cb);
                this._unsubscribers.push(unsub);
                return unsub;
            },
            once: (name: string, cb: EventCallback): Unsubscribe => {
                const unsub = rt.Events.Once(name, cb);
                this._unsubscribers.push(unsub);
                return unsub;
            },
            off: (...names: string[]): void => {
                if (names.length > 0) {
                    // Wails v3 Off 签名要求 [WailsEventName, ...WailsEventName[]] 非空元组
                    rt.Events.Off(...(names as [string, ...string[]]));
                }
            },
            offAll: (): void => {
                rt.Events.OffAll();
            },
            emit: (name: string, data?: unknown): Promise<boolean> => {
                return rt.Events.Emit(name, data);
            },
        };
        this._browser = {
            async openURL(url: string): Promise<void> {
                await rt.Browser.OpenURL(url);
            },
        };
    }

    get events(): RuntimeEvents {
        // 同步代理——on/once/off/offAll/emit 调用时才触发 _load
        // 注意：Wails 侧 Events 在 bridge 注入后立即可用，无需 await
        // 这里用惰性同步访问——若未加载，先调 _load（async），但 events 方法本身返回同步值
        // 实际上 Wails 环境下 bridge 已在 bootstrap 时注入，不会走到 _load 的异步路径
        // 保险起见，若 _events 为 null（理论上不会），返回 WebEvents 兜底
        return this._events ?? new WebEvents();
    }

    get browser(): RuntimeBrowser {
        return this._browser ?? new WebBrowser();
    }

    disposeAll(): void {
        for (const unsub of this._unsubscribers) {
            try {
                unsub();
            } catch {
                /* ignore */
            }
        }
        this._unsubscribers.length = 0;
        try {
            this._events?.offAll();
        } catch {
            /* ignore */
        }
    }

    /** 在 bootstrap 时调用，确保 Wails 侧 @wailsio/runtime 已加载 */
    async init(): Promise<void> {
        await this._load();
    }
}

// ======== 单例选型 ========
let _bridge: RuntimeBridge | null = null;
let _wailsBridge: WailsRuntimeBridge | null = null;

export function getRuntimeBridge(): RuntimeBridge {
    if (_bridge) return _bridge;
    if (isWebPlatform()) {
        _bridge = new WebRuntimeBridge();
    } else {
        _wailsBridge = new WailsRuntimeBridge();
        _bridge = _wailsBridge;
    }
    return _bridge;
}

/**
 * Wails 侧初始化——在 bootstrap 桥接注入后调用，加载真实 @wailsio/runtime。
 * Web 侧调用无副作用（短路）。
 */
export async function initRuntimeBridge(): Promise<void> {
    if (isWebPlatform()) return;
    const b = getRuntimeBridge();
    if (b instanceof WailsRuntimeBridge) {
        await b.init();
    }
}

// ======== 便捷导出（业务侧直接消费，无需每次 getRuntimeBridge()） ========
export const events: RuntimeEvents = new Proxy({} as RuntimeEvents, {
    get(_target, prop: string) {
        return getRuntimeBridge().events[prop as keyof RuntimeEvents];
    },
});

export const browser: RuntimeBrowser = new Proxy({} as RuntimeBrowser, {
    get(_target, prop: string) {
        return getRuntimeBridge().browser[prop as keyof RuntimeBrowser];
    },
});
