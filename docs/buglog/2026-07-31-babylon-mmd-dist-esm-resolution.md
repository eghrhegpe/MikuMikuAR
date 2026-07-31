# babylon-mmd -dist git 依赖产物三类 ESM 解析缺陷（build 绿但 vitest 全挂）

> **状态**: 🟢 已修复（三轮缺陷全部由 -dist 侧解决，消费侧三连全绿 tsc0/build/2704）

**日期**: 2026-07-31
**严重程度**: 🟠 P2
**影响范围**: `frontend/node_modules/babylon-mmd/esm/**`（-dist 分支构建产物）、连带 `frontend` 全量 vitest 20 个 suite
**发现方式**: 测试发现（切换 babylon-mmd 至 -dist git 依赖后 `npm run test` 20 suite 失败）
**修复提交**: -dist `900cf29`（R1）/ `12b4b85`（R2）/ R3 装饰器转译（tsconfig + build 脚本）；消费侧 `frontend/src/scene/scene.ts` + `frontend/package.json`

---

## 问题描述

babylon-mmd 分发方案从官方 npm 1.2.0 切换到 fork 的 `-dist` 分支 git 依赖（`github:eghrhegpe/babylon-mmd#feat/p2-native-rigidbody-bundle-dist`，见 ADR-202）后：

- `npx tsc --noEmit`：✅ 0 错
- `npm run build`（vite）：✅ 通过
- `npm run test`（vitest）：❌ **20 个 test suite 在模块加载阶段 `SyntaxError: Invalid or unexpected token`**（Tests 用例本身 2506 全过，失败全在 Failed Suites 加载阶段）

典型症状：`library-core.*` 等测试本身不直接 import babylon-mmd，却因传递依赖链（`library-core → scene.ts → babylon-mmd 深路径`）在加载时炸。

## 根因分析

`-dist` 分支的 `esm/*.js` 产物必须是**纯净、可被 Node 原生 ESM 解析**的 JS。vite/rollup/esbuild 的解析器容忍度高（所以 build 绿、日常开发无感），但 **vitest 走 Node 原生 ESM，容忍度低**，暴露三类产物缺陷：

### 第一轮（已修 `900cf29`）— 无扩展名 import
81 处 `from "@babylonjs/core/Misc/observable.pure"`（缺 `.js`）。Node ESM 要求相对/子路径 import 带 `.js` 后缀。

### 第二轮（已修 `12b4b85`）— 目录 import 被一刀切补 `.js`
后缀补全脚本对**目录 import** 也误加 `.js`：`../wasm/spr` → `../wasm/spr.js`，但 `wasm/spr` 是**目录**（入口 `wasm/spr/index.js`），加 `.js` 后找不到文件 → `Could not resolve "../wasm/spr.js"`（8 个 InstanceType 文件全中招）。
修法：区分文件 import（补 `.js`）与目录 import（补 `/index.js`）。

### 第三轮（✅ 已修）— `.pure.js` 产物残留未转译的 TS 装饰器
3 个文件含未编译的旧版 TS 装饰器语法，Node/vitest 原生 ESM 无法解析：

| 文件 | 首个报错行 | 装饰器残留数 |
|------|-----------|-------------|
| `Runtime/mmdCamera.pure.js` | `:21 @serializeAsVector3()` | 3 |
| `Loader/mmdStandardMaterial.pure.js` | `:39 @serialize("renderOutline")` | 4 |
| `Loader/mmdPluginMaterial.pure.js` | `:59 @serializeAsTexture("sphereTexture")` | 6 |

病因链（关联 ADR-202 §48）：fork 的 `tsconfig.lib.json` 当年为修 TS1240（babylon 9.18 的 `@serialize` 迁 TC39 标准装饰器与旧版冲突）**关闭了 `experimentalDecorators` + `emitDecoratorMetadata`**。关闭后，这几个仍用旧版装饰器语法的 `.pure.ts` 编译时装饰器**未被转译**、原样输出到 `.js` → 非法 JS。

**定位方法**（可复用）：
```powershell
cd node_modules/babylon-mmd/esm
Get-ChildItem -Recurse -Filter "*.js" | ForEach-Object {
  node --check $_.FullName 2>&1
  if ($LASTEXITCODE -ne 0) { $_.FullName }
}
```

## 修复方案

### -dist 侧（构建产物根治）
- **第一/二轮**：`build-dist-branch.mjs` 后处理补全 `.js` 扩展名，分两阶段——相对 import 判断目录/文件（目录补 `/index.js`，文件补 `.js`），外部子路径直接补 `.js`。已落地（`12b4b85`，351 + 182 文件）。
- **第三轮（已修）**：二选一，实际采纳组合方案——
  1. `tsconfig.lib.json` 恢复 `experimentalDecorators: true`（`emitDecoratorMetadata` 保持 false 以避开当年的 TS1240）；
  2. `build-dist-branch.mjs` 增加 `__decorate` helper 转译步骤，把 `@serialize*` 转成 ESM 严格模式兼容的调用形式，产出纯净 JS。
  验证：3 个装饰器文件 `node --check` 全绿，全 esm 语法非法文件数归零。

### 主仓库侧（消费适配，已就绪）
切换到 -dist 1.3.0 后的 app 侧适配（`frontend/src/scene/scene.ts`）：
- 补 1.3.0 纯/非纯拆分要求的副作用 import：`mmdRuntimeCameraAnimation`、`mmdCompositeRuntimeModelAnimation`（否则 `createRuntimeCameraAnimation`/`createRuntimeModelAnimation` 原型 augmentation 缺失 → TS2345）；
- 失效深路径修复：`mmdModelLoader.default` → `mmdModelLoader`（1.3.0 拆分改了入口名）；
- KTX2 `URLConfig` 自托管配置守卫（字段存在才赋值，避免未来 babylon 删字段时崩）。

## 教训

1. **build 绿 ≠ test 绿**：vite/esbuild 解析器容忍度高于 Node 原生 ESM；git 依赖分发的产物必须能被 Node 原生 ESM 解析，验证分发方案时**必须跑 vitest**，不能只验 `npm install` + build。
2. **产物纯净性优先于源码正确性**：`-dist` 分发的是编译产物，任何未转译的 TS 语法（装饰器/类型注解）、无扩展名 import、目录 import 都会在严格解析器下暴露。定位用 `node --check` 逐文件校验最快。
3. **一刀切后处理有回归风险**：后缀补全脚本不区分目录/文件 import 会引入新失败；批量产物改写需按 import 目标类型分流。
