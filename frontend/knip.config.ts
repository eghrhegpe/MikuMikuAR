import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Alternate build configs & helper scripts are valid entry points
  // (knip auto-detects main.ts, vite.config.ts, vitest.config.ts, eslint.config.js, playwright.config.ts)
  entry: [
    'vite.web.config.ts',
    'vite.spike.config.ts',
    'vitest.perf.config.ts',
    'scripts/**/*.ts',
    'scripts/**/*.mjs',
    '../scripts/**/*.mjs',           // 根目录脚本（codemod.mjs 使用 ts-morph）
  ],
  ignore: [
    'bindings/**',
    'src/__tests__/**',
    'e2e/**',
    'public/**',
    'src/config.ts',                    // Type barrel re-export (knip can't trace)
    'src/core/runtime-stub.ts', // Used via Vite alias in vite.web.config.ts
  ],
  // Suppress exports used within the same file (factory pattern in motion-modules)
  ignoreExportsUsedInFile: true,
  ignoreBinaries: ['wails3'],
  // These are used via side-effect, runtime auto-loading, or build-time tooling
  ignoreDependencies: [
    '@babylonjs/loaders',      // Babylon.js auto-loads for PMX/GLB support
    '@iconify/iconify',        // Used by icon system
    '@preact/signals-core',    // Used by reactivity system
    '@iconify/icons-lucide',   // Dev: icon generation
    'jscpd-html-reporter',     // Used by `duplicate:html` npm script (--reporters flag)
    'ts-morph',                // Used by root scripts/codemod.mjs (knip can't trace ../scripts)
  ],
  rules: {
    files: 'warn',
    dependencies: 'warn',
    devDependencies: 'warn',
    unlisted: 'warn',
    exports: 'warn',
    types: 'warn',
    nsExports: 'warn',
    nsTypes: 'warn',
    enumMembers: 'warn',
    duplicates: 'warn',
  },
};

export default config;