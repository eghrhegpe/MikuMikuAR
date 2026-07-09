# ADR-023: Android 文件访问策略 — FileAccessor 抽象与 SAF 决策

**日期**：2026-07-04
**更新**：2026-07-06 — Phase C 重新评估：Wails v3 已原生支持 SAF **文件**选择
**更新**：2026-07-06 — Phase C 目录选择已通过 `CanChooseDirectories(true)` 走通 Wails v3 SAF 原生目录选择器 ⚠️ **此条为误判，已被 2026-07-08 勘误推翻**
**更新**：2026-07-08 — 勘误：Wails v3 alpha2.105 安卓**不支持**目录选择（见文末「勘误」段）；Java `openDocumentTree` 为孤儿桥，Phase C 目录选择实际未走通
> **状态**: ✅ 已合并 → [ADR-017](adr-017-android-adaptation.md)
> **来源**: 本文件内容已合并至 ADR-017 精简版

---

## 背景

ADR-017 完成首轮 Android 适配，ADR-018 引入 `PathManager` 抽象路径获取。但文件读取链路仍存在两类问题：

1. **缓存目录耦合 `os.TempDir()`** — 安卓端 `os.TempDir()` 行为不确定，可能导致 `isolateDir` 失败闪退
2. **`os.*` 调用散落各处** — `httpserver.go`/`library.go`/`zipextract.go` 共 10 处直接调用 `os.Open`/`os.ReadDir`/`filepath.WalkDir`，无法接入 SAF `content://` URI

真机测试确认核心链路可工作（模型加载、VMD 播放、zip 解压均正常），但稳定性和通用性需加固。本 ADR 记录分阶段适配方案与 SAF 接入决策。

---

## 决策

### 1. Phase A：缓存目录重构（已实施 ✅）

**问题**：`isolateDir` 用 `os.TempDir()` 作为隔离根目录，安卓端可能落到不存在的 `/tmp`。

**修复**：
- `httpserver.go` 新增 `serveRootDir()`，统一走 `platformPathMgr.CacheRoot()` 拼接 `MikuMikuAR/serve`
- `pathmgr_android.go` 的 `CacheRoot` 从 `/data/data/<pkg>/files` 改为 `/data/data/<pkg>/cache`（与安卓 `cacheDir`/`filesDir` 惯例一致）
- `isolateDir` 安卓端 copy 失败时增加 `os.Stat` 诊断日志

### 2. Phase B：FileAccessor 抽象层（已实施 ✅）

**问题**：10 处 `os.*` 读取调用散落在 3 个文件，未来接入 SAF 需逐处修改，回归风险高。

**方案**：引入 `FileAccessor` 接口 + build tags 平台实现，包级单例。

```
internal/app/
├── fileaccess.go           # 接口 + 单例 + isContentUri（49行）
├── fileaccess_desktop.go   # //go:build !android — os 包薄包装
├── fileaccess_android.go   # //go:build android — content:// 占位 + os 包
```

**接口定义（5 方法，严守「不过度工程」）**：

```go
type FileAccessor interface {
    Stat(path string) (os.FileInfo, error)
    Open(path string) (io.ReadCloser, error)
    ReadDir(path string) ([]os.DirEntry, error)
    WalkDir(root string, fs.WalkDirFunc) error
    Abs(path string) (string, error)
}
```

**关键设计原则**：
- **只抽象读取**：写入操作（`os.Create`/`os.MkdirAll`/`os.Remove*`）永远在 app 私有目录，`os` 包完全可用，不抽象
- **桌面端零行为差异**：`desktopFileAccessor` 仅是 `os` 包薄包装，无任何逻辑分支
- **安卓端 SAF 占位**：`content://` URI 返回 `ErrContentUriNotSupported`，不静默失败；Phase C 接 SAF 时只改 `fileaccess_android.go` 一个文件，调用方零改动

**替换的调用点（10 处）**：

| 文件 | 原调用 | 改为 |
|------|--------|------|
| `httpserver.go` × 3 | `os.Open`/`os.ReadDir`/`filepath.WalkDir` | `fileAccessor.*` |
| `library.go` × 4 | `filepath.WalkDir` × 2 + `os.ReadDir` × 2 | `fileAccessor.*` |
| `zipextract.go` × 3 | `os.Stat` × 2 + `filepath.WalkDir` × 1 | `fileAccessor.*` |

**刻意保留的 `os.*` 调用**：
- 写入操作（`os.Create`/`os.MkdirAll`/`os.OpenFile`/`os.Remove*`）— 私有目录，不需抽象
- 读 cache 目录（`os.ReadDir(cacheRoot)` in `CleanOrphanCache`）— 私有目录
- 检查缩略图缓存（`os.Stat(thumbPath)`）— 私有目录
- `isolateDir` 诊断日志的 `os.Stat` — 故意用 `os.Stat` 探测权限
- `zip.OpenReader(zipPath)` — Go 标准库限制，Phase C 对 `content://` 先复制到 cache 再调用

### 3. Phase C：SAF 接入策略（2026-07-06 重新评估）⚠️ 本节结论已被 2026-07-08 勘误推翻，正确结论见文末「勘误」段

**Wails v3 已原生支持 SAF 文件选择**（dialogs_android.go）：

```go
// File dialogs by the Storage Access Framework document picker
// (selected documents are copied into the app's cache directory
// so callers receive real filesystem paths).
```

| SAF 能力 | Wails v3 状态 | 说明 |
|----------|-------------|------|
| `OpenFile`（选单文件） | ✅ 已支持 | SAF 文档选择器 → 自动复制到 cache → 返回真实路径 |
| `OpenDirectory`（选目录树） | ✅ 已支持 | `CanChooseDirectories(true)` + `CanChooseFiles(false)` 触发 SAF 原生目录选择器 |
| `SaveFile`（保存文件） | ❌ 不支持 | 返回 "save file dialogs are not supported on Android" |
| `TakePersistableUriPermission` | ❌ 不支持 | 需自建 bridge |
| `ContentResolver.openFileDescriptor` | ❌ 不支持 | 需自建 bridge |

**结论**：文件选择 + 目录选择均已由 Wails v3 原生解决，不需要自建 JNI 桥接。用户通过 Wails 文件选择器选的模型会自动复制到 cache 目录返回真实路径，`IsolateModelDir` / `StartFileServer` 全链路正常工作。目录选择通过 `CanChooseDirectories(true)` 触发 SAF `OpenDocumentTree` intent，返回用户选中的目录路径。注意返回的是 SAF 复制后的临时路径（文件模式）或 content:// URI（目录模式），`filepath.ToSlash` 处理后前端可直接使用。

**实现位置**：`internal/app/library.go:16-29` — `SelectDir()` 方法统一走 Wails Dialog API，无平台差异分支。

**三条路径重新评估**：

| 路径 | 评估 | 决策 |
|------|------|------|
| A. Wails 原生（文件选择） | ✅ 已可用 | **采纳** — 文件选择直接用 Wails API |
| B. 自建 JNI 桥接（目录选择） | Java 侧 Spike 已完成，Go 侧无需接通 | **废弃（⚠️ 勘误：此结论错误，应重启而非废弃 — 见文末勘误段方案 A）** — 原以为 Wails v3 原生 `CanChooseDirectories(true)` 已满足需求，实为误判 |
| C. `MANAGE_EXTERNAL_STORAGE` | 不再需要 | **废弃** — 目录选择已由 SAF 原生支持 |

### 4. 桌面端 SelectDir 小问题（仍待修复）

**问题**：`library.go:16-29` 的 `OpenFile` dialog 虽设置 `CanChooseDirectories(true)`/`CanChooseFiles(false)`，但 Wails v3 在 Windows 上对这两个标志支持有缺陷，实际弹出文件选择器（而非目录选择器）。Android 端通过 SAF 正常工作。

**修复方向**：Windows 端可能需换 dialog 实现或调用原生 Win32 `IFileOpenDialog` / `IFileDialog`。

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| Phase B 抽象层引入回归 | 低 | `desktopFileAccessor` 是 `os` 包薄包装，零行为差异；`go test ./...` 全通过作为回归基线 |
| 安卓 cache 目录膨胀 | 低 | 复用现有 `CleanOrphanCache` 模式，`cache/MikuMikuAR/serve/` 随 cache 清理 |
| `content://` URI 在 Phase C 前被传入 | 低 | `androidFileAccessor` 返回 `ErrContentUriNotSupported`，不会静默失败 |
| Phase C 目录选择实际未实现（Wails 安卓硬报错 + Java 孤儿桥） | 高 | 见文末勘误段：C 前端止血 / A 自建 SAF 遍历；原路径 B（自建 JNI 桥）应重启而非废弃 |
| 路径 C 的 Google Play 审核风险 | 中 | 短期可接受；长期依赖路径 B 落地或 Wails v3 稳定后重新评估 |

---

## 涉及文件清单

### Phase A（已实施）

| 文件 | 改动 |
|------|------|
| `internal/app/httpserver.go` | 新增 `serveRootDir()`，`isolateDir` 改用 `CacheRoot()` + 安卓诊断日志 |
| `internal/app/pathmgr_android.go` | `CacheRoot` 改为 `/data/data/<pkg>/cache` |

### Phase B（已实施）

| 文件 | 改动 |
|------|------|
| `internal/app/fileaccess.go` | 新增 — 接口 + 单例 + `isContentUri` |
| `internal/app/fileaccess_desktop.go` | 新增 — 桌面实现（os 包薄包装） |
| `internal/app/fileaccess_android.go` | 新增 — 安卓混合实现（content:// 占位） |
| `internal/app/httpserver.go` | 3 处 `os.*` → `fileAccessor.*` |
| `internal/app/library.go` | 4 处 `os.*`/`filepath.*` → `fileAccessor.*` |
| `internal/app/zipextract.go` | 3 处 `os.*`/`filepath.*` → `fileAccessor.*` |
| `frontend/src/core/fileservice.ts` | `normPath` 增加 `content://` 识别 |

### Phase C（部分实施 ⚠️：仅文件选择生效，目录选择未走通 — 见文末勘误）

| 文件 | 改动 |
|------|------|
| `internal/app/library.go` | `SelectDir` 统一使用 Wails Dialog API，Android 端通过 `CanChooseDirectories(true)` 触发 SAF 目录选择器 |

---

## 后续方向（2026-07-08 勘误后修订）

1. ~~（已推翻）Wails v3 原生支持目录选择~~ → 实为仅支持**文件**选择；目录选择需自建（见文末勘误段方案 A/B）
2. **短期（C 止血·推荐）**：前端 `selectResourceRoot`/`selectOverridePath` 捕获 `SelectDir()` 异常并 `setStatus` 提示「安卓暂不支持选目录」，消除静默失效
3. **中期（A 治本·按需）**：Go 显式调 `openDocumentTree` 拿 tree URI + `androidFileAccessor` 经 `ContentResolver`/`DocumentFile` 遍历 `content://` tree（即重启原路径 B 自建 JNI 桥）
4. **备选（B 务实）**：安卓资源根目录改 app 私有/授权目录（`getExternalFilesDir()` 或 `Documents/MikuMikuAR`），模型经 SAF 文件选择器导入，不暴露「选目录」
5. **待修复（遗留）**：Windows 端 `SelectDir` 的 `CanChooseDirectories(true)` 无效问题（见 §4）
6. **长期**：关注 Wails v3 稳定版是否补全安卓目录选择
7. **缓存治理**：`cache/MikuMikuAR/serve/` 随 `CleanOrphanCache` 清理，需监控膨胀情况

---

## 勘误（2026-07-08）：Phase C 目录选择真相

> 本节推翻原 §3 关于「Wails v3 原生支持目录选择」的结论。结论基于对 `wails v3.0.0-alpha2.105` 安卓源码与本项目 Java 桥的逐行核对。

### 结论变更
- Wails v3 安卓**仅原生支持 SAF 文件选择**（单选/多选，自动复制到 cache 返真实路径）。
- **目录（tree）选择从未实现**：`SelectDir` 在安卓上 `return err`；Java 侧 `openDocumentTree` 是**孤儿桥**（无人调用）。原 §3 表格「`OpenDirectory`（选目录树）✅ 已支持」系误判。

### 三条源码铁证
1. **Wails 安卓对话框硬拒目录** — `wails/.../application/dialogs_android.go:120-122`：
   ```go
   if d.dialog.canChooseDirectories && !d.dialog.canChooseFiles {
       return nil, fmt.Errorf("directory selection is not supported on Android: ...")
   }
   ```
   整个 wails 模块内 `openDocumentTree`/`SelectDirectory` 引用数 = 0；公共 API 无独立目录选择器，仅 `OpenFileDialogStruct.CanChooseDirectories` 旗标，其安卓实现只走 `showFilePicker`。

2. **Go→Java 桥按名派发，但 Wails 从不调 `openDocumentTree`** — `application_android.go:436` `androidBridgeVoidIntString(method, id, arg)` → C `callBridgeVoidIntString` → `WailsBridge.<method>`。Wails 仅 `dialogs_android.go:135` 调 `"showFilePicker"`，**从不调 `"openDocumentTree"`**。Java 的 `openDocumentTree(int)` 虽符合桥约定（理论上可被 `androidBridgeVoidIntString("openDocumentTree", id, "")` 调到），但 Wails `SelectDir` 在铁证①即 `return err`，永远到不了桥。

3. **本项目 Java `openDocumentTree` 是孤儿** — 全项目 `grep openDocumentTree`（Go+Java）仅命中 `WailsBridge.java:304/325` 自身定义；`internal/` 内无任何 `androidBridgeVoidIntString("openDocumentTree"` 调用。即便接通，返回 `content://…/tree/…` URI，而 `androidFileAccessor`（`fileaccess_android.go:29-57`）对全部 `content://` 返回 `ErrContentUriNotSupported` —— Phase C 的 SAF 遍历层从未实现。**链路两端都断：无 Go 调用方 + 无访问器支持。**

### 安卓文件访问能力现状（v3.0.0-alpha2.105）

| 能力 | 安卓现状 | 证据 |
|------|----------|------|
| 选单/多**文件** | ✅ 正常（复制到 cache 返真实路径） | `showFilePicker` + `os.*` 直读 |
| 选**目录** | ❌ Wails 直接报错拒绝 | `dialogs_android.go:120` |
| Java `openDocumentTree` | ⚠️ 实现正确但孤儿（无人接） | 全项目仅 2 处自引用 |
| `content://` 遍历 | ❌ 访问器一律拒绝 | `fileaccess_android.go:29` |

### 为何设置默认路径「失效」
点击事件 `selectResourceRoot()` → `SelectDir()` → Wails 抛 rejected promise → 前端 `if (!dir) return` 只挡「取消返回空」、不挡异常 → 被最外层 `.catch(console.warn)` 静默吞掉 → 用户界面一片寂静。

### 修正后的处置方向（原路径 B 应重启，非废弃）
- **C（最小止血·推荐先上）**：前端捕获 `SelectDir()` 异常并 `setStatus` 提示「安卓暂不支持选目录」，消除静默失效。纯前端、分钟级。
- **A（治本·若需安卓任意目录）**：自己补两端 —— Go 显式调 `openDocumentTree` 拿 tree URI + 让 `androidFileAccessor` 经 `ContentResolver`/`DocumentFile` 遍历 `content://` tree（复用已有的 `takePersistableUriPermission`）。即原方案 B 的自建 JNI 桥，**应重启而非废弃**。
- **B（务实替代）**：安卓放弃「任意目录选择」，资源根目录改 app 私有/授权目录（`getExternalFilesDir()` 或 `Documents/MikuMikuAR`），模型经 SAF 文件选择器导入。与现有可用的文件选择路径一致。
