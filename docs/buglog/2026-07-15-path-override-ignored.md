# 路径覆写失效：多个函数绕过 OverridePaths 导致幽灵目录与统计数据不准

**发现日期**：2026-07-15
**严重度**：🟠 P2（功能缺陷，影响用户体验）

---

## 问题描述

用户配置了 `OverridePaths` 将各分类目录（PMX/VMD/audio 等）指向自定义位置（如 `text-model/PMX`），但以下行为未遵循覆写：

1. **根目录冒出空文件夹**：程序启动后在 ResourceRoot 下创建 `PMX/`、`VMD/`、`audio/` 等空目录，即使这些分类已覆写到别处
2. **配置文件位置错误**：`config.json` 写到 `ResourceRoot/setting/` 而非 `OverridePaths.Setting` 指定的位置
3. **资源统计不准**：缓存统计页面漏统计覆写后的目录
4. **广场下载目录错误**：模型广场下载的文件存到 `ResourceRoot/model/`（目录名还不对），而非覆写后的 `PMX/` 目录
5. **导出工程相对路径丢失**：导出 MMD 工程时，覆写目录下的模型相对路径退化成 basename

---

## 根因分析

路径解析存在「多入口」问题，没有统一的真相来源：

| 函数 | 预期行为 | 实际行为 |
|------|---------|---------|
| `GetPath(cfg, category)` | 有 override 用 override，否则 `ResourceRoot/subdir` | ✅ 正确 |
| `settingDir(cfg)` | 同上 | ❌ 固定拼 `ResourceRoot/setting` |
| `ensureResourceDirs(cfg)` | 只在未覆写的分类下创建默认目录 | ❌ 一律在 ResourceRoot 下创建所有目录 |
| `GetCacheStats()` | 统计覆写后的实际目录 | ❌ 硬编码 `knownResourceDirs` 列表 |
| `DownloadFromPlaza()` | 下载到覆写后的分类目录 | ❌ 硬编码 `ResourceRoot/model`（目录名还是错的） |
| `BundleScene()` | 用覆写目录计算相对路径 | ❌ 用 ResourceRoot 做基准，退化成 basename |

核心问题：`GetPath()` 已正确实现 override 逻辑，但其他函数各搞各的，没有复用。

---

## 修复方案

### 1. `settingDir()` — 尊重 OverridePaths.Setting

**文件**：`internal/app/app.go:579-591`

```diff
 func settingDir(cfg *Config) (string, error) {
     if cfg != nil && cfg.ResourceRoot != "" {
-        d := filepath.Join(cfg.ResourceRoot, "setting")
+        d := cfg.OverridePaths.Setting
+        if d == "" {
+            d = filepath.Join(cfg.ResourceRoot, "setting")
+        }
         if err := os.MkdirAll(d, 0755); err != nil {
             return "", fmt.Errorf("create setting dir %s: %w", d, err)
         }
         return d, nil
     }
     return configDir()
 }
```

**效果**：下游 `scenePresetDir`、`modelPresetDir`、`envPresetsDir`、`writeConfig`、`GetLibraryIndex` 全部自动跟随修复。

### 2. `ensureResourceDirs()` — 按分类独立判断

**文件**：`internal/app/app.go:725-752`

```diff
 func (a *App) ensureResourceDirs(cfg *Config) {
     root := cfg.ResourceRoot
     if root == "" {
         root = DefaultResourceRoot()
         cfg.ResourceRoot = root
     }
-    dirs := []string{"PMX", "VMD", "audio", "stage", "prop", "environment", "MD-dress", "setting"}
-    for _, d := range dirs {
-        os.MkdirAll(filepath.Join(root, d), 0755)
+    defs := []struct {
+        override *string
+        subdir   string
+    }{
+        {&cfg.OverridePaths.PMX, "PMX"},
+        {&cfg.OverridePaths.VMD, "VMD"},
+        // ... 其他分类
+    }
+    for _, d := range defs {
+        target := *d.override
+        if target == "" {
+            target = filepath.Join(root, d.subdir)
+        }
+        os.MkdirAll(target, 0755)
     }
 }
```

**效果**：不再在 ResourceRoot 下创建幽灵空目录。

### 3. `GetCacheStats()` — 统计覆写后的实际目录

**文件**：`internal/app/zipextract.go:305-347`

```diff
 if cfg, err := a.GetConfig(); err == nil && cfg != nil && cfg.ResourceRoot != "" {
+    seen := make(map[string]struct{})
+    categories := []string{"pmx", "vmd", "audio", "stage", "prop", "environment", "md_dress", "setting"}
+    for _, cat := range categories {
+        dir := a.GetPath(cfg, cat)
+        if _, ok := seen[dir]; ok {
+            continue
+        }
+        seen[dir] = struct{}{}
+        bytes, count := dirSize(dir)
+        stats.ResourceBytes += bytes
+        stats.ResourceCount += count
+    }
-    for _, name := range knownResourceDirs {
-        dir := filepath.Join(cfg.ResourceRoot, name)
-        bytes, count := dirSize(dir)
-        stats.ResourceBytes += bytes
-        stats.ResourceCount += count
-    }
 }
```

**效果**：缓存统计准确反映实际目录大小。

### 4. `DownloadFromPlaza()` — 使用 GetPath 获取下载目录

**文件**：`internal/app/proxy.go:556-578`

```diff
-    root := cfg.ResourceRoot
-    if root == "" {
-        root = DefaultResourceRoot()
-    }
     ext := lowerExt(fileName)
-    var subdir string
+    var category string
     switch ext {
     case ".pmx", ".zip":
-        subdir = "model"
+        category = "model"
     case ".vmd":
-        subdir = "motion"
+        category = "motion"
     case ".vpd":
-        subdir = "pose"
+        category = "pose"
     default:
-        subdir = "model"
+        category = "model"
     }
-    destDir := filepath.Join(root, subdir)
+    destDir := a.GetPath(cfg, mapCategoryKey(category))
```

**效果**：广场下载文件存到覆写后的正确目录。

### 5. `BundleScene()` — 智能选择相对路径基准

**文件**：`internal/app/integration.go:600-607`

新增 `findBestLibRoot()` 函数，从所有分类路径中选取最长匹配前缀作为基准：

```go
func (a *App) findBestLibRoot(cfg *Config, assetPaths []string) string {
    candidates := []string{}
    cats := []string{"pmx", "vmd", "audio", "stage", "prop", "environment", "md_dress", "setting"}
    for _, cat := range cats {
        candidates = append(candidates, a.GetPath(cfg, cat))
    }
    // 选最长匹配前缀
    // ...
}
```

**效果**：覆写目录下的模型导出时保留完整目录结构。

---

## 影响范围

| 影响模块 | 修复前行为 | 修复后行为 |
|---------|-----------|-----------|
| 配置文件存储 | 固定写 ResourceRoot/setting | 遵循 OverridePaths.Setting |
| 场景/模型/渲染预设 | 固定在 ResourceRoot/setting 下 | 同上（自动跟随） |
| 模型库扫描 | ✅ 已正确（用 GetPath） | 不变 |
| 目录初始化 | 无条件创建所有默认目录 | 只创建未覆写的目录 |
| 缓存统计 | 漏统计覆写目录 | 准确统计 |
| 广场下载 | 目录名错 + 不走覆写 | 目录名正确 + 走覆写 |
| 工程导出 | 覆写目录退化 basename | 保留完整结构 |

---

## 验证结果

- `go build ./...` ✅
- `go test ./internal/...` ✅
- 前端测试：1476 passing（未受影响）

---

## 附：测试隔离修复

`proxy_test.go` 中 `TestDownloadFromPlaza` 原本未隔离 `configDir()`，会读取用户真实配置导致测试失败。已添加 `testConfigDir(t)` 隔离。

---

## 教训

**单一真相来源原则**：路径解析逻辑应收敛到唯一入口（本例为 `GetPath`），其他函数复用而非重写，避免「修复 A 忘修 B」的碎片化问题。