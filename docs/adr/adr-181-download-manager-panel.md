# ADR-181: 下载管理面板（扫描→解压→入库→processed 标记）【经 ADR-195 修订定位与行为】

> **状态**: 已完成（代码+测试 2026-07-26 全部落地；settings-downloads.ts 422 行 + download-manager.test.ts 25 测试 + 全量 2100+ 通过）
> **修订**: 经 **ADR-195（下载文件夹统一修订，2026-07-27）** 修订——① 命名"暂存目录/staging"统一改为"**下载文件夹**"；② 批量摄入**仅写资源库、不加载到场景**（与 `importFileByPath` 解耦）；③ 安卓不再走 SAF，改复用 shared 模式 `/sdcard/Download`（`pathmgr_android.DownloadsDir()` 返回该路径）。下文标注【ADR-195 修订】处为变更点，详细动机见 ADR-195。
> **日期**: 2026-07-25
> **关联**: ADR-176（前端 Backend 适配器双实现）、ADR-177（Web Loader 与主应用统一路径）、ADR-178（能力矩阵宿主键 —— 本 ADR 实施后 `watchDir` 键随之废弃）、ADR-179（更新安装拉起，平台分级）、ADR-180（FSA 句柄持久化 —— 本面板网页/安卓端 staging 持久化直接复用其句柄恢复机制）、ADR-017（安卓适配，platform 探测范式）、ADR-018（pathmgr 抽象）
> **前置**: zip 解压管线已具备（网页 `browser-adapter.ts` JSZip / Go `ExtractZip`）；资源库写入已具备（IndexedDB `dir:/outfit:` 路由 / Go 落盘）；fsnotify watch 现状（`internal/app/watch.go`）；ADR-180（FSA 句柄持久化）已落地，提供网页/安卓端 staging 句柄持久化能力
> **审核记录**: 2026-07-25 首轮审核通过（草案可批准），落地前修正 3 处：
>   ① P3 —— `importFile()` 无参数 → `importFileByPath(path)` 已抽取为独立导出函数（`library-actions.ts:633`）；
>   ② P3 —— 注册点已定位 `settings.ts:139`（`[SETTINGS.DOWNLOADS]: () => buildSettingsDownloadsLevel(...)`）；
>   ③ P4 —— 网页侧清单改存 IndexedDB（`webMarkImported`/`webIsImported`，key = `imported:<handleId>:<hash>`）。
>   2026-07-26 实施：panel 422 行全链路落地 + i18n 18 键 + `download-manager.test.ts` 25 测试。

## 背景

当前「下载自动导入」依赖 `internal/app/watch.go` 的 fsnotify 目录监听（卡片见 `frontend/src/menus/settings-resources.ts:406–487`）。核查结论显示该机制存在四项结构性缺陷，且与项目「四端统一、删平台分支」的一贯哲学相悖：

事实核查：

| 维度 | 现状 | 来源 |
|------|------|------|
| 桌面 | `StartWatchDir`（:225）基于 `fsnotify.NewWatcher()`（:253），`watchLoop`（:389）加 800ms 去抖缓解瞬时 Write/重命名竞态，但仍脆弱 | `internal/app/watch.go` |
| 安卓 | `pathmgr_android.go:29` `DownloadsDir()` 直接返回 `""`（注释：fsnotify 不支持，下载走手动导入）；`internal/AGENTS.md:212`「Android 文件监听 ⚠️ 不支持 \| `StartWatchDir()` 返回错误」 | `internal/app/pathmgr_android.go`、`internal/AGENTS.md` |
| 网页 | 无 FSA 自动监听能力（浏览器安全模型禁止静默监视目录），`browser-adapter` 无 watch 实现 | 浏览器安全模型 |
| 行为性质 | **瞬时事件**：下载落盘瞬间触发，易踩半写完文件 / 多次 Write 事件 / 重命名竞态 | `watch.go:400` 事件过滤 |

核心缺口：**「下载落盘自动冒出来」这个 magic 只在桌面 fsnotify 成立；网页因 FSA 手势限制根本做不到，安卓因 fsnotify 不支持也做不到**。watch 本质是个「桌面独享的假统一」。

## 决策

引入**独立「下载管理」面板**，作为下载摄入（ingestion）的唯一入口，**彻底取代 fsnotify watch**。流程分四阶段，全程复用现有管线，不新造解压/入库引擎：

1. **扫描（scan）**：枚举暂存目录（staging）下的文件，按现有扩展名过滤（`ExtractZip` 内部已按 PMX stem 分组、`dir:/outfit:` / `bundle:` 路由，见 `browser-adapter.ts:20/:739`，面板无需新写分类器）。
2. **解压（decompress）**：遇到 `.zip` → 复用 `ExtractZip`（`browser-adapter.ts:802–845` 网页 JSZip / Go `ExtractZip`）；非 zip 资源直接进第 3 步。
3. **入库（import）**：解压产物 / 裸资源写入对应资源库——网页落 IndexedDB `dir:/outfit:` 等键，桌面/安卓经 Go 扫描落盘；复用 `library-actions.ts:614 importFile()` 抽出的路由函数 `importFileByPath(path)`（见 §精确改法②，避免 `importFile()` 内部 `SelectImportFile()` 弹窗）。**【ADR-195 修订】批量摄入路径（下载面板）只调用资源库写入（`ingestModelBytes` / `ImportLocalFile` / `ImportZip`），不调用 `loadManager.load` 进场景；`importFileByPath` 仍保留"选区即加载"语义，二者职责分离。**
4. **标记已处理（mark processed）**：写入成功的源文件移入 `<staging>/_imported/`（非系统级回收站，仅 staging 内子目录），并追加 `.imported.json` 清单（已处理文件 hash/相对路径），防重复导入。

**跨端暂存目录获取（复用 ADR-180 句柄持久化，不再单列子能力）：**

| 端 | staging 来源 | 自动化 | 持久化 |
|----|--------------|--------|--------|
| 桌面应用 | Go 自动取 `pathmgr.DownloadsDir()`（非安卓有值） | 全自动，面板直接扫 | 无需 |
| 安卓应用 | `pathmgr_android.go:29` 返回 `""` → **无法自动枚举 OS 下载目录**；需用户经 SAF 授权一个暂存位置（或 app 自有 MMD 文件夹） | 首次需手势 | SAF URI 持久化（待定位：安卓 WailsBridge 持久化点） |
| 网页模式 | FSA `showDirectoryPicker` 选暂存目录 | 首次需手势，之后复用 | `FileSystemHandle` 持久化（**ADR-180** `restoreFsaRootHandle` 句柄恢复） |

> **【ADR-195 修订】上方「跨端暂存目录获取」表已部分过时**：命名由"暂存目录/staging"改为"**下载文件夹**"；安卓行不再要求 SAF 授权——改走 shared 存储模式直接枚举 `/sdcard/Download`（`pathmgr_android.DownloadsDir()` 现返回该路径，原返回 `""` 的注释已作废）；网页行"复用 ADR-180 根句柄"改为**可独立第二个 FSA 授权**（下载文件夹专用，不强制共享 resource-root 句柄）。以 ADR-195 为准。

**能力层影响**：`watchDir` 能力键（`go-adapter.ts:33`，ADR-178 落地为 `!isAndroidPlatform()`）在 watch 机制移除后**失去意义**，标记废弃；UI 不再依赖 `getCachedCapabilities().watchDir` 隐藏/显示任何卡片。

## 精确改法（待批准）

### ① 新增面板 `frontend/src/menus/settings-downloads.ts`

结构对齐现有 `settings-resources.ts` 的 schema builder 范式：

```ts
// [doc:adr-181] 下载管理面板：扫描 → 解压 → 入库 → 标记
export function buildSettingsDownloadsLevel(
  getSettingsMenu: () => SettingsMenuHandle
): PopupLevel {
  return {
    label: t('settings.downloads'),
    dir: '',
    nodes: buildDownloadManagerSchema(getSettingsMenu), // 含：暂存目录选择/状态、扫描并导入按钮、_imported 清理入口
  };
}
```

注册点：在 `settings.ts:127` 的 `SETTINGS_FOLDER_ROUTES` 注册表新增 `[SETTINGS.DOWNLOADS]: () => buildSettingsDownloadsLevel(getSettingsMenu)`（紧邻 `[SETTINGS.RESOURCES]: () => buildSettingsResourcesLevel(getSettingsMenu)` 行）。i18n 需在 `frontend/src/core/i18n/locales/*.ts` 补 `settings.downloads` 等键（参照 `settings.paths.resourceRoot` 既有键位 `zh-CN.ts:1727`）。

### ② 复用现有管线（不新写引擎）

| 环节 | 复用 | 文件:行 |
|------|------|---------|
| zip 解压（网页） | `ExtractZip` 内 `JSZip.loadAsync` + `dir:/outfit:` 路由 | `browser-adapter.ts:814/:845` |
| zip 解压（桌面/安卓） | Go `ExtractZip`（与网页语义对齐） | `browser-adapter.ts:4` 注释确认 |
| FSA 目录扫描 | `_scanDirIntoIDB` | `browser-adapter.ts:496`（调用点 `:1335/:1352`） |
| 资源入库路由（拆分） | `importFileByPath(path)`；原 `importFile()` 改为 `const p = await SelectImportFile(); if (p) await importFileByPath(p)` | `library-actions.ts:614` 抽取 L634–666 扩展名路由块 |
| 单根资源库 | `resourceRoot`（`library-state.ts:15`）/ `cfg.resource_root`（`library-setup.ts:45/:176`） | 见 §风险④ |

### ③ 扫描与标记实现要点

```ts
// [doc:adr-181] 扫描 → 入库 → 标记 主循环（伪代码，待落地）
async function runDownloadManager(staging: string) {
  const manifest = await readManifest(staging);          // 桌面：<staging>/.imported.json；网页：IndexedDB（key = staging 句柄 id + 文件 hash）；安卓：SAF 等价持久化（P4 修正）
  for (const f of await listFiles(staging)) {
    if (manifest.has(hash(f)) || f.name === '_imported' || f.name === '.imported.json') continue;
    const ok = f.name.endsWith('.zip')
      ? await ExtractZip(f.path, '')            // 复用到资源库
      : await importFileByPath(f.path);         // 复用 library-actions.ts:614 抽出的路由函数（无弹窗）
    if (ok) {
      const moved = await moveToImported(staging, f);    // 桌面 os.Rename；网页/安卓无写权限时跳过重命名
      manifest.add(hash(f));                    // 双保险：清单兜底（移动因权限失败也不重复）
      if (!moved) await persistManifest(staging, manifest); // 移动失败也落盘清单，防重
    }
  }
  await writeManifest(staging, manifest);
}
```

`moveToImported` 桌面用 `os.Rename`（可写）；**网页只读 FSA 句柄无法向 staging 写 `.imported.json`**，故网页侧清单改存 IndexedDB（key = staging 句柄 id + 文件 hash），`moveToImported` 无写权限时跳过重命名、仅依赖 IndexedDB 清单防重；安卓 SAF 视授权写权限同理（P4 修正）。

### ④ 废弃 fsnotify watch

- 删除 `settings-resources.ts:406–487` 的 `buildWatchSchema` 及其在 `buildResourcesSchema`（:487）的拼接；移入「下载管理」面板的等价能力（扫描/导入开关）。
- `watch.go` 的 `StartWatchDir`/`StopWatchDir`/`SetDownloadWatchEnabled`/`GetDownloadWatchStatus`/`watchLoop` 标记为废弃（保留一个 release 过渡期，或随本 ADR 一次性移除——由实施时按契约影响裁决；139 契约函数若移除需同步 FNV-1a method ID）。
- `go-adapter.ts:33` `watchDir` 键：标记 `@deprecated`，或在下一轮能力矩阵整理中删除（ADR-178 同步更新）。

## 迁移计划

- **阶段 1（本 ADR 范围，网页/桌面先行）**：新增 `settings-downloads.ts` 面板 + 桌面 `/` 网页 staging 获取（复用 ADR-180 句柄恢复）；复用 `ExtractZip`/`_scanDirIntoIDB`/`importFile` 跑通「扫描→解压→入库→标记」；桌面保留旧 watch 一段时间，网页直接切新面板。
- **阶段 2（安卓接入）**：SAF 授权暂存目录 + URI 持久化；复用同一面板逻辑（staging 抽象屏蔽平台差异）。
- **阶段 3（收口）**：移除 fsnotify watch 代码与 `watchDir` 键；`docs/targets.md` 增补「下载管理」四端行为矩阵；契约测试按需同步（移除绑定时 −N 函数 FNV-1a ID）。

## 风险与边界

| 等级 | 项 | 缓解 |
|------|----|------|
| 🟠 P2 | 安卓/网页无法静默枚举 OS 下载目录，首次需用户手势授权暂存目录 | 复用 ADR-180 FSA / 安卓 SAF 范式；授权后持久化句柄，后续自动；UX 文案明示「选一个存放下载模型的文件夹」 |
| 🟠 P2 | 网页 `JSZip` 全量载入内存，超大 zip（>数百 MB）可能 OOM | 限制单次扫描 zip 体积阈值 + 失败回退手动导入；桌面走 Go 流式解压不受影响 |
| 🟡 P3 | 物理移动原文件可能因权限失败（网页/安卓只读句柄） | 双保险：网页清单存 IndexedDB（staging 句柄 id + 文件 hash）、桌面写 `<staging>/.imported.json`，独立于移动保证防重；移动失败不阻断入库 |
| 🟡 P3 | 资源库当前为**单根**（`library-state.ts:15` `resourceRoot` 单值，`library-setup.ts:45/:176` 单字段） | staging 入库复用现有单根写入；若未来需「下载」独立库，应在 ADR 外另立存储模型演进（不在本 ADR 范围） |
| 🟢 P4 | 移除 `watchDir` 键影响 `settings-resources.ts:412` 已迁调用 | 该卡片随 watch 整体移除，无残留引用；ADR-178 同步标注键废弃 |
| ⚪ 架构红线 | 不推翻四端统一范式 | staging 抽象屏蔽平台差异；入库走既有 `ExtractZip`/`importFile`，不新增引擎 |

## 测试

- `backend.test.ts`：网页/桌面 adapter 的 `ExtractZip` 解压→`dir:/outfit:` 落地断言不变（复用既有）。
- 新增 `download-manager.test.ts`：扫描跳过 `_imported`/`.imported.json`、`.imported.json` 防重、zip 与非 zip 分流。
- `app.contract.test.ts`：若阶段 3 移除 watch 绑定，同步移除其 FNV-1a method ID（139 → −N）。
- E2E：桌面「选 Downloads → 扫描 → zip 自动入库 → 源文件移至 _imported」；网页「FSA 选暂存 → 复用 ADR-180 句柄恢复」；安卓「SAF 授权 → 复用」。
