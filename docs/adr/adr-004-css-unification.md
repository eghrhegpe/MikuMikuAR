# ADR-004: CSS 统一重构 + 弹窗单例模式

**日期**：2026-07-16

---

### 背景

项目经历了多轮功能迭代，CSS 逐渐膨胀到以下状态：
- `index.html` 内联 410 行 `<style>`
- `frontend/src/style.css` 20 行（与内联重复）
- `frontend/src/app.css` 1 行注释（空壳）

5 个弹窗（modelPopup / externalOverlay / settingsOverlay / downloadOverlay / siteOverlay）重复同样的 `background/blur/border/radius/flex-direction` 定义，header 和 close 按钮样式各写各的。主题色 `#4a6cf7` 硬编码 20+ 处。

同时，5 个弹窗都定位在 `bottom: 100px; left: 24px`，如果同时打开会完全重叠，但没有任何机制阻止同时打开。

### 决定

#### 1. CSS 文件合并

- 删除 `index.html` 内联 `<style>` 块（410 行）
- 删除 `frontend/src/style.css`（20 行）
- `frontend/src/app.css` 成为唯一的样式文件，通过 `<link>` 引入

#### 2. CSS 变量体系

引入 12 个设计 token 替代硬编码值：

| 变量 | 用途 |
|------|------|
| `--accent` / `--accent-hover` | 主色 `#4a6cf7` |
| `--overlay-bg` / `--overlay-blur` | 弹窗背景 |
| `--text` / `--text-dim` / `--text-muted` | 文字层级 |
| `--divider` | 分隔线颜色 |
| `--overlay-radius` / `--overlay-header-py` / `--overlay-header-px` | 布局间距 |

#### 3. 统一弹窗复用类

| class | 替换了 |
|-------|--------|
| `.overlay` | 各弹窗独立定义的 `background/blur/border/radius` |
| `.overlay-header` | `.eo-header` + `.so-header` |
| `.overlay-close` | `.eo-close` + `.so-close` |
| `.overlay-body` | `.so-body` + `.dl-body` |
| `.overlay-row` | `.eo-row` |
| `.overlay-list` | `.eo-list` |
| `.overlay-label` / `.overlay-option` / `.overlay-opt-label` | `.so-label` / `.so-option` / `.so-opt-label` |
| `.overlay-hint` / `.overlay-name-hint` | `.dl-hint` / `.dl-name-hint` |
| `.overlay-primary-btn` | `.dl-start-btn` |
| `.overlay-secondary-btn` | `.setting-btn` |
| `.overlay-input` / `.overlay-input-lg` | 3 处 inline `style` |

#### 4. 弹窗单例模式

- 新增 `closeAllOverlays()` 函数，关闭所有 5 个弹窗 + 重置状态
- 每个弹窗打开前先调用 `closeAllOverlays()`，确保同时只有一个弹窗可见
- Esc 键从逐个判断改为直接 `closeAllOverlays()`

不受影响的 UI 元素：
- `#importToast`（右下角，不同定位）
- `#downloadBar`（居中进度条）
- `#scenePanel`（右侧面板）

### 影响

**正面**
- CSS 总量从 430 行 → 280 行
- 弹窗容器/header/close 的重复定义从 5 套 → 1 套
- 硬编码色值从 20+ 处 → 1 个变量
- 弹窗行为可预测：任何时候只显示一个

**负面或风险**
- 重构过程中需谨慎验证每个弹窗的 class 映射
- 如果有外部插件/脚本依赖旧 class 名（`.eo-header` / `.so-header` 等），会失效
- 项目内部无插件依赖，风险可控

### 技术细节

- `closeAllOverlays()` 定义在 `config.ts`（就近于 `dom` 引用）
- 各弹窗宽度通过 `#id { width: Xpx }` 覆盖（`.overlay` 不设宽度）
- `site-row` 保留独立样式（间距/font 与 overlay-row 不同）
