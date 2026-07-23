// ADR-177 Phase 0 Spike — 临时验证配置（非生产）
//
// 目的：验证主应用 index.html + core/main.ts 在浏览器侧能启动不崩，
// 作为方向 A「主应用直接跑浏览器」的可行性前置门槛。
//
// 关键差异（vs vite.config.ts）：
//   1. 入口改 index.spike.html（移除 babylon UMD script + 置 __MMKU_WEB__）
//   2. @wailsio/runtime → no-op stub（隔离 @bindings/app.ts 的 value import）
//   3. base = '/'（dev 模式，非 GitHub Pages）
//
// 构建：npx vite build --config vite.spike.config.ts
// 预览：npx vite preview --config vite.spike.config.ts --port 4174
// Dev： npx vite --config vite.spike.config.ts
//
// ⚠️ Spike 产物：本文件 + index.spike.html + wails-runtime-stub.ts（已扩展）
// Phase 0 通过后保留作为复现凭证。

import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    base: '/',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@bindings': path.resolve(__dirname, 'bindings'),
            '@wailsio/runtime': path.resolve(__dirname, 'src/web-loader/wails-runtime-stub.ts'),
        },
    },
    server: {
        host: '127.0.0.1',
        port: 5174,
    },
    worker: {
        format: 'es',
    },
    optimizeDeps: {
        exclude: ['babylon-mmd', '@babylonjs/core', '@babylonjs/materials'],
    },
    assetsInclude: ['**/*.wasm', '**/*.fx'],
    // 构建期常量注入（对齐 vite.config.ts，否则 ReferenceError）
    define: {
        __MMD_ENABLE_MPR__: JSON.stringify(!!process.env.VITE_MMD_WASM_MT),
    },
    build: {
        target: 'esnext',
        minify: 'esbuild',
        sourcemap: true, // Spike 保留 sourcemap 便于调试
        chunkSizeWarningLimit: 4000,
        outDir: 'dist-spike',
        rollupOptions: {
            input: path.resolve(__dirname, 'index.spike.html'),
            output: {
                format: 'es',
                manualChunks: (id) => {
                    if (id.includes('@iconify') || id.includes('iconify-icon')) {
                        return 'iconify-vendor';
                    }
                    if (id.includes('@babylonjs/core') || id.includes('@babylonjs/materials')) {
                        return 'babylon-vendor';
                    }
                    if (id.includes('babylon-mmd')) {
                        return 'mmd-vendor';
                    }
                    if (id.includes('node_modules')) {
                        return 'vendor';
                    }
                },
            },
        },
    },
});
