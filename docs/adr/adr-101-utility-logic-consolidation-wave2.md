# ADR-101: 通用逻辑模式收敛（第二波）

> **状态**: 实施中（P1-a 已完成：7 函数新增 + 17 单测；P1-b Step 4/5/6 已完成，Step 7 进行中）
> **关联**: ADR-096（通用 Helper 单点收敛，第一波）、ADR-095（路径归一化收敛）
> **影响面**: `frontend/src/core/utils.ts`、`frontend/src/core/dom.ts`、`frontend/src/core/status-bar.ts` 及全仓 ~130 个源文件中约 350+ 处重复模式

---

## 1. 问题

ADR-096 完成了纯函数 helper（`clamp`/`lerp`/`formatTimestamp`/`debounce`/`deepClone`/`col3FromTriple`/`hexToRgb`）的收敛。但此后对全仓 ~130 个 TS 源文件的系统扫描发现，还存在 **6 类更高层级的重复模式**，合计约 **350+ 处**重复实现，远超 ADR-096 覆盖的规模：

### 1.1 静默吞错（47+ 处）

全仓 `xxx().catch(() => {})` 模式，无任何日志或用户反馈：

```typescript
// 典型用法（散落 40+ 文件）
import('...').then(...).catch(() => {})
someAsync().catch(() => {})
```

| 文件 | 次数 |
|------|------|
| `main.ts` | 6 |
| `scene.ts` | 5 |
| `env-bridge.ts` | 5 |
| `model-loader.ts` | 4 |
| `settings-about.ts` | 8 |
| `settings-appearance.ts` | 10 |
| 及其他 ~13 个文件 | 各 1–3 |

**根因**：通用 `fireAndForget` / `swallowError` 不存在，各模块就地手写空 catch 块。

### 1.2 无标签 console.warn（180+ 处）

全仓约 **180+ 处** `console.warn('[tag] ...', err)` 模式，标签格式不一、无统一的打印开关：

```typescript
// 典型用法
console.warn('[model-loader] failed to load:', err)
console.warn('[vmd-layers] skip:', err)
```

遍布 40+ 文件，从 `library-core.ts(15处)` 到 `scene-serialize.ts(15处)`、`env-bridge.ts(10处)`、`proc-motion-bridge.ts(10处)`。

**根因**：统一日志函数不存在，每人就地手写 `console.warn` 标签串。

### 1.3 Promise 包装延迟/帧等待（16+ 处）

两种 `new Promise` 包装模式，纯样板代码：

```typescript
// 延迟  delay(ms) 模式（3 处）
new Promise((r) => setTimeout(r, 100))

// 等待帧  waitForFrame() 模式（13 处）
new Promise((r) => requestAnimationFrame(r))
```

散落于 `model-loader.ts`(3)、`model-manager.ts`(2)、`motion-pose-levels.ts`(3)、`scene-menu.ts`(5)、`outfit.ts`(1) 等。

### 1.4 动态导入样板（56+ 处）

```typescript
import('...').then(({ X }) => X(...)).catch(() => {})
```

散落15+文件，模式完全一致：`import()` → `.then()` → `.catch(() => {})`。

### 1.5 并发/生命周期守卫各自为政（11+ 处）

| 模式 | 散落文件 | 重复数 |
|------|---------|--------|
| `_loading` / `_pending` 标志 | `outfit.ts`(`Set`)、`library-core.ts`(`Set`)、`outfit-ui.ts`(×3 boolean)、`menu.ts`(`array`) | 4 |
| `setTimeout`/`clearTimeout` 管理 | `main.ts`、`menu.ts`、`status-bar.ts`、`toast.ts`、`env-bridge.ts`、`motion-cloth-levels.ts`、`env-particles.ts` | 7 |
| `addEventListener`/`removeEventListener` 配对 | 全仓 ~24 个文件超 100 对 | 100+ |
| `AbortController` + `signal` 传递 | `main.ts`(5)、`model-loader.ts`(4)、`vmd-loader.ts`(4)、`library-core.ts`(3)、`scene-serialize.ts`(3)、`model-detail.ts`(2) | 6+ |

### 1.6 分散的纯函数操作（50+ 处）

| 操作 | 出现文件 | 次数 | 说明 |
|------|---------|------|------|
| `Math.max(0, Math.min(100, x))` | `ui-rows.ts`(2)、`ui-advanced-rows.ts`(4)、`ui-virtual-grid.ts`(1)、`renderer.ts`(1)、`lighting.ts`(1)、`camera.ts`(1)、`model-manager.ts`(1) | 11 | 百分比钳制，已有 `clamp01` 但不适用 |
| `Math.sqrt(dx*dx+dy*dy)` | `main.ts`(2)、`camera.ts`(1)、`skirt-analyzer.ts`(3)、`orbit.ts`(1) | 7 | 2D/3D 距离 |
| `x * Math.PI / 180` / `x * 180 / Math.PI` | `orbit.ts`(4)、`lighting.ts`(4)、`camera.ts`(6)、`model-manager.ts`(4)、`accessory.ts`(3)、`pose-preset.ts`(10)、`proc-motion-*`(30+)、`feet-adjustment-math.ts`(3)、`camera-angle.ts`(2)、`motion-pose-levels.ts`(2) | 60+ | 角度↔弧度转换 |
| `Array.isArray(x) ? x : [x]` | `model-manager.ts`(2)、`model-preset.ts`(2)、`vmd-layers.ts`(2)、`motion-pose-levels.ts`(2)、`scene-stage-levels.ts`(2) | 10 | 数组化 |
| `Object.keys(x).filter(k => ...)` | `model-preset.ts`(3)、`scene-serialize.ts`(3)、`model-detail.ts`(2)、`vmd-layers.ts`(2)、`settings-paths.ts`(2) | 12 | 对象键过滤 |
| `new Map()` + get/set 缓存 | `model-manager.ts`(3)、`model-preset.ts`(2)、`vmd-layers.ts`(2)、`outfit.ts`(2)、`library-core.ts`(2) | 11 | 本地缓存模式 |
| `Promise.allSettled` + 结果过滤 | `model-loader.ts`(2)、`library-core.ts`(2)、`scene-serialize.ts`(2) | 6 | 异步批量结果过滤 |
| `rgb(…)` 字符串构造 | `ui-advanced-rows.ts`(4) | 4 | `Math.round(c[0]*255)` 重复 |
| `JSON.stringify(x, null, 2)` / `JSON.parse(s)` | `model-preset.ts`(4)、`scene-serialize.ts`(2)、`scene-bundle.ts`(2)、`scene-render-presets.ts`(1)、`settings-about.ts`(2) 等 | 16 | 序列化/反序列化 |

---

## 2. 决策

**将 1.1–1.6 中的重复模式收敛至现有公共模块，按"纯函数 → 封装工具 → 生命周期守卫"三级推进。**

### 2.1 收敛目标

| 分类 | 模式 | 入口 | 新增/扩展 | 优先级 |
|------|------|------|-----------|--------|
| **错误处理** | 静默吞错 | `core/utils.ts` | 新增 `swallowError(fn)` / `fireAndForget(promise)` | 🔴 P1 |
| **错误处理** | 无标签 `console.warn` | `core/utils.ts` | 新增 `logWarn(tag, msg, err?)` / `logError(tag, msg, err?)` | 🔴 P1 |
| **错误处理** | `setStatus(...false)+formatError` | `core/status-bar.ts` | 新增 `setStatusError(key, err?)` | 🟡 P3 |
| **异步工具** | `new Promise(r=>setTimeout(r, N))` | `core/utils.ts` | 新增 `delay(ms): Promise<void>` | 🔴 P1 |
| **异步工具** | `new Promise(r=>requestAnimationFrame(r))` | `core/utils.ts` | 新增 `waitForFrame(): Promise<void>` | 🔴 P1 |
| **异步工具** | `import().then().catch(())` 样板 | `core/utils.ts` | 新增 `lazyImport(path, name)` | 🔴 P1 |
| **生命周期** | `_loading`/`_pending` 标志 | `core/utils.ts` | 新增 `class LoadingGuard` | 🟠 P2 |
| **生命周期** | `_timer` 管理 | `core/utils.ts` | 新增 `class DebouncedTimer` | 🟠 P2 |
| **生命周期** | `AbortController` 配对 | `core/utils.ts` | 新增 `class Abortable` | 🟠 P2 |
| **DOM 工具** | `addEventListener`/`removeEventListener` | `core/dom.ts` | 新增 `addDisposableListener(el, event, handler): Disposable` | 🟠 P2 |
| **纯函数** | 百分比钳制 | `core/utils.ts` | 新增 `clampPct(v)` | 🟡 P3 |
| **纯函数** | 距离计算 | `core/utils.ts` | 新增 `dist2d(a, b)` / `dist3d(a, b)` | 🟡 P3 |
| **纯函数** | 角度↔弧度 | `core/utils.ts` | 新增 `degToRad(d)` / `radToDeg(r)` | 🟡 P3 |
| **纯函数** | 数组化 | `core/utils.ts` | 新增 `ensureArray<T>(x)` | 🟡 P3 |
| **纯函数** | 对象键过滤 | `core/utils.ts` | 新增 `filterKeys(obj, pred)` | 🟡 P3 |
| **纯函数** | 本地缓存 | `core/utils.ts` | 新增 `class Cache<K, V>` | 🟡 P3 |
| **纯函数** | 批量异步结果 | `core/utils.ts` | 新增 `allSettledFilter(promises)` | 🟡 P3 |
| **纯函数** | 序列化 | `core/utils.ts` | 新增 `jsonStringify(x)` / `jsonParse<T>(s)` | 🟡 P3 |
| **纯函数** | RGB 字符串 | `core/color-helpers.ts` | 新增 `rgbString(c: Color3)` | 🟡 P3 |

### 2.2 选项

| 选项 | 描述 | 结论 |
|------|------|------|
| A. 维持现状 | 各模块继续手写重复模式，不做收敛 | ❌ 否决：350+ 处重复，每轮需求变更都要改 N 处 |
| B. 仅收敛纯函数（P3 部分） | 低风险、先用 Typescript 本身消音 | ❌ 否决：P1/P2 的 300+ 处重复影响更大 |
| C. 本次全量按级推进 | 三级优先级区分风险，P1 先做无争议的部分，P2 需设计类接口，P3 纯函数可并行 | ✅ 采用 |
| D. 一次性全量替换 | 同时迁移 350+ 处，变更面过大 | ❌ 否决：不可控回归风险 |

### 2.3 模块归属原则

| 原则 | 说明 | 示例 |
|------|------|------|
| **纯函数 → `utils.ts`** | 无副作用、无外部依赖 | `clampPct`, `degToRad`, `ensureArray` |
| **非纯工具 → 按职责归属** | 有副作用的归对应模块 | `status-bar.ts` → `setStatusError`；`dom.ts` → `addDisposableListener` |
| **不新建顶层模块** | 避免 `core/` 目录膨胀；当前粒度足够 | — |
| **不反向依赖** | 公共模块不得依赖 menus/scene/outfit 等业务模块 | `color-helpers.ts` 仅依赖 `@babylonjs/core`（同 ADR-096） |

---

## 3. 约束

- **所有新增函数必须附带单测**（`frontend/src/__tests__/lib/utils.test.ts` 或相近位置）。
- **`swallowError` 不得静默吞错误**——必须 `console.warn` 记录（比空 catch 可调试）。
- **`logWarn`/`logError` 不改变现有日志行为**，仅统一标签格式为 `[tag] message`。
- **`LoadingGuard` 接口设计**须覆盖 `Set` 模式和 `boolean` 模式两种使用场景（`tryEnter(key)` 返回 boolean + `leave(key)`）。
- **`DebouncedTimer` 必须支持取消和重新调度**（`schedule(fn, ms)` + `cancel()`）。
- **`addDisposableListener` 返回 `{ dispose(): void }`**，与项目既有 `Disposable` 接口兼容。接口签名：

```typescript
// core/dom.ts 已有或本次补齐
export interface Disposable {
  dispose(): void
}
```

- 对于**高频调用**的数学工具（`degToRad`、`clampPct`），保留函数调用方式以维持可调试性，不做过度内联优化。
- 任何批次不得改变既有对外行为：`tsc --noEmit` 必须通过，`vitest run` 必须全绿。
- **全仓零新增 `as any` / `@ts-ignore`**（排除测试文件），P1 迁移中若引入类型压制视为失败。

### 3.1 接口设计预览

```typescript
// --- 错误处理 ---
export function swallowError<T>(promise: Promise<T>): void {
  promise.catch((err) => logWarn('swallow', '', err))
}
export function fireAndForget(fn: () => Promise<void>): void {
  swallowError(fn())
}
export function logWarn(tag: string, message: string, err?: unknown): void {
  console.warn(`[${tag}] ${message}`, err ?? '')
}
export function logError(tag: string, message: string, err?: unknown): void {
  console.error(`[${tag}] ${message}`, err ?? '')
}

// --- 异步工具 ---
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
export function waitForFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(r))
}
export async function lazyImport<T>(path: string, name: string): Promise<T> {
  const mod = await import(path)
  return mod[name] as T
}

// --- 生命周期 ---
export class LoadingGuard {
  private _loading = new Set<string>()
  tryEnter(key: string): boolean { /* ... */ }
  leave(key: string): void { /* ... */ }
}
export class DebouncedTimer {
  private _timer: ReturnType<typeof setTimeout> | null = null
  schedule(fn: () => void, ms: number): void { /* ... */ }
  cancel(): void { /* ... */ }
}
export class Abortable {
  readonly controller = new AbortController()
  get signal(): AbortSignal { return this.controller.signal }
  abort(): void { this.controller.abort(); /* 自动重置 */ }
}

// --- DOM 工具 ---
export function addDisposableListener(
  el: EventTarget,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions
): { dispose(): void }

// --- 纯函数 ---
export function clampPct(v: number): number // Math.max(0, Math.min(100, v))
export function dist2d(a: { x: number; y: number }, b: { x: number; y: number }): number
export function dist3d(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number
export function degToRad(deg: number): number
export function radToDeg(rad: number): number
export function ensureArray<T>(x: T | T[]): T[]
export function filterKeys<T extends object>(obj: T, pred: (key: keyof T) => boolean): Partial<T>
export class Cache<K, V> { /* get/set/has/delete/clear */ }
export function allSettledFilter<T>(promises: Promise<T>[]): Promise<PromiseFulfilledResult<T>[]>
export function jsonStringify(x: unknown): string  // JSON.stringify(x, null, 2)
export function jsonParse<T>(s: string): T | null  // JSON.parse(s) with try/catch
```

---

## 4. 执行计划

### 子里程碑划分

Phase 1 内部按职责拆为两个子里程碑，独立验证：

| 子里程碑 | 包含步骤 | 变更规模 | 验证门 |
|----------|---------|----------|--------|
| **P1-a: 异步工具（纯新增）** | §4.1 步骤 1–3 | 2 文件新增，~120 行 | `npx vitest run` 新增 6 函数单测 |
| **P1-b: 错误处理迁移** | §4.1 步骤 4–7 | ~50 文件，~300 行变更 | `npx vitest run` 全绿 + 验收清单零残留 |

各步骤验证门：
- **每完成一个步骤**（含新增 + 迁移）→ 执行 `npm run check`（`tsc --noEmit`）+ `npx vitest run`
- **Phase 末尾** → 全量验收清单核对

### 4.1 第一阶段 P1-a：异步工具新增

| 步骤 | 动作 | 变更估算 | 风险 |
|------|------|---------|------|
| 1 | 在 `utils.ts` 新增 `swallowError` / `fireAndForget` / `logWarn` / `logError` | 1 文件，~30 行 | 低：纯新增，无调用方 |
| 2 | 在 `utils.ts` 新增 `delay` / `waitForFrame` / `lazyImport` | 1 文件，~20 行 | 低：纯新增 |
| 3 | 写单测（6 函数） | 1 文件，~80 行 | — |
| ✅ **里程碑 P1-a 完成** | `npx vitest run` 全绿 | — | 进入 P1-b |

### 4.2 第一阶段 P1-b：错误处理迁移

| 步骤 | 动作 | 变更估算 | 风险 |
|------|------|---------|------|
| **4a** | **前置扫描**：`grep -rn '\.catch(\s*\(\s*\)\s*=>\s*{}\s*)'` 全仓 → 输出 JSON 清单，人工标注"√ 静默 / ⚠ 需保留 / ⚠ 改用 try-catch"三列 | 清单文件 ~50 行 | 区分真静默 vs 意图性吞错 |
| **4b** | 按标注结果迁移 √ 条目 → `swallowError`；非静默条目原地加注释 | ~15 文件，~47 行 | 中 |
| **5a** | **前置扫描**：`grep -rn 'console\.warn'` 全仓 → 输出 JSON 清单，含文件:行号 + 上下文 | 清单文件 ~180 行 | 确保零遗漏 |
| **5b** | 逐文件替换 `console.warn('[tag]' → `logWarn(tag, ...)`；每替换 5 文件执行一次 `npx vitest run`（小批量止损） | ~40 文件，~180 行 | 中：最大批次 |
| 6 | 迁移 `new Promise(r=>setTimeout/rAF)` → `delay/waitForFrame`（16+ 处） | ~7 文件，~16 行 | 低：机械替换 |
| **7a** | **前置扫描**：`grep -rn 'import('` → 提取动态导入模式，输出清单 | 清单文件 ~56 行 | 识别非静默路径 |
| **7b** | 迁移 √ 条目 → `lazyImport` + `swallowError`；替换前后各跑一遍 `vitest run`，对比失败用例数 | ~15 文件，~56 行 | 中：错误处理路径变化 |
| ✅ **里程碑 P1-b 完成** | `npx vitest run` 全绿 + 验收清单零残留 | — | 进入 Phase 2 |

### 4.3 第二阶段 P2：生命周期守卫

| 步骤 | 动作 | 变更估算 | 风险 |
|------|------|---------|------|
| 1 | 新增 `LoadingGuard` / `DebouncedTimer` / `Abortable` 类 + 单测 | 2 文件，~100 行 | 低：纯新增 |
| 2 | 迁移 `_loading` 标志 → `LoadingGuard`（4 处） | 4 文件，~20 行 | 中：Set→tryEnter/leave 适配 |
| 3 | 迁移 `_timer` 管理 → `DebouncedTimer`（7 处） | 7 文件，~30 行 | 低：机械替换 |
| 4 | 迁移 `AbortController` 使用 → `Abortable`（6 处） | 6 文件，~24 行 | 中：reset 语义处理 |
| 5 | 新增 `addDisposableListener`（`dom.ts`）+ 单测 | 2 文件，~40 行 | 低：纯新增 |
| 6 | **按组**迁移 `addEventListener/removeEventListener`（~24 文件，100+ 对） | — | 高：见分组说明 |

**Step 6 分组策略**（每组完成后独立验证后合并 commit）：

| 组 | 文件 | 对数估 | 顺序 |
|----|------|--------|------|
| A. UI 组件 | `dialog.ts`(6)、`ui-advanced-rows.ts`(4)、`ui-collapsible.ts`(2)、`ui-slide-row.ts`(4)、`ui-resource-panel.ts`(8)、`ui-rows.ts`(4)、`ui-virtual-grid.ts`(1)、`ui-fullscreen-overlay.ts`(3) | ~32 对 | 1（无业务依赖） |
| B. 菜单/设置 | `main.ts`(15+)、`menu.ts`(10+)、`settings-shortcuts.ts`(2)、`library-core.ts`(5)、`model-detail.ts`(5)、`model-material.ts`(3) | ~40 对 | 2 |
| C. 场景/道具 | `camera.ts`(3)、`audio.ts`(3)、`scene-serialize.ts`(2)、`scene-prop-levels.ts`(5)、`outfit-ui.ts`(1)、`plaza.ts`(1) | ~15 对 | 3 |
| D. 动画/其他 | `motion-*`(8)、`scene-stage-*`(5)、`shortcut-registry.ts`(1)、`settings-*`(3) | ~17 对 | 4 |

每组完成后：`npm run check` + `vitest run` 通过 → commit。

### 4.4 第三阶段 P3：纯函数

| 步骤 | 动作 | 变更估算 | 风险 |
|------|------|---------|------|
| 1 | 新增全部 P3 纯函数（`clampPct`/`dist2d`/`dist3d`/`degToRad`/`radToDeg`/`ensureArray`/`filterKeys`/`Cache`/`allSettledFilter`/`jsonStringify`/`jsonParse`/`rgbString`）～12 个 | 2 文件，~150 行 | 低 |
| 2 | 写单测 | 1 文件，~120 行 | — |
| 3 | 迁移 50+ 处数学/数据操作 | ~15 文件，~50 行 | 低 |

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `swallowError` 过度使用导致真正的错误被沉默 | 难以调试的隐式错误 | `swallowError` 内部自动调用 `logWarn`；保留按需的 `fireAndForget` 原语 |
| `lazyImport` 的 `.catch` 被隐含后丢失错误上下文 | 错误无声消失 | `lazyImport` 不内含 `.catch`——调用方显式配合 `swallowError` 或 `try/catch`；替换前后各跑一次 `vitest run` 对比失败数 |
| 180+ 处 `console.warn` 替换遗漏 | 新旧日志格式混用 | 替换前生成全量 JSON 清单 → 替换后 `grep console\.warn` 零残留（排除测试文件） |
| `.catch(() => {})` 中部分非静默条目被误替换 | 功能性错误被沉默 | 替换前增加人工标注三列（√ 静默 / ⚠ 保留 / ⚠ 改用 try-catch），仅替换 √ 条目 |
| `addDisposableListener` 迁移时 dispose 时机不一致 | 内存泄漏或事件丢失 | 按文件类型分组推进（A/B/C/D 四组），每组独立验证 + commit；每对手动确认 dispose 路径 |
| `clampPct`/`degToRad` 等高频函数调用开销 | 微性能退化 | 保持函数调用——可调试性优先于微优化；后续可视热点 profile 决定是否 inline |
| P1-b 步骤 5 是最大批次（~40 文件，180 行），疲劳作业易降质量 | 替换质量下降，遗漏/错误替换 | 每替换 5 文件执行一次 `npx vitest run` 止损；限制单次连续替换不超过 10 文件 |
| 类型安全退化：P1 迁移中引入 `as any` 或 `@ts-ignore` 绕过类型错误 | 类型安全约束失效 | 验收标准已加入 `as any` / `@ts-ignore` 零新增检查；`tsc --noEmit` 必须通过 |

---

## 6. 与 ADR-096 的关系

| 维度 | ADR-096（已完成） | ADR-101（规划中） |
|------|-------------------|-------------------|
| **覆盖范围** | 纯函数 helper（`clamp`/`lerp`/`col3FromTriple`/`hexToRgb` 等） | 高层级重复模式（收错/异步/生命周期/常用操作） |
| **抽象层级** | 纯函数，单行调用 | 函数 + 类（`LoadingGuard`/`DebouncedTimer`/`Abortable`） |
| **影响面** | 约 30 处替换 | 约 350+ 处替换 |
| **风险等级** | 低（纯函数替换） | 中（涉及生命周期和并发守卫） |
| **迁移策略** | 一次性替换 | 三级分期，每级独立验证 |
| **不重叠项** | — | ADR-096 已覆盖的 `clamp`/`lerp`/`debounce`/`deepClone` 等**不在本次重复** |

---

## 7. 验收标准

- [ ] `npx tsc --noEmit`：0 错误
- [ ] `npx vitest run`：全部通过（含新增工具函数单测）
- [ ] `npm run build`：构建通过
- [ ] `git diff --stat` 每步变化距离在预期范围内（P1-b 各步骤 ≤50 文件/≤200 行）
- [ ] `grep -r 'as any' frontend/src/ --include='*.ts'`：零新增（排除 `__tests__/`）
- [ ] `grep -r '@ts-ignore\|@ts-expect-error' frontend/src/ --include='*.ts'`：零新增（排除 `__tests__/`）
- [ ] 全仓 `\.catch\(\(\) => \{\}\)` / `\.catch\(\(\) => {}` 零匹配
- [ ] 全仓 `console\.warn\(` 仅允许在 `logWarn` 实现中出现或测试文件中
- [ ] 全仓 `new Promise\(.*setTimeout` / `new Promise\(.*requestAnimationFrame` 零匹配（测试文件除外）