# 设置「滑动动画」开关名不副实（只覆盖 #sceneOverlay 一条规则）

> **状态**: ✅ 已修复

**日期**: 2026-10-22
**严重程度**: 🟡 P2（功能失效：用户体感「动画关不掉」）
**影响范围**: `frontend/src/app.css`、`frontend/src/core/ui-motion.ts`（新增）、`frontend/src/core/init.ts`、`frontend/src/menus/settings-shared.ts`、`frontend/src/menus/settings-appearance.ts`、`frontend/src/menus/menu.ts`
**发现方式**: 用户反馈（「想砍 UI 动画了」）
**修复提交**: 见同批次 commit

---

## 现象

设置 → 动效 →「滑动动画」关掉后，菜单仍然滑、hover 仍然渐变。用户以为开关坏了。

## 根因

1. `--ui-animations` 全仓只有一个消费者：`app.css:617-618` 的 `#sceneOverlay` `transition: opacity calc(0.2s * var(--ui-animations)) ease, ...`。它被当成「某条规则的计算因子」，而不是全局开关——新增动效时没人记得乘 `var`。
2. `frontend/src/menus/menu.ts` 用内联 `style.transition` 硬编码 `0.15s` / `0.12s`（原 `TRANSITION_DURATION` 常量），完全绕过 CSS 变量。注释声称「与 app.css `--menu-transition-duration` 同步」，实际早已漂移。
3. 其余约 58 条 CSS transition/animation 声明无任何门控。

## 修复

1. 新增 `frontend/src/core/ui-motion.ts` → `applyUiMotionDom(on: boolean)`：单一写入口，同时写 CSS 变量 `--ui-animations` 与根节点属性 `data-ui-animations`（变量供 `calc()` 规则，属性供全局选择器命中——CSS 无法对自定义属性值做条件判断）。
2. `app.css` 新增全局降级规则：

   ```css
   :root[data-ui-animations='0'] *,
   :root[data-ui-animations='0'] *::before,
   :root[data-ui-animations='0'] *::after {
       animation-duration: 0.01ms !important;
       transition-duration: 0.01ms !important;
   }
   ```

   `!important` 同时压过 `menu.ts` 的内联 `style.transition`，因此菜单无需再各自判断开关。
3. `menu.ts` 删除硬编码常量，新增 `resolveTransitionDuration(fast = false): string`：读 `--menu-transition-duration` / `--menu-transition-duration-fast`，缺省兜底 `0.15s` / `0.12s`（jsdom 无样式表时走兜底），并叠加 `--ui-animations === '0'` → `0.01ms` 门控。
4. 变量写入点收敛：`core/init.ts:361`、`menus/settings-shared.ts:161`、`menus/settings-appearance.ts`（开关 + 恢复默认）共 4 处 `root.style.setProperty('--ui-animations', ...)` 全部改调 `applyUiMotionDom(...)`。

## 为什么关动画用 0.01ms 而不是 0s / none

零时长**不会生成过渡**，`transitionend` 永不触发；`SlideMenu` 的 `transitioning` 锁靠它释放，只剩 150ms/200ms 兜底定时器可走——关动画反而更卡，且这条路径历史上出过 P0 卡死（`menu.ts` 里成片的 `[fix:P0]` 注释）。与 `app.css` 既有 `@media (prefers-reduced-motion: reduce)` 块同法（ADR-153 Phase 2）。

## 顺带砍掉两个纯装饰 infinite

- `.plaza-cr-ring-gold` 的 `animation: spin 3s linear infinite`（保留 `border-color`，金色环变静态）
- `.cs-fill::before` 的 `animation: csShimmer 2s infinite`（连 `::before` 规则与 `@keyframes csShimmer` 一并删除，`.cs-fill::after` 高光保留）

loading 用的 `spin` 未删（`.spinner` / `.plaza-spinner-ring` 仍需要），只是被 0.01ms 压平。

## 验证

- `npx tsc --noEmit` 通过；`npx eslint <改动文件>` 0 error
- `npx vitest run src/__tests__/ui-motion.test.ts src/__tests__/init.test.ts` → 30 passed
- `npx vitest run src/__tests__/menu src/__tests__/ui-helpers.test.ts src/__tests__/menu-schema.motion-module.test.ts` → 1768 passed
- `npm run build:dev` 通过
- 新增 `frontend/src/__tests__/ui-motion.test.ts`（变量 + 属性双写契约、幂等）；`init.test.ts` 增断言 `dataset.uiAnimations === '0'`

## 回归风险

开关关闭后所有 hover 反馈一起归零（符合「关动画」预期）。若将来需要「只关装饰动效、保留交互反馈」，应拆成两个开关，而不是把这条规则改窄。
