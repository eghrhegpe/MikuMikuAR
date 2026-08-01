---
tier: architecture
kind: android_file_access
name: 安卓文件访问（shared 模式）
category: core
scope:
  - internal/app
  - frontend/src/core/backend
  - frontend/src/menus
  - build/android
source_files:
  - internal/app/fileaccess_android.go
  - frontend/src/core/backend/go-adapter.ts
  - frontend/src/menus/settings-downloads.ts
  - frontend/src/menus/settings-resources.ts
  - frontend/src/menus/library-setup.ts
  - build/android/app/src/main/java/com/wails/app/WailsBridge.java
  - build/android/app/src/main/java/com/wails/app/MainActivity.java
adr:
  - ADR-017
  - ADR-180
  - ADR-183
  - ADR-194
symbols:
  - buildSettingsDownloadsLevel
  - buildSettingsResourcesLevel
  - goAdapter
  - initLibrary
  - refreshLibrary
  - reloadConfig
  - rescanAndSync
  - selectOverridePath
  - selectResourceRoot
  - switchStorageMode
invariants:
  - 安卓文件访问走 shared 模式（MANAGE_EXTERNAL_STORAGE 授权后 os.ReadDir 直读 /sdcard），不依赖 SAF content:// 树
  - 安卓能力矩阵 fsSelectDir = false，前端不应对安卓调用 SelectDir() 弹目录选择
  - 网页 FSA（File System Access API）与安卓 SAF 是两套独立机制，检索与讨论时务必区分
use_when:
  - 安卓 文件访问 SAF Storage Access Framework shared 模式 /sdcard 目录选择
  - 网页 FSA 重选目录 授权引导 getFsaAuthState
  - SelectDir 在安卓弹 SAF 建树 ACTION_OPEN_DOCUMENT_TREE
---

## 系统概览

安卓端文件访问已**废弃 Storage Access Framework（SAF，`ACTION_OPEN_DOCUMENT_TREE` / `content://` 树 URI）**，改为 **shared 模式**：在 `MANAGE_EXTERNAL_STORAGE` 权限授权后，Go 后端用标准 `os.*` 直读 `/sdcard/...` 真实路径（如 `/sdcard/Download`、`/sdcard/MMD`）。网页端则使用 **FSA（File System Access API）**，二者是**不同平台、不同机制**，检索与讨论时务必区分——"SAF"仅指安卓，"FSA"仅指网页。

## 核心职责

- `fileaccess_android.go` — 安卓文件读写全走 `os.*`；对 `content://` 直接返回 `ErrContentUriNotSupported`（SAF 产物对后端已无意义）。
- `go-adapter.ts` `fsSelectDir: !isAndroidPlatform()` — 能力矩阵声明安卓**无目录选择能力**，是唯一真相源。
- `library-setup.ts` — 资源根/覆盖路径已按 `fsSelectDir` 守卫，安卓直接 `androidDirNotSupported` 返回，**不调 `SelectDir()`**。
- `WailsBridge.java` `openDocumentTree` + `MainActivity.java` `SAF_TREE_REQUEST` — **死代码**，Go 侧无调用者；真正弹 SAF 的是 Wails v3 框架目录对话框在安卓后端出的 `ACTION_OPEN_DOCUMENT_TREE`。

## 当前主流选择（决策演变）

| 阶段 | 选择 | 状态 |
|------|------|------|
| 早期（ADR-017 原案）| Wails v3 SAF 目录选择（`CanChooseDirectories`）| ❌ 已放弃（2026-07-22 修订）|
| **当前安卓** | **shared 模式**：`MANAGE_EXTERNAL_STORAGE` + `os.ReadDir` 直读 `/sdcard` | ✅ **主流、已落地** |
| **网页** | **FSA**（`getFsaAuthState` / `reauthorizeFsaRoot`，ADR-180/183）| ✅ **活跃、预期内** |
| 安卓 SAF 建树 | 经 `SelectDir()` 在安卓被框架翻译成 `ACTION_OPEN_DOCUMENT_TREE` | ⚠️ **应避免（见下）** |

> **Google Play 政策提示**：`MANAGE_EXTERNAL_STORAGE` 受商店政策限制，仅 sideload 分发无影响（ADR-017）。上架需申请豁免或降级为 SAF/MediaStore。

## 已知缺陷（待 ADR-194 修复）

前端两处 `SelectDir()` **未做 `fsSelectDir` 守卫**，在安卓（`!isWebPlatform()`→go-adapter→Wails v3 安卓对话框）会被强制翻译成 SAF 建树：

- `settings-downloads.ts:63` `pickStagingDirDesktop()`（line 344 `!isWebPlatform()` 分支命中安卓）
- `settings-resources.ts:473` `SetDownloadWatchDir` 内 `SelectDir()`

ADR-194 落地时，安卓下载/监听目录应直接走系统 `/sdcard/Download`（shared 模式授权下 `os.ReadDir` 直读），两处 `SelectDir()` 加安卓分支或同 `library-setup` 加 `fsSelectDir` 守卫；`WailsBridge.openDocumentTree` 死代码可一并清理。

## 与其他子系统关系

- 能力矩阵 `go-adapter.ts` 是平台能力的唯一真相源；`fsSelectDir` 决定前端是否弹目录选择。
- 网页 FSA 见 `browser-adapter.ts` + `docs/web-data-origin-isolation.md`，与安卓 shared 模式正交。

## UI 入口

- 无独立入口函数（菜单基础设施卡）：菜单层级 / 入口一览见 [menu-map.md](./menu-map.md)（机器生成）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）由对应源码 UI 卡补充说明。
## 不变量

- 安卓读文件必须走真实 `/sdcard` 路径，**禁止引入 `content://` 依赖**（后端已 `ErrContentUriNotSupported` 兜底）。
- `fsSelectDir=false` 时，任何 `SelectDir()` 调用在安卓都会落到框架 SAF，属**缺陷而非预期**。

## 验证入口

- 后端单测：`internal/app/*_test.go`（fileaccess_android 相关）
- 前端契约：`frontend/src/__tests__/bindings/app.contract.test.ts`
- 手动复现：安卓 apk 设下载暂存目录，确认是否弹 SAF（当前会弹 → 缺陷复现）
