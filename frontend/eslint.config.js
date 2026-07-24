import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  eslint.configs.recommended,
  prettierConfig,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-ssr/**',
      'wailsjs/**',
      'public/lib/**',
      '*.min.js',
      '*.css',
      '**/poc-mmd-bone-attachment.mjs',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
        __MMD_ENABLE_MPR__: 'readonly',
        // 环境全局类型：由 @babylonjs/core 的 `declare global` 注入（Engines/engine.d.ts），
        // 非运行时值，仅供类型标注；eslint 的 no-undef 看不见全局类型增强，故在此登记。
        XRSessionMode: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': 'allow-with-description',
          'ts-nocheck': 'allow-with-description',
          'ts-check': false,
        },
      ],
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'no-console': ['warn', { allow: ['error', 'warn', 'info'] }],
      'no-debugger': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unused-vars': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
      curly: ['warn', 'all'],
      'brace-style': ['warn', '1tbs'],
      quotes: ['warn', 'single', { avoidEscape: true }],
      semi: ['warn', 'always'],
      // 代码质量度量：自动拦截超限函数（审计 250LOC 红线 + 圈复杂度）
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'warn',
        { max: 250, skipBlankLines: true, skipComments: true },
      ],
      complexity: ['warn', 20],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/wailsjs/go/**', '**/wailsjs/runtime/**'],
              message:
                "Import from '../core/wails-bindings' instead of directly from wailsjs/.",
            },
          ],
        },
      ],
      indent: 'off',
      // Windows 开发环境关掉 linebreak 检查（Git autocrlf 导致大量 CRLF 噪声）
      'linebreak-style': 'off',
      'prettier/prettier': [
        'warn',
        {
          singleQuote: true,
          trailingComma: 'es5',
          semi: true,
          printWidth: 100,
          tabWidth: 4,
          useTabs: false,
          arrowParens: 'always',
          endOfLine: 'lf',
          bracketSpacing: true,
          bracketSameLine: false,
          quoteProps: 'consistent',
        },
      ],
    },
  },
  {
    files: ['src/core/wails-bindings.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['src/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
        __MMD_ENABLE_MPR__: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['*.config.js', '*.config.cjs', '*.config.mjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      sourceType: 'commonjs',
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
];
