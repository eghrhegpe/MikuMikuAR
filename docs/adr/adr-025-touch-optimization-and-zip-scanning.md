# ADR-025: 触屏交互优化与 ZIP 模型扫描通用化

**日期**：2026-07-04

---

## 背景

Android 端进入发版测试阶段后暴露两大类问题：

1. **触屏交互缺失**：桌面端设计的 UI 组件（4px seek bar、键盘 WASD、无 touch-action）在触屏设备上几乎不可用
2. **ZIP 模型包识别不完整**：仅 outfit 类别支持 zip 扫描，用户将 zip 放入 PMX 目录时无法识别；且 `scanDirByExt` 缺少 zip 展开逻辑，需统一抽象

---

## 决策一：触屏交互分层优化（P0 → P1 → P2）

### P0 — 阻断级修复

| 改动 | 文件 | 方案 |
|------|------|------|
| Seek 条触控区域 | `app.css` | `@media (pointer: coarse)` 下高度从 4px 扩至 44px（Apple HIG 最小触控目标），视觉仍为 4px（`::before` 伪元素绘制轨道） |
| viewport 锁定 | `index.html` | 加 `maximum-scale=1.0, user-scalable=no` 阻止浏览器双指缩放 |
| touch-action | `app.css` | `html/body/#app/#renderCanvas` 设 `touch-action: none`，浏览器不再抢占手势给 Babylon.js |

### P1 — 核心体验

| 改动 | 文件 | 方案 |
|------|------|------|
| ArcRotateCamera 触屏参数 | `camera.ts` | 新增 `isTouchDevice()` 工具函数（`ontouchstart` + `maxTouchPoints` + `matchMedia`），触屏时 `pinchPrecision=32`（灵敏缩放）、`panningSensibility=20`（易拖动）、`multiTouchPanAndZoom=true` |
| Freefly 双指操控 | `camera.ts` | 新增 `initFreeflyTouch`/`stopFreeflyTouch`：双指捏合 = 前进/后退，双指滑动 = 上下/左右移动，松手自动停止；仅在 freefly 模式激活 |
| 长按弹详情 | `main.ts` | `pointerdown` 启动 500ms 定时器 → 超时且移动 < 10px → `showModelPopup()` + `buildModelDetailLevel(id)`；`pointermove` 超 10px 取消，`pointerup` 清除 |

### P2 — 锦上添花

| 改动 | 文件 | 方案 |
|------|------|------|
| 双击聚焦 | `main.ts` | 300ms 内两次 tap 同一位置 → `focusModel(focusedModelId)` 自动构图 |
| 右滑返回 | `menu.ts` | SlideMenu 新增 `touchstart/touchend` 监听：水平滑动 > 60px 且垂直偏移 < 40px → `pop()` 返回上层 |
| Safe area 适配 | `index.html` + `app.css` | viewport 加 `viewport-fit=cover`；`#bottomNav`/`#statusBar` 加 `padding-bottom: env(safe-area-inset-bottom)` |

---

## 决策二：ZIP 模型扫描通用化

### 问题

1. `scanAllCategories` 中仅 outfit 类别包含 `.zip` 扩展名，PMX 目录下的 zip 包无法被识别
2. `scanDirByExt` 缺少 zip 展开逻辑，与 `scanDirRecursive` 中已有的 zip 处理代码重复
3. 给所有类别盲目加 `.zip` 导致 audio/pose 等无独立目录的类别回退到根目录 `WalkDir(root)`，递归命中其他类别的 zip 造成重复扫描

### 方案

1. **提取 `expandZipEntries` 函数**（`library.go:113-160`）：打开 zip → 遍历内部 PMX/VMD/Audio/VPD → 返回 `ModelEntry` 列表，支持 `typeOverride` 参数覆盖类型推断
2. **`scanDirByExt` 和 `scanDirRecursive` 统一调用** `expandZipEntries`，消除两处重复的 zip 展开代码
3. **仅在有独立目录的类别加 `.zip`**：model（PMX）、motion（VMD）、scene（stage）、environment、outfit（MD-dress）；audio/pose 不加，避免回退根目录递归扫描

### 类别扫描配置（最终）

```go
{"model",        []string{".pmx", ".zip"}},
{"motion",       []string{".vmd", ".zip"}},
{"audio",        []string{".mp3", ".wav", ".ogg", ".flac", ".wma"}},
{"pose",         []string{".vpd"}},
{"scene",        []string{".x", ".pmx", ".zip"}},
{"environment",  []string{".png", ".jpg", ".jpeg", ".hdr", ".dds", ".json", ".zip"}},
{"outfit",       []string{".zip", ".pmx", ".x"}},
```

---

## 附带修复

| 问题 | 修复 |
|------|------|
| Taskfile.yml 缺少 ARCH 默认值 → 构建出 ARM64 EXE 无法在 x86_64 Windows 运行 | `build/windows/Taskfile.yml` 加 `ARCH: '{{.ARCH \| default "amd64"}}'` |
| `body` 上 `user-select: none` 导致搜索框/输入框文字无法选中 | 补 `input, textarea, [contenteditable] { user-select: text }` 覆写 |
| `scanDirByExt` 重构后残留孤儿 `scanRoot` 结构体（209-213 行） | 删除死代码 |

---

## 后果

- **正向**：Android 端触屏交互从"基本不可用"提升到"可用且手感合理"；zip 模型包在所有有独立目录的类别下均可被正确识别和展示
- **负向**：`isTouchDevice()` 在每次创建相机时调用一次 `matchMedia`，开销可忽略；`@media (pointer: coarse)` 仅触屏设备生效，桌面端零影响
- **风险**：Freefly 双指操控依赖 `touchmove` 事件的 `preventDefault()`，若未来引入原生滚动容器需注意冲突
