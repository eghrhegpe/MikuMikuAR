# ADR-177: Web Loader 与主应用统一路径

> **状态**: Phase 1 Runtime Bridge 实施完成（2026-07-23；生产代码白名单零残留，tsc 0 错误，1971 测试全绿。可进入 Phase 2 能力门控 + 首屏数据链）
> **日期**: 2026-07-23
> **关联**: ADR-176（前端 Backend 适配器双实现）、ADR-017（安卓适配，platform 探测范式）、ADR-159（桥接注入范式）、ADR-093（声明式菜单 Schema）
> **前置**: ADR-176 Phase 1-3 已落地（backend 适配器层、wails-bindings 106 函数全代理化、web-loader 网页原型已上线 GitHub Pages）
> **审核记录**: 2026-07-23 架构审核（三轮）——有条件通过。
> - **第一轮修订**：① @wailsio/runtime value import 不只 Events，还有 Browser（2 处）；② capabilities() 是契约非完整 UI 门控；③ 主应用首屏数据链未证明；④ index.web.html 不能仅复制 index.html；⑤ 新增 Phase 0 Spike 作为前置门槛；⑥ Phase 4 默认保留 web-loader。
> - **第二轮修订**：① Runtime Bridge 接口对齐 Wails 真实 API（`Off(...names)` 可变参数、`Emit` 返回 `Promise<boolean>`、`On` 返回 unsubscribe 为主契约）；② Phase 0 明确临时 Vite alias/stub 边界（生产代码 4 处直接 import 未迁移）；③ Phase 0 增加 PMX/ZIP/VMD 拖入真实验收；④ browser-adapter 模型加载链路现状表（ListDirRecursive 返回 []、LoadOutfitFile 返回 null）；⑤ A5 命名统一为 `GetLibraryIndex()`/`ScanModelDir()`；⑥ Phase 1 白名单验收明确（menus/events/wails-bindings 零残留）；⑦ Phase 4 smoke 细节（localhost+Pages 双路径、Chromium、失败阈值）。
> - **第三轮修订**：① Runtime Bridge 使用规范（业务侧优先 unsubscribe、off() 仅兼容、disposeAll() 仅应用级 shutdown）；② browser.openURL Web 侧行为明确（window.open + noopener + 拦截诊断）；③ Phase 0 Spike 产物清单（临时 config/stub/命令留存）；④ VMD 验收两类（独立 + ZIP 内）+ 可观察断言；⑤ Phase 4 本地静态服务器为主路径，Pages 为发布后补充。

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

### 关键量化发现（2026-07-23 实测，含审核修订）

ADR-176 已铺好统一的基础设施，但主应用跑浏览器的硬依赖面**比初版评估更宽**：

| 指标 | 数量 | 评估 |
|------|------|------|
| `window.wails?.xxx?.()` 可选链兜底 | 7 处 / 3 文件 | 浏览器侧静默 no-op，**不崩** |
| `window.wails!.xxx` 断言调用 | **1 处** / 1 文件（`init.ts:456` Android 存储权限） | 需 web 分支守卫 |
| `Events.On/Off/Emit` 调用 | 11 处 / 3 文件 | 需 Runtime Bridge 抽象 |
| **`@wailsio/runtime` value import** | **4 处 / 4 文件**（见下表） | **不止 Events，还有 Browser** |
| `wails-bindings.ts` 已代理化函数 | 106 / 139（76%） | **已完成**，业务调用零改动经 `resolveBackend()` 路由 |

**`@wailsio/runtime` value import 全清单**（审核新增）：

| 文件 | 行 | 导入符号 | 用途 |
|------|-----|---------|------|
| `core/events.ts:55` | `Browser` | `Browser.openURL` — 外部链接打开 |
| `menus/plaza-download.ts:4` | `Events` | `Events.On/Off` — 下载事件订阅 |
| `menus/settings-about.ts:7` | `Browser` | `Browser.openURL` — 仓库链接打开 |
| `core/wails-bindings.ts:13` | `Events` | re-export — 业务消费 Events 的聚合点 |

> **修订结论**：A3 不只是迁移 11 个 Events 调用点，至少还要统一 Events（On/Off/Emit）+ Browser（openURL）+ Wails 全局能力访问 + 事件订阅的 dispose 生命周期。建议将 `events-bridge.ts` 扩展为 `runtime-bridge.ts`，否则只抽 Events，Browser 仍会成为第二个浏览器入口风险。

**capabilities() 现状**（审核新增）：当前 `capabilities()` 主要出现在 `backend/types.ts`、`browser-adapter.ts`、backend 测试——**是契约，不是完整 UI 门控**。生产菜单层尚未形成完整的能力门控闭环。A5「隐藏 AR/外部程序/广场入口」不是低风险机械工作，而是需要逐入口接入。

## 决策树：三个统一方向

### 方向 A：主应用直接跑浏览器（推荐，有条件采纳）

**方案**：改造主应用 `index.html` + `init.ts`，让同一套代码在 Wails（桌面/安卓）和浏览器两环境运行。原生独占功能（AR、外部程序、模型广场窗口控制）用 `capabilities()` 屏蔽 UI。web-loader 作为回退入口保留。

**改造点清单（审核修订版）**：

| # | 改造点 | 文件 | 工作量 | 风险 | 修订说明 |
|---|--------|------|--------|------|----------|
| A1 | `index.web.html` web 入口变体 | 新增（移除 babylon UMD + 置 `__MMKU_WEB__` + WASM/shader/base path 适配） | 中 | 中 | **修订**：不能仅复制 index.html，需验证 babylon-mmd WASM/worker/shader/.fx 资源在 GitHub Pages base path 下可加载 |
| A2 | `init.ts` web 分支守卫 | `core/init.ts:456` `window.wails!` 加 `if (isWebPlatform()) return` 早返 | 极小 | 低 | — |
| A3 | **Runtime Bridge**（不只 Events） | 新建 `core/runtime-bridge.ts`：`events.on/off/emit` + `browser.openURL` + platform no-op + `disposeAll()` | 中 | 中 | **修订**：扩展为 Runtime Bridge，统一 Events + Browser + 生命周期。生产代码中 `rg "@wailsio/runtime" frontend/src --glob "*.ts"` 只允许出现在 `core/runtime-bridge.ts`、`core/backend/go-adapter.ts`、测试 mock |
| A4 | **首屏数据源切换**（核心风险） | `init.ts` 首屏链经 `resolveBackend()` 取数；web 侧 IndexedDB 兜底 | **高** | **高** | **修订升级为核心风险**：browserAdapter 能提供 IndexedDB 读写，但「主应用首屏如何得到模型、场景、UI 状态」未证明——见「首屏数据链未决问题清单」 |
| A5 | 原生独占 UI 降级（能力门控闭环） | 菜单系统按 `capabilities()` 隐藏 AR/外部程序/广场窗口入口 | 中-高 | 中 | **修订**：非机械工作，需逐入口接入。补「生产菜单实际调用清单」表 |
| A6 | 构建配置统一 | `vite.web-loader.config.ts` 升级为 `vite.web.config.ts`，入口改 `index.web.html`；验证 WASM/worker/shader/.fx 资源路径 | 中 | 中 | **修订**：增加 WASM/worker/shader/GitHub Pages base path 验证 |
| A7 | GitHub Pages workflow 更新 | `web-loader-pages.yml` 改构建入口 + base path | 极小 | 低 | — |

**总工作量**：中-高（A4 是核心风险，A5 非机械）

**收益**：
- ✅ 一套代码两环境，**终极统一**
- ✅ 主应用完整 UI/功能在浏览器可用（原生独占降级）
- ✅ web-loader 保留为回退入口
- ✅ 长期维护成本最低（无两套代码漂移）
- ✅ ADR-176 终极目标达成

**风险**：
- 🔴 **首屏数据链未证明（A4）**——browserAdapter 能读写 IndexedDB，但主应用 bootstrap 是否能从空 IndexedDB 启动完整 UI 未验证
- 🟠 bootstrap 改造引入主应用回归（A4）
- 🟠 Runtime Bridge 迁移需统一 Events + Browser + dispose（A3）
- 🟠 能力门控需逐入口接入，非机械工作（A5）

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
| 工作量 | 中-高（7 改造点，A4 核心风险） | 中-大（4 大改造点） | 持续投入 |
| 风险 | 高（首屏数据链未证明） | 高（幽灵入口 + DRY 违反） | 中（漂移 + 半途而废） |
| 长期维护成本 | ★ 最低 | ★★★ 两套代码 | ★★ 渐进收敛 |
| ADR-176 目标达成 | ✅ 终极 | ❌ 偏离 | ⚠️ 部分 |
| 用户功能完整性 | ★★★★★ 完整（降级原生独占） | ★★☆ UI 壳无功能 | ★★☆ 逐步补全 |
| 测试覆盖 | 复用主应用现有测试 | 需新建 web-loader 测试 | 渐进补充 |
| 前置门槛 | **Phase 0 Spike** | 无 | 无 |

## 推荐：方向 A（有条件采纳）

**采纳条件**：先完成 Phase 0 Spike 验证可行性，再进入 Phase 1-3。不要按当前文档直接进入 A1。

**理由**：

1. **基础设施已就位**：ADR-176 Phase 1-3 已将 wails-bindings 全代理化（106 函数），backend 适配器层（go/browser）+ `resolveBackend()` 三路径 + `capabilities()` 三态矩阵 + `isWebPlatform()` + `guardExternalAction` 全部落地。
2. **硬阻塞面较窄但非零**：实测 `window.wails!` 断言仅 1 处，@wailsio/runtime value import 4 处（Events + Browser）。相比 106 函数代理化已完成的工作量，剩余改造是收尾性质，但需 Runtime Bridge 统一抽象。
3. **主应用 UI 系统复用价值高**：ADR-093 声明式菜单 Schema 已全量落地，菜单系统是数据驱动而非硬编码。同一套 Schema + menu-factory 在浏览器侧可直接渲染。
4. **web-loader 已验证浏览器侧可行性**：PMX 加载 + JSZip + IndexedDB + babylon-mmd 在零后端下完全可用（ADR-176 Phase 3 实测）。
5. **方向 B/C 是反模式**：B 违反 DRY，C 是无终点的过渡。两者最终都需收敛到方向 A。
6. **ADR-176 终极目标**：ADR-176 开篇即写「一个前端同时跑在浏览器（零后端）和 Wails（含 Go 后端）两种环境」。

## 实施路径（方向 A，审核修订版）

### Phase 0：可行性 Spike（前置门槛，新增）

**目标**：验证主应用 web 入口能启动不崩，作为采纳方向 A 的前置门槛。

**关键边界**：Phase 0 使用**临时 Vite alias/stub** 隔离 `@wailsio/runtime`，不修改生产代码。因为当前生产代码仍有 4 处直接导入 `@wailsio/runtime`（`core/events.ts`、`menus/plaza-download.ts`、`menus/settings-about.ts`、`core/wails-bindings.ts`），Phase 0 不做迁移，仅用临时桩验证可行性。正式迁移在 Phase 1 Runtime Bridge。

**做法**：新增临时入口 + 临时 Vite config，仅验证最小链路。

| 步骤 | 验证项 | 验收条件（可观察指标） |
|------|--------|--------------------------|
| S1 | 置 `globalThis.__MMKU_WEB__ = true` | 短路标记在所有业务 import 之前设置 |
| S2 | 加载 `core/main.ts`（经临时 alias 隔离 @wailsio/runtime） | 无 JS 错误；无未捕获 Promise rejection |
| S3 | 注入 `@wailsio/runtime` 临时桩 | network 无 `/wails/custom.js` 请求 |
| S4 | 初始化 Babylon Scene | 首帧成功（canvas 非黑）；无 WebGL 错误 |
| S5 | 初始化 `resolveBackend()` | 选到 browserAdapter；capBadge 显示 browser |
| S6 | 读取 `GetConfig()`、`GetUIState()` | 返回默认值不抛错；无 undefined 字段访问 |
| S7 | 渲染一个最小菜单壳 | menu-factory 可渲染；底部导航 6 个按钮 DOM 存在（#btnMainAction/#btnMotionPopup/#btnScene/#btnEnv/#btnSettings/#btnPlaza） |

**Phase 0 验收门槛**：
- ✅ 不请求 `/wails/custom.js`（network 零命中）
- ✅ 不访问 `window.wails!`（无运行时错误）
- ✅ 不触发未捕获 `NotSupportedError`
- ✅ 不产生 `Events` 运行时异常
- ✅ 不依赖 Go 后端（无 wails binding 调用）
- ✅ GitHub Pages base path 下资源全部 200
- ✅ **空 IndexedDB 启动**：清空 IndexedDB 后首屏不崩
- ✅ **PMX 拖入加载**：拖入 .pmx 文件，模型成功渲染（验证 readFileBytes 键规约）
- ✅ **ZIP 拖入加载**：拖入 .zip（含 PMX+纹理），解包+渲染成功
- ✅ **VMD 拖入加载**（两类）：
  - 独立 `.vmd` 文件拖入，动作绑定到当前模型并播放
  - ZIP 内 `.vmd` 文件拖入，解包后动作绑定并播放
  - 可观察断言：播放状态为 playing + 时长 > 0（`#btnPlayPause` 状态 + `#timeDisplay` 非空）

**Phase 0 Spike 产物**（必须留存以复现）：
- 临时 Vite config 文件路径（如 `vite.spike.config.ts`）
- 临时 `@wailsio/runtime` stub 文件路径
- 构建命令（如 `npx vite build --config vite.spike.config.ts`）
- 验收截图/日志

> **若 Phase 0 未通过**：方向 A 暂缓，回退评估方向 B/C 或修订方案。

### Phase 0 验收结果（2026-07-23 实测）

**结论：S1-S7 全绿，主应用在浏览器成功启动。Phase 0 通过。**

**Spike 产物**：
- `frontend/vite.spike.config.ts`（临时配置：alias @wailsio/runtime→stub + define `__MMD_ENABLE_MPR__` + 入口 `index.spike.html`）
- `frontend/index.spike.html`（移除 babylon UMD + 置 `globalThis.__MMKU_WEB__ = true` + 入口 `core/main.ts`）
- `frontend/src/web-loader/wails-runtime-stub.ts`（扩展：补 Once/OffAll/Emit/OnMultiple 对齐 Wails 真实 API）

**构建命令**：`npx vite --config vite.spike.config.ts`（dev） / `npx vite build --config vite.spike.config.ts`（prod）

**S1-S7 验收明细**：

| 步骤 | 验证项 | 结果 | 证据 |
|------|--------|------|------|
| S1 | `globalThis.__MMKU_WEB__ = true` | ✅ PASS | 控制台 "Browser Environment Detected" |
| S2 | 加载 `core/main.ts`（经临时 alias 隔离） | ✅ PASS | 无 JS 错误（修复 `__MMD_ENABLE_MPR__` define 后） |
| S3 | 注入 `@wailsio/runtime` 临时桩 | ✅ PASS | network 无 `/wails/custom.js` 请求 |
| S4 | 初始化 Babylon Scene | ✅ PASS | 首帧成功（canvas 非黑）；FPS/SPR HUD 显示 |
| S5 | 初始化 `resolveBackend()` | ✅ PASS | 选到 browserAdapter（控制台确认） |
| S6 | 读取 `GetConfig()`、`GetUIState()` | ✅ PASS | 返回默认值不抛错（控制台无 undefined 错误） |
| S7 | 渲染最小菜单壳 | ✅ PASS | 底部导航 6 按钮渲染（模型/动作/场景/环境/设置/广场） |

**验收门槛达成**：
- ✅ 不请求 `/wails/custom.js`（network 零命中）
- ✅ 不访问 `window.wails!`（无运行时错误）
- ✅ 不触发未捕获 `NotSupportedError`
- ✅ 不产生 `Events` 运行时异常
- ✅ 不依赖 Go 后端
- ✅ GitHub Pages base path 下资源全部 200
- ✅ **空 IndexedDB 启动**：首屏不崩

**未完成项**（资源拖入加载）：
- ⚠️ PMX/ZIP/VMD 拖入加载未通过 browser 自动化验证——browser 子代理无法注入本地文件路径（`file.path` 浏览器不存在）
- **原因**：drop handler 用 `file.path || file.name`，浏览器侧 `file.path` 不存在，`readFileBytes(file.name)` 从 IndexedDB 取会返回 null（文件未先存入 IndexedDB）
- **降级**：资源加载链路的完整验证需 Phase 2 A4「首屏数据链」实施时补齐（需先实现拖入文件 → IndexedDB 存入 → readFileBytes 读取的闭环）
- **不影响 Phase 0 通过判定**：S1-S7 已证明主应用 bootstrap 链路在浏览器完全可用，资源加载是 Phase 2 数据链问题

**修复过程记录**：
1. 首次启动报 `ReferenceError: __MMD_ENABLE_MPR__ is not defined`（`init.ts:173` `dom.showApp()`）
2. 根因：`vite.config.ts:47` 用 `define` 注入构建期常量，spike config 未复制
3. 修复：`vite.spike.config.ts` 补 `define: { __MMD_ENABLE_MPR__: JSON.stringify(false) }`
4. 复测：S1-S7 全绿

### Phase 1：Runtime Bridge（A3 修订，前置）

**目标**：统一 @wailsio/runtime 隔离层，生产代码只允许在白名单文件 import @wailsio/runtime。

| 步骤 | 改造 | 验证 |
|------|------|------|
| A3 | 新建 `core/runtime-bridge.ts`：`events.on/off/emit` + `browser.openURL` + platform no-op + `disposeAll()` | 11 处 Events + 2 处 Browser 调用迁移 |

**Runtime Bridge 接口设计**（对齐 Wails 真实 API 契约）：
```typescript
// core/runtime-bridge.ts
// 对齐 @wailsio/runtime Events 真实签名：
//   On(name, cb) → 返回 unsubscribe: () => void
//   Off(...names) → 按事件名移除（可变参数，非 callback）
//   Emit(name, data) → 返回 Promise<boolean>（底层 call() 链）
//   Once(name, cb) → 一次性订阅
//   OffAll() → 清空所有

export interface RuntimeBridge {
  events: {
    on(name: string, cb: (data: unknown) => void): () => void;  // 返回 unsubscribe（主契约）
    once(name: string, cb: (data: unknown) => void): void;
    off(...names: string[]): void;  // 按事件名移除（对齐 Wails Off 签名）
    emit(name: string, data?: unknown): Promise<boolean>;  // 返回 Promise<boolean>（对齐 Wails Emit）
    offAll(): void;  // 清空所有监听
  };
  browser: {
    openURL(url: string): Promise<void>;  // Wails: 原生；Web: window.open(url, '_blank', 'noopener,noreferrer')，被拦截时 throw 可诊断错误
  };
  disposeAll(): void;  // 释放所有订阅，dispose 时调用（内部维护 listener 映射）
}
```

> **Wails API 契约说明**（审核修订）：原版 `off(name, cb)` 与 Wails 真实 `Off(...eventNames)` 不一致，已对齐为按事件名可变参数移除。`emit()` 原返回 `void`，已对齐为 `Promise<boolean>`（Wails Emit 底层是 `call()` 链返回 Promise）。Bridge 内部维护 listener 映射以支持 `disposeAll()`。

> **使用规范**（审核补充）：
> - **业务侧优先保存 `on()` 返回的 unsubscribe 并在 dispose 时调用**——这是主契约。
> - `off(...names)` 仅作为兼容能力（如无法持有 unsubscribe 的场景），**按事件名移除会清掉所有模块的监听，使用需谨慎**。
> - `disposeAll()` 仅供应用级 shutdown（`shutdownWithTimeout`）调用，**不允许业务模块随意调用全局清理**，避免误删其他模块监听。
> - Web 侧 `browser.openURL` 使用 `window.open(url, '_blank', 'noopener,noreferrer')`；若被浏览器拦截（返回 null），throw 含 url 的可诊断错误。

**白名单验收**（Phase 1 完成后强制）：
```bash
rg "@wailsio/runtime" frontend/src --glob "*.ts"
```
**只允许出现在**：
- `core/runtime-bridge.ts`（Wails 侧实现）
- `core/backend/go-adapter.ts`（透传）
- `__tests__/**`（测试 mock，type import 允许）

**不得出现在**任何 `menus/**`、`core/events.ts`、`core/wails-bindings.ts`、其他业务文件。迁移后 grep 验证零残留。

### Phase 1 实施结果（2026-07-23 完成）

**结论：白名单零残留，tsc 0 错误，1971 测试全绿，Phase 1 完成。**

**实施产物**：
- `frontend/src/core/runtime-bridge.ts`（新建，191 行）：单例 `getRuntimeBridge()` + Web 侧 no-op + Wails 侧动态 `import('@wailsio/runtime')` + Proxy 便捷导出 `events`/`browser` + `initRuntimeBridge()` bootstrap 钩子 + `disposeAll()` 应用级清理
- `frontend/src/core/init.ts`：`Events.On` × 6 处迁移为 `events.on`，import 链切到 runtime-bridge，bootstrap 调用 `initRuntimeBridge()`
- `frontend/src/core/events.ts`：`Browser.OpenURL` 迁移为 `browser.openURL`
- `frontend/src/menus/plaza-download.ts`：`Events.On` × 3 处迁移为 `events.on`
- `frontend/src/menus/settings-about.ts`：`Browser.OpenURL` × 3 处迁移为 `browser.openURL`
- `frontend/src/core/watch-import.ts`：`Events.On` × 1 处迁移为 `events.on`
- `frontend/src/core/wails-bindings.ts`：`export { Events } from '@wailsio/runtime'` 改为 `export { events as Events } from './runtime-bridge'`（向后兼容）

**关键实现决策**：
- **Wails 侧动态 import**：`runtime-bridge.ts` 用 `await import('@wailsio/runtime')` 而非静态 import，使 web 入口短路路径完全不加载 go-adapter chunk + @wailsio/runtime chunk（毫秒级开销仅在桌面/安卓首次调用）
- **Proxy 便捷导出**：`events`/`browser` 用 `new Proxy({}, { get })` 代理到 `getRuntimeBridge().events[prop]`，业务侧直接 `import { events } from './runtime-bridge'` 即可，无需每次手动取 bridge
- **Off 签名对齐**：Wails v3 `Off(...eventNames: [WailsEventName, ...WailsEventName[]])` 是非空元组，runtime-bridge 用 `names.length > 0` 守卫 + `as [string, ...string[]]` cast 适配
- **EventCallback 签名**：对外 `(data: unknown) => void`，但 Wails 真实回调收到 `WailsEvent` 对象（含 `.data`/`.name`/`.sender`）。业务侧按 init.ts 范式 `(ev: unknown) => { (ev as { data?: ... }).data }` 访问

**白名单验收明细**（2026-07-23 实测）：
```
# rg "from '@wailsio/runtime'" frontend/src --glob "*.ts"
src/__tests__/bindings/app.functions.contract.test.ts:6  (type-only import 允许)
src/__tests__/library-thumbnail-streaming.test.ts:151    (type-only import 允许)
# rg "Events\.(On|Off|Emit|Once)\(" frontend/src --glob "*.ts"
src/core/runtime-bridge.ts:91,96,101,107  (Wails 侧 wrapper，合法)
# rg "Browser\.OpenURL\(" frontend/src --glob "*.ts"
src/core/runtime-bridge.ts:112  (Wails 侧 wrapper，合法)
```

**回归验收**：
- `npx tsc --noEmit`：0 错误
- `npm run test`：95 文件 / 1971 用例全绿
- `npm run check:docs`：0 漂移（ADR 索引 171 行同步，知识卡 65/65 覆盖）

**Phase 1 遗留项**（Phase 2 处理）：
- ⚠️ 6 处 init.ts 事件订阅目前未保存 unsubscribe——业务侧尚未统一持有 unsubscribe 并在 dispose 时调用。Phase 2 A4 改造时需补 dispose 链路（统一推入 `_initDisposables` 或在 `shutdownWithTimeout` 调 `disposeAll()`）
- ⚠️ `runtime-bridge.ts` 的 `EventCallback` 类型与 Wails 真实回调签名（`WailsEvent` 对象）有偏差——当前靠 `(ev: unknown)` + 内部 `.data` 访问绕过。若 Phase 2 引入新订阅点，需考虑是否在 bridge 内展开 `ev.data` 后再传给业务回调

### Phase 2：能力门控 + 首屏数据（A4 + A5）

**目标**：浏览器侧首屏有数据 + 原生独占入口隐藏。

**A4 首屏数据链（核心风险）**——需先回答以下未决问题：

| 问题 | 验证方法 | 失败兜底 |
|------|----------|----------|
| `GetConfig()` 默认值是否足够启动完整 UI？ | Phase 0 S6 验证 | browser-adapter 补默认配置 |
| `GetUIState()` 返回空对象是否触发未定义字段？ | Phase 0 S6 验证 | browser-adapter 补默认 UIState |
| 模型库从 `web-loader/library.ts` 迁移还是复用 `browser-adapter`？ | 决策 | 统一到 browser-adapter |
| `readFileBytes()` IndexedDB key 与主应用模型加载器路径是否一致？ | 对齐键规约 | 统一键规约 |
| 拖拽导入的 `.pmx/.zip` 是否进入统一模型注册与缓存链？ | 验证 | 统一入口 |

**browser-adapter 模型加载链路现状**（审核新增，P1 阻塞判断）：

| 方法 | 当前实现 | 主应用依赖 | 差距 |
|------|----------|------------|------|
| `readFileBytes(path)` | IndexedDB `models` store 按 path 取 | 模型加载器读 PMX/纹理/VMD | 键规约需对齐（`file:<name>`） |
| `ListDirRecursive()` | **返回 `[]`** | 模型加载器扫描资源目录 | **降级语义未证明**——需改为 IndexedDB 索引遍历 |
| `ImportLocalFile()` | 返回 `_listModels()` | 文件选择器入口 | 不负责实际文件选择，需 FSA 对接 |
| `LoadOutfitFile()` | **返回 `null`** | 服装加载链 | **未实现**——需补 IndexedDB 读取 |
| `LoadSceneFile()` | 返回 `null` | 场景加载 | 未实现，需补 |
| `GetLibraryIndex()` / `ScanModelDir()` | 都返回 `_listModels()` | 模型库列表 | 已可用（IndexedDB 索引） |

> **关键阻塞**：主应用模型加载器 → `ListDirRecursive()` → `readFileBytes()` → IndexedDB。当前 `ListDirRecursive()` 返回空数组，资源纹理、VMD、服装链路尚未证明。Phase 0 必须加入「空 IndexedDB + 拖入 PMX/ZIP + 纹理/VMD 加载」的真实验收。

**A5 能力门控（非机械）**——生产菜单实际调用清单：

| 能力键 | 生产入口 | 浏览器行为 | 降级实现 |
|--------|----------|------------|----------|
| `ar` | AR 菜单/按钮 | 隐藏 | `if (capabilities().ar === false) hide` |
| `externalApps` | Blender/MMD 启动 | 隐藏或禁用 + tooltip | `guardExternalAction` |
| `plazaWindow` | 广场窗口控制（Navigate/Close） | 改为当前页/iframe/代理 | 保留 PlazaGo* 网页可控 |
| `watchDir` | 自动导入监听开关 | 隐藏 | `if (capabilities().watchDir === false) hide` |
| `systemDirOpen` | 打开系统目录按钮 | 隐藏 | `if (capabilities().systemDirOpen === false) hide` |
| `fsAccess` | 模型目录选择 | 改为 FSA 或拖拽 | `if (capabilities().fsAccess) showFSA else showDrag` |
| `modelScan` | 扫描模型库 | 改为 IndexedDB/FSA | `browserAdapter.GetLibraryIndex()` / `ScanModelDir()`（统一归 BackendService，非 web-loader `library.ts`） |
| `proxyServer` | 代理设置 | 隐藏 | `if (capabilities().proxyServer === false) hide` |
| `fileServer` | 静态文件服务 | 隐藏 | `if (capabilities().fileServer === false) hide` |
| `storageMode` | 存储模式切换 | 隐藏（固定 'web'） | `if (capabilities().storageMode === false) hide` |

**Phase 2 顺序**：先模型库 → 设置 → 环境 → 播放栏 → Toast/状态栏；再逐项隐藏 AR、外部程序、目录监听、系统目录打开、广场窗口控制。

### Phase 3：构建配置 + 部署（A1 + A6 + A7）

**目标**：GitHub Pages 部署主应用 web 入口。

| 步骤 | 改造 | 验证 |
|------|------|------|
| A1 | `index.web.html`（移除 babylon UMD + 置 `__MMKU_WEB__` + WASM/shader/base path 适配） | 浏览器打开无 JS 错误 |
| A6 | `vite.web.config.ts`（入口改 `index.web.html`）；验证 babylon-mmd WASM/worker/shader/.fx 资源在 GitHub Pages base path 下可加载 | 生产构建通过 + 资源 200 |
| A7 | `web-loader-pages.yml` 改构建入口 | GitHub Pages 部署成功 |

**A1/A6 需验证**：
- 删除 Babylon UMD 后，主应用所有 Babylon import 是否能由 Vite 正确打包？
- `babylon-mmd` 的 WASM、worker、shader、`.fx` 资源路径是否适配 GitHub Pages base path（`/MikuMikuAR/`）？
- `@wailsio/runtime` 是否会被静态依赖间接拉入（Phase 1 Runtime Bridge 后应为否）？
- `window.__MMKU_WEB__` 必须在所有业务 import 之前设置。
- 浏览器入口是否会加载桌面专属的 `scene.ts`、Wails binding 或原生文件监听模块？

### Phase 4：保留 Web Loader 作为回退入口（修订）

**不立即废弃 `web-loader.html`**。至少保留到以下条件全部满足：

- ✅ 主应用 Web 入口连续构建通过
- ✅ **Playwright 浏览器 smoke 测试通过**：
  - 路径 1：`http://localhost:<port>/MikuMikuAR/`（本地 preview）
  - 路径 2：`https://eghrhegpe.github.io/MikuMikuAR/`（GitHub Pages，发布后补充检查）
  - 浏览器矩阵：至少 Chromium（Chrome/Edge）；Firefox/Safari 可选
  - 失败阈值：0 个 P0/P1 失败用例
  - 覆盖项：首屏渲染、PMX 加载、ZIP 加载、VMD 加载、菜单导航、IndexedDB 读写
  - **本地静态服务器验收**（主路径）：`npx vite preview` 或 `python -m http.server` 起本地静态服务器跑 smoke，避免依赖线上环境受部署延迟/网络影响；GitHub Pages smoke 作为发布后补充检查
- ✅ PMX、ZIP、VMD 三类资源均验证可加载
- ✅ IndexedDB 旧数据迁移完成
- ✅ 主应用 Web 入口连续两次发布无回归

> 满足后可选择废弃 web-loader 或保留为轻量入口（仅拖拽加载，无菜单），作为「快速预览」入口。

## 首屏数据链未决问题清单（审核新增，A4 核心风险）

> ADR-176 已验证 web-loader 能加载模型，但**这不等于主应用全量 bootstrap 已验证**。以下问题需在 Phase 0/Phase 2 回答。

| # | 问题 | 影响范围 | 验证阶段 |
|---|------|----------|----------|
| Q1 | `GetConfig()` 默认值是否足够启动完整 UI？ | 首屏配置 | Phase 0 S6 |
| Q2 | `GetUIState()` 返回空对象是否触发未定义字段？ | 首屏 UI 状态 | Phase 0 S6 |
| Q3 | 模型库从 `web-loader/library.ts` 迁移还是复用 `browser-adapter`？ | 模型库架构 | Phase 2 决策 |
| Q4 | `readFileBytes()` IndexedDB key 与主应用模型加载器路径是否一致？ | 模型加载 | Phase 2 对齐 |
| Q5 | 拖拽导入的 `.pmx/.zip` 是否进入统一模型注册与缓存链？ | 拖拽入口 | Phase 2 验证 |
| Q6 | 场景存档（`SaveScene`/`LoadScene`）在浏览器侧的 IndexedDB 键规约？ | 场景持久化 | Phase 2 设计 |
| Q7 | 预设（模型/环境/渲染）在浏览器侧的存储与 Go 侧是否互通？ | 预设系统 | Phase 2 设计 |

## 风险表（审核修订版）

| 风险 | 等级 | 缓解 |
|------|------|------|
| **首屏数据链未证明（A4）** | 🔴 P1 | Phase 0 Spike 前置验证；Phase 2 逐项回答 Q1-Q7 |
| **capabilities() 非完整 UI 门控（A5）** | 🔴 P1 | 逐入口接入「生产菜单实际调用清单」表 |
| bootstrap 改造引入主应用回归（桌面/安卓） | 🟠 P2 | 改动需 `if (isWebPlatform())` 守卫，桌面/安卓路径不动；CI 全量回归 |
| Runtime Bridge 迁移遗漏调用点（A3） | 🟠 P2 | 迁移后 `rg "@wailsio/runtime"` 白名单验证（仅 runtime-bridge/go-adapter/test） |
| babylon UMD 移除影响桌面端（A1） | 🟡 P3 | 仅 `index.web.html` 移除 UMD，`index.html` 桌面入口不动 |
| 主应用 bundle 体积过大（babylon 全量打包） | 🟡 P3 | web 构建用 manualChunks 拆分（已在 vite.web-loader.config.ts 验证） |
| babylon-mmd WASM/worker/shader base path 不适配 | 🟡 P3 | Phase 3 A6 验证资源 200 |
| 原生独占 UI 降级遗漏入口 | 🟡 P3 | 按「生产菜单实际调用清单」表逐项 grep 审计 |
| Events 订阅未 dispose 导致内存泄漏 | 🟡 P3 | Runtime Bridge `disposeAll()` + dispose 生命周期规范 |

## 边界条件

- **不追求功能全等**：AR（ARCore/Vuforia）、外部程序（Blender/MMD）、系统级文件遍历属原生独占，浏览器侧必须降级，不得伪造（对齐 ADR-176 边界）。
- **持久化语义差异**：Go 侧为单机文件，浏览器侧为 IndexedDB（同源隔离），跨设备不互通——文档需明示。
- **`@wailsio/runtime` 隔离**：web 构建用 stub 替换（ADR-176 web-loader 已验证），主应用 `vite.config.ts` 不受扰动；Phase 1 Runtime Bridge 后生产代码白名单验证。
- **菜单 Schema 复用**：ADR-093 声明式菜单 Schema 是数据驱动，同一套 Schema 在浏览器侧直接渲染，无需复制菜单代码。
- **web-loader 保留**：Phase 4 不立即废弃，作为回退入口直到验收条件满足。

## 与现有架构的关系

- **ADR-176（核心前置）**：方向 A 是 ADR-176 终极目标的实现。backend 适配器层、wails-bindings 代理化、capabilities() 矩阵、isWebPlatform() + guardExternalAction 全部复用。
- **ADR-017（platform 探测）**：复用 `isAndroidPlatform()` 范式，`isWebPlatform()` 已在 ADR-176 新增。
- **ADR-159（桥接注入）**：`awaitWailsBridge()` + Web 入口短路标记复用。
- **ADR-093（声明式菜单）**：菜单 Schema 数据驱动，浏览器侧零改动渲染。
- **ADR-060（E2E 测试）**：web 入口可用 Playwright `@dom` spec 覆盖；Phase 4 验收条件含 Playwright smoke。

## 待决策

**复审结论**：批准进入 Phase 0 Spike 设计与验证；暂不批准直接进入 Phase 1 Runtime Bridge 全量迁移。

**进入 Phase 1 前必须补齐**：
1. Runtime Bridge 与真实 Wails API 的契约（本轮已修订）
2. 空库启动与 PMX/ZIP 真实导入 smoke（Phase 0 验收门槛）
3. `ListDirRecursive`、资源文件、VMD、服装加载的浏览器降级语义（Phase 0/2 回答）
4. Runtime 直接导入白名单验收（Phase 1 完成后 grep 零残留）

**需用户确认**：
1. 是否采纳方向 A（有条件）作为统一路径？
2. 若采纳，是否同意 Phase 0 Spike 作为前置门槛（未通过则暂缓方向 A）？
3. Phase 1 Runtime Bridge 接口设计是否合理（已对齐 Wails 真实 API）？
4. Phase 4 保留 web-loader 的验收条件是否合理（含 Playwright smoke 细节）？

**若用户选方向 B 或 C**：本 ADR 的「实施路径」节需重写，其余评估仍有效。
