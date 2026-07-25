import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            // Path aliases (matching tsconfig.json paths)
            "@": path.resolve(__dirname, "src"),
            "@bindings": path.resolve(__dirname, "bindings"),
            // Redirect Engine import to our mock BEFORE esbuild sees the real source.
            // This prevents the _renderLoops parse error on CI (Ubuntu/Node 20).
            "@babylonjs/core/Engines/engine": path.resolve(
                __dirname,
                "src/__tests__/mocks/engine-mock.ts"
            ),
        },
    },
    test: {
        environment: "happy-dom",
        globals: true,
        exclude: [
            "e2e/**",
            "node_modules/**",
            "**/*.perf.test.ts",
        ],
        setupFiles: ["./src/__tests__/setup-wails.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.test.ts",
                "src/__tests__/**",
                "src/**/index.ts",
                "src/wailsjs/**",
            ],
            thresholds: {
                // 基线 31.87/24.75/27.55/31.94（2026-07-24，6 个测试文件因 mock 问题排除）
                // 逐步上调防止回退
                lines: 31,
                branches: 24,
                functions: 27,
                statements: 31,
            },
        },
    },
});
