# ADR-017: Android 平台适配现状与差距分析

**日期**：2026-07-03

---

## 背景

项目已完成首轮 Android APK 发版测试，但文档体系此前将 Android 标注为"远期"（Phase 10、P5 优先级）。经全面代码审查与 Wails v3 官方移动端文档对证，确认：

1. Wails v3 的 Android 支持已进入生产级阶段（Go 编译为 `libwails.so` → JNI 桥接 → Android WebView 渲染），`@wailsio/runtime` 绑定/事件/剪贴板等核心通道正常工作
2. 项目已有部分 Android 适配代码（`isAndroid` 守卫、`SelectDir` 回退、`integration.go` 平台分支），但存在信息滞后（注释仍称"Wails alpha"）
3. 首轮发版测试证明核心管道（Go 绑定、文件服务器、渲染引擎）可运行

本 ADR 记录实际差距与修复计划，而非早期分析的虚假警报。

---

## Wails v3 Android 工作机制

| 层次 | 桌面 | Android |
|------|------|---------|
| Go 编译 | 原生可执行文件 | `CGO_ENABLED=1` + NDK 编译为 `libwails.so` |
| 前端渲染 | Wails WebView | Android WebView（Chrome 内核） |
| 内置资源 | `embed.FS` → HTTP 文件服务器 | `WebViewAssetLoader` 进程内服务，无端口 |
| 用户模型资源 | `StartFileServer` → `127.0.0.1:PORT` | 同上，Android Linux 内核 TCP 正常 |
| 绑定通信 | `@wailsio/runtime` in-process | 同上，JNI → Go 消息处理器 |
| 对话框 | Wails Dialog API | SAF 文件选择器（OpenFile），目录/保存返回错误 |
| 文件访问 | 直接 `os.*` 系统调用 | 沙盒内 `os.*` 可用；外部需 SAF 授权 |

关键性质：**Android 是 Linux 内核**，`net.Listen("tcp", "127.0.0.1:0")` / `os.ReadDir` 沙盒内 / WASM / SharedArrayBuffer 均正常工作。

---

## 项目已有适配代码

已识别到项目中的 Android 感知代码：

| 位置 | 代码 | 评估 |
|------|------|------|
| `app.go:20` | `var isAndroid = stdruntime.GOOS == "android"` | ✅ 正确 |
| `app.go:167-169` | `openFileDialog` 返回"暂不可用"错误 | ⚠️ 过时，Wails v3 现已支持 SAF 文件选择 |
| `library.go:18-21` | `SelectDir` 返回 `/sdcard/MikuMikuAR` | ⚠️ 回退策略合理但硬编码路径脆弱 |
| `integration.go:346-351` | 软件管理 `switch GOOS` → Android 返回空列表 | ✅ 设计正确 |

---

## 实际差距分析

### 🔴 P0 — 必须修复

| ID | 问题 | 文件 | 修复方案 |
|----|------|------|---------|
| A01 | `openFileDialog` 硬挡 Android | `app.go:167-169` | 移除 `isAndroid` 守卫，让 Wails v3 SAF 文件选择器正常走通 |
| A02 | AndroidManifest 缺 cleartext 声明 | `AndroidManifest.xml` | 添加 `android:usesCleartextTraffic="true"` 或 `network_security_config.xml` 允许 `127.0.0.1` HTTP 请求 |
| A03 | `prompt()`/`confirm()` ~20 处散落 | `settings.ts`, `settings-software.ts`, `model-preset.ts`, `scene-render-levels.ts`, `motion-dance-sets.ts`, `env-preset-levels.ts` | Android WebView 不实现 `onJsPrompt` → 替换为 Wails 原生对话框或自定义 CSS 模态框 |

### 🟡 P1 — 体验降级，不影响核心功能

| ID | 问题 | 当前状态 | 建议 |
|----|------|---------|------|
| B01 | `SelectDir` 返回硬编码 `/sdcard/MikuMikuAR` | 目录可能不存在 | 启动时检测 + 自动创建，或让用户通过 `SetLibraryRoot` binding 手动设定 |
| B02 | 软件管理（Blender/MMD/自定软件） | `integration.go` 已有 `case "android"` 返回空 | 前端隐藏软件管理面板即可，无需后端改动 |
| B03 | 拖放文件导入依赖 `file.path` Wails 扩展 | `main.ts:drop` 事件 | Android 无桌面拖放，使用 SAF 文件选择器作为备选入口 |
| B04 | 触摸事件 | Babylon.js `attachControl` 默认 PointerEvent | 需在 `scene.ts` 初始化时确认 `engine` 启用了触控支持 |
| B05 | `SelectEnvTextureFile` 等文件选择器 | 均通过 `openFileDialog` | A01 修复后自动解决 |

### 🟢 P2 — 实际已工作，无需修改

| 之前误报项 | 真实情况 | 依据 |
|-----------|---------|------|
| `@wailsio/runtime` 绑定 | ✅ Wails v3 官方确认 JNI 桥接正常 | `nativeHandleRuntimeCall` → Go 消息处理器 |
| `os.*` 文件操作 | ✅ 沙盒内正常；`os.UserConfigDir()` 返回 app 数据目录 | Android Linux 内核 |
| `net.Listen` HTTP 服务器 | ✅ 127.0.0.1 TCP 监听正常 | Android Linux 内核 |
| WASM 物理 | ✅ Android Chrome WebView 支持 WASM + SharedArrayBuffer | Chromium 引擎 |
| `canvas.toDataURL` | ✅ Wails WebView 无跨域 canvas 安全问题 | 自定义协议加载 |
| 音频 `AudioContext` | ✅ Android WebView 支持 Web Audio API | 自动播放需用户手势触发 |

---

## 决策

### 1. 适配策略：小步迭代，不引入 PlatformAdapter 抽象层

当前 Android 只在极少数点需要特殊处理（`runtime.GOOS == "android"` 守卫），引入全量 PlatformAdapter 抽象过头了。保持现有 `isAndroid` 守卫模式，逐点修补。

### 2. 文件选择器：解除 `openFileDialog` 的 Android 封锁

Wails v3 通过 SAF 实现了 Android 文件选择，`openFileDialog` 的 `isAndroid` 守卫已过时。移除该守卫后，PMX/VMD/texture 的选择器自动可用。

### 3. 网络策略：补 Manifest 而非改架构

不使用 TCP 隧道或 WebViewAssetLoader 替代方案，直接在 `AndroidManifest.xml` 补 `android:usesCleartextTraffic="true"`。`127.0.0.1` 回环接口风险极小。

### 4. 对话框：用 Wails MessageDialog 替代 `prompt()/confirm()`

将用户输入和确认场景迁移至 Wails 的 `MessageDialog` / 自定义对话框 API，一举解决 Android + 桌面体验统一问题。

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| SAF 文件选择器在 Wails v3 Android 实际表现未验证 | 中 | 先在 `openFileDialog` 加 try/catch，失败时回退到原错误提示 |
| cleartext 声明被 Google Play 审核拒绝 | 低 | `usesCleartextTraffic` 仅允许 `127.0.0.1`，可用 `network_security_config.xml` 精确限域 |
| `prompt()`→`MessageDialog` 改造面广（~20处） | 中 | 分 2-3 轮完成，优先 P0 场景（设置重命名/删除确认/预设命名） |

---

## 涉及文件清单

| 文件 | 改动类型 | P0 |
|------|---------|----|
| `internal/app/app.go` | 移除 `openFileDialog` 的 Android 守卫 | ✅ |
| `build/android/app/src/main/AndroidManifest.xml` | 追加 `usesCleartextTraffic` 属性 | ✅ |
| `frontend/src/menus/settings.ts` | `prompt()` → Wails Dialog | ✅ |
| `frontend/src/menus/settings-software.ts` | `prompt()` → Wails Dialog | ✅ |
| `frontend/src/menus/model-preset.ts` | `prompt()` → Wails Dialog | ✅ |
| `frontend/src/menus/scene-render-levels.ts` | `prompt()` → Wails Dialog | ✅ |
| `frontend/src/menus/motion-dance-sets.ts` | `prompt()` → Wails Dialog | ✅ |
| `frontend/src/menus/env-preset-levels.ts` | `prompt()` → Wails Dialog | ✅ |
| `build/android/app/src/main/AndroidManifest.xml` | `network_security_config.xml` 引用（可选） | — |
| `build/android/app/src/main/res/xml/network_security_config.xml` | 新增，允许 127.0.0.1 cleartext（可选） | — |
| `internal/app/library.go` | `SelectDir` `/sdcard` 路径启动时校验 | — |

---

## 后续方向

1. **短期**：3 个 P0 修复完成 → 重新发版测试，验证 SAF 文件选择器 + 本地纹理加载全链路
2. **中期**：`prompt()` 改造完成后，逐项验证 B 级体验项（触摸事件、文件导入备选入口）
3. **远期**：评估是否引入 `application.System.IsMobile()` 运行时检测（Wails v3 官方推荐），替换编译期 `isAndroid` 守卫
