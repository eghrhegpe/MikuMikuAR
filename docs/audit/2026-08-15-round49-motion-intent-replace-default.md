# 审核报告：motion-intent-replace-default 测试 + replaceDefaultMotion（round-49 / 测试 2/3）

## 审核范围

| 项 | 内容 |
|---|---|
| 测试文件 | `frontend/src/__tests__/scene/motion-intent-replace-default.test.ts`（139 行，6 用例） |
| 被测源码 | `frontend/src/scene/motion/motion-intent.ts`：`replaceDefaultMotion` :235-270（核心）、`addSceneMotion` :138-152、`setDefaultMotion` :178-183、`clearAllSceneMotions` :189-195，辅助 `getActiveMotion` :32-37 / `getSceneMotions` :40-42 / `getActiveMotionId` :45-47 / `getMotionGen` :50-52 / `setBroadcastCallback` :121-127；类型依赖 `frontend/src/core/types.ts:134-146`（`SceneMotionIntent`，纯类型导入） |
| 设计依据 | `docs/adr/adr-169-motion-load-replace-default.md`（已实施，P0 验收：单测覆盖四象限） |
| 测试运行 | `npm run test -- src/__tests__/scene/motion-intent-replace-default.test.ts` → **6/6 通过**（238ms，vitest 4.1.9） |
| 类型检查 | `npm run check` → **通过**（tsc --noEmit + lint，EXITCODE=0，基线全绿） |

### 与历轮审核的关系（任务要求注明）

- **round-11**（2026-08-06）审过 motion-intent（history/retargeter），登记 P3：`getSceneMotions` 返回内部可变引用（L40-42）、`addSceneMotion` 不校验重复 id。**本测试范围（库管理 API + 广播）与 round-11 重叠面内，该两项仍遗留**（见风险表沿用项）。
- **round-31**（2026-08-15）审过 motion-intent-ratio-guards（`resolveCompatibility` :331-361），登记 P3：`Number.isFinite` 守卫不可达空真断言、桥注册 `as unknown as` 边界用法（ADR-238）。`resolveCompatibility` **不在本测试范围**（无骨骼兼容断言），round-31 结论沿用。
- **本测试（round-49）** 是 ADR-169「P0：新增 replaceDefaultMotion 单测」的点名补测，覆盖「装载即替换默认」语义，与 round-11（库 API 通用健康）、round-31（兼容性解析）**互补不重叠**。

## 总体结论：✅ 通过

6/6 测试全绿、`npm run check` 全绿；四象限（有默认/无默认/空库/路径已存在）+ 两个额外边界全部真实断言；无 P1/P2 风险。3 项 P3/P4 为沿用项或测试补充建议，不影响通过。

## 亮点

- **原子广播一次性递增，测试真实验证**：`replaceDefaultMotion` 单次 `_motionGen++`（motion-intent.ts:267）+ 单次广播（:268），`prev` 快照在变更前取得（:240），「移除旧默认 → 原位插入/复用新动作 → 设默认 → 广播」在一次 generation 递增内完成，中间态不会被并发广播读到（ADR-169 原子性验收点）。测试用例 6（test:128-138）用 `getMotionGen() === g0 + 1` + `toHaveBeenCalledTimes(1)` 双断言真实钉住原子性，非占位断言。
- **原位插入保持库顺序稳定**：新动作经 `findIndex(prevId)` + `filter` + `splice(idx, 0, withId)` 插入旧默认原位置（motion-intent.ts:256-263）；测试用例 1 用 `expect(paths()).toEqual(['a.vmd','d.vmd','c.vmd'])` 精确数组断言钉住「D 顶替 B 的位置」语义（test:65）。
- **去重复用语义完整**：装载路径已是库中候选时复用其 id、仅移除旧默认（motion-intent.ts:247-252）；测试用例 2 断言 `newId === a`（复用）+ `['a.vmd']`（B 移除）（test:84-88）。
- **空 vmdPath 拒绝装载守卫**：`!intent.vmdPath` 直接返回 `''`（motion-intent.ts:237-239），防止 `!mmdRuntime` 占位路径（`vmdPath: null`）污染场景库——ADR-169「占位路径迁移」的落地防线。
- **测试隔离严谨**：beforeEach 按「先 `setBroadcastCallback(null)` 再 `clearAllSceneMotions()` 再设新 spy」顺序清理（test:44-50），并有注释说明「先摘回调再清库，避免清库广播打到上一个用例的 spy」——这是对本文件依赖的真实广播副作用的正确防护，非模板化样板。
- **helper 简洁表达语义**：`intent()`/`add()`/`paths()`（test:27-39）消除重复构造，`paths()` 返回 vmdPath 序列使断言直接表达「顺序/原位」语义，可读性高。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|---|---|---|---|---|
| 🟡 P3 | 生产 | motion-intent.ts:237-239 | vmdPath 空守卫（`return ''`）分支**无测试覆盖**：6 用例全部传非空 vmdPath，若该守卫回归（误删/放宽），ADR-169 防占位污染防线失效而测试不报警 | 补 1 个用例：`replaceDefaultMotion({vmdPath:null,...})` → 返回 `''` 且库/默认/gen/广播均不变 |
| 🟡 P3（沿用 round-11） | 生产 | motion-intent.ts:244 | `existing` 仅按 `vmdPath` 匹配取第一个：`addSceneMotion` 不阻止同路径重复添加（round-11 P3 已登记），库中同路径多条目时复用行为不确定（取哪个、旧默认删哪个） | 在 `addSceneMotion` 加同路径去重，或 `replaceDefaultMotion` 明确「复用最后一个/全部同路径」策略并补多条目用例 |
| 🟢 P4 | 生产 | motion-intent.ts:254 | `intent.id ?? genMotionId()` 显式 id 分支未覆盖：若调用方传入已在库中的 id 且 vmdPath 不同 → 产生重复 id（与 round-11「addSceneMotion 不校验重复 id」同源） | 补一个带显式 id 的用例钉住该分支；重复 id 校验可并入 round-11 项一并处理 |
| 🟢 P4（沿用 round-11） | 生产 | motion-intent.ts:40-42 | `getSceneMotions` 返回内部可变引用（round-11 P3 已登记，未修）：本测试 `paths()` 仅读取不改写，但生产调用方（序列化/菜单）可直接原地改库绕过 API | 返回浅拷贝 `[..._sceneMotions]` |
| 🟢 P4 | 测试 | motion-intent-replace-default.test.ts:20-24 | `BroadcastCb` 为手写复刻 motion-intent 内部回调签名，若生产签名漂移测试不报错（弱耦合，双份定义） | 从生产模块导出回调类型供测试 import，或接受为低风险复制 |
| 🟢 P4（沿用 round-31） | 生产 | motion-intent.ts:364-378 | import 触发模块级 `registerSceneAction`×8 副作用，node 测试环境下无害（round-31 已登记） | 仅记录备查 |

## 测试质量评价

- **断言有效性：高。** 四象限逐一对应 ADR-169 验收表（test:54-111）：用例 1（有默认+新路径）同时断言原位顺序、新默认 id、旧默认物理移除（`find(...) === undefined`）、广播恰好一次、gen+1、prev=旧默认——全链路真实钉住，无占位断言；用例 2 断言 id 复用而非仅路径；用例 3/4 验证无默认分支的 push 语义。用例 5（装载路径即当前默认）验证「不误删」边界——防的是 `existing` 命中默认自身时误执行 `filter(prevId)` 的回归。用例 6 直击原子性验收点。
- **边界覆盖：良好，两处可补。** 已覆盖：四象限 + 去重复用 + 原位顺序 + 不误删 + 原子广播。未覆盖：空 vmdPath 守卫（P3，见风险表）、显式 `intent.id` 分支（P4）。
- **隔离与卫生：优。** `@vitest-environment node` 选择正确（被测函数无 DOM 依赖）；beforeEach 清理顺序防跨用例广播泄漏；无 `.skip`/`.only`/`.todo`。
- **验证结果：** 6/6 通过（238ms）；`npm run check` 全绿，无新增类型错误。

---

- 审核日期：2026-08-15
- 审核员：子代理 round49-motion-intent-replace-default
