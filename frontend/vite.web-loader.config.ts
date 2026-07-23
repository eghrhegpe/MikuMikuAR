// [doc:architecture] Web Loader 独立构建配置 — ADR-176 Phase 3
//
// 用途：为 GitHub Pages 部署 web-loader.html 原型页提供独立生产构建。
// 与主应用 vite.config.ts 的差异：
//   1. 仅以 web-loader.html 为入口（不构建主 Wails 应用 index.html）
//   2. 不 externalize @babylonjs/* —— web-loader.html 无 babylon UMD script 标签，
//      必须将 Babylon 打进 bundle（原型页接受大 bundle 换取零外部依赖）
//   3. base = '/MikuMikuAR/' —— GitHub Pages 仓库名前缀（eghrhegpe/MikuMikuAR）
//   4. 产物输出到 dist-web/，不污染主应用 dist/（Wails 构建用）
//
// 构建：npx vite build --config vite.web-loader.config.ts
// 预览：npx vite preview --config vite.web-loader.config.ts

import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    // GitHub Pages 仓库名前缀（eghrhegpe.github.io/MikuMikuAR/）
    base: '/MikuMikuAR/',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@bindings': path.resolve(__dirname, 'bindings'),
            // @wailsio/runtime 替换为 no-op 桩：web-loader 不依赖 Wails 运行时，
            // 避免其 loadOptionalScript → HEAD /wails/custom.js 探测污染浏览器 bundle。
            // go-adapter 在 web 入口下被 __MMKU_WEB__ 短路，永不加载。
            '@wailsio/runtime': path.resolve(__dirname, 'src/web-loader/wails-runtime-stub.ts'),
        },
    },
    server: {
        host: '127.0.0.1',
    },
    // babylon-mmd MPR worker 入口
    worker: {
        format: 'es',
    },
    optimizeDeps: {
        // @babylonjs/core 必须排除（ESBuild 不认 .fx shader）
        // babylon-mmd 必须排除（WASM 加载方式特殊）
        exclude: ['babylon-mmd', '@babylonjs/core', '@babylonjs/materials'],
    },
    assetsInclude: ['**/*.wasm', '**/*.fx'],
    build: {
        target: 'esnext',
        minify: 'esbuild',
        cssMinify: true,
        sourcemap: false,
        // 原型页接受大 bundle（Babylon 全量打包），静音告警
        chunkSizeWarningLimit: 4000,
        // 产物输出到独立目录，不污染主应用 dist/
        outDir: 'dist-web',
        rollupOptions: {
            // 仅 web-loader.html 作为入口
            input: path.resolve(__dirname, 'web-loader.html'),
            output: {
                format: 'es',
                manualChunks: (id) => {
                    if (id.includes('@iconify') || id.includes('iconify-icon')) {
                        return 'iconify-vendor';
                    }
                    // Babylon 拆 chunk 加速首屏（虽都打进 bundle，但可并行加载）
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
