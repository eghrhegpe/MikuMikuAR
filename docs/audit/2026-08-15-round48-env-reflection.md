# 第 48 轮审核 · 测试 1/3 — env-reflection 修复回归

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/scene/env-reflection.test.ts`（106 行） |
| 被测源码 | `frontend/src/scene/env/env-reflection.ts` 纯函数层：`resolveReflectionMode`（L130-142）、`setReflectionARSuspended`（L149-166）、`getPlanarQualityOverride`（L184-200）、`disposeReflection`（L574-593） |
| 相关调用点 | `ar-scene.ts` L194/L225（AR 进入/退出挂起与恢复）、`env-ground.ts` L641-659 与 `env-water-reflect.ts` L24-40（getQuality 消费 override）、`scene.ts` L324/L828（disposeReflection 级联） |
| 验证结果 | `npm run test -- src/__tests__/scene/env-reflection.test.ts`：**8/8 通过**（4ms）；`npm run check`：**exit 0**（tsc + boolean-naming + i18n parity 全绿） |

**与既往审核的关系**：round-9 审过镜面反射（env-water/env-ground planar 反射）；ADR-151 审过反射统一架构（`applyReflection` 单入口 + `reflectionMode`/`reflectionQuality` 收口，即本文件核心设计）；round-47 审过 planar-reflection 统一平面反射引擎。**本测试是 ADR-151 修复的回归测试**：P2（非 planar + `reflectionQuality='off'` 时保底 low）、P3（AR 模式纯派生挂起 `setReflectionARSuspended`）、P3(code_review)（`disposeReflection` 重置 `_arSuspended`），并覆盖 `getPlanarQualityOverride` 与 `resolveReflectionMode` 纯函数契约。

## 总体结论

**✅ 通过** — 无 P1/P2 风险。测试对 P2 保底、AR 挂起/恢复、dispose 重置三条修复链路做了真实双向断言，回归有效性高；生产纯函数层职责单一、防御完备、资源复位完整。仅 1 项建议性 P3（非法枚举兜底分支无测试覆盖）与若干 P4。

---

## 亮点

| 模式 | 位置 | 说明 |
|------|------|------|
| 纯函数层与 Babylon 场景解耦 | test L10-14 | `vi.mock('../../scene/env/_shared/env-context')` 只 mock `getScene: () => null`，使 `disposeReflection` 走 null-safe else 分支，无需真实 Scene 实例。经 grep 核实 `renderer.ts` 不 import env-context，mock 无传递副作用 ✅ |
| 用例状态隔离 | test L70-73 | `beforeEach` 复位模块级派生标志 `_arSuspended`，配合 vitest 每文件 isolate，无跨用例/跨文件状态泄漏 ✅ |
| P2 修复双向断言 | test L50-66 | `['ssr','probe','hybrid'] as const` 循环断言 `off→low`（防"静默关闭"回归），同时 `high→null` 对照断言（防过度修复、遵循用户显式设置）——双向护栏 ✅ |
| dispose 重置"前后断言" | test L98-105 | 先断言挂起生效（`hybrid→none`），`disposeReflection()` 后断言恢复（`→hybrid`）：若 `_arSuspended` 未重置，末断言必失败，回归验证有效 ✅ |
| 派生覆盖不改写用户值 | env-reflection.ts L130-142 + test L81-90 | AR 挂起为纯派生覆盖（`_arSuspended` 标志），恢复后回到用户 `reflectionMode`，无状态泄漏与回滚遗漏；测试专门验证"恢复后仍为 hybrid" ✅ |
| 幂等守卫 + 异常隔离 | env-reflection.ts L149-166 | `setReflectionARSuspended` 同值早退空操作（测试 L92-96 验证不抛错）；`applyReflection(envState)` 包 try/catch + logWarn，scene 未初始化时不崩溃 ✅ |
| dispose 完整状态复位 | env-reflection.ts L574-593 | 复位 `_currentMode`/`_probeStrength`/`_probeCreateFailed`/`_arSuspended` 并清理三张 map（`_savedReflectionTextures`/`_savedReflectionColors`/`_probeBoundMaterials`），场景重建后反射不会静默关闭 ✅ |
| 非法枚举白名单防御 | env-reflection.ts L136-140 | `VALID_REFLECTION_MODES` 断言，旧存档残留 `auto` 等非法值兜底 `planar`，消除零反射静默 no-op（ADR-151 Rev2 P3 落地）✅ |
| dispose 早退清理颜色映射 | env-reflection.ts L230-237 | `_restoreOriginalTexture` 的 isDisposed 早退路径同步删除 `_savedReflectionColors` 条目，消除小内存泄漏 ✅ |

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | — | — | 无 | 无 |
| 🟡 P3 | `env-reflection.test.ts` | 缺失用例（对照 L32-67） | `resolveReflectionMode` 的非法枚举兜底分支（`VALID_REFLECTION_MODES` 未命中 → `planar`，env-reflection.ts L138-140）无任何测试覆盖——grep 全测试目录确认本文件是唯一测试该函数者，却只覆盖 AR 派生与合法值路径；该防御是 ADR-151 Rev2 的 P3 落地项，属核心不变量，回归风险真实存在 | 补一条：`resolveReflectionMode(baseState({ reflectionMode: 'auto' as EnvState['reflectionMode'] })).toBe('planar')`，并联动断言 `getPlanarQualityOverride` 同态返回 `'low'` |
| 🟢 P4 | `env-reflection.test.ts` L7/L98 vs `env-reflection.ts` L586 | 注释编号不一致 | 同一次修复（disposeReflection 重置 `_arSuspended`）测试侧标 "P3(code_review)"、源码注释标 "[fix P2]"，编号漂移会造成追溯混乱 | 统一编号（以 ADR/审查记录为准），或去掉编号只保留语义描述 |
| 🟢 P4 | `env-reflection.test.ts` L23-30 | `baseState` | `{ ...overrides } as EnvState` 对部分对象强转，是测试侧类型谎言（缺其余字段）；且恒设 `reflectionQuality`，导致 `getPlanarQualityOverride` 的 `?? 'off'` 默认分支（L195）与 `medium→null` 分支无覆盖 | 用完整默认对象或 `satisfies`；补 `reflectionQuality: undefined` 与 `'medium'` 两条断言 |
| 🟢 P4 | `env-reflection.ts` L574-593 | `disposeReflection` 复位清单 | 未复位 `_lastProbeMeshSignature`（L93）：场景重建后首次 Probe 自动刷新（10s 间隔）会因签名与旧会话不同触发一次无谓 renderList 重建。功能无害（`_createProbe` 已重建 renderList），但状态复位不完整 | 与 `_lastProbeMeshCount`/`_lastProbeRefresh` 一并复位，保持复位清单对称 |
| 🟢 P4 | `env-reflection.ts` L292/L543/L114-126 | 魔法数值 | `10000`ms 刷新间隔、`0.01` 强度 epsilon、hybrid 衰减因子 `0.3/0.4/0.5` 为内联魔法数（`PROBE_REFRESH_MIN_FPS` 已命名，同类未完全贯彻） | 提取为命名常量，与 `PROBE_REFRESH_MIN_FPS` 对齐 |
| 🟢 P4 | `env-reflection.ts` L344/L352-356/L550-554 | 类型 | 材质鸭子类型双重 cast `as unknown as MaterialWithReflection` / `{ reflectionColor: ... }` 重复 3 处（非 `as any`，合规，但模式重复） | 提取类型守卫/断言函数单点收敛 |
| 🟢 P4 | `env-reflection.test.ts` L10-14 | mock 行为差异 | mock `getScene` 返回 `null`，而真实 `getScene` 未初始化时 **throw**——`setReflectionARSuspended` 的 try/catch + logWarn 抛错路径（L157-165）未被覆盖。纯函数层测试的合理取舍，仅记录 | 如需覆盖，可另设 mock 为 throw 的用例验证 logWarn 兜底 |

---

## 测试质量评价

- **断言有效性**：8 个用例全部对目标行为做真实断言（无空断言、无"只调用不验证"）。P2 保底 low 与 `high→null` 双向验证防过度修复；AR 挂起→恢复→dispose 重置形成完整状态链路验证；dispose 用例的前后断言使其成为有效回归护栏。
- **mock 合理性**：只 mock env-reflection 对 env-context 的唯一使用点 `getScene`，`renderer.ts` 经 grep 确认不依赖 env-context，无过度 mock 副作用；node 环境显式声明（`@vitest-environment node`），模块级副作用（`registerEnvCallback` 注册 + `envState` import）运行稳定（4ms）。
- **边界覆盖**：quality 档位覆盖 off/low/high，缺 medium 与 undefined 默认分支；AR 恢复与幂等重复设置已覆盖；重复 `disposeReflection` 未显式覆盖（null 路径 safeDispose 天然安全，风险低）。
- **无跳过测试**：全文件无 `.skip`/`.todo`。
- **类型安全**：生产代码本文件范围 0 处新增 `as any`/`@ts-ignore`（既有双重 cast 非本轮引入）；测试侧 `as EnvState` 强转可接受。

---

- **审核日期**：2026-08-15
- **审核员**：子代理 round48-env-reflection
