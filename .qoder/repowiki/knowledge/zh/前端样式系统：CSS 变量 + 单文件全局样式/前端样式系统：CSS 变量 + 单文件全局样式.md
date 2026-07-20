---
kind: frontend_style
name: 前端样式系统：CSS 变量 + 单文件全局样式
category: frontend_style
scope:
    - '**'
source_files:
    - frontend/src/app.css
    - frontend/index.html
    - frontend/web-loader.html
    - frontend/package.json
---

## 1. 使用的体系/方法
- 纯 CSS，无 Sass/Less、Tailwind、styled-components、Emotion 等预处理或 CSS-in-JS 方案。
- 通过 `:root` 自定义属性（CSS Variables）集中管理设计令牌（Design Tokens），包括颜色、字号、间距、圆角、阴影、动画时长等。
- 所有 UI 样式集中在单一文件 `frontend/src/app.css`（约 3200 行），按功能区块注释分段组织（弹窗、按钮、滑动菜单、滑块、对话框、广场层等）。
- 构建工具为 Vite，打包产物由 Wails v3 注入到 Go 后端；样式通过 HTML `<link>` 引入（见 `index.html` / `web-loader.html`）。
- 图标使用 `@iconify/iconify` + `iconify-icon` Web Component，尺寸通过 CSS 变量统一控制。
- 响应式策略基于 CSS `@media (max-width: 480px)` 与 `pointer: coarse`，配合 `--ui-scale` 变量实现桌面/移动端缩放。

## 2. 关键文件与包
- `frontend/src/app.css` — 唯一的全局样式入口，包含全部 Design Tokens 与组件样式。
- `frontend/index.html` / `frontend/web-loader.html` — 应用入口，加载 `app.css` 与 Babylon.js 资源。
- `frontend/package.json` — 声明依赖（Babylon.js、Iconify、Wails Runtime、Vitest/Playwright 等），无 CSS 框架依赖。
- `frontend/vite.config.ts` — Vite 构建配置（静态资源处理、开发服务器）。
- `frontend/public/lib/babylon.js` 等 — 运行时库，非样式相关但影响渲染上下文。

## 3. 架构与约定
- **Design Token 分层**
  - 基础层：颜色（`--accent`、`--text`、`--bg-app`）、字体族（`--font`）、透明度阶梯（`--white-04` ~ `--white-85`）。
  - 语义层：按用途命名（`--font-ui`、`--font-title`、`--btn-height`、`--overlay-bg`），避免直接写死数值。
  - 组件层：针对 Slide Menu、CS Row、Preset Chip、Collapsible、Material Card 等定义专用 token，便于局部调整。
- **缩放机制**：所有尺寸通过 `calc(N * var(--ui-scale))` 计算，`--ui-scale` 可在运行时修改以适配不同 DPI/平台。
- **布局模式**：大量使用 Flexbox，少量 Grid（如广场创作者网格 `.plaza-creator-grid`）；绝对定位用于 HUD、Overlay、Toast 等浮层。
- **主题色**：主色 `--accent: #4a6cf7`，危险色 `--danger`，整体暗色背景 `--bg-app: #1e1e28`，强调半透明白色层级 `--white-*`。
- **组件化约定**：每个可复用交互块（按钮、开关、滑块、折叠面板、卡片）都有对应类名与 token，新增组件应遵循相同命名与 token 使用方式。
- **移动端适配**：窄屏媒体查询覆盖弹窗宽度、导航位置等；触屏设备通过 `touch-action: none` 与扩大触控热区优化体验。

## 4. 开发者应遵守的规则
1. **禁止硬编码颜色/字号/间距**：新建样式必须引用现有 CSS 变量，无法匹配时先在 `:root` 中补充 token。
2. **尺寸一律乘以 `var(--ui-scale)`**：确保在不同缩放级别下视觉一致。
3. **类名采用 BEM 风格前缀**：如 `.slide-item`、`.cs-row`、`.preset-chip`、`.collapsible-header`，保持命名一致性。
4. **新增组件需配套 token**：在 `:root` 中定义对应的 `--xxx-*` 变量，再在组件类中使用。
5. **响应式仅用媒体查询**：不引入 JS 动态样式，优先通过 CSS 变量与 `@media` 组合实现。
6. **图标统一走 Iconify**：通过 `iconify-icon` 元素 + CSS 变量控制尺寸，不在 CSS 中内联 SVG。
7. **样式文件只维护 `app.css`**：不再新增独立 CSS 文件，所有样式集中管理以避免碎片化。
8. **动画与过渡使用 CSS transition/keyframes**：并通过 `--menu-transition-duration`、`--ui-animations` 等变量统一控制时长。