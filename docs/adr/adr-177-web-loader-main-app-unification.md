# ADR-177: Web Loader 与主应用统一路径

> **状态**: 规划中（2026-07-23；三方向评估完成，推荐方向 A「主应用直接跑浏览器」，待用户审核决策后推进至实施）
> **日期**: 2026-07-23
> **关联**: ADR-176（前端 Backend 适配器双实现）、ADR-017（安卓适配，platform 探测范式）、ADR-159（桥接注入范式）、ADR-093（声明式菜单 Schema）
> **前置**: ADR-176 Phase 1-3 已落地（backend 适配器层、wails-bindings 106 函数全代理化、web-loader 网页原型已上线 GitHub Pages）

## 背景

ADR-176 Phase 3 将 web-loader 升级为准完整网页入口，已上线 `https://eghrhegpe.github.io/MikuMikuAR/`。但 web-loader 是独立原型，与主应用（Wails 桌面/安卓）在功能与界面上相差悬殊：

| 维度 | 主应用（Wails） | web-loader（网页） |
|------|-----------------|-------------------|
| UI 系统 | 完整菜单（模型/动作/场景/环境/设置/广场 6 大模块）+ 底部导航 + 播放栏 + Toast + 状态栏 | 单一拖拽区 + 模型库面板 + 信息面板 |
| CSS | `app.css` CSS 变量体系（全局主题） | `web-loader.css` 独立样式 |
| 场景 | 完整场景编排（相机/灯光/渲染/环境/物理/AR） | 仅 Babylon 基础场景（1 相机 + 2 灯光 + 不可见地面） |
| 动作 | VMD 加载 + 图层叠加 + 感知层 + 程序化动作 + Ragdoll | 无 |
| 模型 | PMX 加载 + 换装 + 材质编辑器 + 预设 | 仅 PMX 加载 + IndexedDB 模型库 |
| 代码量 | ~50+ 模块文件 | ~570 行 main.ts |

用户诉求：**统一两者**，而非维护两套界面与功能割裂的入口。

### 关键量化发现（2026-07-23 实测）

ADR-176 已铺好统一的基础设施，主应用跑浏览器的硬依赖面极窄：

| 指标 | 数量 | 评估 |
|------|------|------|
| `window.wails?.xxx?.()` 可选链兜底 | 7 处 / 3 文件 | 浏览器侧静默 no-op，**不崩** |
| `window.wails!.xxx` 断言调用 | **1 处** / 1 文件（`init.ts:456` Android 存储权限） | 需 web 分支守卫 |
| `Events.On/Off/Emit` 调用 | 11 处 / 3 文件（`init.ts`、`plaza-download.ts`、`watch-import.ts`） | 需 Events 抽象或 stub 注入 |
| `wails-bindings.ts` 已代理化函数 | 106 / 139（76%） | **已完成**，业务调用零改动经 `resolveBackend()` 路由 |
| `@wailsio/runtime` value import 来源 | `@bindings/app.ts:11` + `wails-bindings.ts:13` | web-loader 已用 stub 隔离 |

结论：**主应用跑浏览器的潜力比直觉大得多**——硬阻塞点仅 1 处断言 + 11 处 Events，基础设施（backend 代理层）已就位。

## 决策树：三个统一方向

### 方向 A：主应用直接跑浏览器（推荐）

**方案**：改造主应用 `index.html` + `init.ts`，让同一套代码在 Wails（桌面/安卓）和浏览器两环境运行。原生独占功能（AR、外部程序、模型广场窗口控制）用 `capabilities()` 屏蔽 UI。web-loader 降级为轻量入口或废弃。

**改造点清单**：

| # | 改造点 | 文件 | 工作量 | 风险 |
|---|--------|------|--------|------|
| A1 | `index.html` web 入口变体 | 新增 `index.web.html`（移除 `<script src="/lib/babylon.js">` UMD，置 `__MMKU_WEB__=true`） | 小 | 低 |
| A2 | `init.ts` web 分支守卫 | `core/init.ts:456` `window.wails!` 加 `if (isWebPlatform()) return` 早返 | 极小 | 低 |
| A3 | Events 抽象 | 新建 `core/events-bridge.ts`，Wails 侧透传 `@wailsio/runtime`，web 侧 no-op（复用 web-loader stub） | 小 | 中（11 处调用点需迁移 import） |
| A4 | bootstrap web 分支 | `init.ts` 首屏链（`GetConfig`/`GetSystemA11ySettings`/`CheckForUpdate`/`initLibrary`）经 `resolveBackend()` 取数，web 侧 IndexedDB 兜底 | 中 | 中（首屏行为可能差异） |
| A5 | 原生独占 UI 降级 | 菜单系统按 `capabilities()` 隐藏 AR/外部程序/广场窗口入口 | 中 | 低（`guardExternalAction` 已扩展三态） |
| A6 | 构建配置统一 | `vite.web-loader.config.ts` 升级为 `vite.web.config.ts`，入口改 `index.web.html` | 小 | 低 |
| A7 | GitHub Pages workflow 更新 | `web-loader-pages.yml` 改构建入口 + base path | 极小 | 低 |

**总工作量**：中（A4/A5 是主体，A1-A3/A6/A7 是辅助）

**收益**：
- ✅ 一套代码两环境，**终极统一**
- ✅ 主应用完整 UI/功能在浏览器可用（原生独占降级）
- ✅ web-loader 可废弃或保留为轻量入口
- ✅ 长期维护成本最低（无两套代码漂移）
- ✅ ADR-176 终极目标达成

**风险**：
- 🟠 bootstrap 改造可能引入回归（A4）——需充分测试
- 🟠 Events 抽象需迁移 11 处调用点（A3）——机械工作但需仔细
- 🟡 首屏数据源切换在浏览器侧的行为差异（IndexedDB vs Go 文件系统）

### 方向 B：web-loader 复用主应用 UI（折中）

**方案**：把主应用的 `app.css`、菜单系统、UI 组件搬到 web-loader，保留两套入口但 UI 风格一致。

**改造点清单**：

| # | 改造点 | 工作量 | 风险 |
|---|--------|--------|------|
| B1 | `app.css` 接入 web-loader | 小 | 低 |
| B2 | 菜单系统（menu-schema + menu-factory）迁移 | 大 | 中（需适配 backend 调用） |
| B3 | 底部导航 + 播放栏 + Toast 组件迁移 | 中 | 中 |
| B4 | web-loader 重写为菜单驱动 | 大 | 中 |

**总工作量**：中-大

**收益**：
- ✅ UI 风格统一
- ❌ 功能仍简陋（菜单渲染了但底层场景/动作/环境模块未接入）
- ❌ 维护两套代码，长期漂移风险高
- ❌ 本质是「复制主应用 UI 壳到 web-loader」，未解决功能割裂

**风险**：
- 🔴 复制粘贴式迁移，维护成本高
- 🔴 菜单壳渲染了但底层功能未接入，用户体验更差（「幽灵入口」）
- 🟠 长期看是反模式（违反 DRY）

### 方向 C：web-loader 渐进式增强（过渡）

**方案**：保留 web-loader 独立架构，逐个接入主应用功能模块（先菜单系统，再场景，再环境）。每步可验证。

**改造点清单**：持续投入，无明确终点

**总工作量**：持续

**收益**：
- ✅ 每步可验证，风险低
- ❌ 长期是过渡方案，最终仍需方向 A 统一
- ❌ 接入过程中 web-loader 与主应用功能重叠，维护成本上升

**风险**：
- 🟠 渐进式迁移过程中两套代码并存，漂移风险
- 🟡 无明确完成信号，易半途而废

## 候选方案对比表

| 维度 | 方向 A（主应用跑浏览器） | 方向 B（web-loader 复用 UI） | 方向 C（渐进式增强） |
|------|--------------------------|------------------------------|---------------------|
| 统一程度 | ★★★★★ 终极统一 | ★★★☆ UI 统一功能割裂 | ★★☆☆ 渐进但无终点 |
| 工作量 | 中（7 改造点） | 中-大（4 大改造点） | 持续投入 |
| 风险 | 中（bootstrap 回归） | 高（幽灵入口 + DRY 违反） | 中（漂移 + 半途而废） |
| 长期维护成本 | ★ 最低 | ★★★ 两套代码 | ★★ 渐进收敛 |
| ADR-176 目标达成 | ✅ 终极 | ❌ 偏离 | ⚠️ 部分 |
| 用户功能完整性 | ★★★★★ 完整（降级原生独占） | ★★☆ UI 壳无功能 | ★★☆ 逐步补全 |
| 测试覆盖 | 复用主应用现有测试 | 需新建 web-loader 测试 | 渐进补充 |

## 推荐：方向 A

**理由**：

1. **基础设施已就位**：ADR-176 Phase 1-3 已将 wails-bindings 全代理化（106 函数），backend 适配器层（go/browser）+ `resolveBackend()` 三路径 + `capabilities()` 三态矩阵 + `isWebPlatform()` + `guardExternalAction` 全部落地。方向 A 是「在已铺好的路上走最后一段」。

2. **硬阻塞面极窄**：实测 `window.wails!` 断言仅 1 处，Events 依赖 11 处（3 文件）。相比 106 函数代理化已完成的工作量，剩余改造是收尾性质。

3. **主应用 UI 系统复用价值高**：ADR-093 声明式菜单 Schema 已全量落地，菜单系统是数据驱动而非硬编码。同一套 Schema + menu-factory 在浏览器侧可直接渲染。

4. **web-loader 已验证浏览器侧可行性**：PMX 加载 + JSZip + IndexedDB + babylon-mmd 在零后端下完全可用（ADR-176 Phase 3 实测）。方向 A 是「把 web-loader 的浏览器验证扩展到主应用全量」。

5. **方向 B/C 是反模式**：B 违反 DRY（复制 UI 壳），C 是无终点的过渡。两者最终都需收敛到方向 A。

6. **ADR-176 终极目标**：ADR-176 开篇即写「一个前端同时跑在浏览器（零后端）和 Wails（含 Go 后端）两种环境」。方向 A 是这一目标的直接实现。

## 实施路径（方向 A）

### Phase 1：bootstrap web 分支（A1-A3）

**目标**：主应用 `index.html` 在浏览器侧能启动不崩。

| 步骤 | 改造 | 验证 |
|------|------|------|
| A1 | 新增 `index.web.html`（移除 babylon UMD，置 `__MMKU_WEB__=true`，入口 `core/main.ts`） | 浏览器打开无 JS 错误 |
| A2 | `init.ts:456` `window.wails!` 加 `if (isWebPlatform()) return` 早返 | 浏览器侧不崩 |
| A3 | 新建 `core/events-bridge.ts`：Wails 侧透传 `@wailsio/runtime` Events，web 侧复用 web-loader stub | 11 处 Events 调用迁移 import |

### Phase 2：首屏数据源 + UI 降级（A4-A5）

**目标**：浏览器侧首屏有数据 + 原生独占入口隐藏。

| 步骤 | 改造 | 验证 |
|------|------|------|
| A4 | `init.ts` 首屏链经 `resolveBackend()` 取数；web 侧 IndexedDB 兜底默认配置 | 首屏有配置/UIState |
| A5 | 菜单系统按 `capabilities()` 隐藏 AR/外部程序/广场窗口入口 | 无「幽灵入口」 |

### Phase 3：构建配置 + 部署（A6-A7）

**目标**：GitHub Pages 部署主应用 web 入口。

| 步骤 | 改造 | 验证 |
|------|------|------|
| A6 | `vite.web-loader.config.ts` 升级为 `vite.web.config.ts`，入口改 `index.web.html` | 生产构建通过 |
| A7 | `web-loader-pages.yml` 改构建入口 | GitHub Pages 部署成功 |

### Phase 4：web-loader 处置

- 选项 1：废弃 `web-loader.html`（主应用 web 入口已覆盖）
- 选项 2：保留为轻量入口（仅拖拽加载，无菜单），作为「快速预览」入口

## 风险表

| 风险 | 等级 | 缓解 |
|------|------|------|
| bootstrap 改造引入主应用回归（桌面/安卓） | 🟠 P2 | 改动需 `if (isWebPlatform())` 守卫，桌面/安卓路径不动；CI 全量回归 |
| Events 抽象迁移遗漏调用点 | 🟠 P2 | grep `Events\.(On\|Off\|Emit)` 全量迁移，迁移后 grep 零残留 |
| 首屏行为差异（IndexedDB vs Go 文件系统） | 🟡 P3 | web 侧 IndexedDB 兜底默认配置；首屏加载差异用 Toast 提示 |
| babylon UMD 移除影响桌面端 | 🟡 P3 | 仅 `index.web.html` 移除 UMD，`index.html` 桌面入口不动 |
| 主应用 bundle 体积过大（babylon 全量打包） | 🟡 P3 | web 构建用 manualChunks 拆分（已在 vite.web-loader.config.ts 验证） |
| 原生独占 UI 降级遗漏入口 | 🟡 P3 | 按 `capabilities()` 矩阵逐项 grep 审计 |

## 边界条件

- **不追求功能全等**：AR（ARCore/Vuforia）、外部程序（Blender/MMD）、系统级文件遍历属原生独占，浏览器侧必须降级，不得伪造（对齐 ADR-176 边界）。
- **持久化语义差异**：Go 侧为单机文件，浏览器侧为 IndexedDB（同源隔离），跨设备不互通——文档需明示。
- **`@wailsio/runtime` 隔离**：web 构建用 stub 替换（ADR-176 web-loader 已验证），主应用 `vite.config.ts` 不受扰动。
- **菜单 Schema 复用**：ADR-093 声明式菜单 Schema 是数据驱动，同一套 Schema 在浏览器侧直接渲染，无需复制菜单代码。

## 与现有架构的关系

- **ADR-176（核心前置）**：方向 A 是 ADR-176 终极目标的实现。backend 适配器层、wails-bindings 代理化、capabilities() 矩阵、isWebPlatform() 全部复用。
- **ADR-017（platform 探测）**：复用 `isAndroidPlatform()` 范式，`isWebPlatform()` 已在 ADR-176 新增。
- **ADR-159（桥接注入）**：`awaitWailsBridge()` + Web 入口短路标记复用。
- **ADR-093（声明式菜单）**：菜单 Schema 数据驱动，浏览器侧零改动渲染。
- **ADR-060（E2E 测试）**：web 入口可用 Playwright `@dom` spec 覆盖。

## 待决策

**需用户确认**：
1. 是否采纳方向 A 作为统一路径？
2. 若采纳，Phase 1-3 优先级排序是否合理？
3. web-loader 在 Phase 4 是废弃还是保留为轻量入口？

**若用户选方向 B 或 C**：本 ADR 的「实施路径」节需重写，其余评估仍有效。
