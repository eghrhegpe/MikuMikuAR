# 第 15 轮审核报告 — scene 共享 / pose / 序列化 / env 共享层

> **日期**: 2026-08-07
> **范围**: 10 模块（scene 共享 2 + pose 3 + 序列化/迁移 2 + env 共享 3）
> **方法**: 知识卡 → 源码 → 5 维度 + 4 心理模拟；逐行核对源码
> **结论**: ✅通过 8 / ⚠️有条件通过 2 / ❌不通过 0（P1×0）

## 执行摘要

| 结论 | 模块数 | 模块 |
|------|--------|------|
| ✅ 通过 | 8 | menu-node-types, texture-lru, camera-angle, composition-guide, scene-migrate, env-context, env-texture, env-type-helpers |
| ⚠️ 有条件通过 | 2 | watermark, scene-bundle |
| ❌ 不通过 | 0 | — |

## 🔴 P1 问题（必须修复）

无。

## 🟠 P2 问题（建议修复）

| # | 模块 | 位置 | 问题 |
|---|------|------|------|
| 1 | watermark | watermark.ts:45 | `applyWatermark` 不接受 `AbortSignal`。用户快速操作 3 次（如连续截图）会创建 3 个 `Image` 对象并发加载，无取消机制。建议签名改为 `applyWatermark(base64, format, quality, signal?)`，在 `img.onload`/`img.onerror` 中检查 `signal?.aborted` 并提前 resolve/reject。 |
| 2 | watermark | watermark.ts:52-57 | `Image` 元素创建后无显式清理。`img.onload`/`img.onerror` 回调完成后 `img` 依赖 GC 回收，但 `img.src` 仍持有 data URL 引用。建议回调末尾置 `img.src = ''` 释放引用。 |

## 🟡 P3 关注项

| # | 模块 | 位置 | 问题 |
|---|------|------|------|
| 1 | texture-lru | texture-lru.ts:81 | `data.buffer as ArrayBuffer` 类型断言冗余——`readFileBytes` 返回 `Uint8Array \| null`，`Uint8Array.buffer` 已是 `ArrayBuffer`，TypeScript 可推导。可去掉 `as ArrayBuffer`。 |
| 2 | texture-lru | texture-lru.ts:36 | `_textureLRU.keys().next().value!` 非空断言——虽由 `size === 0` 守卫保护，但 `keys().next().value` 在空 Map 上返回 `undefined`。建议改为 `_textureLRU.keys().next().value` 配合可选链，或保持现状（守卫已足够）。 |
| 3 | scene-bundle | scene-bundle.ts:137 | `feedbackInfo('scene.bundle.collecting')` 在 try 块之前调用。若用户在文件选择对话框取消（line 146-149），`setStatus('', false)` 清空状态栏，但 `feedbackInfo` 已发出"正在收集"提示，用户可能看到短暂残留。建议将 `feedbackInfo` 移入 try 块，或在取消分支也调用 `feedbackStatus` 清除。 |
| 4 | scene-bundle | scene-bundle.ts:191 | `JSON.parse(sceneJson)` 无独立 try/catch。若 bundle 内 scene.json 格式损坏，异常被外层 catch 捕获但错误信息不具体。建议在 `JSON.parse` 外加一层 try/catch，给出 "scene.json 格式无效" 的明确提示。 |
| 5 | env-texture | env-texture.ts:71,81,184 | 三处 `catch {}` 空捕获块。虽为有意的回退/降级策略（注释已说明），但在非受约束环境（正常浏览器）中若 `draw` 回调自身抛异常，也会被静默吞掉。建议在 catch 中加 `console.warn` 日志，便于调试。 |
| 6 | env-texture | env-texture.ts:117 | `_retiredTextures` Set 持有被淘汰贴图的引用，仅在 `disposeTextureCache` 时统一释放。若 `disposeEnv` 未被调用（如热重载/页面刷新），这些贴图会持续占用 GPU 内存。建议在 `_texCache` 淘汰时增加上限检查，或记录日志。 |
| 7 | env-context | env-context.ts:74-95 | `_envSys` 为公开可变对象，任何模块可直接修改其字段（如 `_envSys.sky.skyMesh = ...`），无封装保护。虽为 env 子系统内部约定，但缺乏 setter/getter 或 Proxy 守卫，误操作风险存在。 |
| 8 | scene-migrate | scene-migrate.ts:64 | `perception as PerceptionState` 类型断言无运行时校验。若旧存档 perception 字段结构异常，断言通过但下游可能拿到不完整对象。建议加 `if (!('focused' in perception) && typeof perception === 'object')` 的防御性检查（已有 line 55 的 `'focused' in perception` 分支，但 line 64 的 else 路径直接断言）。 |
| 9 | env-type-helpers | env-type-helpers.ts:9 | `as unknown as CanvasRenderingContext2D \| null` 类型逃逸——虽为 Babylon.js 私有 API 访问的有意封装，但 Babylon 升级时 `getContext()` 返回类型若变化，此处会静默断裂。建议在 helper 顶部加注释标注适用的 Babylon 版本范围。 |

## 知识卡偏差汇总

| 知识卡 | 偏差 |
|--------|------|
| texture-lru.md | 知识卡声明 `readFileBytes` 返回 `ArrayBuffer`，实际返回 `Uint8Array \| null`（wails-bindings.ts:44）。源码 `data.buffer as ArrayBuffer` 正是为此适配。知识卡应更新为 `Uint8Array \| null`。 |
| watermark.md | 知识卡声明 `applyWatermark` 操作 `RenderTargetTexture`，实际源码操作的是 base64 字符串 + canvas 2D 上下文，不涉及 Babylon.js 纹理。知识卡描述与实现不符。 |
| env-type-helpers.md | 知识卡声明 `getCanvasCtx` 封装 `DynamicTexture.getContext() → CanvasRenderingContext2D` 的类型断言，与源码一致。无偏差。 |
| scene-bundle.md | 知识卡声明 `collectSceneAssets` 收集"模型/VMD/相机VMD/道具引用资源的绝对路径并去重"，源码实现一致。无偏差。 |
| scene-migrate.md | 知识卡声明"纯函数，无 scene 依赖"，源码一致。无偏差。 |
| camera-angle.md | 知识卡声明 `FRONT_BASE_RAD = -π/2`，源码一致。无偏差。 |
| composition-guide.md | 知识卡声明"构图覆盖层经 disposeGuides 释放"，源码中 `_dispose` 函数负责清理，但无名为 `disposeGuides` 的导出函数。知识卡函数名与源码不一致。 |
| env-context.md | 知识卡声明 `_envSys` 为"环境系统内部聚合对象"，源码一致。无偏差。 |
| env-texture.md | 知识卡声明"优先使用 DynamicTexture，失败回退 canvas → toDataURL → Texture"，源码一致。无偏差。 |

## 心理模拟推演

### 1. 某行抛异常，清理代码是否会执行？

- **texture-lru.ts**: `readFileBytes` 抛异常 → IIFE 内未 catch → Promise reject → `finally` 块执行 `_inFlight.delete(key)` ✅
- **watermark.ts**: `drawImage` 抛异常 → 无 catch → Promise 永久 pending（`img.onload` 不会触发）❌ → 但 `img.onerror` 会触发（drawImage 异常不会导致 onerror），实际 `ctx.drawImage` 异常会冒泡到 Promise 构造函数外部，导致 Promise 永久 pending。**这是 P2 问题 #1 的补充**：建议在 `img.onload` 内加 try/catch 包裹绘图逻辑。
- **scene-bundle.ts**: `BundleScene` 抛异常 → 外层 catch 捕获 → `console.error` + `feedbackStatus` ✅。`deserializeScene` 抛异常 → 外层 catch 捕获，但 `finally` 块仍执行 `setLibraryRoot(origRoot)` ✅
- **env-texture.ts**: `draw` 回调抛异常 → DynamicTexture 路径被外层 catch 捕获 → 回退到 canvas 路径 → canvas 路径的 `draw` 再次抛异常 → 内层 catch 捕获 → 返回空纹理 ✅

### 2. 异步操作是否接受 AbortSignal？

- **texture-lru.ts**: `readTextureWithLRU` 接受 `signal?` ✅，在 abort 后不入缓存 ✅
- **watermark.ts**: `applyWatermark` **不接受** `AbortSignal` ❌ → P2 问题 #1
- **scene-bundle.ts**: `exportSceneBundle` / `importSceneBundle` 不接受 `AbortSignal`，但文件选择对话框本身有取消机制（返回空值）

### 3. 用户快速操作 3 次会怎样？

- **texture-lru.ts**: 并发同 key → `_inFlight` 去重，只发起一次 `readFileBytes` ✅
- **watermark.ts**: 连续 3 次 `applyWatermark` → 创建 3 个 `Image` 并发加载 → 3 个 canvas 同时绘制 → 3 个 `toBlob` 并发 → 低端机可能 OOM。无取消机制，无法中止已发起的操作 ❌
- **composition-guide.ts**: 快速切换 3 次模式 → 每次 `_refresh` 先 `_dispose` 再重建 → 旧 DOM 被移除，新 DOM 创建 → 无残留 ✅
- **scene-bundle.ts**: 快速点击 3 次导出 → 第 1 次进入文件选择对话框 → 第 2/3 次也进入对话框（无防抖）→ 用户需逐个取消。无 `_loading` 标志 ❌（P3 关注项）

### 4. finally 块是否有 disposed 标志守卫？

- **texture-lru.ts**: `finally` 块执行 `_inFlight.delete(key)`，无 disposed 守卫。但 `_inFlight` 是模块级 Map，`clearTextureLRU` 会 `_inFlight.clear()`，finally 中的 delete 操作在 clear 后执行是安全的（delete 不存在的 key 无副作用）✅
- **scene-bundle.ts**: `finally` 块执行 `setLibraryRoot(origRoot)`，无 disposed 守卫。若 `deserializeScene` 抛异常，finally 仍执行 ✅
- **watermark.ts**: 无 finally 块。`setTimeout` 超时后 `img.onload = null` 清除回调，但 `img` 元素本身未清理 ⚠️

## 验证

- [x] 已检查所有 10 个文件
- [x] 已核对 9 张知识卡（menu-node-types 无独立知识卡，使用 menu-schema.md）
- [x] 已检查 ADR-191 合规（无 `@/core/utils` 导入）
- [x] 已检查 `as any` / `@ts-ignore` / `@ts-expect-error`（0 处）
- [x] 已检查非空断言 `!`（1 处，有守卫保护）
- [x] 已检查 `catch{}` 静默吞错（env-texture 3 处为有意回退，已标注 P3）
- [x] 已检查 Promise 链错误处理（watermark 有 P2 问题）
