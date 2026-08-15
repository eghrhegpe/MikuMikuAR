# round56-env-context 审核报告 — env 共享上下文测试与其生产源码

## 一、审核范围

| 项 | 文件 | 行号范围 |
|----|------|---------|
| 测试文件 | `frontend/src/__tests__/scene/env-context.test.ts` | 全文 83 行（9 用例 / 3 describe 块） |
| 被测源码 | `frontend/src/scene/env/_shared/env-context.ts` | 全文 103 行：`initEnvImpl`(19-22) / `resetEnvContext`(27-30) / `getScene`(33-38) / `isInitialized`(40-42) / `getPipeline`(44-49) / `INFINITE_GROUND_SIZE`(55) / `effectiveGroundSize`(61-63) / `resolveStaticAsset`(66-71) / `_envSys`(82-103) |
| 设计意图参考 | `docs/knowledge/env-context.md`（tier: leaf）、ADR-134（无限地面 2000）、ADR-217（地水无限尺寸单源化）、ADR-106 Phase 3（dispose 幂等）、ADR-063 §4.3（barrel re-export 型循环可接受） | — |

**验证记录：**
- `cd frontend && npm run test -- src/__tests__/scene/env-context.test.ts` → **9/9 passed**（vitest 4.1.9，self 52ms，环境 happy-dom）。
- `npm run check` 未跑（任务允许跳过；本文件极简单且零类型逃生，结论不依赖类型检查）。
- 生产代码 grep `as any`/`@ts-ignore`/`@ts-expect-error`/`catch{}` → **零命中**；测试文件 grep `it.skip`/`describe.skip`/`.todo`/`.only` → **零命中**。

**与既往审核的关系（任务要求注明）：**
- **round-12（env 状态链，2026-08-06）**：批量审 env 系列 9 模块，env-context 当时作为 env-impl 拆分产物未单独立项；其状态链（init→get→reset）的「共享上下文」环节此前无直接单测——本测试即该缺口的 L1 单元补测。
- **round-40（env-sky，2026-08-15）**：`env-sky.test.ts:7` **mock** 了 `resolveStaticAsset`、`_envSys.sky` 等 env-context 符号；本测试**真实加载** env-context 源码，两者构成「mock 消费方 vs 真实实现方」互补（round-40 报告 P4 曾提示 env-sky 测试只 mock 不执行 env-context 逻辑）。
- **round-53（env-persist）/ round-55（set-env-state）**：两轮均审 env-bridge 持久化/中央入口链，其测试对 env-context 部分符号做桩（`initEnvImpl: () => {}` 等）；本测试为这些桥接层依赖的共享上下文提供真实行为基座，与 L2 集成测试（set-env-state.int.test.ts 等）分层互补。
- **env-impl.test.ts（dispose 复位分支，L251-302）**：通过 `disposeEnvUpdateObserver` 集成路径断言 `resetEnvContext` 后 `isInitialized()===false`；本测试直接单测 `resetEnvContext` 本身——集成层 + 单元层双覆盖同一 P2 修复点，无冲突仅冗余度低。

## 二、总体结论

**✅ 通过**

测试 9/9 通过且断言全部真实有效：8 个导出符号中 7 个（`initEnvImpl`/`resetEnvContext`/`getScene`/`isInitialized`/`getPipeline`/`effectiveGroundSize`/`INFINITE_GROUND_SIZE`）被直接行为验证，外加任务范围外的 `resolveStaticAsset`（Android 安全解析）4 断言。生产源码 103 行零类型逃生、状态流清晰（模块私有 `_scene`/`_pipeline` 仅 init/reset 两处写入点）、常量锚定 ADR-134/217、共享层零循环依赖设计成立。83 行对 103 行源码的覆盖对「共享上下文行为」这一焦点是充分的（唯一未直接测的 `_envSys` 是纯数据结构，其字段由 env-sky/water/ground/particles 消费方测试经真实对象间接覆盖）。风险均为 P3/P4 级小项，不构成通过条件。

## 三、亮点

1. **[fix P2] 幽灵引用复位的直接回归测试**（`env-context.test.ts:43-51`）：`initEnvImpl → resetEnvContext → getScene/getPipeline 重新抛错 + isInitialized 回 false` 三步断言精确钉死「dispose 后引用置 null」契约，对应源码 `env-context.ts:24-30` 的注释（HMR 重入 step0 再 dispose 时避免写已销毁 scene）。该 P2 修复同时被 `env-impl.test.ts:285-286` 集成层复验，双层护栏。
2. **模块私有状态写入点单一**（`env-context.ts:16-17,19-22,27-30`）：`_scene`/`_pipeline` 仅 `initEnvImpl`（成对赋值）与 `resetEnvContext`（成对置 null）两处触碰，grep 全仓确认无第三方直写——「isInitialized 只查 _scene 而 getPipeline 独立抛错」的不对称在成对写入不变量下保持自洽（见 P3-1 建议加注释固化）。
3. **地水尺寸单源落地完整**（`env-context.ts:55,61-63`）：`INFINITE_GROUND_SIZE=2000` 锚定 ADR-134/217 注释；`effectiveGroundSize` 被 `env-water.ts:56,107`、`env-water-material.ts:273`、`env-ground-spec.ts:157,296,413` 共 5 处消费，且 `env-ground.ts:571` re-export 消除了历史双源（[fix P3] 注释自证）。测试断言 `effectiveGroundSize` 两分支 + 常量值（`env-context.test.ts:55-65`），契约防漂移。
4. **异常处理带语义化错误**（`env-context.ts:33-38,44-49`）：未初始化访问抛 `[env-context] Scene/Pipeline not initialized`，非静默返回 undefined；`disposeEnvUpdateObserver` 以 `isInitialized()` 守卫先 no-op（`env-impl.ts:200-202`，ADR-106 Phase 3），HMR 首启幂等路径无抛错风险。
5. **测试用双强转而非 `as any`**（`env-context.test.ts:16-17`）：`{} as unknown as Scene` 符合 frontend/AGENTS.md 类型卫生精神；`afterEach(resetEnvContext)`（L19-22）保证用例间共享状态隔离，无裸 `window` 操作、无 vi.mock 依赖——本文件是 env 系列中少数真实加载 env-context 源码的测试（其余多为 mock）。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `env-context.ts` | 40-42 vs 44-49 | `isInitialized()` 只查 `_scene !== null`，`getPipeline` 却独立抛错——不对称依赖「init/reset 成对写入」不变量。当前成立（全仓仅 initEnvImpl/resetEnvContext 触碰两者），但未来若出现只设 scene 不设 pipeline 的路径，将进入「isInitialized=true 但 getPipeline 抛错」的静默分裂态 | 在 `isInitialized` 处加注释固化「_scene/_pipeline 必须成对写入」不变量；或改为 `return _scene !== null && _pipeline !== null`（成本一行，消除不对称） |
| 🟡 P3 | `env-context.ts` | 66-71 | `resolveStaticAsset` 相对路径分支直接读 `window.location.origin`，无 `window` 存在性守卫——若未来在 node/worker 上下文调用会抛 ReferenceError（当前唯一调用点 `env-sky.ts:191` 在浏览器路径，安全） | 可选：`typeof window === 'undefined' ? path : new URL(...)` 兜底；至少加注释说明「仅浏览器路径调用」的前置条件 |
| 🟡 P3 | `env-context.test.ts` | 78-82 | 相对路径解析用例依赖 happy-dom 环境提供的 `window.location.origin`——本文件无 `@vitest-environment node` 标注，靠默认环境隐性成立；若未来为提速给本文件加 node 标注，该用例会以 ReferenceError 而非断言失败暴露 | 加 `// @vitest-environment happy-dom` 显式标注，或断言改为不依赖具体 origin（如 `expect(new URL(out).pathname).toBe('/textures/sky.png')`） |
| 🟢 P4 | `env-context.test.ts` | 全文 | `_envSys`（源码 82-103，最大的共享数据结构）在本文件零直接断言——仅靠 env-sky/env-water/env-ground/env-particles 测试经真实对象间接覆盖其字段形状；若某子模块新增 `_envSys` 字段而消费方 mock 未同步，会命中 ADR-217 §五记录的同款「vi.mock 未同步 export」运行时错误 | 可在本文件补一条 `_envSys` 结构形状断言（各字段初始值为 null），把「聚合对象形状」钉在 L1 层，防止 mock 形状漂移 |
| 🟢 P4 | `env-context.test.ts` | 34-41 | 无「重复 initEnvImpl（覆盖注入）」用例——HMR 重入场景中 init 幂等性（后注入覆盖先注入）未直接验证（env-impl 集成层有 dispose 侧覆盖，init 侧无） | 补一条：init A → init B → getScene() 返回 B（断言覆盖语义），与 reset 用例对称 |
| 🟢 P4 | `env-context.test.ts` | 68-82 | `resolveStaticAsset` 仅覆盖 http/https/data 透传 + 相对路径；未覆盖 `//` 协议相对 URL、`/` 根相对路径、带 query/hash 路径、`data:` 大写变体等边界 | 低价值边界，可随 P3-3 补测时顺带 1-2 条 |
| 🟢 P4 | `docs/knowledge/env-context.md` | L22,24,46 | 知识卡漂移：`tests: []` 未登记本测试文件；不变量文案「getScene() 返回未定义」与实际「抛 Error」不符（`env-context.ts:35`）；`getPipeline` 未列入 API 节选 | 更新知识卡：`tests` 填 `env-context.test.ts`，不变量改「未初始化时 getScene/getPipeline 抛错」，API 节选补 `getPipeline`/`resetEnvContext` |

## 五、测试质量评价

**断言有效性（优）**：9 个用例全部有真实行为断言，无空断言——未初始化抛错（正则匹配错误文案）、init 后引用同一性（`toBe(s)` 引用级断言，非 `toEqual` 浅比）、[fix P2] 复位三步曲（抛错恢复 + isInitialized 翻转）、`effectiveGroundSize` 两分支 + 常量值、`resolveStaticAsset` 四断言（透传保真 + 相对路径 URL 形态）。「init 返回注入依赖」用 `toBe` 验证引用同一性，直击「上下文持有注入对象」的核心语义。

**Mock 合理性（优）**：本文件**零 vi.mock**——真实加载被测模块，这正是「共享上下文」测试应有的姿态（其余 env 测试 mock 它，此处补真实侧）。`mkScene`/`mkPipeline` 用 `as unknown as` 双强转而非 `as any`，符合类型卫生。无 TDZ/hoist 陷阱、无共享可变全局污染（`afterEach` 复位即隔离）。

**边界覆盖（良好）**：未初始化 ✓ / 初始化后 ✓ / 复位后 ✓（P2 核心）/ 无限尺寸两分支 ✓ / 绝对 URL 透传 ✓ / 相对路径解析 ✓。缺口均为低价值或已由消费方测试兜底：重复 init 覆盖（P4-5）、`_envSys` 形状（P4-4）、resolveStaticAsset 更多边界（P4-6）。

**83 行充分性**：对 103 行源码、聚焦「上下文行为」而言**充分**——导出符号 8 个测了 7 个（余 `_envSys` 为数据形状，间接覆盖成立）；与 round-40 审 env-sky.test.ts（87 行对 504 行仅 10% 覆盖）形成鲜明对比，本测试的行/符号覆盖密度远高，属 env 系列中覆盖最扎实的小文件之一。

**跳过与卫生**：无 `it.skip`/`describe.skip`/`.only`/`.todo`（grep 零命中）；无死导入；`npm run test` 单文件 9/9 通过（52ms）。

---

审核日期：2026-08-15
审核员：子代理 round56-env-context
