# ADR-023: Android 文件访问策略 — FileAccessor 抽象与 SAF 决策

**日期**：2026-07-04
> **状态**: 部分完成 — Phase A+B 已实施；Phase C Spike 完成（Java 侧可行，Go 侧受 Wails v3 alpha 限制）

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

### 3. Phase C：SAF 接入策略（决策待定 ⏸）

**Wails v3 SAF 能力调研结论**：

| SAF 能力 | 状态 | 证据 |
|----------|------|------|
| `OpenDocumentTree`（选目录树） | ❌ 不支持 | `mobile_features_android.go` 35 个方法无一项 SAF 相关 |
| `OpenDocument`（选单文件） | ❌ 不支持 | 同上 |
| `TakePersistableUriPermission` | ❌ 不支持 | `SecureSet/SecureGet` 是键值对存储，与 URI 权限无关 |
| `ContentResolver.openFileDescriptor` | ❌ 不支持 | 无任何 content:// 处理 API |
| `DocumentsContract.buildChildDocumentsUriUsingTree` | ❌ 不支持 | 同上 |

**三条路径对比**：

| 路径 | 工作量 | 风险 | 适用场景 |
|------|--------|------|---------|
| A. Wails 原生 | — | ❌ 否决 | 零 API 可用 |
| B. 自建 JNI 桥接 | ~4.5 天 | ⚠️ Wails alpha 不稳定，升级可能冲突 | 长期方案 |
| C. 继续 `MANAGE_EXTERNAL_STORAGE` | 0 | ⚠️ Google Play 审核风险 | sideload/国内渠道 |

**决策：先做 0.5 天 Spike，再决定是否投入完整 4.5 天**

Spike 范围（仅验证可行性，不写生产代码）：
1. `WailsBridge.java` 加 `openDocumentTree()` 方法，启动 `ACTION_OPEN_DOCUMENT_TREE` Intent
2. 验证能拿到 `content://` URI 字符串回传 Go
3. 验证 `takePersistableUriPermission` 重启后仍有效
4. 验证 Wails Activity 的 `onActivityResult` 转发链路是否工作

**Spike 成功** → 投入剩余 4 天完成完整 SAF（路径 B）
**Spike 失败**（Wails alpha 阻塞） → 回退路径 C，等 Wails v3 Android 稳定后再启动

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

1. **短期**：执行 Phase C Spike（0.5 天），验证 SAF 可行性
2. **中期**：根据 Spike 结果决定是否投入完整 SAF 桥接（4 天）
3. **并行**：修复桌面端 `SelectDir` 弹文件选择器的小问题
4. **长期**：关注 Wails v3 Android runtime 稳定进展（issue #5020 / PR #5022），稳定后重新评估 SAF 接入成本
5. **缓存治理**：`cache/MikuMikuAR/serve/` 目录随 `CleanOrphanCache` 清理，需监控膨胀情况
