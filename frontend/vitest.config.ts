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
        // 兜底防卡死：漏挂 mock / 永不 resolve 的 Promise 最多挂 10s 后报超时失败，
        // 而不是让整个 vitest run 永久挂着。需要更长耗时的用例在 test() 第三参覆盖。
        testTimeout: 10000,
        hookTimeout: 15000,
        exclude: [
            "e2e/**",
            "node_modules/**",
            "**/*.perf.test.ts",
        ],
        setupFiles: ["./src/__tests__/setup-wails.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text-summary", "html"],
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
