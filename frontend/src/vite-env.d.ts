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
        // [audit:round20] 补 __dumpBones 声明（DEV/VITE_E2E_MODE 注入，控制台骨骼层级调试）
        __dumpBones?: () => unknown;
        // [audit:round20] 补 __scene 声明（e2e 只读探针 + driver 写钩子，ADR-229 读写分离）
        __scene?: {
            fps: number;
            meshCount: number;
            currentAnimation: string | null;
            fingerprint?: string;
            driver: {
                applyOutfit: (variantName: string) => Promise<boolean>;
                [key: string]: unknown;
            };
        };
        __envDebug?: () => {
            clearColor: string;
            matType: string;
            skyMode: string;
        };
        // [doc:adr-229] 只读状态读取器（schema-driven 交互断言用，复用 getStateValue）
        __state?: {
            get: (path: string, modelId?: string) => unknown;
            // [audit:round20] 补 ready 探针声明（initScene 完成态，schema-driven 守卫域用）
            get isLightingReady(): boolean;
            get isRenderReady(): boolean;
        };
    }

    // ADR-099: 构建期注入的 MPR 开关（vite define）。
    // true → 前端编入 MmdWasmInstanceTypeMPR（多线程物理，需 COOP/COEP + SharedArrayBuffer）；
    // false（默认）→ 死分支被 esbuild 消除，默认构建不含 MPR worker/wasm。
    // 与 Go 端 CoopCoepMiddleware 同轴门控（同名环境变量 VITE_MMD_WASM_MT）。
    const __MMD_ENABLE_MPR__: boolean;

    interface ImportMetaEnv {
        readonly VITE_WASM_LAYERS_BLEND?: string;
        // [audit:round20] ADR-229 e2e 钩子注入开关（?e2e=1 或本变量注入 __capture/__state/__scene）
        readonly VITE_E2E_MODE?: string;
        // ADR-099: 多线程 WASM 物理（MPR）构建开关（文档用途；实际门控走 __MMD_ENABLE_MPR__ define）。
        // 定义时前端拉入 MmdWasmInstanceTypeMPR（依赖 SharedArrayBuffer + COOP/COEP），
        // 与 Go 端 CoopCoepMiddleware 同轴门控。
        readonly VITE_MMD_WASM_MT?: string;
        // ADR-188: MMD 材质模式切换（Phase 0 POC）
        // 'standard'（默认）→ MmdStandardMaterialProxy + MmdStandardMaterial（Lambert/Blinn-Phong）
        // 'pbr'              → PBRMaterialBuilder + PBRMaterial（Cook-Torrance PBR）
        readonly VITE_MMD_MATERIAL?: string;
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv;
    }
}

export {};
