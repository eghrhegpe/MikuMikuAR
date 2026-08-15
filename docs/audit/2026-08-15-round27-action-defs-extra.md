# [round27] action-defs 覆盖缺口补测（scene / library / diagnostic）— 审核结果

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/action-defs-extra.test.ts`（302 行，13 用例，`@vitest-environment node`） |
| 被测源码 | `frontend/src/core/action-defs/scene-actions.ts`（74 行，5 动作）<br>`frontend/src/core/action-defs/library-actions-def.ts`（69 行，4 动作）<br>`frontend/src/core/action-defs/diagnostic-actions.ts`（89 行，5 动作） |
| 间接涉及 | `core/action-registry.ts`（注册表）、`core/action-executor.ts`（统一执行/参数校验/异常兜底）、`core/scene-action-bridge.ts` / `core/ui-action-bridge.ts`（ADR-238 注入桥）、`core/async.ts` `makeLazyLoader` |
| 与 round-15 关系 | round-15 已审 core 状态/UI/动作定义体系（core-state-ui-backend）。本测试为**覆盖缺口补测**：兄弟测试 `action-defs.test.ts` 只覆盖 settings/motion/env 三文件，本测试补测 scene/library/diagnostic 剩余三文件（原低覆盖/0% 文件拉高），测试结构同构于 `action-defs.test.ts`（注册→getAction→execute 全链路），二者合计覆盖 `core/action-defs/` 全部 6 文件。 |

**总体结论：✅ 通过**（无 P1/P2；生产代码 0 处 `as any`/`@ts-ignore`，测试 13 用例全绿）

## 亮点

- **全链路真实行为验证，非 mock execute 本身**：测试走 `registerXxxActions() → getAction(id) → execute({})` 真实链路，仅 mock 桥与状态叶子（`action-defs-extra.test.ts:67-82`、`:134-152`），断言落在 execute 的**转发参数**（`toHaveBeenLastCalledWith(type)`）与**结构化返回**（`toEqual({ data: {...} })` 全字段比对），而非桩函数返回值——断言有效性高。
- **vi.hoisted 共享 mock 符合测试卫生铁律**：`vi.mock` 工厂只引用 hoisted 绑定（`:7-44`），无 TDZ 风险；9 个外部模块（两个 bridge / feedback / config / error-buffer / scene-snapshot / state / scene-state / Wails bindings）全部静态替换，被测模块消费面（单符号）与 mock 形状完全对齐。
- **桥设计（ADR-238）显著降低测试成本**：`scene-actions.ts:16` `getUiAction('screenshotCurrent')?.()` 与 `diagnostic-actions.ts:69` 惰性 `makeLazyLoader` 动态 import bindings，使 core/action-defs 与 scene/menus/Wails 运行时解耦，测试只需 1 行 mock 即可替换整条依赖链。
- **执行器兜底完整**：`action-executor.ts:47-60` 对 `def.execute` 统一 try/catch（失败 → `success:false` + `translateGoError`），`action-executor.ts:27-45` 对非 optional 参数做必填校验——`library-actions-def.ts:43` 的 `p.type as string` 与 `diagnostic-actions.ts:70-71` 的 `as string`/`as number` 有执行器层的 enum/range 校验兜底，窄断言无运行时风险。
- **测试边界覆盖充分**：未注册桥兜底（`scene-actions.test.ts:84-95` 无快照、`:112-127` 空列表）、null 兜底（getBackendLogs null→`[]`、getBackendState null→`{}`、getSceneSnapshot null→error 文案）、参数默认值归一化（`getBackendLogs` 无参→`('', 50)`，`:281`）、过滤行为（vmd 被过滤 `:220`）、空库（`:223-229`）、元数据标志（`uiOnly: true`，`:151`）。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | — | — | 无 | — |
| 🟡 P3 | `scene-actions.ts` | 57-60 | `restoreUndoSnapshot` 返回 false（恢复失败）时仅 `if (ok)` 静默，无失败反馈——UX「反馈缺失」（执行成功但用户无感知） | 补 `else feedbackStatus('scene.undoFailed', undefined, false)` 失败分支；同时测试补一条「restore 返回 false 不调 feedbackInfo」断言 |
| 🟡 P3 | `diagnostic-actions.ts` | 31 | 硬编码中文 `'场景未初始化'`，与同文件其余 label 走 i18n key（`ai.actions.diagnostic.*`）的模式不一致，多语言场景会露原文 | 抽 i18n key（如 `diagnostic.sceneNotInitialized`），测试断言同步改为校验 key 存在 |
| 🟡 P3 | `scene-actions.ts` | 8-42 | 3 个转发动作（screenshot:current / screenshot:batch / scene:save）为同构样板（id/label/icon/params/destructive/execute 六字段重复模式），`env-actions.ts:13-25` 已有 `registerBindAction` 抽 helper 先例，此处未复用 | 抽 `registerForwardAction(id, label, icon, uiKey)` helper（对齐 env-actions 样板消除先例），测试保持全绿即安全网 |
| 🟡 P3 | `action-defs-extra.test.ts` | 34 / 39 / 40 | `@/core/config`、`@/core/state`、`@/core/scene-state` 均为 god-barrel/barrel，mock 采用完整静态替换、未按 AGENTS.md 铁律 `...(await importOriginal())` spread；当前被测文件只消费 `allModels`/`envState`/`modelRegistry` 单符号故自洽，但未来被测文件新增同 barrel 符号 import 会**静默 undefined** | 保持单符号消费面或改用 importOriginal spread；至少在文件头注释标注「mock 形状与被测消费面强耦合」 |
| 🟢 P4 | `diagnostic-actions.ts` | 71 | `?? 50` limit 默认值为魔法数值，与 params `range max: 200`（`:65`）无关联常量 | 提常量 `const DEFAULT_LOG_LIMIT = 50`，与 range 上限同文件可见 |
| 🟢 P4 | `library-actions-def.ts` | 42 | `execute` 声明 `async` 但函数体无 `await`（`setModelFormation` 同步转发）——冗余异步标记，可能误导调用方以为可中断 | 去掉 `async`（返回 void 与 ActionDef 签名兼容） |
| 🟢 P4 | `action-defs-extra.test.ts` | 86-88 | `name === 'popUndoSnapshot' ? undefined : undefined` 双分支返回相同值（恒等 undefined），写法冗余且误导读者以为有分支逻辑 | 简化为 `shared.getSceneAction.mockReturnValue(undefined)` |
| 🟢 P4 | `action-defs-extra.test.ts` | — | 未覆盖 `scene:undo` restore 返回 false 分支、`library:set-formation` 缺 type 参数（直接 `execute({})`）两处边界；前者对应源码 P3 静默路径，后者生产侧已有执行器必填校验拦截，风险低 | 优先补 restore-false 用例（与源码修复配套）；type 缺失用例可加可不加 |

## 测试质量评价

- **结构与同构性**：与 `action-defs.test.ts`（settings/motion/env）完全同构——同一 `vi.hoisted` 共享 mock + `_resetActionRegistry()` 重置 + 注册→getAction→execute 断言模式，两份测试合起来覆盖 `core/action-defs/` 6/6 文件，无重复断言、无跨文件状态泄漏。
- **mock 合理性**：9 个 vi.mock 全部是「被测模块 import 面的最小超集」——`@/core/config` 只出 `allModels`（被测只消费它）、`@/core/state` 只出 `envState`、bindings 只出 `AiGetBackendLogs`/`AiGetBackendState`，与真实符号名逐一核对一致（`library-state.ts:29`、`state.ts:27`、`scene-state.ts:43`、`bindings/.../app.ts:61,68`）。beforeEach 重置完整（registry + mocks + allModels 数组 + modelRegistry Map + envState 三字段），用例间无泄漏。
- **断言有效性**：关键链路断言为参数精确匹配（`toHaveBeenCalledWith('', 50)` / `('warn', 100)`、`toHaveBeenLastCalledWith(type)`）与返回结构全字段 `toEqual`（getFrontendState 5 字段、list 投影 8 字段），能捕捉「转发键写错 / 投影字段漏写 / 默认值漂移」类回归；`not.toHaveBeenCalledWith('restoreUndoSnapshot', ...)` 验证了「无快照不调 restore」分支。
- **边界覆盖**：无跳过/待办用例（grep 无 `.skip`/`.todo`）；null/undefined 兜底、空库、过滤、默认值四类边界均有独立用例。
- **验证结果**：`npm run test -- src/__tests__/action-defs-extra.test.ts` → 13 passed（70ms）；`npm run check`（tsc --noEmit + lint 链）exit 0，mock 形状无类型问题。项目基线保持全绿。

## 附：符号核实

- 测试断言键与源码一一对应：`scene.statusNoUndo`/`scene.undoApplied`（scene-actions.ts:54,59）、`scene.formationStatus.<type>` 动态拼接（library-actions-def.ts:44）、`AiGetBackendLogs(level, limit)`（diagnostic-actions.ts:72）——全部经 `docs/function-map.md`/grep 核实为真实符号，无悬空 key。
- 环境状态字段 `lightingPresetName`/`groundVisibleEnabled`/`skyMode` 为 `EnvState`（`core/types.ts:544`，schema 推导）成员，测试 mock 的普通对象形状一致（生产侧 `reactive` 包装不影响读取）。

---
审核日期：2026-08-15
审核员：子代理 round27-action-defs-extra
