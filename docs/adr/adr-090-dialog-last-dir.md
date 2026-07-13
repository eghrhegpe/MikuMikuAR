# ADR-090: 对话框默认目录记忆（按资源类型）—— 双端可用

**日期**：2026-07-11 / 2026-07-12（双端重构 + 浏览器扩展）
> **状态**: 已完成（2026-07-12）
> **关联**: ADR-045（统一加载与资源管理）、ADR-018（PathManager + 文件 I/O 审计）、ADR-023（Android SAF 文件访问）、ADR-064（`*Dir` 包装维持现状）
> **影响面**: `internal/dialogs/file_dialog.go`、`internal/app/app.go`（Config）、`internal/app/` 各 `Select*` 包装函数、`frontend/src/menus/menu.ts`、`frontend/src/menus/library-core.ts`

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

**按资源类型分别记忆对话框默认目录，持久化到 `Config`，使用相对路径（相对于 ResourceRoot）在桌面端和 Android 端均可用。**

### 选项

| 选项 | 描述 | 结论 |
|------|------|------|
| A. 全局单一 lastDir | 所有对话框共用一个最后目录 | ❌ 否决：加载动作会跳回模型目录，体验倒退 |
| B. 按资源类型分别记忆（本 ADR） | `LastDirs map[string]string`，key 区分类型，相对路径优先 | ✅ 采用 |
| C. 仅会话内记忆（不落盘） | 进程退出即丢失 | ❌ 否决：重启后失效，价值减半 |

### 存储设计

`Config` 新增字段（`internal/app/app.go` `Config` 结构体）：

```go
// LastDirs 记录各资源类型文件对话框的默认起始目录。
// 优先使用相对于 ResourceRoot 的路径（以 "./" 开头），跨平台可移植；
// 绝对路径（不以 "./" 开头）仅用于桌面端外部目录（不在 ResourceRoot 下）。
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

### 相对路径解析规则（核心）

**存储格式**：优先使用相对于 `ResourceRoot` 的相对路径，以 `./` 前缀标识：

| 存储值 | 含义 | 读取结果（桌面） | 读取结果（Android） |
|--------|------|-----------------|-------------------|
| `"./VMD/初音未来"` | 相对于 ResourceRoot | `C:/Users/.../MMD/VMD/初音未来` | `/sdcard/MMD/VMD/初音未来` |
| `"D:/External/VMD"` | 绝对路径（仅桌面） | `D:/External/VMD` | N/A（Android 端不会存储绝对路径） |

**写入逻辑**：
1. 获取用户选择的文件所在目录 `dir`
2. 尝试用 `filepath.Rel(ResourceRoot, dir)` 转换为相对路径
3. 如果转换成功且路径不以 `..` 开头（即在 ResourceRoot 下），存储 `"./" + relPath`
4. 否则存储绝对路径（桌面端外部目录）

**读取逻辑**：
1. 从 `LastDirs[cat]` 取值
2. 如果以 `./` 开头，拼接 `ResourceRoot + path[2:]` 返回
3. 否则直接返回绝对路径

### 回退链（读取时）

```
LastDirs[cat] 存在且非空
  → 解析后使用
LastDirs[cat] 为空
  → OverridePaths[cat]（透传到 dialogs，不在此层拼接）
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

5. **Android 端生效（与 ADR-023 兼容）**
   Android 的 SAF 选择器（`fileaccess_android.go`）由 Wails v3 处理，选定后返回真实文件系统路径（复制到缓存目录）。由于：
   - `ResourceRoot` 是固定的（private: `/storage/emulated/0/Android/data/...` / shared: `/sdcard/MMD`）
   - 相对路径拼接后指向正确位置
   - Android 切换 private/shared 模式时 ResourceRoot 变化，但相对路径自动适配新根
   
   因此 LastDir 在 Android 端完全可用。唯一限制是 Android 上 Wails 不支持目录选择器，`SelectDir` 仍直接返回 ResourceRoot，不写 LastDir。

6. **并发安全**
   读取经 `GetConfig()`（RLock），写入经 `updateConfig(mutate, false)`（Lock），复用现有 `configMu`（`app.go:53`）。**不引入任何模块级全局变量**，满足 AGENTS.md 审核准则「无幽灵路径」。

---

## 实施清单

| 文件 | 改动 |
|------|------|
| `internal/app/app.go` | `Config` 结构体新增 `LastDirs map[string]string`（`json:"last_dirs,omitempty"`）；新增 `getLastDir` / `setLastDir` helper；新增 `GetLastBrowseDir` / `SetLastBrowseDir` binding |
| `internal/dialogs/file_dialog.go` | `OpenFile` / `SaveFile` / `SelectDir` 增加 `startDir string` 形参；`if startDir != "" { dialog.SetDirectory(startDir) }`；所有 `Select*` 内部调用透传 |
| `internal/app/app.go` | `SelectVMDMotion` / `SelectVPDPose` / `SelectAudioFile` / `SelectEnvTextureFile` / `SelectImportFile` / `SelectExeFile` / `SelectPMXFile`：调用前 `getLastDir` 取起始目录，成功后 `setLastDir` 写回 |
| `internal/app/integration.go` | `SelectSceneOpenFile` / `SelectBundleSaveFile`：同样接入 |
| `internal/app/model_preset.go` | `SelectPresetSaveFile` / `SelectPresetOpenFile`：同样接入 |
| `internal/app/library.go` | `SelectDir`（桌面分支）成功后写 `LastDirs["library"]`；读取时优先 `LastDirs["library"]` |
| `frontend/src/menus/menu.ts` | `SlideMenu` 新增 `onLevelEnter` 回调（level push/pop 后触发）；`onFolderEnter` 签名改为支持 `Promise` 异步返回 |
| `frontend/src/menus/library-core.ts` | `models:browse` 入口调用 `GetLastBrowseDir('pmx')` 恢复上次目录；`onLevelEnter` 回调在导航子目录时调用 `SetLastBrowseDir` 持久化 |
| `frontend/src/__tests__/bindings/app.contract.test.ts` | 补充 `GetLastBrowseDir` / `SetLastBrowseDir` 到预期函数列表 |

### 核心代码

```go
// internal/app/app.go — 相对路径解析

// getLastDir 读取目录记忆，自动解析相对路径 → 绝对路径
func (a *App) getLastDir(cat string) string {
    cfg, err := a.GetConfig()
    if err != nil || cfg == nil || cfg.LastDirs == nil {
        return ""
    }
    path := cfg.LastDirs[cat]
    if path == "" {
        return ""
    }

    // 相对路径：./PMX/subfolder → ResourceRoot/PMX/subfolder
    if strings.HasPrefix(path, "./") {
        root := cfg.ResourceRoot
        if root == "" {
            root = DefaultResourceRoot()
        }
        return filepath.Join(root, path[2:])
    }

    // 绝对路径：直接返回（用于外部目录）
    return path
}

// setLastDir 写入目录记忆，优先转换为相对路径（跨平台可移植）
func (a *App) setLastDir(cat, dir string) {
    _ = a.updateConfig(func(cfg *Config) {
        if cfg.LastDirs == nil {
            cfg.LastDirs = map[string]string{}
        }

        root := cfg.ResourceRoot
        if root == "" {
            root = DefaultResourceRoot()
        }

        // 尝试转换为相对路径
        relPath, err := filepath.Rel(root, dir)
        if err == nil && !strings.HasPrefix(relPath, "..") {
            cfg.LastDirs[cat] = "./" + filepath.ToSlash(relPath)
        } else {
            // 不在 ResourceRoot 下，使用绝对路径
            cfg.LastDirs[cat] = filepath.ToSlash(dir)
        }
    }, false) // rescan=false：目录记忆不触发模型重扫
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

### 包装函数模式

```go
func (a *App) SelectVMDMotion() (string, error) {
    path, err := dialogs.SelectVMD(a.wailsApp, a.getLastDir("motion"))
    if err != nil || path == "" {
        return path, err
    }
    a.setLastDir("motion", filepath.Dir(path))
    return path, nil
}
```

---

## 浏览器目录记忆（扩展 —— 资源库浏览器也使用相同基础设施）

**背景**：日常模型浏览 90% 走资源库浏览器（`library-core.ts`），而非文件对话框。浏览器每次打开均从 `getBrowseDir("pmx")` 的根目录重建，不记忆上次浏览的子目录。

**方案**：复用同一套 `LastDirs` 基础设施，key 前缀 `browse:` 区分浏览器场景，与文件对话框场景互不干扰。

### 后端新增 binding

```go
// GetLastBrowseDir 读取上次浏览目录，透传给前端。
func (a *App) GetLastBrowseDir(category string) (string, error) {
    return util.SafeCall(func() (string, error) {
        dir := a.getLastDir("browse:" + category)
        if dir == "" {
            return "", nil
        }
        return dir, nil
    })
}

// SetLastBrowseDir 持久化当前浏览目录。
func (a *App) SetLastBrowseDir(category, dir string) error {
    return util.SafeCallVoid(func() error {
        a.setLastDir("browse:" + category, dir)
        return nil
    })
}
```

### 前端读取（`models:browse` 入口）

```typescript
// library-core.ts — makeModelMenu 的 onFolderEnter 回调
if (row.target === 'models:browse') {
    const browseDir = getBrowseDir('pmx');
    // 始终从 root 打开；仅记录 lastDir 相对 root 的子目录段，交由 onLevelEnter 逐级展开
    const [lastDir] = await GetLastBrowseDir('pmx');
    const segs = lastDir ? splitSubdirSegments(browseDir, lastDir) : null;
    pendingAutoExpand = segs && segs.length > 0 ? segs : null;
    return buildLevel(browseDir, ...); // 不再是 startDir = lastDir（换根）
}
```

> **修订（展开栈）**：原方案把 `lastDir` 直接作为 `buildLevel` 起始层级（"换根"），导致导航栈单层、用户迷失，且 `lastDir` 与实时 `m.dir` 前缀不对齐时会生成 `:` 伪文件夹。改为"从 root 打开 + `onLevelEnter` 异步串行展开到 `lastDir` 各层"，既保留完整层级路径（可逐级返回），又不改变资源库读取根。

### 前端写入 + 展开（`onLevelEnter` 回调）

```typescript
// library-core.ts — SlideMenu 的 onLevelEnter 选项
onLevelEnter: (level, menu) => {
    const dir = normPath(level.dir);
    if (!dir || dir === '.' || dir === '/') return;
    const browseRoot = getBrowseDir('pmx');
    if (!browseRoot) return;
    // [展开栈] 打开时从 root 异步串行展开到上次浏览目录（push 为动画驱动，同步多 push 会被 transitioning 拦截）
    if (pendingAutoExpand && pendingAutoExpand.length > 0) {
        const seg = pendingAutoExpand[0];
        const nextDir = normPath(dir + '/' + seg);
        pendingAutoExpand = pendingAutoExpand.length > 1 ? pendingAutoExpand.slice(1) : null;
        menu.push(buildLevel(nextDir, seg, (m) => m.format === 'pmx', menu));
        return;
    }
    if (dir === browseRoot) return; // 根目录不持久化
    // 仅在 ResourceRoot/PMX/ 下的子目录导航时持久化
    if (dir.toLowerCase().startsWith(browseRoot.toLowerCase())) {
        void SetLastBrowseDir('pmx', dir);
    }
},
```

### SlideMenu `onLevelEnter` 回调（新增）

`menu.ts` 的 `SlideMenu` 新增 `onLevelEnter` 选项，在每次 level 变更（push/pop）后触发：

```typescript
// menu.ts — SlideMenu 类新增
onLevelEnter?: (level: PopupLevel, menu: SlideMenu) => void;
```

调用时机与 `onAfterRender` 同步，覆盖 `push()` 初始渲染、`push()` 切换完成、`pop()` 返回、`go()` 跳转。

### `onFolderEnter` 改为异步兼容

为支持 `models:browse` 入口调用异步 `GetLastBrowseDir`，`onFolderEnter` 签名改为支持 `Promise`：

```typescript
// 原签名
onFolderEnter?: (row: PopupRow, menu: SlideMenu) => PopupLevel | null;
// 新签名
onFolderEnter?: (row: PopupRow, menu: SlideMenu) => PopupLevel | null | Promise<PopupLevel | null>;
```

`library-core.ts` 的 `makeModelMenu` 将 `onFolderEnter` 改为 `async`，`menu.ts` 的两处点击处理改为 `await`。

---

## 已知缺口 / 不在范围

1. **Android `SelectDir` 不生效**：Wails v3 Android 不支持目录选择器，直接返回 ResourceRoot，不写 LastDir。
2. **测试覆盖**：建议补 `getLastDir` / `setLastDir` 的单元测试（相对路径解析、绝对路径回退、nil map 初始化），核心 UI builder 可暂不测。
3. **多窗口 / 多实例**：当前为单 App 实例，`configMu` 已覆盖；若未来多窗口共享进程，逻辑不变。
4. **不替代 `RecentModels`**：`RecentModels`（`app.go:346`）管「一键重开上次文件」，LastDirs 管「对话框默认位置」，二者互补不重叠，不改动 `RecentModels`。
5. **浏览器仅记忆 PMX 目录**：当前仅 `models:browse`（PMX 模型浏览）接入目录记忆；其他类别的浏览器（如 VMD、音频）未接入，后续可按需扩展。
6. **写入仅针对 ResourceRoot 下的子目录**：`onLevelEnter` 中检查 `dir.startsWith(browseRoot)` 排除根菜单、scene 详情等无关目录，避免误存。

---

## 验证

- `go build ./...` 通过
- `cd frontend && npm run test -- src/__tests__/bindings/app.contract.test.ts`（118 函数 + FNV-1a 契约不变）
- 手动：连续加载两次不同目录的 VMD，第二次对话框应默认落在第一次目录；加载 PMX 不影响 VMD 目录记忆
- 手动：在资源库浏览器中导航到 `PMX/初音未来/`，关闭弹窗后重新打开「加载模型」，应自动定位到 `PMX/初音未来/` 而非根目录
