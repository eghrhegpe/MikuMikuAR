# internal/ — Go 后端专用 AGENTS.md

> **定位**：Go 后端模块的架构索引、测试约定、维护指南。
> AI 在 `internal/` 内编辑时优先读本文件；根 [`AGENTS.md`](../AGENTS.md) 是项目宪法 + 全局文档地图。

---

## 一、构建与测试命令

> **执行位置**：所有命令在项目根目录执行。

| 命令 | 用途 | 说明 |
|------|------|------|
| `go build ./...` | 构建全部 | 验证编译通过 |
| `go test ./...` | 运行全部测试 | |
| `go test ./internal/...` | 仅后端测试 | |
| `go vet ./...` | 静态分析 | 检查常见错误 |
| `go run ./cmd/mikumikuar` | 本地运行 | 启动应用 |

### 高频最小集

```bash
go build ./... && go test ./internal/...
```

---

## 二、后端目录索引

```
internal/
├── app/                    # 核心业务逻辑
│   ├── app.go              # ★ App 结构体 + 生命周期 + 配置管理
│   ├── app_test.go         # 单元测试（validatePresetName、bestDecode、zipCacheName）
│   ├── library.go          # 模型库扫描（并行分类扫描、PMX 解析）
│   ├── fileaccess.go       # FileAccessor 接口（跨平台文件访问抽象）
│   ├── fileaccess_desktop.go # Desktop 实现（os.*）
│   ├── fileaccess_android.go # Android 实现（预留 SAF 桥接）
│   ├── httpserver.go       # 模型隔离 + 安全 HTTP 服务
│   ├── integration.go      # Blender/MMD 集成 + 软件管理
│   ├── watch.go            # fsnotify 下载目录监听 + 去抖
│   ├── tags.go             # 标签系统
│   ├── dancesets.go        # 舞蹈套装管理
│   ├── update.go           # GitHub Release 更新检查
│   ├── thumbnail.go        # 缩略图缓存入口
│   ├── zipextract.go       # ZIP 解压 + 缓存管理
│   ├── scene_preset.go     # 场景预设持久化
│   ├── model_preset.go     # 模型预设持久化
│   ├── render_preset.go    # 渲染预设持久化
│   ├── pathmgr.go          # PathManager 接口（平台路径抽象）
│   ├── pathmgr_desktop.go  # Desktop 路径实现
│   ├── pathmgr_android.go  # Android 路径实现
│   ├── shutdown_test.go    # HTTP 服务关闭测试
│   ├── decodezip_test.go   # ZIP 编码测试
│   └── fs_test.go          # 文件系统操作测试
├── dialogs/                # 文件对话框封装
│   └── file_dialog.go      # Wails v3 Dialog 封装（PMX/VMD/Audio/Exe/Dir）
├── thumbnail/              # 缩略图缓存
│   └── thumbnail.go        # SHA-256 缓存键 + PNG 存取
└── util/                   # 通用工具
    ├── errors.go           # WrapError/WrapErrorf 错误包装
    ├── errors_test.go      # 错误包装测试
    ├── safecall.go         # SafeCall/SafeCallVoid panic 恢复
    ├── safecall_test.go    # safecall 测试
    ├── safecall_integration_test.go # 集成测试
    ├── pmx.go              # PMX 二进制头解析（UTF-8/UTF-16LE）
    └── pmx_test.go         # PMX 解析测试
```

---

## 三、核心架构

### 3.1 App 结构体（`app.go`）

```go
type App struct {
    wailsApp    *application.App    // Wails 应用引用
    appVersion  string              // 构建版本（-ldflags 注入）
    buildTime   string              // 构建时间
    commitHash  string              // 提交哈希
    httpServers map[string]*httpServerInfo // 按目录索引的 HTTP 服务
    httpSrvMu   sync.Mutex          // HTTP 服务互斥锁
    configMu    sync.RWMutex        // 配置读写锁
    cachedCfg   *Config             // 内存缓存，writeConfig 时失效
    watcher     *fsnotify.Watcher   // 目录监听器
    watchDir    string              // 当前监听目录
    watchMu     sync.Mutex          // 监听互斥锁
    watchTimer  *time.Timer         // 去抖定时器
    watchPending map[string]struct{} // 待处理文件
}
```

**生命周期**：
- `NewApp()` → `ServiceStartup()` → 运行中 → `ServiceShutdown()`
- `ServiceStartup`：恢复监听 + 后台清理孤立缓存
- `ServiceShutdown`：关闭监听器 + 并行关闭 HTTP 服务（5s 超时）

### 3.2 配置系统

**双层存储**：
1. `configDir()/config.json` — 启动引导配置（含 ResourceRoot）
2. `settingDir()/config.json` — 完整配置（ResourceRoot 可用时）

**读写锁**：
- `GetConfig()` — RLock 读取
- `updateConfig(mutate, rescan)` — Lock 写入 + 可选 rescan
- `writeConfig()` — 持久化 + 失效缓存

**版本迁移**：
- `currentConfigVersion = 1`
- `finaliseConfig()` 执行迁移（v0→v1: library_root→resource_root）

### 3.3 模型库扫描（`library.go`）

**并行扫描**：
- 8 个分类（model/motion/audio/pose/scene/environment/outfit/prop）
- 每个分类一个 goroutine，结果合并后返回

**ZIP 展开**：
- `expandZipEntries()` 打开 ZIP，识别内部 PMX/VMD/Audio/VPD
- 支持 Shift-JIS/GBK 编码文件名（`bestDecode()`）

**PMX 解析**：
- `GetModelMeta()` / `GetModelMetaBatch()` 按需解析头部
- `isGarbageModelName()` 过滤无效名称

### 3.4 文件隔离（`httpserver.go`）

**安全隔离**：
- `IsolateModelDir()` — 信任目录返回原路径，外部文件复制到缓存
- `isSafePath()` — 前缀匹配 + "/" 边界防止路径穿越
- `trustedRoots()` — ResourceRoot + LibraryRoot

**资源限制**：
- 单文件上限 500MB（`maxIsolateFileSize`）
- 单次复制上限 2GB（`maxIsolateTotalSize`）
- 符号链检测（`EvalSymlinks`）防止目录遍历

### 3.5 目录监听（`watch.go`）

**事件处理**：
- fsnotify Create/Write 事件
- 扩展名过滤（.zip/.pmx/.vmd）
- Magic Number 验证（ZIP/RAR 签名）
- 800ms 去抖

**前端通知**：
- `watch:newfile` 事件，携带 path/name/type

### 3.6 平台抽象

**FileAccessor 接口**：
- `fileaccess.go` 定义接口
- `fileaccess_desktop.go` — os.* 实现
- `fileaccess_android.go` — 预留 SAF 桥接

**PathManager 接口**：
- `pathmgr.go` 定义接口
- `pathmgr_desktop.go` — UserConfigDir/UserCacheDir
- `pathmgr_android.go` — /data/data/<pkg>/files

---

## 四、测试覆盖

| 文件 | 测试数 | 覆盖内容 |
|------|--------|----------|
| `app_test.go` | 7 | validatePresetName、ScenePresetDir、bestDecode（Shift-JIS/GBK）、decodeZipName、zipCacheName、manifest |
| `shutdown_test.go` | 1 | HTTP 服务并行关闭 |
| `decodezip_test.go` | - | ZIP 编码测试 |
| `fs_test.go` | - | 文件系统操作测试 |
| `errors_test.go` | - | 错误包装测试 |
| `safecall_test.go` | - | panic 恢复测试 |
| `safecall_integration_test.go` | - | 集成测试 |
| `pmx_test.go` | - | PMX 解析测试 |

---

## 五、维护风险清单

### 5.1 并发安全

| 问题 | 状态 | 说明 |
|------|------|------|
| 配置读写竞争 | ✅ 已防护 | `configMu` RWMutex 保护 |
| HTTP 服务并发关闭 | ✅ 已处理 | `shutdownServers()` 并行 + WaitGroup |
| 监听器事件竞态 | ✅ 已防护 | `watchMu` 互斥锁 + 去抖 |

### 5.2 资源管理

| 问题 | 状态 | 说明 |
|------|------|------|
| HTTP 服务泄漏 | ✅ 已处理 | `ServiceShutdown()` 关闭所有服务 |
| 文件句柄泄漏 | ✅ 已处理 | `defer in.Close()` / `defer out.Close()` |
| 监听器泄漏 | ✅ 已处理 | `ServiceShutdown()` 关闭 watcher |

### 5.3 安全边界

| 问题 | 状态 | 说明 |
|------|------|------|
| 路径穿越 | ✅ 已防护 | `isSafePath()` + `EvalSymlinks` |
| 文件大小失控 | ✅ 已限制 | 500MB/文件、2GB/次 |
| ZIP 炸弹 | ⚠️ 未防护 | 无 ZIP 条目数量/深度限制 |
| 命令注入 | ✅ 安全 | `exec.Command()` 参数数组传递，无 shell 解释 |

### 5.4 平台兼容

| 问题 | 状态 | 说明 |
|------|------|------|
| Android SAF | ⚠️ 预留 | FileAccessor 接口已定义，实现待 Phase C |
| Android 文件监听 | ⚠️ 不支持 | `StartWatchDir()` 返回错误 |
| Android 软件启动 | ⚠️ 不支持 | `LaunchSoftware()` 返回错误 |

### 5.5 已知技术债

| 问题 | 优先级 | 说明 |
|------|--------|------|
| ZIP 炸弹防护 | 低 | 可添加条目数/深度限制 |
| Android SAF 实现 | 中 | Phase C 时实现 |
| 缩略图过期清理 | 低 | 无 TTL 机制，依赖磁盘空间 |

---

## 六、依赖关系

```
internal/app
  ├── github.com/wailsapp/wails/v3/pkg/application  # Wails 框架
  ├── github.com/fsnotify/fsnotify                   # 文件系统监听
  ├── mikumikuar/internal/dialogs                    # 文件对话框
  ├── mikumikuar/internal/thumbnail                  # 缩略图缓存
  └── mikumikuar/internal/util                       # 通用工具

internal/util
  └── (标准库 only)

internal/thumbnail
  └── (标准库 only)

internal/dialogs
  └── github.com/wailsapp/wails/v3/pkg/application
```

---

## 七、写新代码的约定

1. **错误包装** — 使用 `util.WrapError(op, err)` 或 `util.WrapErrorf(op, msg, err)`
2. **panic 恢复** — 对外暴露的方法使用 `util.SafeCall()` / `util.SafeCallVoid()`
3. **配置变更** — 通过 `a.updateConfig(mutate, rescan)` 原子操作
4. **文件访问** — 使用 `fileAccessor` 而非 `os.*`（为 Android SAF 预留）
5. **平台分支** — 使用 `isAndroid` 变量检查，`runtime.GOOS` 用于构建标签
6. **测试** — 使用 `testConfigDir(t)` 隔离配置目录，避免污染用户环境
