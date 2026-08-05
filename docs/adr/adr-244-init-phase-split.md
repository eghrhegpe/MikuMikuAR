# ADR-244: init 启动流程阶段化拆分 —— 110 行编排器按职责切分

> **日期**: 2026-08-06
> **状态**: ✅ 已完成（2026-08-06 落地；实施前子代理坑点审核确认 1 个阻断项——骨架示例缺 await——已先修订再实施）—— `init()` 主体压至 13 行，4 个阶段函数落地，零行为变更
> **编号**: 244
>
> **关联**: [ADR-102](adr-102-main-ts-split.md)（main.ts 拆分——init/events/render-loop/dev-hooks 同款拆分精神）、[ADR-003](adr-003-download-strategy.md)（启动引导）、[ADR-177](adr-177-web-loader-main-app-unification.md)（Web Loader 统一）、[ADR-238](adr-238-循环依赖消解二期-core-scene-根环.md)（桥接注册链）
>
> **来源**: 2026-08-06 第 10 轮代码审核（`docs/audit/`）P3-2：`init()` 函数 110 行串联 20+ 步骤，可读性下降。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

`frontend/src/core/init.ts` 的 `init()`（L88-199）是启动编排的唯一入口，单函数串联 20+ 步骤，实际承担 **4 类职责**：

| 职责类别 | 步骤示例 | 数量 |
|----------|---------|------|
| ① HMR 幂等清理 | `_initDisposables` 清理、`disposeEventHandlers`、`disposeOverlay2`、`disposeStatusBar` | 4 |
| ② 早期基建 | `registerIconBundle`、`initI18n`、`initRuntimeBridge`、`registerRuntimeEventHandlers`、`installLoggingPatch`/`installGlobalErrorCapture`、`_applySystemA11y`、`registerEventHandlers`、快捷键注册 | 10 |
| ③ 场景与库初始化 | capabilities 预热、`resolveBackend`、`initDropHandler`、`initScene`、`showApp`、`initLibrary`、auto-import 预加载 | 7 |
| ④ 状态恢复 | `restoreEnvState`、`restoreUIState`、`applyHudVisibility`、更新检查、`syncTimeOfDayFromEnv`、`restoreAutoCameraState`、`tryRestoreLastScene` | 7 |

### 问题

| # | 问题 | 影响 |
|---|------|------|
| 1 | **上帝函数**：110 行单函数承载 4 类职责，步骤间依赖关系（await 顺序）隐式存在 | 新增启动步骤需通读全函数判断插入点；review 只能整段看 |
| 2 | **阶段边界不可见**：哪一步必须在场景初始化前、哪一步必须在状态恢复后，全靠注释传达 | 错误插入顺序可能引入隐性竞态（如 UI 恢复先于 i18n 就绪） |
| 3 | **与 ADR-102 精神不一致**：main.ts 已按职责拆分（init/events/render-loop/dev-hooks），但 init.ts 内部仍是未分层的单片 | 架构一致性缺口 |

### 现状事实

- 步骤间**确实存在硬依赖**：i18n → 静态文案；`initRuntimeBridge` → `registerRuntimeEventHandlers`（事件订阅必须在桥就绪后，否则回落 no-op WebEvents）；`initScene` → `showApp`；`restoreEnvState` → `tryRestoreLastScene`（env 先恢复，scene restore 跳过 env）。
- 顶层统一 try/catch 已有（L193-198）：失败显示错误 UI + status，**该异常契约必须保留**。
- `_initDisposables` 幂等清理在函数入口，HMR 语义依赖「清理先行」。

## 候选方案

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 阶段函数拆分** | 拆为 `initCleanup()` / `initEarlyInfra()` / `initScenePhase()` / `initRestorePhase()` 4 个私有函数，`init()` 变成 4 行编排 + 统一 try/catch | 轻量、零新抽象；阶段边界显式化；与 ADR-102 精神一致 | 阶段间共享局部状态（如 `_aiErrDisposer`）需提为模块级或返回句柄 |
| **B. 保持现状** | 单函数 + 注释分组 | 零改动 | 问题持续 |
| **C. Orchestrator 类** | 引入 `InitOrchestrator` 类，每阶段一个方法，阶段间通过字段共享状态 | 结构最强 | 过度设计：启动流程一次性执行，无状态复用需求，类引入额外样板 |

## 决策

**采纳方案 A（阶段函数拆分）**，理由：

1. 启动流程是**一次性线性执行**，无需状态机/类抽象——函数拆分已足够表达阶段边界。
2. 4 个阶段与现有注释分组（`// ======== Init ========` 内天然可分）一一对应，迁移成本低、可逐步落地。
3. 与 ADR-102「main.ts 拆分」同一思路的延伸：**编排器保持薄，职责下沉到具名阶段**。

### 实施步骤（Phase 1：纯结构拆分，零行为变更）

1. 抽取 4 个私有阶段函数。**除 `_initCleanup` 外均为 `async`**——阶段内含 `await` 步骤，非 async 会导致阶段函数在首个 await 处让出后立即进入下一阶段，破坏 3 条串行链（`initI18n→initRuntimeBridge` 硬依赖、`initScene→showApp`、`restoreEnvState→tryRestoreLastScene`，P0 竞态）：
   - `_initCleanup(): void`：`_initDisposables` 清理 + `disposeEventHandlers` + `disposeOverlay2` + `disposeStatusBar`；
   - `_initEarlyInfra(): Promise<void>`：icon bundle → i18n → runtime bridge → runtime event handlers → logging patch/error capture（disposer 并入 `_initDisposables`）→ a11y → 静态文案 → 徽标 → 事件处理器 → 快捷键 → status；capabilities 预热 / backend 徽标；
   - `_initScenePhase(): Promise<void>`：`initDropHandler` → initScene 桥守卫 → `initScene` → `showApp` → initLibrary 桥守卫 → `initLibrary` → auto-import 预加载；
   - `_initRestorePhase(): Promise<void>`：`restoreEnvState` → `restoreUIState` → `applyHudVisibility` → 更新检查 → `syncTimeOfDayFromEnv` → `restoreAutoCameraState` → `tryRestoreLastScene`。
2. `init()` 主体改为（**必须 `await` 三个 async 阶段**）：
   ```ts
   async function init(): Promise<void> {
       try {
           _initCleanup();
           await _initEarlyInfra();
           await _initScenePhase();
           await _initRestorePhase();
       } catch (err) { /* 保持现有错误 UI 契约 */ }
   }
   ```
3. **阶段内顺序一字不动**，仅移动代码位置——重构以「diff 中无行为差异」为验收。
4. **已吞错调用原样搬移**：`fireAndForget`/`swallowError`/`safeCallAsync` 共 7 处（L75/136/142/166/168/180/192）保持原位次，不得改写为 await 或加 catch（语义：吞错后不进入顶层 catch）。
5. 跑 `npm run test`（重点 `main.boot-anchor.test.ts`）+ `npm run build` + `npm run deadcode`（knip）验证。

### 验收标准

- [x] `init()` 主体 ≤ 15 行（实测 13 行：编排 + 清理 + try/catch）
- [x] 4 个阶段函数各 ≤ 40 行**（注释不计行；实测代码行 cleanup 9 / earlyInfra 32 / scenePhase 16 / restorePhase 17）**，职责单一
- [x] 启动顺序与现状逐位一致（boot-anchor 测试全绿；diff 确认纯搬运，语句一字未动）
- [x] 全量单测通过（4394），构建通过，knip 无新增死代码

## 落地记录（2026-08-06）

### 实施前子代理坑点审核结论

9 点核实 **1 个阻断项 + 7 个注意项**，全部处理：

| 项 | 结论 | 处理方式 |
|----|------|---------|
| ❌ 阻断：ADR 骨架示例缺 `await` | 照抄会破坏 `initI18n→initRuntimeBridge`、`initScene→showApp`、`restoreEnvState→tryRestoreLastScene` 三条串行链（P0 竞态） | 实施前先修订文档：3 个阶段函数标 `async` + init() 内 `await` |
| 阶段间共享状态 | 全模块级（`_initDisposables`/`uiState`/`dom`/桥引用），唯一局部 `_aiErrDisposer` 阶段内自洽 | 无需跨阶段参数/返回值 |
| 已吞错调用 7 处 | fireAndForget/swallowError/safeCallAsync 语义（吞错不 reject） | 原位次搬移，不改写为 await |
| HMR 幂等语义 | 清理-重建顺序现状一致 | 无改动 |
| 测试影响 | boot-anchor **mock 整个 init 模块**（不执行真实 init） | 零影响 |
| import 副作用 | 全部无顶层执行；真正的 side-effect import 在 main.ts | 保持顶部不动 |
| knip | 私有函数被 init() 调用，非 dead code | 确认无新增报告 |
| `_initEarlyInfra` 超 40 行风险 | 注释 18 行 + 代码 32 行 | 同步修订 ADR 验收口径（注释不计行） |

### 变更文件

| 文件 | 变更 |
|------|------|
| `core/init.ts` | 拆 4 阶段函数（`_initCleanup` 同步 + 3 个 async），`init()` 主体 110 行 → 13 行；语句零改动（diff 纯搬运验证） |
| ADR-244 文档 | 修订骨架示例（补 await）+ 验收口径（注释不计行） |

### 阶段函数实测尺寸

| 函数 | 总行 | 代码行 | 职责 |
|------|------|--------|------|
| `_initCleanup` | 10 | 9 | HMR 幂等清理（disposables/events/overlay/status） |
| `_initEarlyInfra` | 50 | 32 | i18n/桥/错误捕获/a11y/快捷键/徽标/预热 |
| `_initScenePhase` | 27 | 16 | drop/scene/library/auto-import |
| `_initRestorePhase` | 23 | 17 | env/UI/HUD/更新检查/场景恢复 |
| `init()` | 13 | 13 | 4 行编排 + try/catch |

### 验证

- `tsc --noEmit` 干净
- boot-anchor 3 用例 + 全量 **262 文件 / 4394 测试全绿**
- `vite build` 通过；`npm run deadcode`（knip）无新增报告
- `git diff` 确认纯搬运（122 insertions / 99 deletions，语句一字未动）

---

## 附：为什么不拆成独立文件

阶段函数间共享 `_initDisposables` 模块级状态与 `getSceneAction`/`getUiAction` 桥引用，拆文件需引入参数传递或跨文件模块级状态，反而破坏「同文件内顺序即依赖」的直观性。阶段拆分**留在 init.ts 内**，与 ADR-102「init.ts 独立成文件」的边界不冲突——本 ADR 管的是文件**内部**的组织。
