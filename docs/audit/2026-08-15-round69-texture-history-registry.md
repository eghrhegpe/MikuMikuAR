# Round 69 审核报告 — env-texture / motion-history / motion-modules-registry.create

> 日期：2026-08-15
> 模式：继续队列第十三批，3 个子代理并行审计。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/scene/env-texture.test.ts`、`frontend/src/__tests__/scene/motion-history.test.ts`、`frontend/src/__tests__/scene/motion-modules-registry.create.test.ts`）。
- 发现总数：14（P0×0 / P1×1 / P2×5 / P3×5 / P4×3）。
- 实际修改文件：6 个（3 个测试 + 3 个源码）。
- 验证：`npm run check` ✅；定向 16 文件 / 182 用例 ✅；全量前端 Vitest 253 文件 / 5920 用例 ✅；`git diff --check` ✅。

## 修复

### env-texture（子代理）
1. **P2 源码：DynamicTexture 回退时泄漏已创建纹理** — catch 中 `dt?.dispose()`，释放失败不阻断回退。
2. **P3 源码：非法 `wrap` 值行为不一致** — 除 `'wrap'` 外统一回退 CLAMP，与 DynamicTexture 默认一致。
3. **P2 源码：画布尺寸 0/负数/NaN/Infinity 未归一化** — 新增 `_normalizeCanvasSize`，`createCanvasTexture`/`createCanvasDataURL` 统一归一为 1px 以上。
4. **P4 测试：`disposeTextureCache` 断言过弱** — 补“dispose 后同 key 重新创建新贴图”。

### motion-history（子代理）
5. **P2 源码：`jumpToHistory` 接受 NaN/小数污染 cursor** — 增加 `Number.isInteger` 前置校验。
6. **P3 源码：合并分支 builder 抛错留下“描述已更新但快照未更新”不一致条目** — 先构建快照成功后再更新条目。
7. **P3 测试：fake timers 与共享历史状态缺对称清理** — 顶层 `afterEach` 清理并恢复真实定时器。
8. **P3 测试：历史上限/clearHistory 幂等/合并窗口边界/applier 抛错缺覆盖** — 补齐。
9. **P4 测试：499/500ms 合并边界与 applier 抛错 cursor 不前进** — 按现有语义锁定。

### motion-modules-registry.create（子代理）
10. **P1 源码：`setTargetModel` 切换模型时把场景级 `enabled` 全局清成 false** — 清理旧模型运行时前保存 `state.enabled`，`mod.disable()` 后恢复。
11. **P2 源码：无 VMD 回退状态按 moduleId 全局共享，多模型串扰** — 改为 `modelId → moduleId` 二级 Map，并在 `clearAllModulesForModel` 中同步删除。
12. **P3 测试：`resetAll` 未清理 SUT per-model 状态** — 先遍历 `mockModelRegistry` 调 `clearAllModulesForModel`。
13. **P4 测试：默认值断言不完整** — 补 `bodyHeight/bodyDepth` 等全部默认参数。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 定向单测 | `npx vitest run src/__tests__/scene/env-texture.test.ts src/__tests__/scene/env-ground-spec.contract.test.ts src/__tests__/scene/env-impl.test.ts src/__tests__/env-impl.test.ts src/__tests__/env-caustics.test.ts src/__tests__/scene/env-water.test.ts src/__tests__/scene/water-preset-repro.test.ts src/__tests__/scene/motion-history.test.ts src/__tests__/scene/motion-modules-registry.*.test.ts --no-color`（registry 用实际文件名展开） | ✅ 16 files / 182 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5920 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- 合并窗口当前为 `< 500` 排他边界，本次按现状补测试锁定；若产品语义期望 500ms 整点也算窗口内，需改 `<= 500`。
- `getHistoryEntries` 返回内部可变数组引用；当前无消费者滥用，若需防御性拷贝请另行决策。
- `_fallbackModuleStates` 已改为按 modelId+moduleId 隔离；若产品层存在“无 VMD 时所有模型共享 pose-debug 配置”的有意设计，需确认。
