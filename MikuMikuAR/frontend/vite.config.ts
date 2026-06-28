import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  // Exclude both babylon-mmd and @babylonjs/core from Vite's dependency
  // pre-bundling. Pre-bundling creates a separate module instance, causing
  // babylon-mmd's shader side-effects (ShaderStore writes) to write into
  // a different instance than what Babylon.js reads at render time — 404.
  optimizeDeps: {
    exclude: ['babylon-mmd', '@babylonjs/core'],
  },
  assetsInclude: ['**/*.wasm', '**/*.fx'],
  build: {
    rollupOptions: {
      plugins: [
        process.env.ANALYZE
          ? visualizer({ filename: 'dist/stats.html', open: false, gzipSize: true })
          : undefined,
      ].filter(Boolean),
      output: {
        manualChunks(id) {
          // babylon-mmd + @babylonjs/core: large vendor chunk, cached independently
          if (id.includes('babylon-mmd') || id.includes('@babylonjs')) {
            return 'babylon-vendor';
          }
          // iconify is ~150KB, separate from app code
          if (id.includes('@iconify') || id.includes('iconify-icon')) {
            return 'iconify-vendor';
          }
          // remaining node_modules
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
});
