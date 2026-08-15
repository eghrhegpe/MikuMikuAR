# Round 68 审核报告 — bone-override-store / env-ground-spec / env-particles

> 日期：2026-08-15
> 模式：继续队列第十二批，3 个子代理并行审计。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/scene/bone-override-store.test.ts`、`frontend/src/__tests__/scene/env-ground-spec.contract.test.ts`、`frontend/src/__tests__/scene/env-particles.test.ts`）。
- 发现总数：20（P0×0 / P1×6 / P2×6 / P3×7 / P4×1）。
- 实际修改文件：6 个（3 个测试 + 3 个源码）。
- 验证：`npm run check` ✅；定向 10 文件 / 205 用例 ✅；全量前端 Vitest 253 文件 / 5906 用例 ✅；`git diff --check` ✅。

## 修复

### bone-override-store（子代理）
1. **P1 源码：`releaseBones` 只清 loser 冲突，winner 释放/抢占反转后残留幽灵冲突** — 新增 `_clearConflictsForBone`/`_clearModuleConflicts`，释放或所有权转移时清旧冲突。
2. **P1 源码：`setSlot`/`clearSlot` 所有权守卫可被无 `sourceModuleId` 或空 slot 绕过** — 同时校验 owner 与 slot 归属，拒绝无归属孤儿 slot。
3. **P2 源码：claimBones 接管未认领骨时不清理其他模块预置 slot** — 认领成功路径先清非本模块遗留 slot。
4. **P2 源码：`releaseBones` 对空 owned set 重复通知** — 已释放/空集时清冲突但不触发 release 事件。
5. **P3 源码：`getModelsOwningModule` 把空 owned set 也算拥有者** — 仅按非空 owned 返回。
6. **P3 源码：`ModuleRuntimeState.ownedBones` 与 `_ownedBones` 双份 Set 漂移** — 改为共享同一引用。
7. **P3 源码：冲突去重后不刷新 priority/stage** — 命中已有记录时刷新优先级与 stage。
8. **P4 观察项：`setSlot` 未校验 Quaternion/weight/enabled 非法值** — 暂不改，留给主模型决策。

### env-ground-spec（子代理）
9. **P1 源码：非程序化地面 + 涟漪激活时原地更新误 dispose 共享 `groundRippleTex`** — 调整顺序：先解除涟漪再同步 normal，最后按需重挂。
10. **P1 源码：程序化地面原地更新 UV 密度与重建不一致** — 原地程序化密度改由 `proceduralScale` 决定，并同步 PBR bump/metallic scale。
11. **P1 源码：terrain `elevationColoring` 未纳入 structural/specKey，切换不重建** — 加入 terrain 结构性 spec 并纳入 specKey。
12. **P3 测试：材质指纹未覆盖 ADR-230 自发光字段** — `MatFingerprint` 补 `emissiveColor`/`hasEmissiveTex`。

### env-particles（子代理）
13. **P1 源码：关闭 rain→重新开启 rain 湿身不恢复** — 进入 rain 的判断改为 `!isWetnessActive()`。
14. **P2 源码：非法 type 在校验前销毁现有粒子并污染状态** — 任何状态变更前先查配置，非法直接返回。
15. **P2 源码：粒子参数 NaN/Infinity/负数未防护** — 新增 `finiteOrFallback` 并统一非负钳制。
16. **P2 测试：mock `env` 缺少源码实际导入导出** — 补 `addRipple`/`addGroundRipple`/`getGroundHeightAt`。
17. **P2 测试：全局/文档污染缺清理** — 恢复 `document.createElement`，清理全局键与 splash observer。
18. **P3 测试：陈旧 env-impl mock** — 改为从 `_shared/env-context` 导入 `_envSys`。
19. **P3 源码：splash 概率与池初始化范围不一致** — 非 rain/snow 的 `splashProb` 归零（若产品要求落叶溅射需另扩池）。
20. **P3 测试：wind 测试只验证不抛错且 mock 形状不符** — mock 改 `_x/_y/_z` 并补风叠加断言。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 定向单测 | `npx vitest run src/__tests__/scene/bone-override-store.test.ts src/__tests__/scene/env-ground-spec.contract.test.ts src/__tests__/scene/env-ground.test.ts src/__tests__/scene/env-particles.test.ts src/__tests__/scene/env-impl.test.ts src/__tests__/scene/env-water.test.ts src/__tests__/scene/env-terrain.test.ts src/__tests__/env-bridge/facade.int.test.ts src/__tests__/scene/motion-modules-registry.conflict.test.ts src/__tests__/perception/perf-tier.int.test.ts --no-color` | ✅ 10 files / 205 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5906 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- `setSlot` 是否增加 `Quaternion/weight/enabled` 运行时校验（P4）。
- `setSlot` 现在拒绝“无 sourceModuleId 的未认领 slot”；若未来存在手动/非模块覆盖写入路径，需确认语义。
- `sakura/leaves` 是否应支持落地溅射：本次按 ADR-026 将非 rain/snow splash 概率归零；若产品要求落叶溅射，需同步扩展 `syncSplashState` 与 `isWeatherType`。
