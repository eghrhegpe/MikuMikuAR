import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
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
        exclude: ["e2e/**", "node_modules/**"],
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
        },
    },
});
