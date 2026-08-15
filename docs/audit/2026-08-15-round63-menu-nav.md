# Round 63 审核报告 — menu nav-buttons / nav-click / nav-touch

> 日期：2026-08-15
> 模式：继续队列第七批，同模块 3 个测试文件由一个子代理串行处理。

## 摘要

- 精读测试文件：3（`frontend/src/__tests__/menu/nav-buttons-dom.test.ts`、`frontend/src/__tests__/menu/nav-click-dom.test.ts`、`frontend/src/__tests__/menu/nav-touch.test.ts`）。
- 发现总数：9（P0×0 / P1×0 / P2×5 / P3×4）。
- 实际修复文件：3 个测试 + 1 个源码（`frontend/src/menus/nav-actions.ts`）。
- 验证：`npm run check` ✅；`src/__tests__/menu` 18 文件 / 1651 用例 ✅；全量前端 Vitest 253 文件 / 5851 用例 ✅；`git diff --check` ✅。

## 修复

1. **P2 测试：nav-buttons 静态 DOM 测试是自证，且漏 `btnAssistant` / `webviewLayer`** — 改为读取真实 `frontend/index.html` 后断言，补齐 7 按钮 + `webviewLayer`。
2. **P2 测试：nav-click 内联 scene mock 未复用共享 `sceneMockSuperset`** — 改用共享工厂。
3. **P2 测试：nav-click 只覆盖 env/main 两个入口** — 补齐 motion/scene/settings/assistant/plaza 点击链路。
4. **P2 测试：nav-click 未清理 nav-actions 模块级监听/overlay 状态** — 补 `vi.resetModules()` + `disposeNavBindings()` + `closeAllOverlays()` + 清空 body。
5. **P2 源码：`waitForTransition` 安全网 timeout 不清理 transitionend 监听** — 用 `settled` 幂等收口，`finish()` 中 `clearTimeout(timer)` + `disp.dispose()`。
6. **P3 测试：nav-touch 键盘导航未 dispose 菜单/移除容器** — 补 `afterEach`。
7. **P3 测试：nav-touch 平台适配依赖默认 UA、共用容器** — 显式 UA + 独立容器 + 手动 dispose/remove。
8. **P3 测试：nav-touch i18n 噪音** — 预填 `zh-CN`。
9. **P3 测试：nav-touch 未断言 `_swipeActive` 复位** — 补状态断言。

## 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端静态检查 | `cd frontend && npm run check` | ✅ |
| 菜单相关单测 | `npx vitest run src/__tests__/menu --no-color` | ✅ 18 files / 1651 tests |
| 全量前端单测 | `cd frontend && npx vitest run --no-color --reporter=dot` | ✅ 253 files / 5851 tests |
| 空白错误 | `git diff --check` | ✅ |

## 未收口 / 需主模型决策

- 无阻塞项。
- `nav-buttons-dom.test.ts` 读取 `index.html` 使用 `process.cwd()` 定位，依赖“测试从 `frontend/` 目录运行”的项目约定；如需更绝对路径可在后续基建统一。
