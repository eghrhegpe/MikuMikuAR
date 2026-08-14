# 审核报告 — observer-handle（Observer 生命周期统一管理，ADR-139）— 第 17 轮 · 测试 2

## 审核范围

- **测试文件**：`frontend/src/core/__tests__/observer-handle.test.ts`（134 行）
- **被测源码**：`frontend/src/core/observer-handle.ts`（133 行，主测目标）
  - `ObserverHandle`（:31-52）、`observe`（:60-69）、`observeOnce`（:74-83）、`ObserverRegistry`（:91-133）
- **契约核对依赖**：
  - `@babylonjs/core/Misc/observable`（`Observable.add/addOnce/remove` 语义：`add` 返回 `Nullable<Observer<T>>`；`addOnce` 首触发自动摘除；`remove` 对已移除 observer 为 no-op）
  - `docs/adr/adr-139-observer-registry.md`（设计意图：ObserverHandle + observe/observeOnce + ObserverRegistry 批量管理，34 处 add 调用点迁移）
  - `docs/knowledge/observer-handle.md`（知识卡，leaf tier）
- **验证执行**：
  - `npm run test -- src/core/__tests__/observer-handle.test.ts` → **10/10 通过**（21ms），无 stderr 异常
  - `npm run check` → 后台执行中（结果见文末补充，若超时则注明跳过）

## 总体结论：✅ 通过

实现与 ADR-139 设计意图逐条一致：dispose 幂等（双重 null 置空 + isDisposed 派生状态机）、null 空安全、Registry 批量清理/单移除/幂等 disposeAll 全部正确；`observe`/`observeOnce` 对 Babylon 可空返回做防御性抛错，且抛错先于 Registry 注册（无半注册状态）。10 个测试全部落在可观察副作用上（dispose 后 `notifyObservers()` 回调不再触发，验证的是 Observable 内部状态而非句柄自述），实测全绿，无跳过用例，**无 P1/P2 风险**。仅有 2 处 P3（构造器签名 null 语义不一致、observeOnce 句柄 isDisposed 语义 + register() 测试缺口）与少量 P4。

## 亮点

- **幂等 dispose 状态机**（observer-handle.ts:41-51）：`dispose()` 一次 `remove` + 双字段置 null，`isDisposed` 为派生 getter（`_observer === null`），状态写入点唯一、无幽灵路径；重复调用零副作用。
- **null 空安全设计**：字段类型即 `Observable<T> | null` / `Observer<T> | null`（:32-33），`dispose()` 的 `if (this._observable && this._observer)` 守卫（:42）使 `new ObserverHandle(null, null)` 也安全——测试 :33-37 实测覆盖，不抛错且 `isDisposed === true`。
- **防御性可空返回检查**（:65-67, :79-81）：`add()`/`addOnce()` 返回 null 时显式抛错，与 Babylon `Nullable<Observer<T>>` 返回类型对齐；由于 `observe` 在 `push` 之前抛错（:99-101），`Registry.add` 失败不会留下半注册句柄。
- **测试验证真实移除副作用**（observer-handle.test.ts:23-31, :54-57, :82-83）：dispose/remove/disposeAll 后均以 `notifyObservers()` + `toHaveBeenCalledTimes(0)` 断言回调确实从 Observable 摘除——防"只断言句柄内部状态"的假绿。
- **observeOnce 自动移除与 dispose 兼容**（observer-handle.test.ts:118-133）：addOnce 首触发自动摘除后二次 notify 不再回调，且 `handle.dispose()` 不抛错——依赖 Babylon `remove` 对已移除 observer 的 no-op 语义，测试 :132 对该边界做了实测。
- **Registry.remove 返回语义完整**（observer-handle.ts:110-118）：`indexOf` 未找到返回 `false`（test :86-90 覆盖），找到则 splice + dispose + 返回 `true`；`disposeAll` 迭代 dispose 后整体清空数组（:121-126），幂等。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟡 中 P3 | observer-handle.ts:35-38 | 构造器签名与实现 null 语义不一致 | 构造器参数声明为非空 `Observable<T>, Observer<T>`，但字段/`dispose()`/测试均依赖 null 支持（测试 :34 直接 `new ObserverHandle(null, null)`）。`strict: false` 下侥幸编译，一旦启用 strict 该测试即编译失败，签名对调用方"说谎"。 | 构造器参数类型改为 `Observable<T> \| null` / `Observer<T> \| null` 与实现对齐；或提供静态工厂并让构造器私有。 |
| 🟡 中 P3 | observer-handle.ts:74-83 + observer-handle.test.ts:118-133 | observeOnce 句柄的 `isDisposed` 语义漂移 | `addOnce` 首触发自动摘除后，句柄的 `_observer` 引用未置 null，`isDisposed` 返回 `false`——语义是"用户已调 dispose"而非"已从 Observable 摘除"。当前 renderer.ts 已因 P1 bug（renderer.ts:889 注释：observeOnce 只跑首帧到不了 t>=1）弃用 observeOnce 改用 observe，生产无活跃消费者，影响有限；测试也未断言该状态下 isDisposed。 | 在 JSDoc 注明 isDisposed 语义边界；或在包装回调触发后同步置空引用（保持 dispose 幂等）。 |
| 🟡 中 P3 | observer-handle.test.ts | `ObserverRegistry.register()` 与抛错路径无覆盖 | `register()`（observer-handle.ts:105-107）无任何测试用例；全仓 `new ObserverRegistry(` 仅出现在测试文件（生产零使用，ADR-139 提供的可选设施尚未被消费）；`observe`/`observeOnce` 的 add 返回 null 抛错路径亦无测试（该路径依赖 mock Observable.add 返回 null，成本较高）。 | 补 `register` + `remove(register 的句柄)` 用例；抛错路径可后续以 stub Observable 覆盖，低优先。 |
| 🟢 低 P4 | docs/knowledge/observer-handle.md:36 | 知识卡 API 漂移 | 知识卡声称 ObserverRegistry 支持 `add / register / remove / size / **clear**`，实现无 `clear` 方法（只有 `disposeAll`）。 | 更新知识卡，删除 `clear` 或补实现。 |
| 🟢 低 P4 | scene/render/renderer.ts:14 | 死导入 | `observeOnce` 已 import 但全文无调用（P1 修复后 :889-891 全部改用 `observe`），仅剩注释提及。 | 删除 `observeOnce` 导入。 |
| 🟢 低 P4 | observer-handle.ts:60-83 | observe/observeOnce 近似重复 | 两函数仅 `add` vs `addOnce` 之差（各 4 行重复），可参数化内部私有 `_add`。当前体量下可读性更佳，重构收益低。 | 维持现状或抽 `_add(cb, once)` 私有辅助。 |

## 测试质量评价

**有效断言**：10 个用例全部落在可观察副作用上——重复 dispose 不抛错且状态一致（:7-21）、dispose 后回调零触发（:23-31）、null 句柄安全（:33-37）、Registry 批量清理后两路回调均不再触发（:41-58）、disposeAll 幂等（:60-68）、remove 返回语义（:70-90）、observe 数据透传 `42` 精确断言（:104-115）、observeOnce 恰好一次（:118-133）。无 `it.skip` / `it.only`，无 `@ts-ignore` / `as any`，`// @vitest-environment node` 注释正确（模块不依赖 DOM/window，用真实 Babylon Observable 而非 mock，可信度高）。

**缺口**：`register()` 无覆盖（P3-3）；observeOnce 自动摘除后的 `isDisposed` 状态未断言（与 P3-2 同源）；`disposeAll` 后 Registry 复用（再次 add）未测——实现上 `length = 0` 后 add 正常，风险低。

**验证结果**：实测 10/10 通过（21ms），与任务说明的全量测试基线一致。

---

## check 补充

`npm run check`（含 tsc 类型检查 + i18n parity 门禁）→ **通过（exit code 0）**，i18n parity 全绿（zh-CN/en/ja/ko/zh-TW 五语言 1870 键零缺失零多余）。

---

审核日期：2026-08-15
审核员：子代理 round17-observer-handle
