# ADR-068: Android 配置持久化 & 路径浏览级联修复

> **状态**: ✅ 已合并 → [ADR-017](adr-017-android-adaptation.md)
> **来源**: 本文件 B1-B10 修复已合并至 ADR-017 精简版
> **关联**: ADR-067（Android 端口隐患清单）、ADR-023（Android 文件访问策略）
> **触发**: 2026-07-08 首次真机 Android 14 测试

---

## 一、问题

首次在 Android 14 真机上完整走通 MikuMikuAR 流程时，暴露出 **7 个级联 Bug**，从构建方式到 Go 运行时到前端渲染链全部涉及。用户操作链路为：

```
构建APK → 安装 → 启动 → 设置路径(shared模式) → 确认 → 模型浏览 → 动作加载
```

每一步都有 Bug 炸断。

---

## 二、Bug 清单

### B1: 构建环境陷阱（已修复 — ADR-067 跟进）

| 项目 | 详情 |
|------|------|
| **症状** | 前端修改后 `./gradlew installDebug` 部署后不生效 |
| **根因** | `main.go:19` 使用 `//go:embed all:frontend/dist` 将前端资源内嵌进 Go 二进制。`gradlew installDebug` 只重打包 APK，不重新编译 `libwails.so`，旧的嵌入式前端仍被优先服务（`WailsPathHandler.handle()` 先查 Go embed FS 再 fallback 到 APK assets） |
| **正确流程** | `.\scripts\build-android.ps1 -Arch arm64` — 前端构建 → Go 交叉编译 → Gradle 打包全链路执行 |

### B2: Dialog 弹框 `pointer-events` 残留（前端 · `dialog.ts`）

| 项目 | 详情 |
|------|------|
| **症状** | `showConfirm` 确认框关闭后，`#mmd-dialog-overlay` 仍在 DOM 中但不可交互；第二次调用时 CSS class `mmd-dialog-visible` 设 `pointer-events: auto`，但前一次残留的 inline `style.pointerEvents = 'none'` 优先级更高，锁死弹框 |
| **修复** | `cleanup()` 中 `overlay.style.pointerEvents = ''`（清除 inline 值，回退到 CSS class 控制）；`showDialog()` 开头也清一次 |
| **文件** | `frontend/src/core/dialog.ts` |

### B3: 对话框未随菜单关闭（前端 · `utils.ts`）

| 项目 | 详情 |
|------|------|
| **症状** | 菜单打开时弹出了 `showConfirm` 对话框，用户按返回/Esc 关闭菜单但对话框 `#mmd-dialog-overlay`（z-index: 10000）残留覆盖全屏，后续所有菜单操作看似"没反应" |
| **根因** | `closeAllOverlays()` 只清理 `[data-overlay].visible` 元素，不处理 `#mmd-dialog-overlay` |
| **修复** | `closeAllOverlays()` 中新增：检测 `#mmd-dialog-overlay` 存在则移除 `mmd-dialog-visible` class + 清除 inline style |
| **文件** | `frontend/src/core/utils.ts` |

### B4: `tryCatchStatus` 无法区分成功与失败（前端 · `library-core.ts`）

| 项目 | 详情 |
|------|------|
| **症状** | `switchStorageMode` 中的 `async () => { ... }` 回调不 return 值，`tryCatchStatus` 返回 `void = undefined`。`if (result === undefined)` 错误地将成功当失败处理，`throw Error("目录设置失败")` |
| **修复** | 替换为直接 `try/catch`，失败时 `console.error + setStatus + throw err` 三重保证 |
| **文件** | `frontend/src/menus/library-core.ts` |

### B5: Go `sync.RWMutex` 不可重入死锁（Go · `model_preset.go / library.go`）

| 项目 | 详情 |
|------|------|
| **症状** | 点击"授权目录"→确认后应用完全卡死，JS Promise 永不 resolve/reject |
| **根因** | Go 调用链：`SetStorageMode` → `updateConfig`（`configMu.Lock()` 持写锁）→ `writeConfigAndRescan` → `ScanModelDir` → `GetConfig`（`configMu.RLock()` 试图读锁）→ Go 的 `sync.RWMutex` **不可重入**，同一 goroutine 持写锁时再获取读锁 = 自死锁 |
| **修复** | `writeConfigAndRescan` 直接调 `scanAllCategories(cfg)` 传入已有 cfg 参数，绕开 `ScanModelDir` → `GetConfig` 路径 |
| **文件** | `internal/app/model_preset.go` |
| **同类风险** | 搜索 `updateConfig` 所有调用点，确认无其他 `rescan=true` 的路径进入死锁 |

### B6: Config 写入后未缓存（Go · `model_preset.go`）

| 项目 | 详情 |
|------|------|
| **症状** | `SetStorageMode` 写配置后，`reloadConfig()` → `GetConfig()` 读到空 Config（`resource_root = ""`） |
| **根因** | `writeConfig()` 写文件前 `a.cachedCfg = nil` 清空缓存，但后续 `getConfigUnsafe()` 缓存未命中、bootstrap 也不存在（B7），返回空 Config |
| **修复** | `writeConfig()` 写文件成功后 `a.cachedCfg = cfg` 填充缓存 |
| **文件** | `internal/app/model_preset.go` |

### B7: Bootstrap 配置从未写入（Go · `model_preset.go`）

| 项目 | 详情 |
|------|------|
| **症状** | 重启应用后配置丢失，路径显示回默认私有模式 |
| **根因** | `getConfigUnsafe()` 分三阶段：① 读 `configDir()/config.json`（bootstrap）→ ② 根据 bootstrap 的 ResourceRoot 找 `setting/` 下完整配置 → ③ 都不存在则返回空 Config。但 `writeConfig()` **只写了 `setting/` 路径，从未写 bootstrap 路径**。`pm clear` 清数据后 bootstrap 不存在，阶段 ② 因无 ResourceRoot 而跳过，阶段 ③ 返回空 Config |
| **修复** | `writeConfig()` 增加 bootstrap 写入：`configDir()/config.json` 写相同内容（`os.WriteFile + Rename` 原子写入） |
| **文件** | `internal/app/model_preset.go` |

### B8: 浏览路径大小写不匹配（前端 · `utils.ts / motion-popup.ts`）

| 项目 | 详情 |
|------|------|
| **症状** | 模型浏览列表为空（`lcard` 空），动作浏览从根目录开始 |
| **根因** | Go 端 `GetPath("pmx")` 构造的扫描路径为 `/sdcard/MMD/PMX`（大写），`GetPath("vmd")` → `/sdcard/MMD/VMD`（大写）。但前端 `getBrowseDir('pmx')` 返回 `libraryRoot + '/pmx'`（小写）。`buildLevel()` 用 `m.dir.startsWith(dir)` 大小写敏感比对，全部模型被 `continue` 跳过 |
| **修复** | ① `utils.ts` 新增 `CATEGORY_DIR` 映射表（与 Go 端 `GetPath` 的 `subdir` 字段一致）并用于 `getBrowseDir`；② `motion-popup.ts` 4 处 `libraryRoot` 替换为 `getBrowseDir('vmd'/'vpd'/'audio')` |
| **文件** | `frontend/src/core/utils.ts`, `frontend/src/menus/motion-popup.ts` |

---

## 三、修复文件一览

| 文件 | 修改 |
|------|------|
| `internal/app/model_preset.go` | B5: `scanAllCategories(cfg)` 直调避免死锁；B6: 写后 `cachedCfg = cfg`；B7: 同时写 bootstrap |
| `frontend/src/core/dialog.ts` | B2: `pointerEvents = ''` 清除 inline 值 |
| `frontend/src/core/utils.ts` | B3: `closeAllOverlays` 清理 dialog；B8: `CATEGORY_DIR` 大小写映射 |
| `frontend/src/core/library-core.ts` | B4: `try/catch` 替换 `tryCatchStatus` + 诊断日志 |
| `frontend/src/core/settings-paths.ts` | 诊断卡片、`.catch()` 错误传播 |
| `frontend/src/core/menu.ts` | B2: `buildPanel` 中 `renderCustom` try-catch 错误边界 |
| `frontend/src/menus/motion-popup.ts` | B8: `libraryRoot` → `getBrowseDir()` |

---

## 四、教训

### 4.1 Go `embed.FS` 的构建陷阱

`go:embed all:frontend/dist` 在 Go 编译时静态内嵌前端文件。修改前端后 **必须重新编译 Go 二进制**——仅更新 APK `assets/` 目录不会生效，因为`WailsPathHandler` 优先从 Go embed FS 提供服务。

**法则**: Android 前端改动 → 跑 `build-android.ps1`（前端+Go+APK 全量）。不可用 `./gradlew installDebug` 替代。

### 4.2 Go `sync.RWMutex` 不可重入

Go 标准库 `sync.RWMutex` 不支持可重入（reentrant）锁定。持写锁的 goroutine 再获取读锁会导致自死锁。在 `updateConfig` 这类锁定函数中调用 `GetConfig` 等内部也获取锁的函数必须特别谨慎。

**法则**: `updateConfig`（写锁）内部只能使用已持有的 `cfg` 参数，禁止调用 `GetConfig`（读锁）或 `ScanModelDir`（其内部调 `GetConfig`）。

### 4.3 配置双重路径

配置系统有 bootstrap（`configDir()`）和完整（`settingDir()`）两个路径，但写入代码只维护了后者。任何持久化操作都应同时写入两处。

### 4.4 大小写一致性

`/sdcard/MMD/PMX` vs `/sdcard/MMD/pmx` 这类大小写不匹配在 Windows 上不暴露（不区分大小写），但在 Linux/Android 文件系统上直接导致浏览为空。前端 `getBrowseDir` 与 Go 端 `GetPath` 的子目录名必须完全一致。

**法则**: 目录名映射表（`CATEGORY_DIR` / `defaultDirName` / `app.go:defs`）三处须保持同步，测试需在大小写敏感文件系统上验证。

---

## 五、ADR-068 追加修复

| ID | 问题 | 文件 | 修复 |
|----|------|------|------|
| B9 | 环境贴图浏览路径硬编码 `'environment'`（无完整路径），`buildLevel` 的 `startsWith` 匹配失败 | `env-menu.ts`、`env-feature-levels.ts` | 替换为 `getBrowseDir('environment')` |
| B10 | `motion-pose-levels.ts` 动态 `await import('@babylonjs/core/Cameras/arcRotateCamera')` 无法被 Vite externalize 处理，运行时浏览器无法解析 bare specifier | `motion-pose-levels.ts` | 改为静态 `import` |

