# ADR-018: PathManager 平台抽象层 + 文件 I/O 审计

**日期**：2026-07-04
> **状态**: 已完成

---

## 背景

项目需支持 5 平台同步（Windows/macOS/Linux/Android/iOS），文件路径获取逻辑散落在 `ensureDir()`、`DefaultResourceRoot()`、`SelectDir()` 三个函数中，各含 `isAndroid`/`runtime.GOOS` 分支。同时对文件 I/O 层进行了安全与健壮性审计。

---

## 决策

### 1. 引入 PathManager 接口（已实施）

**问题**：路径获取逻辑与平台判断耦合，3 个函数各自硬编码平台分支。

**方案**：包级 PathManager 单例 + build tags 平台实现。

```
internal/app/
├── pathmgr.go              # 接口 + 单例 + init（23行）
├── pathmgr_desktop.go      # //go:build !android
├── pathmgr_android.go      # //go:build android
```

**接口定义**：

```go
type PathManager interface {
    AppDataRoot() (string, error)  // 配置根（不含 "MikuMikuAR"）
    CacheRoot() (string, error)    // 缓存根（不含 "MikuMikuAR"）
    ResourceRoot() string           // 用户资源根（~/MMD）
}
```

**选择包级单例而非 App 字段的原因**：7 个目录函数（`configDir`、`extractedDir` 等）是包级函数，被 42 处调用。改为 App 方法需改 42 处调用者 + 所有测试，收益不匹配成本。

**选择 build tags 而非运行时 GOOS 检查的原因**：平台实现完全不同（硬编码路径 vs 系统 API），build tags 让编译器保证只包含正确实现，零运行时开销。

### 2. 保留 `isAndroid` 用于功能 guard

`integration.go` 中 6 处 `isAndroid` 检查是功能不可用的 guard（Android 不能运行 .exe），不是路径逻辑。保留不动。

### 3. 修复 `trustedRoots()` 遗漏 `ResourceRoot`（已实施）

**问题**：`trustedRoots()` 只检查 `cfg.LibraryRoot`（迁移后永远为空）+ `ExternalPaths`，导致 `ResourceRoot` 下的模型文件每次加载都走 `isolateDir` 复制到 temp 目录。

**修复**：加入 `cfg.ResourceRoot` 到信任列表。

### 4. `copyDir` 改为流式复制（已实施）

**问题**：`httpserver.go` 的 `copyDir` 用 `os.ReadFile` 全量读入内存再写，大纹理文件（几百 MB）会吃内存。

**修复**：改用 `copyFile`（内部 `io.Copy` 流式复制）。

### 5. `zipextract.go` 文件句柄关闭顺序修正（已实施）

**问题**：`rc.Close()` 和 `outFile.Close()` 在循环末尾手动调用，非 defer。

**修复**：`outFile.Close()` 和 `rc.Close()` 紧跟 `io.Copy` 后执行，减少极端情况句柄泄漏窗口。

---

## 文件读取架构审计结果

### 完整链路

```
前端 initLibrary()
├─ GetLibraryIndex()         → 缓存读取（setting/index.json）
├─ rescanAndSync()           → 全量扫描
│   └─ ScanModelDir()        → 5 类别 × (1 主库 + N 外部库) 递归 WalkDir
│       └─ scanDirByExt()    → 扩展名过滤 + zip 内部条目遍历
└─ CleanOrphanCache()        → 后台清理

用户浏览 buildLevel()
├─ hasSubdir()               → O(N) 线性扫描 allModels
└─ _ensureModelMeta()        → 按需批量 PMX 头部解析

用户加载 resolveFileUrl()
├─ IsolateModelDir()         → 信任路径检查 + 外部文件 temp 复制
└─ StartFileServer()         → HTTP 文件服务（127.0.0.1）
```

### 复杂度

| 操作 | 复杂度 | 瓶颈 |
|------|--------|------|
| ScanModelDir（启动） | O(D × F) | 磁盘递归遍历 |
| hasSubdir（浏览） | O(N) 每层 | 全量列表线性扫描 |
| GetModelMetaBatch | O(K × P) | PMX 二进制解析 |
| zip 内部扫描 | O(Z × E) | 每次打开 zip 遍历条目 |

### 安全性确认

| 检查项 | 结论 |
|--------|------|
| Zip slip 防护 | filepath.Abs + HasPrefix + 尾部分隔符，正确 |
| isSafePath 边界 | C:/ModelsSecret 不匹配 C:/Models/，正确 |
| 配置文件读写 | 标准 JSON 序列化，无注入风险 |
| HTTP 文件服务 | CORS 仅限 127.0.0.1，无 CSRF 风险 |

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `internal/app/pathmgr.go` | 新增 — 接口 + 单例 |
| `internal/app/pathmgr_desktop.go` | 新增 — 桌面实现 |
| `internal/app/pathmgr_android.go` | 新增 — Android 实现 |
| `internal/app/app.go` | 修改 — ensureDir + DefaultResourceRoot 委托 PathManager |
| `internal/app/library.go` | 修改 — SelectDir Android 分支委托 PathManager |
| `internal/app/httpserver.go` | 修改 — trustedRoots 加入 ResourceRoot + copyDir 流式复制 |
| `internal/app/zipextract.go` | 修改 — 文件句柄关闭顺序 |

---

## 后续方向

1. **zip 内部条目缓存**：避免每次 `scanDirByExt` 都打开 zip 遍历条目，可缓存 zip 内文件列表
2. **hasSubdir 索引化**：预建 `dir → children` 映射，将 O(N) 降为 O(1)
3. **SAF 文件选择器**：Android 目录选择当前返回默认路径，后续接入 SAF URI
