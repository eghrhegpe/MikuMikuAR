# Round 62 审核报告 — menu focus / level-management / level-write

> 日期：2026-08-15
> 模式：继续队列第六批，同模块 3 个测试文件由一个子代理串行处理，避免并行改 `menu.ts` 冲突。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/menu/focus.test.ts`、`frontend/src/__tests__/menu/level-management.test.ts`、`frontend/src/__tests__/menu/level-write.test.ts`）。
- 发现总数：7（P0×0 / P1×0 / P2×2 / P3×5）。
- 实际修复文件：3 个测试 + 1 个源码。
- 验证：`npm run check` ✅；`src/__tests__/menu` 18 文件 / 1649 用例 ✅；全量前端 Vitest 253 文件 / 5849 用例 ✅；`git diff --check` ✅。

## 修复

1. **P2 源码：`patchPanel` 单 lcard 含 divider 时 DOM 错位** — 只要 items 含 divider 就统一走 `_patchMultiCard`，段数与 lcard 数不匹配时该方法会回退 `buildPanel`。
2. **P2 测试：三个文件缺 SlideMenu dispose / DOM remove 清理** — 统一补 `afterEach`，`level-write` 临时 fresh 实例用 `try/finally` 清理。
3. **P3 测试：裸 setTimeout 等待 buildPanel** — 改为 `requestAnimationFrame`。
4. **P3 测试：i18n 缺失 key 告警** — `beforeAll` 预填 `zh-CN`。
5. **P3 测试：多处弱断言** — 补 `.slide-focused` 不存在、点击目标、层级更新、原 label 未被改写等断言。
6. **P3 测试：ADR-065 用例修改全局 lang 后未恢复** — 补 `afterAll(() => setLang('zh-CN'))`。

## 未收口 / 需主模型决策

1. `core/reactivity.ts` `scheduleRefresh` 同帧 changedKeys 丢失（P1，锁外文件）。
2. `buildPanel` / `updateRow` / `patchPanel` 三套 DOM 更新并存：本次只修 divider 边界，未做大重构；后续建议统一 `data-row-key` 索引与空 items 走 `buildPanel`。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 菜单相关单测 | `npx vitest run src/__tests__/menu --no-color` | ✅ 18 files / 1649 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5849 tests |
| 空白错误 | `git diff --check` | ✅ |
