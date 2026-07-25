# ADR-183: 网页端 FSA 根目录授权引导（四态探针 + 重授权兜底）

> **状态**: 已完成（代码已落地 + 单测 14/14，2026-07-26）
> **日期**: 2026-07-26
> **关联**: ADR-176（前端 Backend 适配器双实现）、ADR-177（Web Loader 与主应用统一路径）、ADR-180（FSA 句柄持久化）
> **前置**: ADR-180 Phase 2（`SelectDir` 持久化句柄 + `restoreFsaRootHandle` 启动自愈）
> **审核记录**: 2026-07-25~26 首席架构师逐轮审核，落地 `browser-adapter.ts` 探针/重授权 + `library-setup.ts` 启动引导/手动重扫兜底 + 五语 i18n；`tsc --noEmit` 0 错误，`browser-adapter.test.ts` 14/14 通过；详见「已知问题」

## 背景

ADR-180 解决了「句柄持久化 + 已授权源启动自愈」，但留下两个 UX 真空，导致网页端防呆能力弱于安卓：

1. **首次启动无引导**：无 `cfgRoot` 时 `initLibrary` 只发 `library.firstUseHint` 轻提示，用户不知道要去「设置根目录」授权，对比安卓「弹确认框 → 点确认才授权」的防呆链路缺失。
2. **`revoked` 假扫描（核心痛点）**：用户首次授权时若**未勾「始终允许此站点」**，句柄虽被持久化，但跨会话 `queryPermission` 返回 `'prompt'`。`restoreFsaRootHandle()`（ADR-180，仅 `queryPermission`、无手势）因非 `'granted'` 落入 `return null` → `ScanModelDir` 静默走 `_listModels()` 读 IDB 缓存。日志表现为「`[web-scan] _listModels: 返回 38 个 ModelEntry`」却**无任何 `[web-scan] 目录` 扫描行**——用户误以为已重扫，实际 N 是上次授权时的缓存快照，新文件不被发现。

**根因定性**：FSA 的 `showDirectoryPicker` / `requestPermission` **必须由用户手势触发**，浏览器禁止无手势调用。因此「启动期自动弹系统目录框」「启动期自动 `requestPermission`」在网页端均不可行（安卓权限模型不同，故能弹）。等价解是用**应用内确认框**（UI 行为、无需手势）→ 用户点「去授权」按钮（产生手势）→ 再调 FSA API。

## 决策

在 ADR-180 持久化地基之上，新增「授权引导 / 重授权」UX 层，覆盖四态与三处入口：

### 1. 四态授权探针 `getFsaAuthState()`（仅 `queryPermission`，绝不弹窗）

| 状态 | 含义 | 触发条件 |
|------|------|----------|
| `unsupported` | 浏览器无 FSA API（桌面端 / 旧浏览器 / WebView） | `_cap().fsAccess === false` |
| `none` | 从未授权过 | IDB 无 `fsaRootHandle` |
| `granted` | 持久化句柄仍有效 | `queryPermission({mode:'readwrite'}) === 'granted'` |
| `revoked` | 曾授权但失效（未勾始终允许 / 隐私模式 / 句柄损坏 / 旧实现无 `queryPermission`） | 句柄在但 `queryPermission !== 'granted'` 或抛错 |

### 2. 跳过记忆标志 `isFsaAuthPromptDismissed` / `dismissFsaAuthPrompt`（IndexedDB `config.fsaAuthPromptDismissed`）

用户跳过启动引导后写入标志，**记住不再弹**，避免纯导入用户每次启动被骚扰；手动「设置根目录」随时可触发，重置该标志。

### 3. 重授权 `reauthorizeFsaRoot()`（对已有句柄 `requestPermission`，**不重选目录**）

与 ADR-180 的 `restoreFsaRootHandle`（仅 `queryPermission`、无手势）明确分工：

- 读持久化句柄 → `requestPermission({mode:'readwrite'})` → `granted` 则写入 `_fsaRootHandle` 返回 `true`；
- 无句柄 / 拒绝 / 句柄无 `requestPermission` 方法 → 返回 `false`。

### 4. 三处入口行为矩阵

| 入口 | 状态 | 行为 |
|------|------|------|
| **首启动**（无 `cfgRoot`） | `unsupported` | 维持原 `firstUseHint` 轻提示 |
| | `granted` | 补 `cfgRoot='web://selected-dir'` 走正常 `rescanAndSync` 真扫，不弹框 |
| | `none` / `revoked` | 弹确认框引导；点「去授权」→ 首次 `selectResourceRoot(false)` 选目录 / 重授权；跳过则写 dismissed 标志 |
| **重进**（有 `cfgRoot`） | `revoked` | 扫描**前**先 `promptReauthorize()`（confirm 手势 → `reauthorizeFsaRoot`）；成功则真扫，失败降级读缓存 + `fsaRevokedHint` |
| | `granted` | 直接真扫 |
| **手动重扫**（`refreshLibrary`） | `revoked` | 用户手势即兜底：先 `promptReauthorize()`；成功真扫，失败降级 + `fsaRevokedHint`（授权过期兜底） |
| | `granted` | 直接真扫 |

### 5. i18n（五语同步）

新增 `library.fsaAuthTitle` / `library.fsaAuthPrompt` / `library.fsaRevokedHint`（zh-CN / zh-TW / en / ja / ko）。

### 6. 私有助手 `promptReauthorize()`（`library-setup.ts`）

`showConfirm(fsaAuthPrompt, fsaAuthTitle)` → 点确认调 `reauthorizeFsaRoot()`；与 `initLibrary` / `refreshLibrary` 共享 dismissed 标志，跳过则不再弹。`selectResourceRoot` 新增 `requireConfirm=false` 参数，启动引导复用其授权+刷新核心，避免「启动确认框 + 内部确认框」连弹。

## 约束（硬限制，不可绕过）

1. **`requestPermission` / `showDirectoryPicker` 必须由用户手势触发**。启动期自愈路径（ADR-180）坚持只 `queryPermission`；任何 `requestPermission` 调用都必须包裹在 confirm 框「去授权」点击的用户手势内。
2. **FSA 无显式「仅本次 / 始终」选项**：授权粒度由浏览器权限 UI（是否勾选「始终允许此站点」）与站点数据保留策略决定，应用层无法强制。故 `revoked` 是预期状态，必须有引导/重授权兜底，不能假设「授权过就永远有效」。
3. **降级不抛错、不阻塞**：所有授权缺失路径都回退到「读 IDB 缓存」，保证库非空、应用可用，仅提示，绝不 `throw` 导致启动失败。

## 影响面

| 维度 | 影响 |
|------|------|
| 桌面端 / 非 FSA 浏览器 | 无副作用：`getFsaAuthState()` 返回 `unsupported`/`none`，三处入口走原分支 |
| 契约测试（139 函数 + FNV-1a method ID） | 不受影响：`getFsaAuthState` / `reauthorizeFsaRoot` / dismissed 标志均为前端 adapter 辅助函数，不进 `wails-bindings` |
| 单测 | `browser-adapter.test.ts` 14/14（含 `getFsaAuthState` 四态、`reauthorizeFsaRoot` 四态、dismissed 标志） |
| `vite.config.ts` | 本次改动无临时配置残留（`emptyOutDir:false` 仅为绕过本机 safe-delete 垫片，已还原） |

## 已知问题 / 边界

1. **本机构建环境坑（非代码问题）**：WorkBuddy `safe-delete` 垫片拦截 vite `emptyOutDir` 对 `dist` 的 `rm`（trash 操作 abort 致 build 失败），与 ADR-180 同源。CI / 普通终端无此垫片，正常构建。
2. **node 测试环境边界**：`_cap()` 的 `typeof (window as ...).x` 写法在无 `window` 环境抛 `ReferenceError`；FSA 相关测试须模拟「有 `window` 但不暴露 FSA API」，而非删除 `window`。
3. **历史遗留（非本次引入）**：`perception-shared.ts:216/220` 的 `isWasmRuntime` / `_isWasmRuntime` 别名被 knip 报 `duplicateExports: 1`；属 deliberate 兼容别名，基线已自动更新，与本 ADR 无关。
4. **`revoked` 重授权仍需用户一次点击**：浏览器禁止无手势 `requestPermission`，故重进时无法完全静默恢复——这是平台约束下的长治久安方案（对齐安卓体验的网页等价），非缺陷。
