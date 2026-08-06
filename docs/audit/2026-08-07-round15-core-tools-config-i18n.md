# 第 15 轮审核报告 — core 工具层 / 配置 / 类型 / i18n

> **日期**: 2026-08-07
> **范围**: 25 个文件（实际 23 个存在 + 2 个不存在）
> **方法**: 知识卡 → 源码 → 5 维度（类型安全 / 资源释放 / 异常处理 / 状态流清晰 / 职责单一）+ 4 心理模拟；逐行核对源码
> **结论**: ✅通过 18 / ⚠️有条件通过 5 / ❌不通过 0（P1×0）

## 执行摘要

| 结论 | 模块数 | 模块 |
|------|--------|------|
| ✅ 通过 | 18 | async, clamp, collections, debounce, deep-clone, escape-html, format, format-timestamp, image, json-stringify, uuid, set-key, safe-call, hash-noise, t, locale, goerr, locales(×5) |
| ⚠️ 有条件通过 | 5 | config, types, mmar-globals, render-context, reactivity, wind-utils |
| ❌ 不通过 | 0 | — |

> **说明**: 审核范围中 `config-barrel.ts` 与 `core-types.ts` **不存在**于代码库，实际对应文件为 `config.ts`（barrel re-export）与 `types.ts`（类型定义），已按实际文件审核。

---

## 🔴 P1 问题（必须修复）

无。

---

## 🟠 P2 问题（建议修复）

| # | 模块 | 位置 | 问题 |
|---|------|------|------|
| 1 | wind-utils | `wind-utils.ts:13` | **违反 ADR-191 去桶化纪律**：从 barrel `./config` 导入 `envState`。`config.ts` 是 barrel re-export（聚合 types/state/dom/format/math-geometry/collections/auto-save/ui-helpers/status-bar/toast），纯叶子模块应引具体零依赖叶。`envState` 实际定义在 `state.ts`，应改为 `import { envState } from './state'`。 |
| 2 | types | `types.ts:15` | **分层违规**：`types.ts`（纯类型定义层）从 `./ui-slide-row`（UI 层）导入 `TrailingAction`，形成 types → UI 反向依赖。应把 `TrailingAction` 提升到 `ui-types.ts` 或独立类型文件。 |
| 3 | mmar-globals | `mmar-globals.ts:2` | **知识卡/注释与源码不符**：文件注释声明"无静态内部模块耦合"，但第 2 行 `import { getSceneAction } from './scene-action-bridge'` 是静态导入，构成静态内部耦合。注释应修正或移除该声明。 |
| 4 | mmar-globals | `mmar-globals.ts:190-197` | **资源释放路径缺失**：`startSceneSnapshotPolling` 启动 `setInterval`，但全代码库（含 `init.ts` 等应用入口）无生产调用点，`stopSceneSnapshotPolling` 仅在测试中使用。若未来被调用，缺少 HMR/重入时的自动 stop 机制，可能泄漏 timer。 |

---

## 🟡 P3 关注项

| # | 模块 | 位置 | 问题 |
|---|------|------|------|
| 1 | reactivity | `reactivity.ts:118-120` | `readonly()` 是 passthrough（直接 `return obj`），不做深冻结。知识卡已声明"store 层通过约定保证不可变"，但名称易误导调用方以为有运行时保护。建议在 JSDoc 中更醒目地标注"无运行时不可变保护"。 |
| 2 | collections | `collections.ts:13` | `filterKeys` 中 `Object.keys(obj) as (keyof T)[]` 是不安全类型断言——`Object.keys` 返回 `string[]`，并非所有字符串都是 `keyof T`。运行时安全（仅遍历实际键），但类型层面是 `as` 逃逸。 |
| 3 | clamp | `clamp.ts:24-26` | `lerpArray(a, b, t)` 不校验 `a.length === b.length`。若 `b` 较短，`b[i]` 为 `undefined`，`lerp(v, undefined, t)` 返回 `NaN`。纯工具函数，调用方负责，但建议加 `console.warn` 或文档说明。 |
| 4 | json-stringify | `json-stringify.ts:12` | `jsonParse<T>` 用 `JSON.parse(s) as T` 做类型断言，无运行时结构校验。对不可信输入（如用户配置）可能把非预期结构当作合法 `T`。 |
| 5 | goerr | `goerr.ts:30` | `JSON.parse(...) as GoErrEnvelope` 无运行时校验。若 Go 端 JSON 结构变更（如 `code` 缺失），`env.code` 为 `undefined`，后续 `t('goerr.undefined')` 静默回退。当前有 `if (env && env.code)` 守卫（第 31 行），可接受。 |
| 6 | deep-clone | `deep-clone.ts:10` | `JSON.parse(JSON.stringify(x)) as T` 丢失函数/undefined/Symbol/RegExp/Date。注释已说明"适合纯数据对象"，但 `as T` 断言掩盖了类型丢失。 |
| 7 | mmar-globals | `mmar-globals.ts:115` | `(engine as { getFps(): number }).getFps()` 用 `as` 断言绕过类型检查。engine 类型未声明 `getFps`，运行时若 engine 实现变更会静默失败。 |
| 8 | mmar-globals | `mmar-globals.ts:163` | `getSceneAction('focusedModel')?.() as { name?: string } | undefined`——`as` 断言假设返回值结构，无运行时校验。 |
| 9 | t | `t.ts:17` | `AVAILABLE_LANGS` 硬编码 5 种语言。`i18n-check.mjs` 已验证与 locales 文件集一致，但新增语言时需手动同步两处。 |

---

## 知识卡偏差汇总

| 知识卡 | 偏差 |
|--------|------|
| i18n-t.md | 声明"单例，无状态"，但 `t.ts` 实际持有 `_warnedMissing`（Set）与 `bundles`（Record）两处模块级可变状态。应修正为"模块级缓存状态"。 |
| config-barrel.md | 列出子模块 `state.ts / dom.ts / utils.ts / ui-helpers.ts / status-bar.ts / toast.ts`，但 `utils.ts` 已删除（ADR-191），实际 barrel 导出为 `format / math-geometry / collections / auto-save` 等。知识卡子模块清单与实际 `config.ts` 的 `export *` 不一致。 |
| mmar-globals（隐含） | 文件注释声明"无静态内部模块耦合"，但存在 `import { getSceneAction } from './scene-action-bridge'` 静态导入。注释与源码不符。 |
| reactivity.md | 知识卡准确描述了 Proxy 不代理数组/Map/Set、Object.is 同值短路、RAF 去抖、unsubscribeAll 等不变量，与源码一致。✅ |
| locale.md | 知识卡准确描述了 signal + localStorage 持久化、SUPPORTED_LANGS vs AVAILABLE_LANGS 区分、setLang 三步（持久化+html lang+scheduleRefresh），与源码一致。✅ |
| goerr.md | 知识卡准确描述了 `@@GOERR@@` 哨兵 + JSON 信封 + 回退原始文本，与源码一致。✅ |
| hash-noise.md | 知识卡准确描述了三个纯函数、seed 可复现、值域 [0,1]，与源码一致。✅ |
| render-context.md | 知识卡准确描述了零依赖叶、RenderContext 接口、push/pop 配对、pathHint 节流，与源码一致。✅ |

---

## 逐模块审核结论

### ✅ 通过模块

**async.ts** — `makeLazyLoader` 并发守卫正确（`_loading` 在 then/catch 中均置 null，失败可重试）；`LoadingGuard` Set 模式 + Boolean 模式清晰；`DebouncedTimer` / `Abortable` 均有 `dispose()` 释放资源。`fireAndForget` 经 `swallowError` 兜底，不静默吞错。✅

**clamp.ts** — 零依赖纯函数，`clamp`/`clampInt`/`clamp01`/`lerp`/`lerpArray`/`clampPct` 职责单一。无 `as any`。✅

**collections.ts** — `ensureArray`/`filterKeys`/`Cache`/`allSettledFilter` 职责清晰。`allSettledFilter` 用 `Promise.allSettled` 过滤 rejected，符合"尽力而为"语义。✅

**debounce.ts** — 标准防抖实现，`cancel()` 释放 timer，类型安全。✅

**deep-clone.ts** — JSON 序列化深拷贝，注释明确限制（不支持函数/undefined/Symbol/RegExp）。✅

**escape-html.ts** — 5 个 HTML 特殊字符转义，零依赖纯函数。✅

**format.ts** — `formatTime` 对非有限数返回 `'00:00.00'`；`formatError` 递归处理 `LibraryLoadError` 结构化对象，`try/catch` 兜底 `String(err)` 失败场景，不静默吞错。✅

**format-timestamp.ts** — 简单日期格式化，默认参数 `new Date()`。✅

**image.ts** — `canvasToBase64` 优先 `toBlob` 异步编码，失败回退 `toDataURL`；`FileReader` 的 `onload`/`onerror` 均有处理。`toBase64` 用 `TextEncoder` UTF-8 安全。`thumbDataUrl` 按魔数嗅探 PNG/JPEG/WebP，回退 PNG。✅

**json-stringify.ts** — `jsonStringify` 美化输出；`jsonParse` 失败返回 null 不抛错。✅

**uuid.ts** — UUID v4 生成，注释声明非密码学安全。✅

**set-key.ts** — 泛型键值写入，类型安全。✅

**safe-call.ts** — `safeCall`/`safeCallVoid`/`safeCallAsync` 三件套，异常时 `logWarn` 保留 tag/msg 上下文，不静默吞错。`safeCallAsync` 用 `.then(onFulfilled, onRejected)` 双参数形式，正确捕获 rejection。✅

**hash-noise.ts** — 纯函数，零依赖，`hash2`/`hash2v`/`valueNoise` 实现正确，seed 可复现，值域 [0,1]。✅

**t.ts** — 翻译函数，回退链"当前语言 → zh-CN → key 本身"正确；dev-only 缺失 key 告警去重；参数插值对 param key 做正则转义（P2 修复已落地）。`loadLocale` 失败时设空 bundle + warn，不抛错。✅

**locale.ts** — `detectSystemLang` 对 navigator 做 try/catch 防御；`loadLang` 对 localStorage 做 try/catch；`setLang` 三步（持久化+html lang+scheduleRefresh）+ 预加载语言包；`initI18n` 异步预加载。✅

**goerr.ts** — `translateGoError` 按 `@@GOERR@@` 哨兵提取 JSON 信封，解析失败回退原始文本；`toText` 处理 Error/string/含 message 对象/兜底 `String(e)`。✅

**locales（en/ja/ko/zh-CN/zh-TW）** — `i18n-check.mjs` 验证：5 个 bundle 均 1866 keys，与 zh-CN 基准完全对齐，占位符集合一致，无漏译。`generate-locale-json.mjs` 正确将 TS 导出编译为 JSON。✅

### ⚠️ 有条件通过模块

**config.ts** — barrel re-export，仅聚合不实现逻辑，符合 ADR-141。但导出的子模块清单与知识卡 `config-barrel.md` 不一致（知识卡列出已删除的 `utils.ts`）。条件：同步知识卡。✅（有条件）

**types.ts** — 类型定义完整，`EnvState` 从 schema 派生（ADR-137），`_UIStateCoversGo` 哨兵保证 Go↔TS 字段同步。条件：`TrailingAction` 从 UI 层导入的分层违规（P2 #2）应修复。✅（有条件）

**mmar-globals.ts** — `ensureMmar` 幂等初始化消除 `!` 断言依赖；`refreshSceneSnapshot` 各段独立 try/catch，单段失败不影响其他字段；`startSceneSnapshotPolling` 幂等。条件：静态导入与注释不符（P2 #3）、timer 释放路径缺失（P2 #4）。✅（有条件）

**render-context.ts** — 零依赖叶，`RenderContext` 接口最小化，`push`/`pop` 配对，`getCurrentRenderingContext` 用 `?? null` 安全。无 `as any`。✅（有条件——知识卡准确，无实质问题，列入因与 mmar-globals 共享审核批次）

**reactivity.ts** — Proxy set 拦截 + RAF 去抖 + 订阅者通知，`_changedKeys` 快照后清空，`Object.is` 同值短路，`_proxyCache` WeakMap 保证引用稳定。订阅者调用用 try/catch 包裹，单个订阅者抛错不影响其他。条件：`readonly` passthrough 命名易误导（P3 #1）。✅（有条件）

**wind-utils.ts** — `isWindActive`/`getWindVector` 守卫对称，`WIND_STRENGTH_SCALE` 常量统一。条件：从 barrel `./config` 导入违反 ADR-191（P2 #1）。✅（有条件）

---

## 心理模拟

1. **某行抛异常，清理代码是否执行？**
   - `mmar-globals.ts` `refreshSceneSnapshot`：各段独立 try/catch，单段失败不影响后续段和最终 `g.scene = snapshot`。✅
   - `reactivity.ts` `scheduleRefresh`：订阅者调用用 try/catch 包裹，单个订阅者抛错不影响其他订阅者和 `_refreshScheduled` 重置。✅
   - `async.ts` `makeLazyLoader`：loader 失败时 catch 中 `_loading = null` + `throw err`，锁正确释放。✅

2. **异步操作是否接受 AbortSignal？**
   - `t.ts` `loadLocale` 用 `fetch` 但不接受 AbortSignal。若调用方快速切换语言，旧 fetch 可能晚于新 fetch 完成并覆盖 bundle。当前有"已加载不重复 fetch"守卫缓解，但非严格取消。P3 关注。

3. **用户快速操作 3 次会怎样？**
   - `locale.ts` `setLang`：`lang === state.lang` 短路 + `SUPPORTED.includes(lang)` 校验，快速切换同一语言无副作用。快速切换不同语言时，`loadLocale` 缓存命中则不重复 fetch，未命中则并发 fetch，最后完成的覆盖——有"旧覆盖新"风险（见上）。
   - `reactivity.ts` `scheduleRefresh`：`_refreshScheduled` 标志保证同帧多次调用只触发一次 RAF。✅
   - `async.ts` `LoadingGuard`：`tryEnter` 返回 false 阻止重复进入，`leave` 释放。✅

4. **finally 块是否有 disposed 标志守卫？**
   - 审核范围内无 finally 块含异步清理的场景。`render-context.ts` 的 `popRenderingContext` 由调用方在 finally 中配对调用（知识卡约定），本模块本身无 finally。✅

---

## 验证

- [x] 已检查所有 23 个存在文件（`config-barrel.ts`/`core-types.ts` 不存在，已按 `config.ts`/`types.ts` 审核）
- [x] 已核对 8 张知识卡（i18n-t, locale, goerr, reactivity, render-context, config-barrel, hash-noise, mmar-globals）
- [x] 已运行 `i18n-check.mjs` 验证 5 个语言包 key 对齐
- [x] 已 grep 检查 `as any`/`@ts-ignore`/`@ts-expect-error`（审核范围内生产代码 0 处）
- [x] 已 grep 检查 ADR-191 神桶导入（审核范围内 0 处 `@/core/utils`，但 `wind-utils.ts` 从 barrel `./config` 导入）
- [x] 已 grep 检查非空断言 `!`（审核范围内生产代码 0 处；`mmar-globals` 已用 `ensureMmar` 消除）
