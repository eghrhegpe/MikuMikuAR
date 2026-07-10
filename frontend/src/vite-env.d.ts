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

    interface ImportMetaEnv {
        readonly VITE_WASM_LAYERS_BLEND?: string;
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv;
    }
}

export {};
