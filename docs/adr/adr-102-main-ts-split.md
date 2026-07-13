# ADR-102: main.ts 拆分（init / events / render-loop / dev-hooks）

> **状态**: 规划
> **日期**: 2026-07-13
> **作者**: Riku（首席架构师 AI）
> **关联**: #3 main.ts 拆分（待后续重构）；ADR-033 config-split-and-dedup；ADR-100 camera-control-behavior-dual-axis；AGENTS.md「本地缓存规范」

---

## 1. 背景与上下文

- `frontend/src/core/main.ts` 当前 1242 行，是应用入口，聚合了大量全局状态（`config`/`state`/`dom`）、DOM 引用与跨模块编排。
- 此前曾尝试拆分为 `init.ts` / `events.ts` / `render-loop.ts` / `dev-hooks.ts`，引入约 80 个 `tsc` 错误，已回退。
- 本次借当时的错误日志复盘根因，重拟**可分步编译验证**的方案，并登记为 ADR 以锁定决策，避免二次踩坑。

---

## 2. 关键发现：错误日志是「化石」，非当前状态

复跑当前基线（2026-07-13）：

```bash
cd frontend && npx tsc --noEmit
# 仅 1 个无关错误：
#   src/scene/scene.ts(177,32): error TS2304: Cannot find name '__MMD_ENABLE_MPR__'.
# TSC EXIT: 2
```

日志中大量报错在当前代码**已不存在**，证明其为旧代码库 + 拆分尝试中机械失误的产物，不能直接当作当前待修清单：

| 日志中的报错 | 当前状态 |
|--------------|----------|
| `window.wails` 未声明（platform.ts / ar-camera.ts / main.ts:417） | 当前基线**无此错**——platform 已改用 `@wailsio/runtime` 的 `Browser`/`Events` |
| `dom.btnLoop` / `dom.navButton` / `dom.navPanel` / `dom.freeflyW` / `dom.moveForward` | 当前 `dom.ts` 已无这些属性（现为 `btnLoopToggle`、`freeflyInput.{forward,backward,left,right,up,down}`） |
| `ui-virtual-grid.ts:138 setColumns`、`ar-camera.ts:311` | 当前基线**无** |
| `main.ts` 自身雪崩式 `Cannot find name isPlaying/...` | 当前 `main.ts` 导入完整（行 6–66），属拆分时 import 被挪走但引用残留 |

**结论**：重拆从**近零基线**起步，但日志暴露的**同类失误模式必须封堵**（见 §5 风险与 §4 Pre-flight）。

---

## 3. 根因分类（从日志提炼的 4 类失误模式）

| # | 失误模式 | 日志实证 | 真实根因 | 正确做法 |
|---|----------|----------|----------|----------|
| 1 | **凭记忆写跨模块 API 签名** | `UpdateCheckResult.Available/.LatestVersion/.DownloadURL`（应为 `available`/`latest`/`url`）；`Config.CacheDir/.KeyBindings`（实为 snake_case `ui_state`/`download_watch_dir`，且 `CacheDir` 根本不存在）；`setUIState('uiState',..)`（实签 `setUIState(state: UIState)`）；`setEnvState('envState',..)`（实签 `setEnvState(partial: Partial<EnvState>)`）；`freeflyInput.moveForward`（实为 `forward`）；`IMmdRuntime.resumeAnimation`（不存在，应为 `seekAnimation` 等）；`uiState.renderFpsLimit`（实为 `fpsLimit`） | 未读真实定义，按记忆/旧版瞎写 | 每处消费生成类型或跨模块 API 前，**先 Grep 真实定义**（`frontend/bindings/.../models.ts`、`core/state.ts`、`core/dom.ts`、`scene/...`）。禁止凭记忆 |
| 2 | **导入搬迁后漏改引用** | `main.ts` 雪崩 `Cannot find name isPlaying/setIsPlaying/setAutoLoop/autoLoop/closeAllOverlays/setUIState/focusedModel/formatTimestamp/...` | 把 import 语句挪到子文件，但 `main.ts` 仍保留对这些符号的引用 | 拆分采用**「整段搬迁」**：代码连同其 import 一起移动；搬完后 `main.ts` 仅留 bootstrap；对残留引用 `grep -n "isPlaying" main.ts` 应为空 |
| 3 | **DOM 类型缺失 + 属性名漂移** | `events.ts`/`main.ts` 报 `dom.navButton/btnLoop/freeflyW` 不存在 | `dom.ts` 是 `export const dom`（只有值无类型别名）；且拆分时用了已不存在的旧属性名 | `dom.ts` 加 `export type DomRefs = typeof dom;`；搬迁前先 `Read dom.ts` 核对当前属性名 |
| 4 | **模块循环依赖** | `freeflyInput` 被 `camera.ts` render observer 读取、被键盘 handler 写入；拆到 `events.ts` 后 `camera↔events` 双向 | 新文件若被 domain 模块反向引用即成环，TS 循环求值把 const 当 `{}` 报 *Property does not exist* | 抽 `core/freefly-state.ts`（leaf，零 import）；`menus/*` 全改动态 `import()`；Split 层禁止被 Domain 层 import |

> 补充：生成类型**命名不一致**——`Config` 用 snake_case（`ui_state`/`resource_root`/`download_watch_dir`），`UpdateCheckResult` 用 camelCase（`current`/`latest`/`available`/`url`）。跨接口消费时极易写错，属模式 #1 的高危子项。

---

## 4. 目标架构（分层 + 4 文件）

```
┌─ Bootstrap 层 ─────────────────────────────┐
│  main.ts  (~30 行): 调 init() 编排，不含逻辑 │
└────────────────────────────────────────────┘
        │ import
┌─ Split 层（只 import 叶子层 + Domain，不被 Domain import）─┐
│  init.ts | events.ts | render-loop.ts | dev-hooks.ts      │
└──────────────────────────────────────────────────────────┘
        │ import
┌─ Leaf 状态层（零副作用、零反向依赖）────────────────────┐
│  config.ts(barrel) → types/state/dom/utils/ui-helpers/... │
│  core/freefly-state.ts  (NEW, leaf): 承载 freeflyInput    │
│  wails-bindings.ts: 唯一 Go 类型源                        │
└──────────────────────────────────────────────────────────┘
        │ import
┌─ Domain 层（scene / camera / menus / outfit …）──────────┐
│  禁止 import Split 层任何文件                              │
└──────────────────────────────────────────────────────────┘
```

**铁律**：Split 层 ↔ Domain 层只能单向（Split → Domain）。凡 Domain 需回调 Split 逻辑，一律用运行时注入 / 动态 `import()`，绝不在 Domain 里静态 import Split 文件。

---

## 5. 函数 → 文件迁移映射（以当前 main.ts 行号为准）

| 目标文件 | 迁入函数（当前 main.ts 行号） | 依赖面 |
|----------|-------------------------------|--------|
| **init.ts** | `_updateStaticHtmlTexts()` :68 · `buildNavMaps()` :227 · `init()` :621 · `restoreEnvState()` :702 · `restoreUIState()` :733 · `checkAndroidStoragePermission()` :1201 | config / scene / wails-bindings |
| **events.ts** | 播放/循环 :93–127 · nav 路由 :128–246 · `registerAppShortcuts()` :249 · Freefly WASD :411–466 · Seek :468–496 · canvas 点击 :497–609 · `initDropHandler()` :871 · `showUpdateToast()` :844 · `importToLibrary()` :1002 | dom / camera / menus(动态) / freefly-state |
| **render-loop.ts** | 渲染循环 :940–980 · `startFpsClock()` :984 | engine / scene / dom |
| **dev-hooks.ts** | E2E 捕获辅助 :1063–1172 · `if(import.meta.env.DEV)` 块 :1064–1191 · Android 存储 :1173–1234 | 仅 DEV / 动态 import babylon |

> 拆分后 `main.ts` 仅保留 import + `bootstrap()` 调用（约 30 行），符合「入口只编排」纪律。

---

## 6. Pre-flight 硬化（先消隐患，再动刀）

1. **补 `window`/全局声明**：在 `vite-env.d.ts` 加 `declare const __MMD_ENABLE_MPR__: boolean;`，使基线先归零，便于区分拆分引入的回归。
2. **`dom.ts` 补类型**：追加 `export type DomRefs = typeof dom;`（或手写 `DomRefs` interface），解决模式 #3。
3. **抽离 `core/freefly-state.ts`**（leaf，零 import）：把 `camera.ts:446` 的 `freeflyInput` 搬过去；`camera.ts` 与未来 `events.ts` 都从它 import → **彻底破环**，解决模式 #4。
4. **单源铁律**：`Config`/`UpdateCheckResult` 只从 `wails-bindings` 取；`UIState`/`EnvState` 只从 `config`/`types` 取；**禁止在新文件手写重复 interface**。仿 `types.ts:351` 补一条 `_GoConfigCoversFrontend` 哨兵类型测试，Go 端改字段时 tsc 主动报错。
5. **（按需）AppContext 注入**：仅当发现 Split 层之间或 Split↔Domain 有跨环调用时，才引入 `bootstrap` 对象把共享函数经参数传入，而非互相 import。

---

## 7. 分阶段执行（每阶段 `npm run check` 归零才进下一阶段）

| 阶段 | 动作 | 编译闸门 |
|------|------|----------|
| **P0** | Pre-flight 硬化（§6 五步），使基线 0 错误 | `npm run check` 0 错误 |
| **P1** | 抽 `dev-hooks.ts`（最低风险，DEV-only，无 Split 互依） | 0 错误 |
| **P2** | 抽 `render-loop.ts`（仅依赖 engine/scene/dom） | 0 错误 |
| **P3** | 抽 `events.ts`（menus 全改动态 import 破环；**先 Read 真实 API 签名**） | 0 错误 |
| **P4** | 抽 `init.ts`（编排 restore 逻辑） | 0 错误 |
| **P5** | 收口 `main.ts` 至 ~30 行，仅 `bootstrap()` | 0 错误 + 单测通过 |

> 每阶段结束按 `AGENTS.md` 本地缓存规范 `git add -A && git commit`（**禁 `git stash`**）。任一阶段出问题，`git reset --soft HEAD~1` 即可单阶段回退。

---

## 8. 风险登记（🔴🟡🟢）

| 等级 | 风险 | 触发条件 | 缓解 |
|------|------|----------|------|
| 🔴 P1 | **凭记忆写 API 签名**（模式 #1） | 消费 `Config`/`UpdateCheckResult`/`setUIState`/`setEnvState`/`freeflyInput`/`IMmdRuntime` 时未先查真实定义 | 每处先 Grep 真实定义；生成类型以 `frontend/bindings/...` 为唯一真相源；Code Review 重点查「无 Grep 依据的跨模块调用」 |
| 🔴 P1 | **导入搬迁后漏改引用**（模式 #2，雪崩主因） | 只搬 import 不搬引用，或搬代码忘搬其 import | 「整段搬迁」+ 搬完 `grep` 残留引用应为空；每阶段 `npm run check` 归零 |
| 🟠 P2 | **模块循环依赖**（模式 #4） | `events.ts` 与 `camera.ts` 静态互引 `freeflyInput`；Split 被 Domain import | 抽 `core/freefly-state.ts`；menus 动态 import；Split 层禁止被 Domain import |
| 🟠 P2 | **DOM 类型缺失 / 属性名漂移**（模式 #3） | 拆出文件需声明 `dom` 形参无类型；用了旧属性名 | `dom.ts` 加 `DomRefs` 类型别名；搬迁前 `Read dom.ts` 核对当前属性 |
| 🟠 P2 | **top-level await 被拒**（dev-hooks.ts:60,68） | tsconfig 不支持 TLA（module/target 过低或 moduleResolution 非 bundler） | 确认 `module: ESNext`/`target: ES2022+`；否则把顶层 await 包进 `async function bootstrap()` 在 main 调用 |
| 🟡 P3 | **生成类型命名不一致**（snake_case vs camelCase） | 跨 `Config`(snake) 与 `UpdateCheckResult`(camel) 消费写错字段 | 写代码前对该类型 Grep 真实字段；评估是否在 `wails-bindings.ts` 做 camelCase 适配层（破坏性需评估） |
| 🟡 P3 | **契约测试回归** | 拆分改名/移动公开导出函数 | 保持公开函数签名与导出名不变，仅移动文件 + 调内部 import；跑 `app.contract.test.ts`（116 函数 + FNV-1a ID）作闸门 |
| 🟡 P3 | **`window.wails` 旧坑复发** | dev-hooks/Android 段再次触碰 `window.wails`（当前基线已无，因已改用 `@wailsio/runtime`） | 触碰前 Grep 确认；必要时在 `vite-env.d.ts` 补 `wails?: unknown` 到 `Window`，或统一改用 `Browser`/`Events` |
| 🟢 P4 | **基线残留 `__MMD_ENABLE_MPR__` 未声明** | 当前基线唯一错误，与拆分无关 | 拆分前在 `vite-env.d.ts` 补 `declare const __MMD_ENABLE_MPR__: boolean;`，使基线先归零 |
| 🟢 P4 | **大文件并行改动 / 未提交 stash 冲突** | 多阶段累积未提交改动 | 按 AGENTS.md 每阶段 `git add -A && git commit`；回退用 `git reset --soft HEAD~1`，禁 `git stash` |

---

## 9. 验证闸门与回滚

- **闸门**：`cd frontend && npm run check`（tsc 类型检查，≠ 仅 `build` 通过）+ `npm run test -- src/__tests__/bindings/app.contract.test.ts`。本重构**不新增 Go 方法**，契约测试应不受影响。
- **回滚**：每阶段一个 commit，`git reset --soft HEAD~1` 精确回退，不丢改动。

---

## 10. 待决事项

1. 是否先在 `vite-env.d.ts` 补 `__MMD_ENABLE_MPR__` 使基线归零（建议：是，作为 P0 第一步）？
2. 是否对 `@bindings` 做 camelCase 适配/重新导出层（vs 仅靠纪律约束）？需评估对现有消费的破坏性。
3. ADR-102 由「规划」转「实施中」的触发条件：P0 完成 + 用户批准 P1 启动。
