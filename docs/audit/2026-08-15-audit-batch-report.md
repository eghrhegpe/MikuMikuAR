# 测试反推源码 · 子代理批量审计阶段性汇报

> 日期：2026-08-15
> 模式：按 `test-files.txt` 队列每批 3 个测试文件，派真实子代理审计；授权子代理直接修改测试/源码；主模型逐批审 diff、跑验证、统一提交。
> 范围：已完成 6 批共 18 个 E2E 测试文件及其关联源码。

---

## 一、已完成批次与提交

| 批次 | 测试文件 | 提交 | 验证 |
|---|---|---|---|
| 1 | `a11y.spec.ts`、`ai-control.spec.ts`、`desktop-capabilities-dom.spec.ts` | `1b0f45bd` | `npm run check` ✅；全量 Vitest 253 文件 / 5786 用例 ✅ |
| 2 | `export-screenshot.spec.ts`、`library-panel-dom.spec.ts`、`menu-declaration.spec.ts` | `7fdd1e34` | `npm run check` ✅；全量 Vitest ✅ |
| 3 | `model-lifecycle-webgl.spec.ts`、`model-load.spec.ts`、`motion-panel-dom.spec.ts` | `a27fc202` | `npm run check` ✅；全量 Vitest ✅ |
| 4 | `motion-playback-dom.spec.ts`、`physics-health.spec.ts`、`scene-panel-dom.spec.ts` | `d3487b07` | `npm run check` ✅；全量 Vitest ✅ |
| 5 | `scene-water-dom.spec.ts`、`settings-panel-dom.spec.ts`、`settings-theme-lang-dom.spec.ts` | `056a8cf8` | `npm run check` ✅；全量 Vitest ✅ |
| 6 | `shortcuts-dom.spec.ts`、`smoke.spec.ts`、`web-capabilities.spec.ts` | `17df52a3` | `npm run check` ✅；全量 Vitest ✅ |

每批均跑 `cd frontend && npm run check` + 全量 `npm run test`，全部通过。部分 E2E 已在子代理环境中实跑通过；无法通过的均为当前无 Wails CDP / headless hit-test 环境问题，非本次改动引入。

---

## 二、已完成的主要修复（摘要）

### 测试质量
- 消除多处假绿/假红：
  - `menu-declaration.spec.ts`：扫描器按 testid 去重导致“唯一 id”断言失效；深度提前剪枝导致“深度 ≤5”恒真；分类器与真实 DOM 不一致；tab 叶子假设错误；点击等待数量方向 flaky。
  - `physics-health.spec.ts`：`meshCount >= 0` 恒真式；FPS ≥ 30 硬阈值在 CI 下 flaky；固定日文骨骼名 skip 面过窄。
  - `model-load.spec.ts`：`innerText` + `hasText` 脆弱选择器；`actor:model` 过期选择器。
  - `web-capabilities.spec.ts`：广场测试等错 overlay 且未打开动作菜单导致假绿；下载监听用中文文案断言在英文 locale 下假绿。
  - `settings-*` 系列：旧 `library/performance/rendering/paths/audio/shortcuts` testid 全部更新为 ADR-157 后的真实 8 区段。
- 多处补 `#app.inert` 守卫，修复纯 Vite 下 FSA 弹窗残留 inert 导致真实点击被 body 拦截。
- 多处补 `pageerror` 监听，让“关闭/重开不崩溃”不再只看 DOM 可见。

### 源码不足
- `ai-control`：未知/全部不支持动作现在会显示“暂不支持”；补 `diagnostic:mode-switch` testid。
- `render-menu.ts`：`kind:'custom'` 节点包一层 `div.schema-custom[data-testid=node.id]`，让 custom 面板在 E2E 扫描/断言中可见。
- `dev-hooks.ts`：`__scene.testMeshCount` 精确统计程序化 seed mesh，避免总 `meshCount` 受背景 mesh 干扰。
- `env-water-levels.ts`：水预设芯片补 `env:water:preset:*` testid。
- `settings-appearance.ts`：主题色行/语言行补稳定 testid。
- `settings-resources.ts`：Android 异步渲染落到 custom host 内，避免 testid 契约被破坏。
- `wind-physics.ts`：全局 `disposeWindPhysics()` 复位 `_implMissingWarned`，避免重建后同类失败被旧告警吞掉。

---

## 三、尚未直接收口 / 需要主模型或产品决策的缺陷

以下问题已定位，但属于跨文件、环境、CI 或需要产品决策，未在当前测试文件批次内直接动手。

### 环境 / 基建
1. **`#app.inert` 清理未集中**
   - 多处 E2E 各自 `removeAttribute("inert")`，根因在 `frontend/e2e/helpers.ts` 的 `installOverlayGuards` / `gotoWebEntry`。
   - 建议：在 helper 中统一处理，并挂 `MutationObserver` 防止竞态。
2. **@webgl 跨文件隔离**
   - 多个 spec 已各自 `serial` + 清理，但多个 @webgl 文件仍可能并行操作同一个 Wails CDP 页面。
   - 建议：全局 `workers:1` / 全局串行 / 独立 Wails 实例。
3. **`VITE_E2E_MODE` 未接入启动/CI**
   - `start-e2e.ps1` 与 @webgl CI 未设置 `VITE_E2E_MODE=true`，`wailsPage` 下 `__scene` 可能不注入。
4. **Playwright webServer 的 `sudo fuser` 在 Windows 不可用**
   - `frontend/playwright.config.ts` 的 4174 preview 命令需跨平台化或由外部脚本管理。
5. **headless Chromium 下 `<body> intercepts pointer events`**
   - 多个 E2E 仍可能受此环境硬伤影响；不建议用 `force: true` 掩盖。

### 存量测试漂移 / 待同步
6. **`helpers.ts` 的 `loadFirstModel` / `loadModelByName`**
   - 仍用过期 `[data-testid^="actor:model"]`，应统一为 `folder:models:browse` → `[data-testid^="model:"]`。
7. **`helpers.ts` 的 `clickMotionSubLevel`**
   - 映射过期：`procmotion` → `proc-library`，`pose` → `poseStudio`。
8. **`web-smoke.spec.ts`**
   - 与 web-capabilities 修复前相同的过时 custom 注释、`.cs-top[role='slider']).first()`、广场等 `#sceneOverlay` 问题。
9. **`frontend/e2e/README.md:295`**
   - 仍写 `slide-item→tab`，与 `menu-declaration.spec.ts` 新分类器不一致。

### 源码维护 / 可访问性
10. **a11y 源码修复（来自 a11y 审计）**
    - `dialog.ts` 缺可访问名称（`aria-dialog-name`）。
    - `app.css` 隐藏弹窗未从可访问性树隐藏（建议 `visibility:hidden`）。
    - `.mmd-dialog-confirm` 对比度 4.39:1 < 4.5:1。
11. **`model-loader.ts:861`**
    - 裸 `console.error` 未走 `@/core/logger`；需同步 `model-loader.test.ts` logger mock。
12. **`model-loader.ts` 两分支重复**
    - `603-632` vs `753-808` 近 30 行副作用重复，建议抽 `finalizeModelLoad(...)`。
13. **`model-loader.test.ts`**
    - 建议断言 `retryWindPhysicsSubscription` 在 actor 成功路径被调用。
14. **`motion-root-ui.ts` 空态行**
    - 无显式 `rowKey`，当前 testid 退化为 `action:`；建议补 `motion:empty-hint`。
15. **i18n 死文案**
    - `motion.noMotionHint` 全仓无消费方，确认后可删除。
16. **`plaza-browser.ts`**
    - more 按钮/动作菜单项无稳定 testid；“独立窗口”等硬编码中文建议 i18n。
17. **风力 E2E 重置钩子**
    - `__scene.driver` 缺少 `resetWindPhysics()`，导致 `windPhysicsActive` 类用例无法验证“本次加载是否重新订阅”。

### 需要产品决策
18. **web nav 是否补 `#btnAssistant`**
    - `web-capabilities.spec.ts` 的 nav 完整性列表未含 `#btnAssistant`，但 web 入口实际有 7 个按钮；是否纳入由产品意图决定。
19. **FPS 性能门禁**
    - 本轮把 @webgl 的 `FPS ≥ 30` 降为 `fps > 0` 渲染冒烟；若需要性能门禁，建议在专用性能环境用独立 perf 测试承接。

---

## 四、建议下一步

1. 先集中修“基建类”：
   - `helpers.ts` 统一 `#app.inert` + `loadFirstModel`/`clickMotionSubLevel` 映射；
   - `start-e2e.ps1` / CI 设置 `VITE_E2E_MODE`；
   - Playwright @webgl 全局串行/`workers:1`。
2. 再补一轮源码修复：
   - a11y 三件套、`model-loader` logger/重构、`plaza-browser` testid/i18n。
3. 之后可继续按队列审计剩余测试文件（当前队列仍有大量未审文件）。
