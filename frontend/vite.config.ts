import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

// Babylon 相关包：生产构建时从 Bundle 中 externalize，改为 script 标签引入
const BABYLON_EXTERNAL = [
  '@babylonjs/core',
  '@babylonjs/materials',
];

// Vitest 需要解析 Babylon 模块来做 vi.mock，不应 externalize
const isVitest = typeof process !== 'undefined' && process.env?.VITEST;

export default defineConfig(({ command }) => {
  const isProduction = command === 'build';

  // 开发模式下移除 index.html 中的 Babylon UMD script 标签，
  // 避免冗余加载 8.3MB 的 babylon.js（dev 模式下由 Vite 直接 serve node_modules 的 ES module）
  const removeBabylonScripts = (): any => ({
    name: 'remove-babylon-scripts',
    transformIndexHtml(html: string) {
      if (isProduction) return html;
      return html
        .replace('<script src="/lib/babylon.js"></script>', '')
        .replace('<script src="/lib/babylonjs.materials.min.js"></script>', '');
    },
  });

  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@bindings': path.resolve(__dirname, 'bindings'),
      },
    },
    server: {
      // 强制 IPv4 监听，修复 Go ExternalAssetHandler 连 127.0.0.1 被拒的问题
      host: '127.0.0.1',
    },
    optimizeDeps: {
      // @babylonjs/core 必须排除，ESBuild 不认识 .fx shader 文件
      // babylon-mmd 也必须排除（WASM 加载方式特殊）
      exclude: ['babylon-mmd', '@babylonjs/core', '@babylonjs/materials'],
    },
    assetsInclude: ['**/*.wasm', '**/*.fx'],
    plugins: [removeBabylonScripts()],
    build: {
      target: 'esnext',
      minify: 'esbuild',
      cssMinify: true,
      sourcemap: false,
      rollupOptions: {
        // 外部化 Babylon 相关包（不打包进 bundle）
        // 注意：vitest 下必须 internalize，否则 vi.mock 无法解析模块
        external: (id) => {
          if (isVitest) return false;
          if (BABYLON_EXTERNAL.some(pkg => id === pkg || id.startsWith(pkg + '/'))) {
            return true;
          }
          if (id.includes('node_modules/@babylonjs/core') || id.includes('node_modules/@babylonjs/materials')) {
            return true;
          }
          return false;
        },
        output: {
          // 生产构建用 IIFE 格式，让 output.globals 生效
          format: isProduction ? 'iife' : 'es',
          name: isProduction ? 'app' : undefined,
          // 映射外部包到全局变量（仅 IIFE/UMD 格式生效）
          globals: (id) => {
            if (isVitest) return undefined;
            if (id === '@babylonjs/core' || id.startsWith('@babylonjs/core/')) return 'BABYLON';
            if (id === '@babylonjs/materials' || id.startsWith('@babylonjs/materials/')) return 'BABYLON';
            return null;
          },
          // manualChunks 仅对 es 格式生效（IIFE 不支持 code splitting）
          ...(isProduction ? {} : {
            manualChunks: (id) => {
              if (id.includes('@iconify') || id.includes('iconify-icon')) {
                return 'iconify-vendor';
              }
              if (id.includes('node_modules')) {
                return 'vendor';
              }
            },
          }),
        },
        plugins: [
          isProduction && visualizer({ filename: 'dist/stats.html', open: false, gzipSize: true }),
        ].filter(Boolean),
      },
    },
  };
});
