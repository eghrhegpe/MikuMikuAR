# ADR-244: init 启动流程阶段化拆分 —— 110 行编排器按职责切分

> **日期**: 2026-08-06
> **状态**: 🔄 规划中 —— 已登记方案与实施步骤，待落地
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

1. 抽取 4 个私有阶段函数（参数 = 现闭包所需局部状态，返回值 = 需传给后续阶段的句柄）：
   - `_initCleanup()`：`_initDisposables` 清理 + `disposeEventHandlers` + `disposeOverlay2` + `disposeStatusBar`；
   - `_initEarlyInfra()`：icon bundle → i18n → runtime bridge → runtime event handlers → logging patch/error capture（返回 disposer 并入 `_initDisposables`）→ a11y → 静态文案 → 徽标 → 事件处理器 → 快捷键 → status；capabilities 预热 / backend 徽标；
   - `_initScenePhase()`：`initDropHandler` → initScene 桥守卫 → `initScene` → `showApp` → initLibrary 桥守卫 → `initLibrary` → auto-import 预加载；
   - `_initRestorePhase()`：`restoreEnvState` → `restoreUIState` → `applyHudVisibility` → 更新检查 → `syncTimeOfDayFromEnv` → `restoreAutoCameraState` → `tryRestoreLastScene`。
2. `init()` 主体改为：
   ```ts
   async function init(): Promise<void> {
       try {
           _initCleanup();
           _initEarlyInfra();
           _initScenePhase();
           _initRestorePhase();
       } catch (err) { /* 保持现有错误 UI 契约 */ }
   }
   ```
3. **阶段内顺序一字不动**，仅移动代码位置——重构以「diff 中无行为差异」为验收。
4. 跑 `npm run test`（重点 `main.boot-anchor.test.ts`）+ `npm run build` 验证。

### 验收标准

- [ ] `init()` 主体 ≤ 15 行（编排 + 清理 + try/catch）
- [ ] 4 个阶段函数各 ≤ 40 行，职责单一
- [ ] 启动顺序与现状逐位一致（boot-anchor 测试全绿）
- [ ] 全量单测通过，构建通过

---

## 附：为什么不拆成独立文件

阶段函数间共享 `_initDisposables` 模块级状态与 `getSceneAction`/`getUiAction` 桥引用，拆文件需引入参数传递或跨文件模块级状态，反而破坏「同文件内顺序即依赖」的直观性。阶段拆分**留在 init.ts 内**，与 ADR-102「init.ts 独立成文件」的边界不冲突——本 ADR 管的是文件**内部**的组织。
