# ADR-190: 端能力声明式收口（淘汰散落 isAndroidPlatform 分支）

> **状态**: 已完成（代码 + 测试 2026-07-26 落地；tsc --noEmit + vitest 全绿）
> **日期**: 2026-07-26（初版）
> **关联**: ADR-176（Backend 适配器双实现 — 绞杀者模式双 adapter）、ADR-177（Web Loader 统一路径 — 能力门控 A5）、ADR-178（能力层收口 watchDir 宿主感知 — 建立 BackendCapabilities 机制）、ADR-179（更新安装拉起 — 本 ADR 收口其 installApk/installLocal）
> **来源**: `docs/multi-end-maturity-matrix.md` 多端统一成熟度矩阵「权限维度」诊断结论——"每加能力就加一处 isAndroidPlatform() 分支"为架构性预防负债，需抽 `getCapabilities()` 声明式清单。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-26

---

## 背景

ADR-178 已建立 `BackendCapabilities`（`core/backend/types.ts`）+ `getCapabilities()` / `getCachedCapabilities()` 能力查询机制，菜单普遍用 `getCachedCapabilities().X` 门控。但**新能力（安装 / 内嵌浏览器 / 目录选择 / 暂存 / AR 相机 / 安卓存储）仍在调用点用 `isAndroidPlatform()` 硬判**，未收口。

改造前散落 `isAndroidPlatform()` 共 **13 个调用点**（跨 7 个文件），外加平台定义层 `platform.ts` 与 adapter 内部（后者为 sanctioned 单一来源）。每新增能力就在调用点加一处平台分支，接缝随特性累积而变脆——这正是多端统一成熟度矩阵中「权限维度」评分 🔄 中等、且被列为 P1 架构性预防负债的根因。

### 改造前散落分布（13 处）

| 文件:行 | 原判定 |
|---------|--------|
| `core/events.ts:460` | `!!downloadUrl && isAndroidPlatform()` |
| `menus/settings-about.ts:171-172` | `(isAndroidPlatform()||!isWebPlatform())` / `!isAndroidPlatform()` |
| `menus/plaza-browser.ts:283,784` | `isWebPlatform()||isAndroidPlatform()` / `isAndroidPlatform()` |
| `menus/settings-downloads.ts:137,292,322,342` | `!isAndroidPlatform()` |
| `scene/ar/ar-camera.ts:137` | `isAndroidPlatform() && ensureAndroidCameraPermission()` |
| `menus/settings-resources.ts:194,203` | `isAndroidPlatform()` |
| `menus/library-setup.ts:149,174,193` | `isAndroidPlatform()` |

---

## 决策

扩展 `BackendCapabilities` 接口，新增 **6 个能力字段**，将平台→能力的翻译**唯一收敛到 `go-adapter.capabilities()`**（桌面/安卓差异的唯一桥接点）；`browser-adapter._cap()` 直接声明固定值（无原生安装/窗口/暂存目录）。调用点全部改为读取 `getCachedCapabilities().X`，散落 `isAndroidPlatform()` 调用点降至 **0**（仅保留平台定义层 `platform.ts` + 单一翻译源 `go-adapter.ts` + bootstrap 层 `init.ts` + 安卓独占开关 `settings-appearance.ts`）。

### 新增字段语义与三端取值

| 字段 | 语义 | go-adapter（桌面） | go-adapter（安卓） | browser-adapter |
|------|------|-------------------|-------------------|-----------------|
| `installApk` | 可直接安装 APK | `false` | `isAndroidPlatform()` | `false` |
| `installLocal` | 有本地安装器路径（桌面直装 / 安卓直装 / 网页跳外链） | `true` | `true` | `false` |
| `inAppBrowser` | 可内嵌/独立窗口浏览广场 | `true` | `false` | `false` |
| `fsSelectDir` | 能原生或 FSA 选择目录 | `true` | `false` | `fsAccess`（FSA 可用即 true） |
| `localStaging` | 桌面级暂存目录可用 | `true` | `false` | `false` |
| `androidStorageMode` | 安卓专属存储模式切换 | `false` | `true` | `false` |

> **关键修正（审核发现）**：原方案字段 `directoryPicker` 仅桌面 true、Web false，会误杀网页端 FSA 选目录（ADR-180 已验证 Web 可走 FSA `SelectDir`）。改为 `fsSelectDir` 语义——"任意路径能选目录的能力（桌面原生 + Web FSA）"，Web 侧复用已有 `fsAccess` 局部变量，三端行为与原逻辑完全一致。

`index.ts` 的 `ALL_TRUE_CAPS`（解析前兜底，假设桌面全开）同步置上述桌面默认值，保证菜单预渲染不闪烁。

### 保留 `isAndroidPlatform()` 的 sanctioned 位置（平台身份，非能力门控）

| 位置 | 理由 |
|------|------|
| `core/platform.ts:13/79/96/99` | 平台探测定义本身 |
| `core/backend/go-adapter.ts` `capabilities()` | **唯一授权翻译源**：平台 → 能力 的唯一桥接 |
| `core/init.ts:328/465` | bootstrap：安卓默认性能档 / 安卓原生存储权限桥（`window.wails`），无桌面等价物 |
| `menus/settings-appearance.ts:478` | 屏幕常亮开关：安卓独占（桌面无 `setKeepAwake` 桥） |
| `core/backend/backend.test.ts:311` | 平台探测单测 |

---

## 迁移映射（13 → 0）

| 文件:行 | 改为 |
|---------|------|
| `events.ts:460` | `getCachedCapabilities().installApk` |
| `settings-about.ts:171` | `getCachedCapabilities().installLocal` |
| `settings-about.ts:172` | `!getCachedCapabilities().installApk` |
| `plaza-browser.ts:283` | `getCachedCapabilities().inAppBrowser ? effectiveMode(site) : 'external'` |
| `plaza-browser.ts:784` | `getCachedCapabilities().inAppBrowser ? 全选项 : 仅 external` |
| `settings-downloads.ts:137/292/322/342` | `getCachedCapabilities().localStaging` |
| `ar-camera.ts:137` | `getCachedCapabilities().arScope === 'android-app' && ensureAndroidCameraPermission()` |
| `settings-resources.ts:194/203` | `getCachedCapabilities().fsSelectDir` |
| `library-setup.ts:149/174` | `!getCachedCapabilities().fsSelectDir` |
| `library-setup.ts:193` | `!getCachedCapabilities().androidStorageMode` |

> `plaza-browser.ts:784` 迁移同时统一了安卓「独立窗口」显隐（原 283 强制 external 但 789 `plazaWindow` 在安卓为 true 时会显示「独立窗口」——属既有不一致，现按 `inAppBrowser` 统一为 external），为预期改进。

---

## 设计质量评估

| 维度 | 结论 |
|------|------|
| 收敛度 | 13 散落调用点 → 0（仅保留平台定义层 + 单一翻译源） |
| 命名一致性 | 6 新字段命名风格与现有 19 字段一致（小驼峰布尔/字符串，语义自明） |
| 可扩展性 | 未来新增能力只需在 `BackendCapabilities` + 两 adapter + `ALL_TRUE_CAPS` 加一行，不再散落 `isAndroid` 分支 |
| 向后兼容 | 全部为增量字段添加，无删除/重命名，现有调用方不受影响 |
| 类型安全 | 0 处新增 `as any` / `@ts-ignore`；`ALL_TRUE_CAPS` 兜底防解析前崩溃 |

---

## 测试影响

- `core/backend/backend.test.ts`：browser 能力矩阵新增 `[adr-190] 安装/更新能力键` 断言（installApk/installLocal/inAppBrowser/localStaging/androidStorageMode 恒 false，fsSelectDir 跟随 fsAccess）。
- `__tests__/virtual-skirt.test.ts`：`getCachedCapabilities` mock 补全 6 字段（未被读取，仅保证形状完整）。
- 全量 `vitest run` + `tsc --noEmit` 通过。

---

## 后续

- 多端统一成熟度矩阵「权限维度」评分由 🔄 中等上调为 ✅ 偏强（仅剩 FSA 多选同名撞车、IDB origin 隔离两项非能力层问题，见 ADR-182 §不在范围 与 matrix 文档）。
- 未来任何新端能力，强制从 `BackendCapabilities` 声明入口，禁止在调用点新增 `isAndroidPlatform()` 分支（纳入 AGENTS.md 硬约束候选）。
