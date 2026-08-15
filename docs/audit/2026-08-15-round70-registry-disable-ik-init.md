# Round 70 审核报告 — motion-modules-registry disable / ik / init

> 日期：2026-08-15
> 模式：继续队列第十四批，registry 三件套合并为 1 个子代理（共享 `registry.ts`/mocks）。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/scene/motion-modules-registry.disable.test.ts`、`frontend/src/__tests__/scene/motion-modules-registry.ik.test.ts`、`frontend/src/__tests__/scene/motion-modules-registry.init.test.ts`）。
- 发现总数：5（P0×0 / P1×0 / P2×3 / P3×2 / P4×0）。
- 实际修改文件：4 个（3 个测试 + 1 个源码 `registry.ts`）。
- 验证：`npm run check` ✅；定向 registry 9 文件 / 59 用例 ✅；全量前端 Vitest 253 文件 / 5922 用例 ✅；`git diff --check` ✅。

## 修复

1. **P2 源码：`unregisterModule` 漏掉无 ownedBones 但已注册帧钩子的模块** — 注销时同时扫描 `modelRegistry.keys()`，并清除无 VMD 回退存储残留。
2. **P2 源码：`clearAllModulesForModel` 不注销帧钩子，且可能残留 `_currentModelId`** — 删除模型前遍历注册表 `disable()`，清理后置空当前目标。
3. **P2 源码：旧存档/旧 state 已存在时不补默认参数** — 新增 `_seedDefaultParams`，在 proc / fallback / VMD existing 路径统一补默认值且不覆盖已有值。
4. **P3 测试：IK 测试跨用例共享 `m1`，模块级帧钩子/缓存残留** — 改用独立 modelId、取最近注册钩子、用例结束 `mod.disable()`。
5. **P3 测试：disable 系列弱断言** — 补 ownedBones 清空、场景级 enabled 保留、清理骨骼集合精确断言。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 定向单测 | `npx vitest run src/__tests__/scene/motion-modules-registry.conflict.test.ts src/__tests__/scene/motion-modules-registry.create.test.ts src/__tests__/scene/motion-modules-registry.disable.test.ts src/__tests__/scene/motion-modules-registry.ik.test.ts src/__tests__/scene/motion-modules-registry.init.test.ts src/__tests__/scene/motion-modules-registry.param.test.ts src/__tests__/scene/motion-modules-registry.side-hooks.test.ts src/__tests__/scene/motion-modules-registry.snapshot.test.ts src/__tests__/scene/motion-modules-timed.test.ts --no-color` | ✅ 9 files / 59 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5922 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- `body-posture.ts` 的模块级缓存（`_centerBoneCache`/`_ikBoneCache`/`_centerPosWritten`）仍未随模型删除清理；已通过 `clearAllModulesForModel` 调 `disable()` 清理帧钩子，但同 modelId 重载模型时可能残留。建议后续批次处理 `body-posture.ts` 生命周期。
- `unregisterModule` 现在扫描全部 `modelRegistry` 以修复帧钩子泄漏；未清理 `procMotionModules`/各 SceneMotion 已保存配置，插件注销后重注册是否保留持久化配置需架构确认。
- `registerBoneOverrideFrameHook` mock spy 未全局重置；当前用“最近一次注册 + 独立 modelId + disable 清理”规避，若需严格计数断言后续统一设计。
