# @overlay 测试在 headless 下点击不可达（环境硬伤，未修复）

> **状态**: 🟡 搁置（headless 软渲染环境硬伤，非业务源码 bug；已用 best-effort CI job 承接）

**日期**: 2026-08-10
**严重程度**: 🟡 P2
**影响范围**: `e2e/*.spec.ts` 中全部 `@overlay` 标签测试（实测 74 个：settings-panel / scene-panel / menu-declaration / schema-driven / library-panel / motion-panel / desktop-capabilities / env-sky / export-screenshot / ai-control 等），以及 `.github/workflows/e2e-suite.yml` 的 `e2e-overlay` job
**发现方式**: 本地实测（`npx playwright test settings-panel-dom.spec.ts` 4 个全挂）+ 13 个 probe 逐层排查
**修复提交**: 未修复（环境硬伤）；承接提交 `5d89e05e`（新增 e2e-overlay best-effort job）、`0626e403`（沉淀排查结论注释）

---

## 问题描述

`@dom` 门禁使用 `--grep-invert "@overlay"` 排除触 WebGL overlay 的 spec 后，**74 个 `@overlay` 测试（设置/场景/环境面板 DOM 断言）完全真空**——无任何 CI job 承接，回归被静默吞掉。尝试放开排除时，`settings-panel-dom.spec.ts` 4 个用例全部失败：

```
Error: page.click: Target page, context or browser has been closed
  - <body class="">…</body> intercepts pointer events
```

即 Playwright 真实 `locator.click()`（带命中测试）在 headless 下无法点击 `#btnSettings` 等导航按钮，点击被 `<body>` 拦截。

## 复现步骤

```bash
cd frontend
npx playwright test settings-panel-dom.spec.ts --reporter=line
# 预期：4 failed，报错 `<body> intercepts pointer events`
```

## 根因分析（13 个 probe 逐层排除，2026-08-10）

| Probe | 假设 | 结论 |
|---|---|---|
| 1–3 | 按钮被遮挡 / 页面滚动 / body 伪元素 | ❌ 排除：scrollY=0、`content:none`、按钮链全 `pe:auto` |
| 4–6 | canvas 覆盖 / z-index 层叠异常 | ❌ 排除：`bottomNav z:100 > canvas z:1`，兄弟节点层叠正常 |
| 7 | canvas 拦截（pe:none / display:none） | ❌ **决定性排除**：canvas 隐藏后仍命中 BODY |
| 8 | app-booting 残留（opacity 0.35） | ⚠️ 发现线索：`body.app-booting #bottomNav { pointer-events:none }` 规则存在，但守卫已移除 class |
| 9 | 命中漂移 | 🔄 反转：`elementFromPoint` 偶尔命中按钮内部 `ICONIFY-ICON`（非恒 BODY） |
| 10–13 | 时序竞态 | ✅ **定论**：`bodyCls=""`、`btnOpacity=1`、`pe:auto` 全部正常时 `elementFromPoint` 仍命中 BODY，且同页多次探测结果漂移 |

**最终判定**：headless + swiftshader 软渲染下，WebGL canvas 合成层与 DOM 命中测试存在竞态——按钮 DOM 状态（rect / pointer-events / z-index）全部正确，但 `elementFromPoint` 结果不稳定（有时命中按钮、有时 BODY）。**属环境硬伤，非业务源码 bug**（改 CSS / 守卫无效），与 `@webgl` 在无 GPU runner 上必崩同类。

## 处置方案

1. **承接（已落地，`5d89e05e`）**：新增 `e2e-overlay` best-effort CI job（ubuntu + vitePage）——`continue-on-error` + failure-count gate（阈值 37 = 74×50%），不阻塞 push，但每次 push 都跑、报告可见、超阈值必红。回归不再被真空吞掉。
2. **排查链沉淀（已落地，`0626e403`）**：13-probe 排除项与定论写入 workflow 注释，防止后人重复踩坑。
3. **转正路径（未做）**：待带 GPU runner（软件渲染可用的 self-hosted）或 mock WebGL（`?e2e=1` 走 NullEngine 后 overlay 仍不可点击，说明 NullEngine 未解决命中测试，需进一步 mock WebGL 合成层）后，74 个测试自动转正为阻塞门禁。

## 教训

1. **"测试红"未必是"代码 bug"**：7 个 probe 排除所有 DOM 层假设后，根因仍在水面下——`elementFromPoint` 命中漂移是渲染合成层竞态，属于 runner 能力缺口而非源码缺口。
2. **环境硬伤要有"可见承接"而非"永久排除"**：`--grep-invert` 排除 + 无 job 承接 = 测试永远不跑 = 回归黑洞。best-effort job（跑 + 报告 + 阈值门禁）是环境硬伤的标准承接形态。
3. **排除链要留档**：13 个 probe 的排除项（滚动/伪元素/守卫/canvas/z-index/app-booting）已写入 workflow 注释，后人改 `@overlay` 前先读注释，避免重复排查。
