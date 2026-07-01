/// <reference types="vite/client" />

declare global {
    interface Window {
        __capture?: () => Promise<string>;
        __envDebug?: () => {
            clearColor: string;
            matType: string;
            skyMode: string;
        };
    }
}

export {};
