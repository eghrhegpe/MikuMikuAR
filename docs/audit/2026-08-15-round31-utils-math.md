# round31-utils-math — 审核结果

> 审核轮次：第 31 轮 · 测试 2/3（仅审本目标，不涉及锁外文件）

**审核范围：**

| 角色 | 文件 | 范围 |
|------|------|------|
| 测试文件 | `frontend/src/__tests__/utils.math.test.ts` | 全文件 169 行 / 28 用例（ADR-101 P3 纯数学工具） |
| 被测源码 | `frontend/src/core/clamp.ts` | 全文件 31 行：`clamp`(6-8) / `clampInt`(10-12) / `clamp01`(14-16) / `lerp`(19-21) / `lerpArray`(24-26) / `clampPct`(29-31) |
| 被测源码 | `frontend/src/core/math-geometry.ts` | 全文件 31 行：`dist2d`(6-10) / `dist3d`(13-21) / `degToRad`(24-26) / `radToDeg`(29-31) |

**关联关系说明：** round-15（`2026-08-07-round15-core-tools-config-i18n.md`）已审过 `core/clamp.ts` ✅（结论通过，风险表第 3 条 = P3「`lerpArray` 不校验长度，b 较短时 `b[i]` 为 undefined → NaN」，建议 console.warn 或文档说明）；`math-geometry.ts` **此前未专门审过**（round-15 仅在其 config-barrel 知识卡中顺带提及「config.ts 聚合 math-geometry」），本轮为 math-geometry 首次专门审核。两文件同源于 ADR-101 P3（`clampPct`/`dist2d`/`dist3d`/`degToRad`/`radToDeg` 原规划入 `core/utils.ts`），ADR-191 去桶化后拆为 `clamp.ts`（ADR-190 收敛产物）与 `math-geometry.ts` 两个零依赖叶子。

**总体结论：⚠️ 有条件通过**

生产代码健康：两文件均为单行纯函数、零依赖叶子、零 `as any`/`@ts-ignore`，无循环依赖、无魔法数值、无资源/状态问题。测试 28/28 全绿（Vitest 4.1.9，1.52s），断言全部指向真实数学值（3-4-5 三角形、0/90/180/360 角度、t=0/0.5/1 插值），非形式断言。有条件通过的理由：**2 个 P3** —— ① round-15 已标注的 `lerpArray` 长度不匹配 NaN 风险延续至今，生产未修且测试未钉死；② 全文件 NaN/Infinity 零覆盖，与项目其他模块已建立的 NaN 防护意识形成反差。另 2 个 P4（math-geometry 死代码/ADR 迁移未落地、lo>hi 宽松断言）。无 P1/P2。

---

**亮点：**

- **零依赖叶子纪律到位**（`clamp.ts:1-4`、`math-geometry.ts:1-3`）：两文件注释头自证 ADR-190/191 合规——神桶 `@/core/utils` 已删除，纯几何/物理模块直接引具体叶，杜绝 vitest fork 下整桶加载挂起（EXIT=124）的历史坑。`grep` 全仓确认无 `@/core/utils` 桶导入。
- **纯函数职责单一**：6 + 4 个导出全部为单行无副作用实现（`clamp.ts:6-31`、`math-geometry.ts:6-31`），无状态、无 IO、无隐藏依赖，类型安全零压制。
- **断言真实有效**：`utils.math.test.ts:20` 3-4-5 三角形 `dist2d=5`、`:34` 1-2-2 `dist3d=3`、`:45-47` 90/180/360 度、`:84-86` t=0/0.5/1、`:101` 逐元素插值 `[5,10,15]`——均为手算可验证的真实数学值，不是镜像实现的伪断言；round-trip 用例（`:71-79`）验证 deg↔rad 互逆无损失，是这类转换最该有的性质测试。
- **边界覆盖扎实**：clamp 双向越界/负区间/`lo===hi`/`lo>hi` 不崩溃（`:139-168`）、clampInt 舍入双向（`:126-128`）、clampPct 端点 0/100（`:9-15`）、clamp01 端点 0/1（`:115-121`）、角度正负双象限（`:50-53, :64-67`）、lerp 外推与负区间（`:89-96`）。
- **测试卫生**：`// @vitest-environment node`（`:1`）纯环境无 window 依赖、无 window 篡改（符合 ADR-219）；零跳过用例（无 `it.skip`/`describe.skip`/`xit`）；`grep` 全仓确认该测试文件是 clamp/math-geometry 的唯一 owner，无跨文件重复覆盖。

---

**风险：**

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟡 P3 | `frontend/src/__tests__/utils.math.test.ts` | `lerpArray` describe（99-112） | **round-15 风险延续**：round-15 已标注 `clamp.ts:24-26` 不校验 `a.length === b.length`，b 较短时 `b[i]` 为 undefined → `lerp(v, undefined, t)` 返回 NaN 静默污染。生产未修（round-15 定性"调用方负责"），本轮测试也**无任何长度不匹配用例**——该 NaN 路径既无守卫也无行为锁定，风险从 round-15 原样延续。 | 补 `lerpArray([0,1],[10],0.5)` 长度不匹配用例钉死现状行为（NaN）；或按 round-15 建议在 `clamp.ts` 加守卫（长度不等时 warn 或按 min 长度截断），改后更新测试。 |
| 🟡 P3 | `frontend/src/__tests__/utils.math.test.ts` | 全文件（28 用例） | **NaN/Infinity 零覆盖**：`clamp(NaN,0,10)=NaN`、`clamp01(NaN)=NaN`、`degToRad(NaN)=NaN`、`dist2d` NaN 坐标 → NaN 均静默传播。与项目已建立的 NaN 防护闭环（`material.ts:102-113` NaN 跳过写入、`lipsync.ts:83-95` amplitudeToWeight 显式守卫）形成反差——业务层防 NaN 防得严，纯工具层反而裸奔；round-25 P4 已指出 `clamp01(NaN)` 返回 NaN 而非 0。 | 补 NaN/±Infinity 用例；若产品语义要求 NaN 输入回落 0（参考 rgbString Infinity→0 的 round-27 结论），在 clamp 系列入口加 `Number.isFinite` 守卫并钉死，否则在 JSDoc 明确「NaN 输入输出 NaN，调用方负责」。 |
| 🟢 P4 | `frontend/src/core/math-geometry.ts` | 全文件（4 导出） | **死代码 + ADR 迁移未落地**：全仓 grep 确认 `dist2d`/`dist3d`/`degToRad`/`radToDeg` 生产消费者为零（仅测试文件与 `config.ts:18` barrel re-export 引用）；而 `orbit.ts:66-67`、`lighting-stage.ts:440-442`、`bone-override.ts:453`、`perception-shared.ts:474`、`env-wind-levels.ts:25` 等 ~8 处同构 rad↔deg 内联仍在生产。ADR-101 §4.4 声称「迁移 50+ 处数学/数据操作」对这四个函数未落地，`docs/function-map.md:375-378` 却将其列为规范入口。 | 迁移上述内联站点到 `radToDeg`/`degToRad`（注意 atan2 结果转角度类站点可直接复用），或回写 ADR-101 迁移状态；避免「库函数死代码 + 生产内联残留」并存。 |
| 🟢 P4 | `frontend/src/__tests__/utils.math.test.ts` | 163-167（`lo > hi` 用例） | **宽松断言掩盖未定义语义**：当前实现 `clamp(5,10,0)=Math.min(0,Math.max(10,5))=0`，断言只验结果 ∈ [0,10]；若未来实现改为 `Math.max(lo, Math.min(hi, v))` 顺序（结果为 10），测试仍通过——`lo>hi` 的实际语义（取 lo 还是取 hi）未被钉死，测试仅保证"不崩溃"。 | 若 `lo>hi` 为未定义输入，在 JSDoc 声明并在用例加注释；若定义语义（如回退取 lo），断言钉死具体值。 |

---

**测试质量评价：**

- **断言有效性 — ✅ 优秀**：28 个用例全部断言真实数学值，无镜像实现伪断言。`dist2d`/`dist3d` 用勾股三元组（3-4-5、1-2-2）验证，角度转换用已知弧度值 + 双向 round-trip，插值用 t=0/0.5/1 端点与中点，全部手算可复核。
- **边界覆盖 — ✅ 良好**：clamp 家族覆盖双向越界、负值、负区间、`lo===hi`、`lo>hi` 崩溃防线；clampInt 舍入双向（5.7→6、4.2→4）；clampPct/clamp01 端点锁死；角度正负象限齐全。
- **缺口 — ⬜ 2 处**：① `lerpArray` 长度不匹配零覆盖（与 round-15 P3 直接关联，见风险表）；② 全文件 NaN/Infinity 零覆盖。均为 P3，不阻断本次通过但建议下轮补齐。
- **无跳过、无重复 — ✅**：零 `skip`/`xit`；唯一 owner，无跨文件重复测试（符合 AGENTS.md 测试卫生）。
- **环境隔离 — ✅**：`@vitest-environment node` 纯环境，无全局污染。
- **验证记录**：`cd frontend && npm run test -- src/__tests__/utils.math.test.ts` → 28/28 passed（1.52s，Vitest 4.1.9）。`npm run check`（tsc 全量）按任务约定跳过——被测两文件为单行纯函数零依赖，tsc 风险极低，单文件测试已验证。

---

审核日期：2026-08-15
审核员：子代理 round31-utils-math
