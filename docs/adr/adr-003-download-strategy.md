# ADR-003: 下载监听策略（精简版）

> **状态**: 方案 C 已实施 ✅；方案 E 远期构想
> **关联**: ADR-011（Wails 版本策略）
> **来源**: ADR-003 + ADR-008 合并（2026-07-08）
> **修订**: 2026-07-09 默认监听目录由 `Downloads/MMDHub_Inbox` 改为 `Downloads/` 根目录 + 首启默认开启。理由：浏览器默认下载到 `Downloads/` 而非其子目录，监听子目录无法真正零配置拉起即用。Config 新增 `DownloadWatchEnabled`（开关，与 dir 解耦）+ `DownloadWatchInitialized`（首启默认哨兵，防重复默认覆盖用户关闭）。

---

## 背景

用户从模之屋等网站下载模型 zip 后，需要手动导入模型库，流程繁琐。需要一种机制自动检测下载目录的新文件并提供一键导入。

模之屋特性：Vue.js SPA、下载可能需登录、URL 临时签名、`X-Frame-Options: DENY`（无法 iframe 嵌入）。

---

## 方案决策

| 方案 | 路径 | 结论 |
|------|------|------|
| A: WebView2 `DownloadStarting` 拦截 | Wails 不暴露 COM 接口，无法实现 | ❌ 放弃 |
| B: 子窗口 WebView | 同上，需 CGo 调 COM API | ❌ 放弃 |
| **C: 系统浏览器 + fsnotify 监听（短期）** | 用户在浏览器下载 → fsnotify 检测 → toast 确认 → 自动导入 | ✅ **已实施** |
| D: 内嵌 WebView + 反向代理 | SPA 全链路代理，工程量大易失效 | ❌ 放弃 |
| E: 浏览器扩展 + nativeMessaging（长期） | 体验最好但需维护扩展，暂不动代码 | 📋 远期构想 |

---

## 已实施方案 C

**流程**：
```
用户点浏览器图标 → BrowserOpenURL(模之屋) → 系统浏览器打开
fsnotify 监听用户 Downloads 目录（%USERPROFILE%/Downloads，首启自动默认 + 开启）
  → 检测到 .zip/.pmx/.vmd Create/Write
  → 800ms debounce（防下载未完成）
  → Magic Number 校验（PK\x03\x04 / Rar!\x1A\x07\x00）
  → 过滤 .crdownload / .part 临时文件
  → toast 通知（一键导入 / 忽略 / 10s 超时）
  → 用户确认 → ImportLocalFile → ExtractZip → 落库
```

**关键设计决策**：

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 监听目录默认值 | `Downloads/` 根目录 | 浏览器默认下载到此处，真正零配置拉起即用；非模型 zip 由 Magic Number + 确认 toast 兜底 |
| 监听开关默认值 | `true`（首启自动开启） | 拉起即用；用户可在 设置→路径→下载监听 关闭，关闭后保留 dir 不丢失 |
| 自动导入默认值 | `false`（需确认） | 安全第一，防止误导入 |
| 文件类型校验 | Magic Number 检测 | 防止临时文件触发 |
| 通知方式 | Toast + 状态栏 | 保持应用内上下文 |

**fsnotify 跨平台**：使用 `github.com/fsnotify/fsnotify`（Wails 已有间接依赖），避免 cgo。

**技术实现**：
- **Go 新增函数**：`ImportLocalFile`、`importZipFile`、`StartWatchDir`、`StopWatchDir`、`SetDownloadWatchDir`、`SetDownloadWatchEnabled`、`GetDownloadWatchEnabled`、`ensureDefaultWatchDir`、`watchLoop`、`notifyNewFile`、`restoreWatcher`
- **前端**：`watch:newfile` 事件 → `#importToast`（导入/忽略按钮，10s 超时）；设置页「下载监听」section（监听开关 + 目录状态行 + 自动导入开关）
- **新增事件**：`watch:newfile`（Go→frontend）、`import:done`（Go→frontend）
- **配置持久化**：`Config.DownloadWatchDir` + `Config.DownloadAutoImport` + `Config.DownloadWatchEnabled`（开关，与 dir 解耦：关闭时保留 dir）+ `Config.DownloadWatchInitialized`（首启默认哨兵）

**复用 `ExtractZip`**：`ImportLocalFile` 对 zip 调用 `importZipFile`（从 `DownloadAndImport` 抽取），复用 cache、zip-slip 防护、Shift-JIS 解码逻辑。

---

## 已知限制

- fsnotify 在 Windows 网络映射盘上不工作（设置文档提示仅本地磁盘）
- 不支持 `.rar` / `.7z`（模之屋部分资源用 rar，一期只支持 zip）
- 单目录监听（需求上限，多目录可在后续扩展）
- 方案 C 体验割裂（两个窗口），长期看方案 E 更优

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `internal/app/watch.go` | `ImportLocalFile` / `StartWatchDir` / `StopWatchDir` / `SetDownloadWatchDir` / `SetDownloadWatchEnabled` / `GetDownloadWatchEnabled` / `ensureDefaultWatchDir` / `restoreWatcher` |
| `internal/app/pathmgr*.go` | `DownloadsDir()` 接口 + desktop/android 实现 |
| `frontend/src/core/main.ts` | `watch:newfile` → `#importToast` 事件链路 |
| `frontend/src/menus/settings-paths.ts` | 「下载监听」section（监听开关 + 目录行 + 自动导入开关） |
| `frontend/src/menus/settings-shared.ts` | `preloadDownloadWatchState` / watch enabled 缓存 |
| 配置 | `Config.DownloadWatchDir` + `DownloadAutoImport` + `DownloadWatchEnabled` + `DownloadWatchInitialized` |