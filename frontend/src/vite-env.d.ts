/// <reference types="vite/client" />

declare module 'encoding-japanese' {
    interface ConvertOptions {
        to: string;
        from: string;
        type?: 'string' | 'arraybuffer' | 'array';
    }
    export function convert(
        data: string | number[] | Uint8Array,
        options: ConvertOptions
    ): number[];
    export function stringToCode(str: string): number[];
    export function codeToString(codes: number[]): string;
}

declare global {
    interface Window {
        __capture?: () => Promise<string>;
        __envDebug?: () => {
            clearColor: string;
            matType: string;
            skyMode: string;
        };
    }

    // ADR-099: 构建期注入的 MPR 开关（vite define）。
    // true → 前端编入 MmdWasmInstanceTypeMPR（多线程物理，需 COOP/COEP + SharedArrayBuffer）；
    // false（默认）→ 死分支被 esbuild 消除，默认构建不含 MPR worker/wasm。
    // 与 Go 端 CoopCoepMiddleware 同轴门控（同名环境变量 VITE_MMD_WASM_MT）。
    const __MMD_ENABLE_MPR__: boolean;

    interface ImportMetaEnv {
        readonly VITE_WASM_LAYERS_BLEND?: string;
        // ADR-099: 多线程 WASM 物理（MPR）构建开关（文档用途；实际门控走 __MMD_ENABLE_MPR__ define）。
        // 定义时前端拉入 MmdWasmInstanceTypeMPR（依赖 SharedArrayBuffer + COOP/COEP），
        // 与 Go 端 CoopCoepMiddleware 同轴门控。
        readonly VITE_MMD_WASM_MT?: string;
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv;
    }
}

export {};
