# ADR-023: Android 文件访问策略 — FileAccessor 抽象与 SAF 决策

**日期**：2026-07-04
**更新**：2026-07-06 — Phase C 重新评估：Wails v3 已原生支持 SAF 文件选择
> **状态**: Phase A+B 已实施；Phase C 文件选择已由 Wails v3 原生解决；目录选择仍需自建 bridge

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

### 3. Phase C：SAF 接入策略（2026-07-06 重新评估）

**Wails v3 已原生支持 SAF 文件选择**（dialogs_android.go）：

```go
// File dialogs by the Storage Access Framework document picker
// (selected documents are copied into the app's cache directory
// so callers receive real filesystem paths).
```

| SAF 能力 | Wails v3 状态 | 说明 |
|----------|-------------|------|
| `OpenFile`（选单文件） | ✅ 已支持 | SAF 文档选择器 → 自动复制到 cache → 返回真实路径 |
| `OpenDirectory`（选目录树） | ❌ 不支持 | 返回 "directory selection is not supported on Android" |
| `SaveFile`（保存文件） | ❌ 不支持 | 返回 "save file dialogs are not supported on Android" |
| `TakePersistableUriPermission` | ❌ 不支持 | 需自建 bridge |
| `ContentResolver.openFileDescriptor` | ❌ 不支持 | 需自建 bridge |

**结论**：文件选择已由 Wails v3 原生解决，不需要自建 JNI 桥接。用户通过 Wails 文件选择器选的模型会自动复制到 cache 目录，返回真实路径，`IsolateModelDir` / `StartFileServer` 全链路正常工作。

**仍需自建 bridge 的场景**：目录选择（`OpenDocumentTree`）—— 用于让用户指定资源库根目录。`WailsBridge.java` 中的 `openDocumentTree` Spike 已实现 Java 侧，但 Go→Java JNI 调用链未接通。

**三条路径重新评估**：

| 路径 | 评估 | 决策 |
|------|------|------|
| A. Wails 原生（文件选择） | ✅ 已可用 | **采纳** — 文件选择直接用 Wails API |
| B. 自建 JNI 桥接（目录选择） | Java 侧 Spike 已完成，Go 侧待接通 | **延后** — 目录选择非核心路径，用户可手动输入路径 |
| C. `MANAGE_EXTERNAL_STORAGE` | 短期可用 | **保留** — 作为目录选择的 fallback |

### 4. 桌面端 SelectDir 小问题（已识别，待修复）

**问题**：`library.go:25-29` 的 `OpenFile` dialog 虽设置 `CanChooseDirectories(true)`/`CanChooseFiles(false)`，但 Wails v3 在 Windows 上对这两个标志支持有缺陷，实际弹出文件选择器。

**修复方向**：可能需换 dialog 实现或调用原生 Win32 API。与 SAF 同属「目录选择能力缺失」类问题，建议一起解决。

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| Phase B 抽象层引入回归 | 低 | `desktopFileAccessor` 是 `os` 包薄包装，零行为差异；`go test ./...` 全通过作为回归基线 |
| 安卓 cache 目录膨胀 | 低 | 复用现有 `CleanOrphanCache` 模式，`cache/MikuMikuAR/serve/` 随 cache 清理 |
| `content://` URI 在 Phase C 前被传入 | 低 | `androidFileAccessor` 返回 `ErrContentUriNotSupported`，不会静默失败 |
| SAF Spike 发现 Wails alpha 阻塞 | 中 | 回退路径 C，`MANAGE_EXTERNAL_STORAGE` 在非 Play 渠道可持续 |
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

### Phase C（待 Spike）

| 文件 | 改动 |
|------|------|
| `build/android/app/src/main/java/com/wails/app/WailsBridge.java` | Spike：加 `openDocumentTree()` 方法 |
| `build/android/app/src/main/java/com/wails/app/MainActivity.java` | Spike：`onActivityResult` 转发 + `ActivityResultLauncher` 注册 |
| `internal/app/fileaccess_android.go` | Spike 成功后：`content://` 分支委托 SAF bridge |
| `internal/app/library.go` | Spike 成功后：`SelectDir` 安卓端改用 `OpenDocumentTree` |
| `internal/app/app.go` | Spike 成功后：`Config` 增加 `SafGrantedUris []string` |

---

## 后续方向

1. ~~短期：执行 Phase C Spike（0.5 天），验证 SAF 可行性~~ → **已由 Wails v3 原生解决文件选择**
2. **短期**：验证 Wails v3 文件选择器在真机上的行为（cache 复制 + 路径返回）
3. **中期**：接通目录选择 JNI 桥接（`openDocumentTree` Go→Java 调用链），用于资源库路径选择
4. **长期**：关注 Wails v3 稳定版发布，确认 SAF 行为无 breaking change
5. **缓存治理**：`cache/MikuMikuAR/serve/` 目录随 `CleanOrphanCache` 清理，需监控膨胀情况
