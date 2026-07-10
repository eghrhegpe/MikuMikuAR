// 专用基准配置：移除 `**/*.perf.test.ts` 排除，使性能基准可显式运行：
//   npx vitest run --config vitest.perf.config.ts src/__tests__/wasm-layers-blender.perf.test.ts
// 默认 `npm run test` 仍走 vitest.config.ts（已排除 *.perf.test.ts，不污染常规套件）。
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
            "@bindings": path.resolve(__dirname, "bindings"),
            "@babylonjs/core/Engines/engine": path.resolve(
                __dirname,
                "src/__tests__/mocks/engine-mock.ts"
            ),
        },
    },
    test: {
        environment: "happy-dom",
        globals: true,
        exclude: ["e2e/**", "node_modules/**"],
        setupFiles: ["./src/__tests__/setup-wails.ts"],
    },
});
