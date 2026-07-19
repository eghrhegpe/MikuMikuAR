// observer-handle.ts — 统一 Observer 生命周期管理
//
// 封装 Babylon.js Observable.add/remove，确保：
// 1. 每次 add 都返回一个可 dispose 的句柄
// 2. 支持批量清理（ObserverRegistry）
// 3. 幂等 dispose（重复调用安全）
// 4. 不再需要手动在 metadata 中存储 observer 引用
//
// 用法：
//   import { observe, observeOnce, ObserverRegistry } from '@/core/observer-handle';
//
//   // 单个 observer
//   const h = observe(scene.onBeforeRenderObservable, () => { ... });
//   h.dispose(); // 移除 observer
//
//   // 批量管理
//   const reg = new ObserverRegistry();
//   reg.add(scene.onBeforeRenderObservable, () => { ... });
//   reg.add(scene.onAfterRenderObservable, () => { ... });
//   reg.disposeAll(); // 一次性清理所有

import { Observable, Observer } from '@babylonjs/core/Misc/observable';

// ======== ObserverHandle ========

/**
 * 可释放的 Observer 句柄。
 * 调用 dispose() 从 Observable 中移除对应的 observer。
 * 幂等：重复调用 dispose() 安全。
 */
export class ObserverHandle {
    private _observable: Observable<any> | null;
    private _observer: Observer<any> | null;

    constructor(observable: Observable<any>, observer: Observer<any>) {
        this._observable = observable;
        this._observer = observer;
    }

    /** 从 Observable 中移除 observer，然后释放引用。幂等。 */
    dispose(): void {
        if (this._observable && this._observer) {
            this._observable.remove(this._observer);
        }
        this._observable = null;
        this._observer = null;
    }

    get isDisposed(): boolean {
        return this._observer === null;
    }
}

// ======== 便利函数 ========

/**
 * 订阅 Observable 并返回自动管理的句柄。
 * 等价于 observable.add(callback)，但返回值是 ObserverHandle 而非 Observer。
 */
export function observe<T>(
    observable: Observable<T>,
    callback: (eventData: T, eventState: any) => void
): ObserverHandle {
    const observer = observable.add(callback);
    if (!observer) {
        throw new Error('ObserverHandle: observable.add() returned null');
    }
    return new ObserverHandle(observable, observer);
}

/**
 * 一次性订阅：回调执行后自动移除，等价于 observable.addOnce()。
 */
export function observeOnce<T>(
    observable: Observable<T>,
    callback: (eventData: T, eventState: any) => void
): ObserverHandle {
    const observer = observable.addOnce(callback);
    if (!observer) {
        throw new Error('ObserverHandle: observable.addOnce() returned null');
    }
    return new ObserverHandle(observable, observer);
}

// ======== ObserverRegistry ========

/**
 * 管理器：收集多个 ObserverHandle，支持一次性 disposeAll()。
 * 适合模块有多个 observer 需要统一清理的场景。
 */
export class ObserverRegistry {
    private _handles: ObserverHandle[] = [];

    /** 订阅并注册，返回句柄。 */
    add<T>(
        observable: Observable<T>,
        callback: (eventData: T, eventState: any) => void
    ): ObserverHandle {
        const handle = observe(observable, callback);
        this._handles.push(handle);
        return handle;
    }

    /** 注册一个已有的句柄。 */
    register(handle: ObserverHandle): void {
        this._handles.push(handle);
    }

    /** 从注册表中移除指定句柄并 dispose。返回 true 表示找到并移除。 */
    remove(handle: ObserverHandle): boolean {
        const idx = this._handles.indexOf(handle);
        if (idx === -1) {
            return false;
        }
        this._handles.splice(idx, 1);
        handle.dispose();
        return true;
    }

    /** 一次性清理所有注册的 observer。幂等。 */
    disposeAll(): void {
        for (const h of this._handles) {
            h.dispose();
        }
        this._handles.length = 0;
    }

    /** 当前管理的 observer 数量。 */
    get size(): number {
        return this._handles.length;
    }

    /** 释放所有句柄并清空（同 disposeAll）。 */
    clear(): void {
        this.disposeAll();
    }
}
