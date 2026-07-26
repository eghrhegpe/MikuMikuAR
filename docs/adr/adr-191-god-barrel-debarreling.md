# ADR-191: 神桶 `@/core/utils` 去桶化（零依赖叶下沉）

> **状态**: 实施中（A 档已完成 2026-07-27；B/C 档进行中）
> **日期**: 2026-07-27（初版）
> **关联**: ADR-177（Web Loader 统一路径 — 测试 EXIT=124 根因）、cf264937（clamp 叶抽取地基）
> **来源**: `virtual-skirt.test.ts`「一改就炸」根因调查——纯几何模块 `skirt-analyzer.ts` 从 `@/core/utils` 桶导入 `clampInt`，整桶 ESM 组合求值留下 pending 微任务，致 vitest fork worker 永不退（EXIT=124）。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-27

---

## 背景

`@/core/utils` 是一处典型 **god barrel**：792 行，顶部 7–19 行拖入 `dom` / `state` / `fileservice` / `status-bar` / `i18n` / `feedback` / `menus` / `logger` 整套应用工具层。任何从桶导入的模块，即便只引用一个纯函数（如 `clamp`），都会被 ESM 组合求值强制拉起整条应用层依赖链。

**直接危害**（已证）：
- `skirt-analyzer.ts`（标榜纯几何）引 `clampInt` 从桶 → vitest fork worker 留 pending 微任务 → `virtual-skirt.test.ts` 整批 EXIT=124（被强杀），表现为「一改就炸」。
- 防御措施：`vitest.config.ts` 已加 `forceExit: true`（管「用例全过但进程不退」），但属兜底，**非根因治理**。

**治理目标**：纯 / 叶子模块禁止从桶导入，须引用具体零依赖叶（`@/core/clamp` / 新增 `@/core/path` / `@/core/async`）。应用耦合符号（依赖 state/dom/feedback 的）留桶内——它们本就需要应用层，不属去桶化范围。

---

## 现状盘点（2026-07-27）

| 档 | 内容 | 状态 |
|----|------|------|
| A 档 | 抽 `@/core/clamp` 叶（`clamp`/`clampInt`/`clamp01`），14 个纯模块改引叶 | ✅ 已完成（cf264937 地基 + 14 模块本提交） |
| B 档 | 抽 `@/core/path` 叶（纯路径符号），迁移路径调用方 | 🔄 进行中 |
| C 档 | 抽 `@/core/async` 叶（纯异步符号）+ `clampPct`/`lerp`/`lerpArray` 并入 `clamp.ts`，迁移调用方 | 🔄 进行中 |
| D 档 | 应用耦合符号（`triggerAutoSave`/`canvasToBase64`/`withLoadingIndicator`/`logWarn`/`deepClone`/`debounce`/`setKey`/`formatTimestamp`/`computeLibraryRef`/`resolveLibraryRef` 等）单独收口或留桶 | ⏳ 待议 |

**A 档落地后，仍从桶导入的 21 个混引模块**（按符号分类）：

| 模块 | 桶内符号 | 可下沉叶 |
|------|----------|----------|
| `outfit/outfit.ts` | getBaseName, normPath, getDirPath, delay, LoadingGuard | path + async |
| `scene/ar/ar-camera.ts` | canvasToBase64 | （D 档，app 耦合） |
| `scene/env/env-bridge.ts` | logWarn | （D 档） |
| `scene/camera/camera.ts` | clamp, debounce, deepClone | clamp + （debounce/deepClone D 档） |
| `scene/manager/model-loader.ts` | getBaseName, swallowError, isUnderRoot | path + async |
| `scene/manager/model-manager.ts` | clamp01, swallowError | clamp + async |
| `scene/manager/thumbnail-capture.ts` | isStageLike, canvasToBase64 | path + （D 档） |
| `scene/env/env-persist.ts` | logWarn, DebouncedTimer | （logWarn D 档）+ async |
| `scene/manager/thumbnail-key.ts` | isStageLike | path |
| `scene/env/env-time-of-day.ts` | 多符号（待核） | 按符号分流 |
| `scene/env/props.ts` | getBaseName | path |
| `motion-algos/beat-detector.ts` | clamp01, swallowError | clamp + async |
| `scene/motion/bone-override.ts` | clamp01, triggerAutoSave | clamp + （D 档） |
| `scene/motion/motion-modules/registry.ts` | triggerAutoSave | （D 档） |
| `scene/motion/vmd-layers.ts` | getBaseName, clamp01 | path + clamp |
| `scene/motion/vmd-loader.ts` | getBaseName, withLoadingIndicator | path + （D 档） |
| `core/ui-advanced-rows.ts` | clampPct | clamp |
| `scene/render/renderer.ts` | clamp, clamp01, lerp, lerpArray, setKey | clamp + （setKey D 档） |
| `scene/render/lighting.ts` | setKey | （D 档） |
| `scene/render/performance.ts` | formatTimestamp | （D 档） |
| `core/ui-rows.ts` | clamp01, clampPct, swallowError | clamp + async |

---

## 决策

1. **叶契约**：新建叶须 **零依赖**（`import` 仅自身或同为叶）。`path.ts` 自含 `normPath`（含缓存），并**反转 `fileservice` 依赖**（让 `fileservice` 改从 `path.ts` 引 `normPath`），消除双份定义。
2. **state/logger 耦合符号不下沉**：`computeLibraryRef`/`resolveLibraryRef`（依赖 `libraryRoot`+`logWarn`）与 `triggerAutoSave`/`canvasToBase64`/`withLoadingIndicator`/`logWarn`/`setKey`/`formatTimestamp` 等留桶内，属 D 档或长期留桶。
3. **math 收敛到 `clamp.ts`**：`clampPct`（clamp 变体）、`lerp`/`lerpArray`（纯数学）并入 `clamp.ts` 叶，统一数学出口。
4. **re-export 保兼容**：`utils.ts` 仍 `export { ... } from './path' | './async' | './clamp'`，其余调用方零改动；仅纯 / 叶子模块主动改引具体叶。
5. **纪律写入 AGENTS.md**：「纯 / 叶子模块禁止从桶（`@/core/utils`）导入，须引具体零依赖叶」。

---

## 验证

- 每档完成后跑 `tsc --noEmit` + 受影响模块单测，确认 EXIT=0（对比 A 档前 `virtual-skirt.test.ts` EXIT=124）。
- `npm run check:funcmap` 校验函数索引（clamp/path/async 符号迁移后）。
