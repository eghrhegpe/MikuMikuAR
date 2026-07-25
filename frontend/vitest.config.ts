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
                // 诚实基线 35.59/28.37/30.91/35.51（2026-07-25；6 个测试文件已恢复计入覆盖率）
                // 旧基线 31.87/24.75/27.55/31.94 因排除 223 用例失真，已作废。
                // 该阈值仅防止「整体覆盖率回退」，不保护「新代码有测试」——新代码保护见 scripts/check-diff-coverage.mjs（P8-A）。
                lines: 35,
                branches: 28,
                functions: 30,
                statements: 35,
            },
        },
    },
});
