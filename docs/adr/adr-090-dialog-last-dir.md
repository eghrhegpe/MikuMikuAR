# ADR-090: 对话框默认目录记忆（按资源类型）

**日期**：2026-07-11
> **状态**: 规划（待实施）
> **关联**: ADR-045（统一加载与资源管理）、ADR-018（PathManager + 文件 I/O 审计）、ADR-023（Android SAF 文件访问）、ADR-064（`*Dir` 包装维持现状）
> **影响面**: `internal/dialogs/file_dialog.go`、`internal/app/app.go`（Config）、`internal/app/` 各 `Select*` 包装函数

---

## 问题

当前 `internal/dialogs/file_dialog.go` 的 `OpenFile` / `SaveFile` 仅调用 Wails 的

```go
dialog := wailsApp.Dialog.OpenFile()
dialog.SetTitle(title)
dialog.CanChooseFiles(true)
// …filters…
dialog.PromptForSingleSelection()
```

**未调用 `.SetDirectory()`**，因此每次打开文件对话框都落在系统默认位置——即**完全不记忆上次位置**。MMD 工作流中模型 / 动作 / 姿势 / 音频 / 环境贴图通常分散在不同目录，反复从根目录翻找是高频低效操作。

Wails v3 已提供 `SetDirectory(dir)`（`pkg/application/dialogs.go:316` 的 `OpenFileDialogStruct.SetDirectory`，Save 侧 `:451` 同样有），接入成本为零。

---

## 决策

**按资源类型分别记忆对话框默认目录，持久化到 `Config`，仅桌面端生效。**

### 选项

| 选项 | 描述 | 结论 |
|------|------|------|
| A. 全局单一 lastDir | 所有对话框共用一个最后目录 | ❌ 否决：加载动作会跳回模型目录，体验倒退 |
| B. 按资源类型分别记忆（本 ADR） | `LastDirs map[string]string`，key 区分类型 | ✅ 采用 |
| C. 仅会话内记忆（不落盘） | 进程退出即丢失 | ❌ 否决：重启后失效，价值减半 |

### 存储设计

`Config` 新增字段（`internal/app/app.go` `Config` 结构体，当前 `:326` 起）：

```go
// LastDirs 记录各资源类型文件对话框的默认起始目录（仅桌面端生效）。
// key 取值见下方分类；value 为绝对目录。空 map / 缺 key 时按回退链处理。
LastDirs map[string]string `json:"last_dirs,omitempty"`
```

key 分类（与 `library.go:scanAllCategories` 的类别命名对齐，UI 专用项单列）：

| key | 对应对话框 / 函数 |
|-----|------------------|
| `model` | `SelectPMX` |
| `motion` | `SelectVMD`（绑定 `SelectVMDMotion`）|
| `pose` | `SelectVPD`（绑定 `SelectVPDPose`）|
| `audio` | `SelectAudio`（绑定 `SelectAudioFile`）|
| `environment` | `SelectEnvTexture`（绑定 `SelectEnvTextureFile`）|
| `preset` | `SelectPresetOpen` / `SelectPresetSave` |
| `scene` | `SelectSceneOpen` / `SelectSceneSave` / `SelectBundleSave` |
| `import` | `SelectImport`（合并 pmx/zip/vmd 选择器）|
| `library` | `SelectLibraryDir`（模型库根目录）|
| `exe` | `SelectExe` |

`import` 缺省时回退到 `model` 目录（导入多为模型/动作，延续模型浏览位置）。

### 回退链（读取时）

```
LastDirs[cat] 存在且非空
  → 使用
LastDirs[cat] 为空
  → OverridePaths[cat] / ResourceRoot（ADR-018 / library.go）
  → 仍空则系统默认（Wails 不传 SetDirectory）
```

**不硬编码任何路径**；回退链只读 `LastDirs`，不修改既有 `isolateDir` / `trustedRoots` 信任解析（ADR-018）。

### 写入时机

对话框**成功选择且返回非空路径**时写回 `filepath.Dir(path)`，与下游加载是否成功解耦（用户确实在该目录选了文件，目录记忆即应更新）。

---

## 兼容性约束（核心 —— 与现有加载逻辑零冲突）

本决策刻意设计为**纯增量、闭包在 Go 后端内部**，不触碰前端契约与加载链路：

1. **Wails 绑定签名不变**
   前端经绑定调用 `SelectVMDMotion()`、`SelectSceneOpenFile()` 等，签名均为 `(string, error)`。LastDir 读写全部在 Go 内部完成，**不改变任何导出函数签名**。
   `frontend/src/__tests__/bindings/app.contract.test.ts` 校验 116 个函数存在性 + FNV-1a method ID，改签名会直接破坏契约测试——本方案规避此风险。

2. **`dialogs` 包保持纯 UI（单一职责）**
   `OpenFile` 仅新增 `startDir string` 形参并在非空时调 `SetDirectory`；**不引用 `Config`**。持久化逻辑放在 `internal/app` 的 `Select*` 包装函数内，职责边界与 ADR-064「命名包装刻意设计、非债」一致。

3. **不动 ADR-045 统一加载链路**
   `LoadManager` / `ResourceHandle` / 队列串行化 / 伴音自动加载均不受影响。LastDir 只决定「对话框从哪打开」，不改变加载路径、加载结果或 `ResourceHandle` 返回结构。

4. **伴音自动加载（ADR-045 §2D）不串扰**
   伴音按 VMD 同目录发现、不经对话框；`LastDirs["audio"]` 与 `LastDirs["motion"]` 独立存储，互不影响。

5. **Android 分支跳过**
   Android 走 content URI + 缓存复制（`internal/app/fileaccess_android.go`），无真实目录语义（ADR-023 / ADR-017）。`SelectDir` 在 Android 已直接返回 `ResourceRoot`（`library.go:21-30`）；其余 `Select*` 的 Android 路径不写 LastDir，仅桌面端生效。

6. **并发安全**
   读取经 `GetConfig()`（RLock），写入经 `updateConfig(mutate, false)`（Lock），复用现有 `configMu`（`app.go:53`）。**不引入任何模块级全局变量**，满足 AGENTS.md 审核准则「无幽灵路径」。

---

## 实施清单

| 文件 | 改动 |
|------|------|
| `internal/app/app.go` | `Config` 结构体新增 `LastDirs map[string]string`（`json:"last_dirs,omitempty"`）|
| `internal/dialogs/file_dialog.go` | `OpenFile` / `SaveFile` 增加 `startDir string` 形参；`if startDir != "" { dialog.SetDirectory(startDir) }`；所有 `Select*` 内部调用透传 |
| `internal/app/app.go` | 新增 `getLastDir(cat)`（经 `GetConfig` 读）/ `setLastDir(cat, dir)`（经 `updateConfig` 写，nil map 初始化）helper |
| `internal/app/app.go` | `SelectVMDMotion` / `SelectVPDPose` / `SelectAudioFile` / `SelectEnvTextureFile` / `SelectImportFile` / `SelectExeFile` / `SelectPresetOpenFile` 等：调用前 `getLastDir` 取起始目录，成功后 `setLastDir` 写回 |
| `internal/app/integration.go` | `SelectSceneOpenFile` / 对应 Save 函数：同样接入 |
| `internal/app/library.go` | `SelectDir`（桌面分支）成功后写 `LastDirs["library"]`；读取时优先 `LastDirs["library"]` |

### 实施 Sketch（关键片段）

```go
// internal/app/app.go
func (a *App) getLastDir(cat string) string {
    cfg, err := a.GetConfig()
    if err != nil || cfg == nil || cfg.LastDirs == nil {
        return ""
    }
    return cfg.LastDirs[cat]
}

func (a *App) setLastDir(cat, dir string) {
    _ = a.updateConfig(func(cfg *Config) {
        if cfg.LastDirs == nil {
            cfg.LastDirs = map[string]string{}
        }
        cfg.LastDirs[cat] = dir
    }, false) // rescan=false：目录记忆不触发模型重扫
}

// 包装函数示例
func (a *App) SelectVMDMotion() (string, error) {
    path, err := dialogs.SelectVMD(a.wailsApp, a.getLastDir("motion"))
    if err != nil || path == "" {
        return path, err
    }
    a.setLastDir("motion", filepath.Dir(path))
    return path, nil
}
```

```go
// internal/dialogs/file_dialog.go
func OpenFile(wailsApp *application.App, title string, filters []application.FileFilter, startDir string) (string, error) {
    if wailsApp == nil {
        return "", fmt.Errorf("application not initialized")
    }
    dialog := wailsApp.Dialog.OpenFile()
    dialog.SetTitle(title)
    if startDir != "" {
        dialog.SetDirectory(startDir)
    }
    dialog.CanChooseFiles(true)
    for _, f := range filters {
        dialog.AddFilter(f.DisplayName, f.Pattern)
    }
    path, err := dialog.PromptForSingleSelection()
    if err != nil {
        return "", err
    }
    return filepath.ToSlash(path), nil
}
```

---

## 已知缺口 / 不在范围

1. **Android 不生效**：content URI 无目录概念，明确排除（见兼容性第 5 条）。
2. **测试覆盖**：建议补 `getLastDir` / `setLastDir` 的单元测试（首次写入初始化 nil map、回退链、并发读写），核心 UI builder 可暂不测。
3. **多窗口 / 多实例**：当前为单 App 实例，`configMu` 已覆盖；若未来多窗口共享进程，逻辑不变。
4. **不替代 `RecentModels`**：`RecentModels`（`app.go:346`）管「一键重开上次文件」，LastDirs 管「对话框默认位置」，二者互补不重叠，不改动 `RecentModels`。

---

## 验证

- `go build ./...` 通过
- `cd frontend && npm run test -- src/__tests__/bindings/app.contract.test.ts`（116 函数 + FNV-1a 契约不变）
- 手动：连续加载两次不同目录的 VMD，第二次对话框应默认落在第一次目录；加载 PMX 不影响 VMD 目录记忆
