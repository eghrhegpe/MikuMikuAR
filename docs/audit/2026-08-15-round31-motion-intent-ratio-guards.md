# 审核报告：motion-intent-ratio-guards 测试 + resolveCompatibility（round-31 / 测试 1/3）

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/motion-intent-ratio-guards.test.ts`（51 行，5 用例） |
| 被测源码 | `frontend/src/scene/motion/motion-intent.ts:331-361` `resolveCompatibility`（含依赖 `:274-275` 阈值常量、`:307-315` `countBoneMatches`、`@/motion-algos/proc-motion-shared.ts:295-308` `matchBone`） |
| 测试运行 | `npm run test -- src/__tests__/motion-intent-ratio-guards.test.ts` → **5/5 通过**（91ms，vitest 4.1.9） |
| 与 round-16 关系 | 本测试创建于 7d4c6019（2026-08-12，diff-coverage 补缺）；round-16 提交 d4deea76 修复其 TS2353（`kind` → `source` 并补齐 `vmdName`/`vmdLayers`），`npm run check` 恢复全绿。本次为类型修复后首次专门审核：**修复正确且完整**（见下）。 |

## 总体结论

✅ **通过**

被测函数 `resolveCompatibility` 为无状态纯函数，分支守卫完备（intent=null / 空骨骼 / 空 vmdBoneNames 三前置 + 两级匹配），阈值常量具名无魔法数值；测试文件 5 个用例覆盖了函数 6 个返回路径中的 5 个，断言与源码行为逐一核对相符，运行全绿。round-16 的 TS2353 修复（`kind`→`source` + 补必填字段）与 `SceneMotionIntent`（`core/types.ts:134-146`）必填字段完全对齐，修复无残留。

**唯一实质问题（P3，不阻断）**：`Number.isFinite` 兜底守卫经公开 API **不可达**——分支条件已保证 `vmdBoneNames.length > 0`，`ratio = 整数/正整数` 恒为有限值；因此测试 1 的 `not.toContain('Infinity'/'NaN')` 属"空真断言"，删除守卫也不会让测试失败，兜底测试名不副实。守卫本身是低成本的防御性死代码，保留无害，但建议注释澄清或评估删除。

## 亮点

- **纯函数直测，零 mock**：`resolveCompatibility` 无状态、无副作用（除 matchBone 边界 `logWarn`），`@vitest-environment node` 直 import 生产函数，不依赖 DOM/bridge 桩，测试即文档 — `motion-intent-ratio-guards.test.ts:1-6`、`motion-intent.ts:331-361`
- **阈值常量具名**：`MIN_STANDARD_BONE_MATCH = 3`、`MIN_VMD_BONE_MATCH_RATIO = 0.5` 为具名常量，0 处魔法数值 — `motion-intent.ts:274-275`
- **前置守卫完备**：`!intent` 直接兼容（:336-338）→ 空骨骼列表先于 vmd 分支判失败（:339-341）→ `vmdBoneNames` 空/缺走 STANDARD 分支（:342, :353），异常路径全部有明确 reason，无静默吞错
- **匹配逻辑复用去重**：`countBoneMatches` 一处实现，VMD 分支与 STANDARD 分支共用（:307-315 → :343, :353）
- **round-16 类型修复干净**：修复后测试字面量 `{ source: 'vmd', vmdPath, vmdName, vmdLayers }` 与 `SceneMotionIntent` 必填字段（`types.ts:137-140`）逐字段对齐；`kind` 本就不是该接口字段，改为 `source` 而非新增字段，方向正确 — `d4deea76` diff、`types.ts:134-146`
- **测试覆盖率高**：6 个返回路径覆盖 5 个（见测试质量小节矩阵），且 `'33%'` 断言真实钉住 `toFixed(0)` 格式与 2/6 命中率计算，非占位断言 — `motion-intent-ratio-guards.test.ts:16`

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `motion-intent.ts:350` | `Number.isFinite(ratio)` 守卫不可达：VMD 分支条件 `vmdBoneNames.length > 0`（:342）保证 `ratio = 整数/正整数` 恒有限；commit 37b82590 提交信息所述"vmdBoneNames 为空时 ratio=Infinity"场景在改动前后均已被分支条件排除 | 守卫处补注释说明其为对未来重构（如分支条件放宽）的防御性保护；或确认死代码后删除。测试侧需知晓该断言是空真断言（见下行） |
| 🟡 P3 | `motion-intent-ratio-guards.test.ts:17-18` | 测试 1 的 `not.toContain('Infinity'/'NaN')` 为空真断言：ratio 恒有限，即使删除 `Number.isFinite` 守卫测试仍通过，无法真正兜底该守卫 | 接受为"格式回归锚点"并改注释说明；若要真实验证守卫，需重构函数暴露可注入 divisor 的路径（成本高，不建议仅为测试），否则明确标注该断言为防御性格式检查 |
| 🟡 P3 | `motion-intent-ratio-guards.test.ts:46-50` | 测试 5 标题声明"reason 不含 Infinity/NaN"，但断言仅查 `toContain('无骨骼数据')`，标题与断言不一致（且该路径在 ratio 计算前提前返回，Infinity 本不可能出现） | 标题改为"reason 返回无骨骼数据提示"，或补齐 `not.toContain` 断言与标题对齐 |
| 🟢 P4 | `motion-intent.ts:353-360` | STANDARD 分支成功路径（`matched >= 3` → `compatible: true`）未被任何真实函数测试覆盖——`model-loader.test.ts:327-571` 对 `resolveCompatibility` 全部走 bridge mock | 补一个 ≥3 个标准骨骼命中（如含 `頭/首/腰/両目`）→ `compatible=true` 的用例，闭合 6/6 返回路径 |
| 🟢 P4 | `motion-intent-ratio-guards.test.ts:16` | `'33%'` 硬编码耦合 2/6 命中与 `toFixed(0)` 舍入：若 vmdBoneNames 候选列表或阈值调整则脆弱；命中率恰为 0.5 的阈值边界（`>=` 语义）未被钉住 | 保持为格式锚点可接受；如需钉边界可补 `ratio === 0.5`（如 3/6 命中）用例 |
| 🟢 P4 | `motion-intent.ts:377-378` | 动作桥注册处 `bones as string[]` / `opts as unknown as` 桥边界断言（既有代码，非本轮新增，非 `as any`/`@ts-ignore`，为 ADR-238 桥接的合理边界用法） | 仅记录，无需处理 |

## 测试质量评价

**断言有效性**：整体有效。`compatible` 布尔断言与源码各返回路径逐一核对一致（含"模型无骨骼数据"文案、`33%` 百分比格式、`reason` 未定义语义）；测试 2 用 6/6 全命中验证高命中分支，测试 1 用 2/6 低命中验证低命中分支，数值计算正确（`2/6 = 33.33% → toFixed(0) = '33'`）。**例外**：Infinity/NaN 断言为空真断言（见 P3-2），测试标题"验证新增的 Number.isFinite 守卫"言过其实。

**边界覆盖**：`intent=null`（:41-44）、空 `actualBones`（:46-50）、空 `vmdBoneNames` 走 STANDARD 分支（:31-39）、低命中/高命中（:9-29）五个边界均有覆盖；缺 STANDARD 成功路径与 `ratio === 0.5` 精确阈值（均为 P4）。51 行小文件 5 用例的密度合理，无跳过（无 `it.skip`/`describe.skip`），无 `as any`。

**环境与隔离**：`@vitest-environment node` 选择正确——被测函数及其依赖（`matchBone`/`canEncodeName`/`logWarn`/`scene-action-bridge`）均无 DOM 依赖，比 happy-dom 更轻量。唯一注意点：import `motion-intent` 会触发模块级 `registerSceneAction`×8 副作用（`motion-intent.ts:364-378`，ADR-238 设计），在 node 测试环境下无害，但属于"非纯 import"，若未来该 bridge 注册在测试环境抛错会波及本文件——风险极低，记录备查。

**与 round-16 关系结论**：TS2353 根因是测试字面量使用不存在的 `kind` 字段 + 缺少必填 `vmdName`/`vmdLayers`；d4deea76 修复方向正确、补全字段完整、未触碰生产逻辑，验证后 `npm run check` 应保持全绿（本会话已跑测试 5/5 通过）。修复后的测试质量达到专项守卫测试应有的水准。

---

审核日期：2026-08-15
审核员：子代理 round31-motion-intent-ratio-guards
