import { defineConfig } from 'vite';

export default defineConfig({
  // Exclude both babylon-mmd and @babylonjs/core from Vite's dependency
  // pre-bundling. Pre-bundling creates a separate module instance, causing
  // babylon-mmd's shader side-effects (ShaderStore writes) to write into
  // a different instance than what Babylon.js reads at render time — 404.
  optimizeDeps: {
    exclude: ['babylon-mmd', '@babylonjs/core'],
  },
  assetsInclude: ['**/*.wasm'],
});
