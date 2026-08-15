# Round 65 审核报告 — menu stack-render / mesh-lifecycle-headless / babylon-classes.contract

> 日期：2026-08-15
> 模式：继续队列第九批，3 个子代理并行审计。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/menu/stack-render.test.ts`、`frontend/src/__tests__/mesh-lifecycle-headless.test.ts`、`frontend/src/__tests__/mocks/babylon-classes.contract.test.ts`）。
- 发现总数：16（P0×0 / P1×3 / P2×9 / P3×3 / P4×1）。
- 实际修复文件：3 个测试 + 3 个源码（`frontend/src/__tests__/mocks/babylon-classes.ts`、`frontend/src/core/test-mesh.ts`、`frontend/src/menus/menu.ts`）。
- 验证：`npm run check` ✅；定向测试 27 文件 / 1931 用例 ✅；全量前端 Vitest 253 文件 / 5858 用例 ✅；`git diff --check` ✅。

## 修复

### menu/stack-render
1. **P1 测试：两个 describe 缺 afterEach 清理** — 补 `menu.dispose(); container.remove()`。
2. **P2 测试：`currentLevel` pop 完所有层级为 undefined 是无效断言** — 改为“pop 不会清空最后一层”。
3. **P2 测试：renderCustom 裸 setTimeout 忙等** — 改为 RAF flush。
4. **P2 源码：`popTo` NaN/小数索引缺守卫** — 加 `!Number.isInteger(index)`。
5. **P2 源码：`reRender` 同帧去抖丢 `preserveFocus`** — 新增 `_pendingReRenderOpts` 合并。
6. **P3 测试：i18n 噪音** — 预填 `zh-CN`。

### mesh-lifecycle-headless
7. **P2 源码：`createTestMesh`/`clearTestMeshes` 只释放 mesh，未释放同名 material** — 抽 `disposeTestResources(scene)` 同时释放前缀 mesh/material。
8. **P2 测试：只断言 mesh 计数，未覆盖 material 释放** — 补 `scene.materials.length` 断言。
9. **P3 测试：幂等性只验证存在** — 补唯一性与 material 不累积断言。

### babylon-classes.contract
10. **P1 测试：`AssertSignatures` 因 `never` 被联合吸收而失效** — 失败键改 `false`，整体 `... extends true ? true : never`。
11. **P1 测试：运行期只自证 mock 字符串，未与真实 Babylon 对比** — 动态 import 真实 Babylon 对比 28 个类的 `getClassName`。
12. **P2 源码：`MockEngine.getClassName()` 与真实不一致** — 改 `'ThinEngine'`。
13. **P2 源码：数学 mock 类缺失 `getClassName`** — 补齐。
14. **P2 源码：大量 mock 方法签名过窄/缺参** — 对照真实 `.d.ts` 修正。
15. **P3 测试：签名断言仅覆盖 14/28 类** — 补齐全部 28 类 + 静态成员子集。
16. **P4 测试：死代码/过时注释/环境标注** — 清理并加 `@vitest-environment node`。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 定向单测 | `npx vitest run ...` | ✅ 27 files / 1931 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5858 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- 外部并行改动（`backend.data-chain.test.ts`、`browser-adapter.ts`、`ui-fullscreen-overlay.ts`、`internal/app/*`）本次不纳入提交，由对应所有者收口。
- 已知 mock 缺陷未在本次最小范围修复：`MockPBRMaterial.subSurface` stub、`MockTexture.isReady()` 恒 true、`AssertPublicSubset` 单向子集限制。
