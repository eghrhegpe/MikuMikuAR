# ADR-277: 严格模式渐进收敛：Stage 3 打开 strict —— 68 处收口、四个根因与协变修复 — 把 strictNullChecks 之外的严格家族一次收完，让 strict: true 成为唯一开关

> **状态**: ✅ 已采纳（2026-10-24）
> **日期**: 2026-10-24

## 背景

ADR-274（Stage 1）打开了 `noImplicitAny`，ADR-276（Stage 2）打开了 `strictNullChecks`，但 `tsconfig.json` 里仍是 `"strict": false` + 三个手工开关（`alwaysStrict` / `strictBindCallApply` / `useUnknownInCatchVariables`）。还差三个 strict 家族成员没开：

| 未开的成员 | 语义 |
|---|---|
| `strictFunctionTypes` | 函数参数按逆变检查（方法的参数仍是双变） |
| `noImplicitThis` | `this` 不能隐式 `any` |
| `strictPropertyInitialization` | 类字段必须在构造函数里初始化 |

「三个手工开关」的制度成本比错误本身更大：新成员要不要开、开了谁来清，每次都要重新论证一遍。所以目标不是再清一遍错误，而是**让 `strict: true` 成为唯一开关**——以后谈严格模式只有一句话。

### 先修量尺：影子检查器的假阴性

`frontend/node_modules/.tmp/strict-check.mjs`（影子检查器：不改 tsconfig，直接在内存里叠加编译选项）原本写死三键，其中 `strictNullChecks` 默认 `false`。但编译器选项的优先级是「显式值覆盖 `strict` 的隐含值」，于是 `--strict` 跑出来的是「strict + strictNullChecks:false」的混合态，首测得到假数字 66 处（SUMMARY 里 `strictNullChecks=false` 就是证据）。

修法：脚本只叠加**显式请求**的开关（`noImplicitAny` 缺省 true，`strictNullChecks` 与 `strict` 仅在传参时置 true）。

### 真实代价

修正后首测：`SUMMARY errors=68 files=27 prod=67/26 test=1/1`（`TS2339`×32 `TS2322`×19 `TS2345`×17），落盘 `frontend/node_modules/.tmp/strict3.txt`。

**ADR-274 里记的「Stage 3 全 strict 实测 454 处（生产 230 / 67 文件）」作废**：那是在 `strictNullChecks` 尚未开启时测的，把 null 家族的账一起算了进去。Stage 1 + Stage 2 清完之后，真正剩下的只有 68 处，且**只有 4 个根因 + 1 处零星**——不是 68 个判断题，是 5 个结构性问题。

## 决策

### 1. 四个根因优先，个案最后

68 处里 67 处塌进四个根因。逐个文件改名换姓地标注一遍能变绿，但会把「结构性缺陷」写成「局部噪声」。本轮一律先修结构，再扫尾。

#### 根因 1（22 处）：`ObserverHandle<T>` 把泛型当实例状态，遇到不变型就崩

`frontend/src/core/observer-handle.ts` 原持有 `private _observable: Observable<T> | null` 与 `private _observer: Observer<T> | null`。Babylon 的 `Observable<T>` 内含 `observers: Observer<T>[]`，而 `Observer<Scene>.callback` 与 `Observer<unknown>` 在 `strictFunctionTypes` 下参数逆变 → `ObserverHandle<Scene>` 不能赋给 `ObserverHandle<unknown>`，而 `ObserverRegistry._handles: ObserverHandle[] = []` 的 push 处有 20 处这么用。

**改法：把泛型从「实例状态」降级为「构造期约束」。** 类只留一个不依赖 `T` 的句柄：

```ts
private _release: (() => void) | null;
constructor(observable, observer) {
    this._release = observable && observer ? () => observable.remove(observer) : null;
}
```

`dispose()` 先 `const release = this._release` 再置 `null` 再调用（重入安全）；`isDisposed` 返回 `this._release === null`，与原 `_observer === null` 等价。类型上 `ObserverHandle<Scene>` 与 `ObserverHandle<unknown>` 从此同构，协变/逆变问题消失。**22 处一次归零，且没有一处 `as`。**

#### 根因 3（13 处）：`addDisposableListener` 的 handler 被 `EventListener` 擦掉了事件类型

`frontend/src/core/dom.ts` 原签名 `handler: EventListenerOrEventListenerObject`，即 `(evt: Event) => void`。`strictFunctionTypes` 下参数逆变，传 `(e: KeyboardEvent) => void` 不合法——13 个调用点（关掉 3 处 `menu.ts` 的 `TouchEvent` 处理器）全部报 `TS2345`。

**改法：泛型化 + 边界一次断言，调用点零改动。** 事件名本身就是类型信息的载体，让它参与推导：

```ts
type KnownEventMap = HTMLElementEventMap & DocumentEventMap & WindowEventMap;
type EventOf<K extends string> = K extends keyof KnownEventMap ? KnownEventMap[K] : Event;
export function addDisposableListener<K extends string>(
    el: EventTarget, event: K, handler: (ev: EventOf<K>) => void, options?: AddEventListenerOptions
): Disposable {
    const listener = handler as unknown as EventListener; // 边界唯一断言
    ...
}
```

这比「让 13 个调用点各自把参数标成 `Event` 再在体内强制转换」强得多：调用方保留精确类型，断言只在库边界出现一次。

#### 根因 2（32 处）+ 根因 4：一句 `as unknown as BackendService` 同时废掉了 `this` 和多余属性检查

`frontend/src/core/backend/browser-adapter.ts:1379` 原写法：

```ts
export const browserAdapter: BackendService = { ... } as unknown as BackendService;
```

双重断言的初衷是「`BackendService` 声明的是 `Promise`，而实现返回 Wails 的 `$CancellablePromise`」。代价是**整段对象字面量失去上下文类型**：

- `noImplicitThis` 下成员内的 `this` 退化成 `{}` → 32 处 `this.X()` 报 `TS2339 Property 'X' does not exist on type '{}'`；
- 多余属性检查（EPC）失效 → 契约外的方法（`GetUIState` / `SetConfig`）与**契约内缺失的方法**都无人报警。

**改法分三步，先把类型对准，再删断言：**

1. **传输层差异在类型层消除**（`frontend/src/core/backend/types.ts`）。`$CancellablePromise` 的 `.cancel()` / `.cancelOn()` 全仓 0 调用，纯 Wails 传输细节，不该漏进契约：

```ts
type PlainReturn<F> = F extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<R>
    : F;
export type BackendService = {
    [K in Exclude<keyof GoApp, ExcludedFromBackend | 'GetConfig'>]: PlainReturn<GoApp[K]>;
} & {
    readonly kind: 'go' | 'browser';
    capabilities(): BackendCapabilities;
    GetConfig(): Promise<Config>;   // 见根因 4
    readFileBytes(path: string): Promise<Uint8Array | null>;
};
```

2. **网页端私有扩展另立接口**：`interface BrowserAdapterExtras { GetUIState(): Promise<UIState>; SetConfig(cfg: Partial<Config>): Promise<void> }`，声明改为 `export const browserAdapter: BrowserAdapterSelf & ThisType<BrowserAdapterSelf> = {`，并把末尾的 `as unknown as BackendService` **整句删除**。至此 `this` 拿到完整类型、EPC 恢复工作。

3. **删断言后暴露的问题按契约修，不许再断言回去**：

| 方法 | 原实现 | 契约 | 处置 |
|---|---|---|---|
| `GetSystemA11ySettings` | `Record<string, unknown>`，空值 `{}` | `SystemA11ySettings`（两个必填布尔） | 缺省给 `{isDarkMode:false,isHighContrast:false}` |
| `GetBuildInfo` | 自造 `{version,commit,date}` | `BuildInfo{version,buildTime,commitHash,goVersion}` | 字段名对齐，保留 `'web'` 占位 |
| `CleanOrphanCache` | `Promise<void>` | `Promise<number>` | 计数并返回清理条数 |
| `GetModelPresets` | `Promise<string[]>`（裸名） | `Promise<ModelPresetEntry[]>` | 包成条目（`preset-meta.ts` 读 `m.name`/`m.updatedAt`，**原先网页端列表条目全是 undefined，真 bug**） |
| `ListEnvPresets` | `Promise<string[]>`（裸名） | `Promise<EnvPresetEntry[]>` | 同上（`e.name/e.label/e.createdAt`） |
| `ReadTextFile` | `Promise<string \| null>` | `Promise<string>` | 读不到返回 `''` |
| `GetModelMetaBatch` | 参数 `string[]` | 参数 `string[] \| null` | 放宽为可空（Go 侧切片 nil 合法） |
| **8 个 AI 方法** | **根本没有实现** | `AiCancelStream/AiFetchModels/AiGetBackendLogs/AiGetBackendState/AiGetLLMConfig/AiSetLLMConfig/AiStreamChat/AiTestLLMConnection` | `Promise<never>` 桩 + `NotSupportedError`（ADR-176 惯例） |

那 8 个 AI 方法是本轮最有价值的副产品：**旧的双重断言把「缺方法」和「签名不符」一起掩盖了**，网页端一旦走到 AI 功能就是 `xxx is not a function`。网页端 AI 走 `frontend/src/core/ai` 自有路径，后端侧能力明确不支持，现在改成显式降级。

#### 根因 4（含在上表）：契约宽于实现 —— `BackendService.GetConfig`

证据链：`internal/app/config.go:67` `func (a *App) GetConfig() (*Config, error)` 在 `err == nil` 时恒非 nil（出错才 `return nil`），但指针让生成的绑定变成 `GetConfig(): $CancellablePromise<Config | null>`；而 `browser-adapter.ts:1454` 的实现本就 `Promise<Config>`。于是十几处使用点（含 ADR-276 批 A 记过的 `GetConfig` 15 处）在跟一个**不存在的 null** 缠斗。

**改法：把 null 收在一个边界上。** `types.ts` 新增：

```ts
export function assertConfig(cfg: Config | null | undefined): Config {
    if (!cfg) throw new Error('backend: GetConfig 返回 null（后端未就绪？）');
    return cfg;
}
```

契约改成 `GetConfig(): Promise<Config>`；`go-adapter.ts` 在 `...goApp` 之后覆盖 `GetConfig: async () => assertConfig(await goApp.GetConfig())`；`wails-bindings.ts` 的 `requireConfig()`（ADR-276 批 B 引入）改为转发 `assertConfig`，判定与报错只留一份。

#### 零星 1 处

`frontend/src/core/dispose-helpers.ts:68`：`disposing.values().next().value?.getScene()` 实际类型是 `Scene | undefined`，补 `?? null`。

### 2. 开关与清零同批落地

`frontend/tsconfig.json` 的六个键收成一个：

```diff
-    "strict": false,
-    "noImplicitAny": true,
-    "strictNullChecks": true,
-    "alwaysStrict": true,
-    "strictBindCallApply": true,
-    "useUnknownInCatchVariables": true,
+    "strict": true,
```

`noUnusedLocals` / `noUnusedParameters` / `noImplicitReturns` 保持 `false`——它们不属于 `strict` 家族，是另一笔账（存量噪声大，且与「严格类型」不是同一件事），留给后续单独提案。

### 3. 验收口径

每批五件：影子检查器计数 → 真 `tsc --noEmit` `EXIT=0` → `prettier --check` → `eslint` 无新 error → 该文件测试绿。全量 `vitest` 与 `check:docs` 放在落地前一次性跑。

## 备选方案

| 方案 | 否决理由 |
|---|---|
| A. 逐处给 `this` 加类型标注（`this: BackendService` 参数） | 32 处各标一次，断言还在，EPC 仍失效。治了症状没治因 |
| B. 保留 `as unknown as BackendService`，只把 `strictFunctionTypes` 打开 | 那就不是「`strict: true` 唯一开关」，而是「`strict: true` 但网页端适配器免检」——最坏的一种：制度上宣布严格，实际上留了一块无人检查的飞地 |
| C. 按目录分片开开关（网页端先不开） | `strict` 是 project 级编译选项，不能按目录分片。能分片的只有「清零」，不能分片的是「开关」 |
| D. 不推进，停在 Stage 2 | 剩下三个成员（含 `strictFunctionTypes`）恰是最容易藏真 bug 的几个；且 ADR-274/276 建立的「阶梯」叙事会断在半路 |
| E. 顺带打开 `noUnusedLocals` 等 | 与 `strict` 不是同一件事，混进来会让本 ADR 的验收数字失去意义 |

## 影响

| 项 | 变化 |
|---|---|
| `frontend/tsconfig.json` | 六个键 → `"strict": true` 单开关（2026-10-24 已落地） |
| `frontend/src/core/observer-handle.ts` | 泛型降级为构造期约束，只留 `_release` 句柄 |
| `frontend/src/core/dom.ts` | `addDisposableListener` 泛型化（`KnownEventMap` / `EventOf`），边界一次断言 |
| `frontend/src/core/backend/types.ts` | 新增 `PlainReturn`、`assertConfig`；`BackendService` 改为映射类型且 `GetConfig` 非空 |
| `frontend/src/core/backend/go-adapter.ts` | 覆盖 `GetConfig` 走 `assertConfig` |
| `frontend/src/core/backend/browser-adapter.ts` | 删双重断言、`BrowserAdapterExtras` + `ThisType`、6 处契约对齐、8 个 AI 桩 |
| `frontend/src/core/wails-bindings.ts` | `requireConfig()` 转发 `assertConfig` |
| `frontend/src/core/dispose-helpers.ts` | `?? null` |
| `frontend/src/scene/manager/model-manager.ts` | Map 迭代器 `value` 收成 `string \| null` |
| 制度 | 「严格模式」以后只有一句话：`strict: true`。新成员无需逐次论证 |

## 风险与教训

1. **`as unknown as T` 是静音开关，不是逃生舱。** 它同时废掉三样东西：`this` 的类型、多余属性检查、缺方法检查。本轮 32 + 6 + 8 = 46 处问题全由这一句遮住。以后凡是要写双重断言，先问「是不是契约本身该改」。
2. **契约宽于实现是债，不是安全。** `GetConfig(): Config | null` 让十几处调用点为一个不可能发生的 null 写分支，真正该报错的「桥未就绪」反而被稀释进噪声。收窄契约 + 单点抛错，比到处判空便宜。
3. **泛型参数放在实例状态上，迟早撞不变型。** `ObserverHandle<T>` 的 T 只用于 `remove(observer)`，把它降级成构造期约束后，类型层面的问题一次消失——**能用闭包表达的东西不要挂在类的泛型上**。
4. **量尺先于结论。** 影子脚本一个默认值，让「Stage 3 要清 454 处」流传了一个阶段。修脚本才知道真实账单是 68。任何「实测数字」都要能说清测的是哪组选项。
5. **行为改动必须有测试**（ADR-276 已立此规矩）。本轮 6 处契约对齐里有 4 处是网页端行为变化（`GetModelPresets`/`ListEnvPresets` 从裸名变条目、`CleanOrphanCache` 从 void 变计数、`ReadTextFile` null→`''`），目前只有 `tsc` 兜着。diff-coverage 是「仅建议不阻断」，所以这条债要显式记：**网页端 `browserAdapter` 的契约行为缺测试**，后续补 `browser-adapter.contract.test.ts`。

## 落地记录（2026-10-24）

| 阶段 | 影子 `--strict` 计数 | 手法 |
|---|---|---|
| 基线（修脚本后） | 68 处 / 27 文件（prod 67、test 1） | — |
| 根因 1 落地后 | 46 处 / 12 文件 | `ObserverHandle` 泛型降级 |
| 根因 3 落地后 | 46（`TS2345`×13 全消，另 32 处 `TS2339` 待根治） | `addDisposableListener` 泛型化 |
| 根因 2+4 契约收窄后 | 2 处 / 2 文件 | `PlainReturn` + 删双重断言 + 6 处对齐 + 8 个 AI 桩 |
| 收尾 | **0 处 / 0 文件**（`strict=true` `strictNullChecks=true` `noImplicitAny=true`） | `GetModelMetaBatch` 参数放宽、`model-manager` 迭代器收窄 |

验收：`tsc --noEmit` `EXIT=0`（`strict: true` 已落地后重跑）；全量 `vitest` **263 文件 / 6086 用例全绿**；`prettier --check` 通过；`eslint` 改动文件 0 error（余下 `max-lines`/`complexity` 全为存量 warning）；`check:lint` 与 `knip` 退出 0。

环境备注：影子检查器 `frontend/node_modules/.tmp/strict-check.mjs`（用法 `cd frontend && node node_modules/.tmp/strict-check.mjs --strict [路径子串...]`，约 40s）本轮修了默认值 bug；探针文件 `frontend/src/__tmp-thistype.ts` 用完即删——它证明了「有上下文类型时 `ThisType` 与 EPC 都生效，`as unknown as T` 会让整段失去上下文」，而项目级 `tsc`（`noImplicitThis` 关）看不出这个问题，必须在 `--strict` 下跑。

## 相关文档

> ADR-274（Stage 1 noImplicitAny）/ ADR-276（Stage 2 strictNullChecks）/ ADR-258（pre-push tsc 缓存键）/ ADR-176（能力降级惯例）
