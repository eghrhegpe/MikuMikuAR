# pre-push 门禁连环阻断：三元语句 lint error + 过时测试断言

> **状态**: 🟢 已修复

**日期**: 2026-07-28
**严重程度**: 🟡 P3
**影响范围**: `frontend/src/core/ui-keyboard-nav.ts`、`frontend/src/core/__tests__/param-adapters.test.ts`
**发现方式**: CI 失败（pre-push 钩子门禁）
**修复提交**: `61492490`（lint）、`db02be68`（test）

---

## 问题描述

推送一批已提交的 commit 时，pre-push 钩子连续两次阻断：

1. 第一次：ESLint 检出 2 个 error（`@typescript-eslint/no-unused-expressions`），lint 门禁不通过。
2. 修掉 lint 后第二次：`test:coverage` 门禁失败，`param-adapters.test.ts` 有 1 个测试 fail。

两者都是仓库既有代码的门禁问题（非本次功能改动引入），但挡住了整条分支的推送。

## 根因分析

**缺陷一（lint error）**：`ui-keyboard-nav.ts` 的 Enter / ArrowRight 分支用三元表达式当语句：

```ts
options.onEnter ? options.onEnter(activeEl) : activeEl.click();
```

项目 ESLint 的 `@typescript-eslint/no-unused-expressions` 配置为 `allowTernary: false`，三元语句被判定为「无用表达式」。此规则仅在 `eslint src` 目录级 typed-linting 模式下触发，单文件 lint 不报，故此前未被拦下。

**缺陷二（过时测试）**：`param-adapters.test.ts` 有一条用例用 `type: 'string'` 作为「不支持的参数类型」的反例。但 `param-adapters.ts` 早已在提交 `95f9cda7` 补入 `string` 直通适配器（原样透传字符串），`string` 已是受支持类型。测试断言与实现不一致，导致 fail。

## 修复方案

- 缺陷一（`61492490`）：三元语句改为 `if/else` 块，符合项目 `curly: all` 风格，让函数调用成为明确语句。`ui-keyboard-nav.test.ts`（11 用例）验证行为不变。
- 缺陷二（`db02be68`）：反例改用真正不存在的类型（`'nonexistent'`），并补一条 `string` 直通的正向用例。27 用例通过。

## 教训

1. **ESLint stylish 格式在 PowerShell 管道下会打乱「文件名 ↔ 错误行」的归属**：排查时连续两次把 error 误判到错误文件（error-buffer.test.ts → config-store.ts → 实为 ui-keyboard-nav.ts）。批量 lint 定位应用 `--format json -o <file>` 落盘再解析，不靠管道 grep 读行号。
2. **typed-linting 规则（如 no-unused-expressions）只在目录级扫描触发**：单文件 `eslint <file>` 可能报 0 error 却在 `npm run lint` 报错，验证门禁须跑与 CI 一致的完整命令。
3. **给函数加能力后要回扫存量测试**：`param-adapters` 补了 string 适配器却漏改把 string 当反例的旧测试，属于「能力扩展未同步测试契约」的典型漂移。
