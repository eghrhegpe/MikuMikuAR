/**
 * ESLint configuration for MikuMikuAR frontend
 *
 * Extends:
 * - @typescript-eslint/recommended: TypeScript 推荐的规则
 * - prettier: 关闭与 Prettier 冲突的规则
 * - prettier/@typescript-eslint: TypeScript 专用的 Prettier 规则
 */

module.exports = {
  root: true,

  // 解析器
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    // 允许多重解析器（比如同时解析 TS 和 JSX）
    extraFileExtensions: [".cjs", ".mjs"],
  },

  // 插件
  plugins: ["@typescript-eslint", "prettier"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
    "plugin:prettier/recommended",
  ],

  // 环境
  env: {
    browser: true,
    es2022: true,
    node: true,
  },

  // 文件匹配
  overrides: [
    // ===== TypeScript 源文件 =====
    {
      files: ["src/**/*.ts"],
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
      rules: {
        // @typescript-eslint 规则
        "@typescript-eslint/no-unused-vars": [
          "warn",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
          },
        ],
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-inferrable-types": "off",
        "@typescript-eslint/ban-ts-comment": [
          "error",
          {
            "ts-expect-error": "allow-with-description",
            "ts-ignore": "allow-with-description",
            "ts-nocheck": "allow-with-description",
            "ts-check": false,
          },
        ],
        "@typescript-eslint/ban-types": [
          "error",
          {
            types: {
              "{}": {
                message: "Prefer 'Record<string, unknown>' or 'object'",
                fixWith: "object",
              },
              "object": false,
              "Function": false,
            },
          },
        ],
        "@typescript-eslint/prefer-optional-chain": "off",
        "@typescript-eslint/prefer-nullish-coalescing": "off",
        "@typescript-eslint/no-unnecessary-condition": "off",
      },
    },

    // ===== 测试文件 =====
    {
      files: ["src/__tests__/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
      extends: ["plugin:@typescript-eslint/recommended"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-unused-vars": [
          "warn",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
          },
        ],
      },
    },

    // ===== E2E 测试文件 =====
    {
      files: ["e2e/**/*.ts"],
      extends: ["plugin:@typescript-eslint/recommended"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
      },
    },

    // ===== 配置文件（CommonJS） =====
    {
      files: ["*.config.cjs", "*.config.js", "scripts/**/*.js"],
      env: {
        node: true,
        es2022: true,
      },
      parserOptions: {
        sourceType: "commonjs",
      },
      rules: {
        "@typescript-eslint/no-var-requires": "off",
      },
    },
  ],

  // 全局忽略
  ignorePatterns: [
    "node_modules",
    "dist",
    "dist-ssr",
    "wailsjs", // Wails 自动生成
    "public/lib", // 第三方库
    "*.min.js",
    "*.css",
  ],

  // 规则
  rules: {
    // ===== ESLint 核心 =====
    "no-console": "warn", // 允许 warn/error
    "no-debugger": "warn",
    "no-empty": "warn", // 空块可能是占位符
    "no-unused-vars": "off", // 由 @typescript-eslint 接管
    "prefer-const": "warn",
    "no-var": "error",
    "eqeqeq": ["warn", "always"], // 宽松一些
    "curly": ["warn", "all"],
    "brace-style": ["warn", "1tbs"],
    "comma-dangle": "off", // 由 Prettier 接管
    "quotes": ["warn", "single", { avoidEscape: true }],
    "semi": ["warn", "always"],
    "indent": "off", // 由 Prettier 接管
    "linebreak-style": ["warn", "unix"],

    // ===== Prettier =====
    "prettier/prettier": [
      "warn",
      {
        singleQuote: true, // 与项目现有风格一致
        trailingComma: "es5",
        semi: true,
        printWidth: 100,
        tabWidth: 4,
        useTabs: false,
        arrowParens: "always",
        endOfLine: "lf",
        bracketSpacing: true,
        bracketSameLine: false,
        quoteProps: "consistent",
      },
    ],
  },
};
