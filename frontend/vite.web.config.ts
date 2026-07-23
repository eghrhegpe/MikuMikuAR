// [doc:adr-177] Phase 3 — 主应用 Web 入口生产构建配置
//
// 用途：为主应用在浏览器环境运行（GitHub Pages 部署）提供独立生产构建。
// 融合 vite.spike.config.ts（Phase 0 验证可行）+ vite.web-loader.config.ts（已验证 Pages 部署）。
//
// 与主应用 vite.config.ts 的差异：
//   1. 入口改 index.web.html（移除 babylon UMD + 置 __MMKU_WEB__）
//   2. 不 externalize @babylonjs/* —— web 入口无 babylon UMD script 标签，必须打进 bundle
//   3. @wailsio/runtime → no-op stub（隔离 @bindings/app.ts 的 Call value import；
//      业务侧 Events/Browser 已走 runtime-bridge 动态 import，web 入口短路不加载）
//   4. base = '/MikuMikuAR/' — GitHub Pages 仓库名前缀
//   5. 产物输出到 dist-web/（复用 web-loader 产物目录，替换其为唯一入口）
//
// 构建：npx vite build --config vite.web.config.ts
// 预览：npx vite preview --config vite.web.config.ts

import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    // GitHub Pages 仓库名前缀（eghrhegpe.github.io/MikuMikuAR/）
    base: '/MikuMikuAR/',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@bindings': path.resolve(__dirname, 'bindings'),
            // @wailsio/runtime 替换为 no-op 桩：web 入口不依赖 Wails 运行时，
            // 避免 loadOptionalScript → HEAD /wails/custom.js 探测污染浏览器 bundle。
            // go-adapter 在 web 入口下被 __MMKU_WEB__ 短路，永不加载（dynamic import 不触发）。
            '@wailsio/runtime': path.resolve(__dirname, 'src/web-loader/wails-runtime-stub.ts'),
        },
    },
    server: {
        host: '127.0.0.1',
        port: 5174,
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
    // 构建期常量注入（对齐 vite.config.ts，否则 ReferenceError: __MMD_ENABLE_MPR__ is not defined）
    define: {
        __MMD_ENABLE_MPR__: JSON.stringify(!!process.env.VITE_MMD_WASM_MT),
    },
    build: {
        target: 'esnext',
        minify: 'esbuild',
        cssMinify: true,
        sourcemap: false,
        // 主应用全量打包（Babylon + 菜单 + 场景），接受大 bundle 换取零外部依赖
        chunkSizeWarningLimit: 4000,
        // 复用 web-loader 产物目录，替换其为唯一 Pages 入口
        outDir: 'dist-web',
        rollupOptions: {
            // 主应用 web 入口
            input: path.resolve(__dirname, 'index.web.html'),
            output: {
                format: 'es',
                manualChunks: (id) => {
                    if (id.includes('@iconify') || id.includes('iconify-icon')) {
                        return 'iconify-vendor';
                    }
                    // Babylon 拆 chunk 加速首屏（可并行加载）
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
