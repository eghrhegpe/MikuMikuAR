// [doc:architecture] @wailsio/runtime 浏览器桩 — ADR-176 web-loader 构建
//
// 用途：web-loader 生产构建时替换 @wailsio/runtime，避免 @bindings/app.ts 的
// value import `import { Call } from "@wailsio/runtime"` 把整个 Wails 运行时
// （含 loadOptionalScript → HEAD /wails/custom.js 探测）打进浏览器 bundle。
//
// web-loader 只用 browserAdapter，不依赖 @wailsio/runtime 任何功能。
// go-adapter（唯一真实消费 @wailsio/runtime 的模块）在 web 入口下被 __MMKU_WEB__
// 短路，永不加载——故桩可为全 no-op。
//
// 通过 vite.web-loader.config.ts 的 resolve.alias 注入，仅影响 web-loader 构建，
// 主应用 vite.config.ts 不受扰动。

export const Call = async (): Promise<null> => null;
export const CancellablePromise = class {
    cancel(): void {
        /* no-op */
    }
    then(): Promise<null> {
        return Promise.resolve(null);
    }
    catch(): Promise<null> {
        return Promise.resolve(null);
    }
};
export const Events = {
    On(): () => void {
        return () => {
            /* no-op */
        };
    },
    OnMultiple(_name: string, _cb: (data: unknown) => void, _max: number): () => void {
        return () => {
            /* no-op */
        };
    },
    Once(_name: string, _cb: (data: unknown) => void): () => void {
        return () => {
            /* no-op */
        };
    },
    Off(..._names: string[]): void {
        /* no-op */
    },
    OffAll(): void {
        /* no-op */
    },
    Emit(_name: string, _data?: unknown): Promise<boolean> {
        return Promise.resolve(false);
    },
};
export const Browser = {
    openURL(): void {
        /* no-op */
    },
};
