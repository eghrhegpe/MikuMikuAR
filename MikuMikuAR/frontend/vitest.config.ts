import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "happy-dom",
        globals: true,
        exclude: ["e2e/**", "node_modules/**"],
        setupFiles: ["./src/__tests__/setup-wails.ts"],
        // Tell Vitest NOT to transform @babylonjs/* — esbuild on CI (Ubuntu/Node 20)
        // can't parse private class fields (_renderLoops) in Babylon.js source.
        // vi.mock() still works because it intercepts module resolution, not transformation.
        deps: {
            optimizer: {
                ssr: {
                    include: ["@babylonjs/core", "@babylonjs/materials", "babylon-mmd"],
                },
            },
            inline: [],
        },
        server: {
            deps: {
                external: [/^@babylonjs\//, /^babylon-mmd/],
            },
        },
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
