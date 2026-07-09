# Wails v3 — Android / iOS 移动端支持调研

> 调研时间：2026-07-09
> 源码版本：wailsapp/wails@3440ae554b8ae3c0fffb7f7a778ba778b6bbf1e5
>
> 结论：Wails v3 移动端**有完整实现**（核心代码 + 平台适配层 + 文档齐全），但框架整体处于 **Alpha** 阶段——save dialog 报错、多窗口仅显第一窗、Menu/Tray 在移动端为 intentional no-ops。移动端能力**未达 production-ready**（Wails 团队公开征贡献者来达成此目标）。本文对其作"功能实现完整"的评估，但**不代表可直接作为生产运行基准**。
>
> ⚠️ 二次审计标记（2026-07-09，基于三路并行源码实证）：
> - **build tags / 平台文件清单 / 文档存在**：经核验 ✅ 准确
> - **文件总数(111/123) / 三个完整示例**：未在上游独立复现，标为待核验
> - **iOS 功能矩阵全 ✅**：基于源码分析与 Wails 官方状态表，**未经本项目实测**
> - **本项目 Android 现状**：实际是"Wails v3 框架 + 自写 940 行 Java host + 自处理 SAF/相机/前台服务"的**重度集成**，**非"零换血直接复用"**
> - **本项目 iOS 现状**：全仓无 `//go:build ios` 文件、无 iOS task，**iOS 尚未起步**

---

## 1. 源码分布

| 平台 | 代表性实现文件 | 已核验 Go 文件数 |
|------|--------------|----------|
| **Android** | `v3/pkg/application/application_android.go` (1164 行 ✅ 已核验) | `v3/pkg/application/` 内 **18 个**（已核验）；全 v3 子树总数 **未独立复现**，原标"~111 个" 待核验 |
| **iOS** | `v3/pkg/application/application_ios.go` (451 行 ✅ 已核验) | `v3/pkg/application/` 内 **8 个**（已核验）；全 v3 子树总数 **未独立复现**，原标"~123 个" 待核验 |

关键平台实现文件（均位于 `v3/pkg/application/`）：

```
application_android.go          # 核心 Android 平台实现（1164 行，已核验）
application_android_nocgo.go   # 非 CGO Android stub
mobile_android.go              # 移动特性注入 Android
mobile_features_android.go     # Android 特有能力（摄像头/传感器等）
clipboard_android.go           # 剪贴板
dialogs_android.go            # 文件对话框 / 消息对话框
screen_android.go             # 屏幕尺寸 / 亮度
systemtray_android.go         # 系统托盘（移动端占位实现）
events_common_android.go       # 事件系统（Go → JS / JS → Go）
init_android.go               # 初始化入口
logger_android.go             # 日志
mainthread_android.go         # 主线程调度
messageprocessor_android.go   # 消息处理
menu_android.go               # 菜单
single_instance_android.go    # 单实例
keys_android.go               # 键值处理
webview_window_android.go     # WebView 窗口封装（原清单漏列，已补）
autostart_android.go          # 自启动（原清单漏列，已补）

application_ios.go            # 核心 iOS 平台实现（451 行，已核验）
mobile_ios.go                # 移动特性注入 iOS
mobile_features_ios.go        # iOS 特有能力
clipboard_ios.go / dialogs_ios.go / screen_ios.go ...
ios_runtime_api.go           # iOS Runtime API 定义
ios_runtime_ios.go           # iOS Runtime 实现
ios_runtime_stub.go          # iOS Runtime CGO stub
webview_window_ios.go        # WKWebView 窗口封装
autostart_ios.go             # 自启动（原清单漏列，已补）

mobile.go                    # 跨平台抽象（路由到 Android/iOS 实现）
mobile_stub.go              # 桌面端的移动能力 stub
```

> 📌 已核验：上述文件均在上游 `3440ae5` 实测存在；Android 18 / iOS 8 个文件的 `v3/pkg/application/` 目录清单完整。"~111 / ~123 个文件"为原稿定量断言，**未经 GitHub API 递归复现**，使用时请注意。

---

## 2. 架构概述

### 2.1 Android 架构

```
┌─────────────────────────────────────────────┐
│               MainActivity                   │
│  (Java Host - WailsActivity / WailsBridge)  │
├─────────────────────────────────────────────┤
│              WebView + WebViewAssetLoader   │
│            (内嵌资源服务，无网络端口)           │
├─────────────────────────────────────────────┤
│           libwails.so (C Shared Lib)        │
│              via JNI / CGO                   │
├─────────────────────────────────────────────┤
│                 Go Runtime                   │
│  (Bindings / Events / Dialogs / Clipboard…) │
└─────────────────────────────────────────────┘
```

- Go 编译为 C shared library（`libwails.so`），由 Java `MainActivity` 加载
- `WebViewAssetLoader` 实现进程内资源服务，无需开放网络端口
- JS ↔ Go 通过 `JavascriptInterface` / JNI 桥接通信

### 2.2 iOS 架构

```
┌─────────────────────────────────────────────┐
│           AppDelegate (Objective-C)          │
│        + WailsBridge / WKURLSchemeHandler    │
├─────────────────────────────────────────────┤
│              WKWebView + wails://            │
│            (自定义 URL 协议内嵌资源)           │
├─────────────────────────────────────────────┤
│           CGO + Objective-C Runtime          │
├─────────────────────────────────────────────┤
│                 Go Runtime                   │
│  (Bindings / Events / Dialogs / Clipboard…) │
└─────────────────────────────────────────────┘
```

- 自定义 `wails://` URL 协议 + `WKURLSchemeHandler` 实现进程内资产服务
- CGO 桥接 Objective-C 运行时，无网络端口依赖
- iOS Runtime 分三文件：`ios_runtime_api.go`（接口）→ `ios_runtime_ios.go`（实现）→ `ios_runtime_stub.go`（CGO 桩）

### 2.3 跨平台抽象

```go
// v3/pkg/application/mobile.go
func (m *Mobile) StoragePath() string {
    if runtime.GOOS == "android" {
        return m.Android.StoragePath()
    }
    if runtime.GOOS == "ios" {
        return m.IOS.StoragePath()
    }
    return ""
}
```

平台通过 Go build tags 区分：

```go
// Android
//go:build android && cgo && !server

// iOS
//go:build ios && !server
```

---

## 3. 功能支持状态

> 📌 数据来源：Android 列对照 v3.wails.io/guides/mobile/android/ 官方状态表；iOS 列对照 v3.wails.io/guides/mobile/ 官方状态表与源码分析。**本项目（MikuMikuAR）对 iOS 能力尚未实测**，本节仅反映 Wails v3 框架层面的支持，不等于 MikuMikuAR 的实际可用能力。

### 3.1 核心功能

| 功能 | Android | iOS |
|------|---------|-----|
| WebView 渲染 | ✅ WebView + WebViewAssetLoader | ✅ WKWebView + wails:// 协议 |
| Service Bindings（JS → Go 调用） | ✅ JavascriptInterface 传输 | ✅ UIWebView / WKWebView 桥接（官方状态表标 "Working"） |
| Events（Go ↔ JS 双向） | ✅ | ✅ |
| 消息对话框（Info / Warning / Error） | ✅ AlertDialog + 按钮回调 | ✅ UIAlertController + 按钮回调 |
| 文件**打开**对话框 | ✅ Storage Access Framework | ✅ UIDocumentPickerViewController |
| 文件**保存**对话框 | ❌ **官方标"Returns an error — write inside the app sandbox instead"** | ❌ **同 Android：报错，写应用沙箱** |
| 剪贴板 | ✅ ClipboardManager | ✅ UIPasteboard |
| 屏幕 API（尺寸/亮度/朝向） | ✅ WindowMetrics | ✅ 屏幕 / safe-area metrics |
| 应用生命周期事件 | ✅ | ✅ |
| 单实例 | ✅ | ⚠️（多窗口仅显第一窗，单实例概念移动端弱） |
| 多窗口 | ⚠️ **只有第一个窗口会被显示** | ⚠️ **只有第一个窗口会被显示** |
| 日志系统 | ✅ | ✅ |
| 主线程调度 | ✅ | ✅ |
| 窗口几何 / 菜单 / 系统托盘 | — | — | **官方标 "Intentional no-ops"** |

### 3.2 移动原生能力

> 📌 该矩阵基于源码分析（`mobile_features_android.go` / `mobile_features_ios.go`），**MikuMikuAR 未实测每一项**。每一项 ✅ 表示 Wails 框架在该平台**提供了** API 入口，不代表本项目已调用或验证。

| 能力 | Android | iOS |
|------|---------|-----|
| 设备信息 | ✅ | ✅ |
| 系统主题（深/浅色） | ✅ | ✅ |
| 电池状态 | ✅ | ✅ |
| 网络状态 | ✅ | ✅ |
| Haptics（振动） | ✅ | ✅ |
| Share（系统分享） | ✅ | ✅ |
| Torch（闪光灯） | ✅ | ✅ |
| 生物识别（指纹/面容） | ✅ | ✅ |
| 地理位置 | ✅ | ✅ |
| 传感器（加速度/陀螺仪等） | ✅ | ✅ |
| 安全存储（KeyChain / Keystore） | ✅ | ✅ |
| 文字转语音 | ✅ | ✅ |
| 存储管理（清理缓存） | ✅ | ✅ |
| 通知 | ✅ | ✅ |
| Dock Badge | — | ✅ |

---

## 4. 文档与示例

| 文件 | 说明 | 核验状态 |
|------|------|----------|
| `v3/ANDROID.md` | Android 构建指南、状态表、Gradle 配置 | ✅ 已核验存在（13,374 字节） |
| `v3/IOS.md` | iOS 构建指南、状态表、Xcode 配置 | ✅ 已核验存在（9,824 字节） |
| `IOS_ARCHITECTURE.md`（仓库根） | iOS 架构详解 | ✅ 已核验存在；行数"419 行" 未实测 |
| `v3/README.md` | 包含移动端示例引用 | ✅ 已核验存在 |
| `v3/Taskfile.yaml` | 含 `android:run` / `ios:run` 等任务 | ✅ 已核验存在（15,262 字节） |
| `v3/examples/android/` | Android 完整示例 | ⚠️ **未核验**：librarian 网络调查报"未找到对应示例目录"；需后续直接 GitHub API 复查 |
| `v3/examples/ios/` | iOS 完整示例 | ⚠️ **未核验**：同上 |
| `v3/examples/mobile/` | 跨平台移动示例 | ⚠️ **未核验**：同上 |

---

## 5. 与 MikuMikuAR 的关联

> 📌 本节为二次审计中**改写最多**的章节。原稿把本项目的 Android 集成描述得过轻（"实验性 c-shared + WebView"），并据此推出"零框架换血扩展到 Android/iOS"的乐观判断。源码实证显示二者均不准确。

### 5.1 实际现状（基于本仓库代码核验）

| 方向 | 实际状态 | 证据 |
|------|----------|------|
| **Android** | ✅ **重度集成**，**不是 c-shared hack**——使用 Wails v3 正规入口 `application.RegisterAndroidMain(main)`，并配以**自写 940 行 Java host**（`build/android/app/src/main/java/com/wails/app/MainActivity.java`）补足框架未覆盖能力 | `main_android.gen.go` 11 行（v3 SDK 注册）；`build/android/MainActivity.java` 940 行（含 SAF 文件选择、相机、生物识别、前台服务、SAF 权限 UI、HTTP Range 流放） |
| **iOS** | ❌ **尚未起步**——全仓无 `//go:build ios` 文件、无 iOS 构建任务、无 iOS task | `Taskfile.yml` 经 `explore` 实查，无 iOS 任务 |
| **Go binding 层 Android 感知** | **极浅**——仅 `runtime.GOOS == "android"` 标志 + `pathmgr_android.go`（27 行）+ `fileaccess_android.go`（68 行；含 `ErrContentUriNotSupported` 安全兜底）。**未使用** Wails v3 mobile_features / SAF / mobile_*.go API | `internal/app/app.go:22`、`internal/app/pathmgr_android.go`、`internal/app/fileaccess_android.go` |
| **构建管线** | **完整可用**——`build/android/Taskfile.yml` 277 行：NDK 交叉编译 `libwails.so`、Gradle assemble + 签名、emulator deploy、logcat | `build/android/Taskfile.yml` |

### 5.2 "可复用 Wails v3 移动端内容"的真实程度

| 文档原断言 | 实际可复用程度 |
|------------|----------------|
| "Android 可复用完整 bindings / events / dialogs / 传感器 / 资产服务" | **部分**：bindings/events/资产服务已通过 Wails v3 SDK 复用；**dialogs/传感器在 MikuMikuAR 实际未调用**——`MainActivity.java` 是自处理 SAF 与相机 |
| "iOS 同 bindings/events 机制，仅换平台适配层" | **理论上成立，工程上尚未起步**：扩展需新增 iOS 构建链 + Wails iOS 桥接层 + iOS 权限适配 |
| "可完全复用核心 3D 渲染逻辑（Babylon.js / babylon-mmd）" | ✅ **成立**——渲染管线在 WebView 内运行，与原生层无关 |

### 5.3 "零框架换血"判否

原稿断言："**零框架换血，直接复用 Go Binding + Babylon.js 渲染管线扩展到 Android / iOS**"。源码实证推翻此说法：

- **Android 已经不是"零换血"**：项目自写了 940 行 Java host、自处理 SAF 权限、自实现相机/生物识别/前台服务桥接——这些**恰恰是 Wails v3 mobile_features 框架未覆盖或本项目选择绕过**的部分。"零换血"对 Android 是事后美化、对未来 iOS 是盲目乐观。
- **iOS 任何"复用"都从零开始**：iOS 没有一行代码、没有构建链、没有桥接。即便 bindings/events 抽象可借鉴，也得自己拉一套 iOS build pipeline + Objective-C 桥接 + iOS 权限/SAF 适配（且现 Wails iOS save dialog 还是 ❌ 报错状态）。
- **3D 管线确实可复用**——这是唯一站得住的复用面。

**修正后表述**：渲染管线可跨平台复用；**框架层 Android 已是重度定制集成**；**iOS 需从零独立立项**。"零换血"用在路径描述上误导性大，应弃用此措辞。

---

## 6. 关键源码链接

| 资源 | URL |
|------|-----|
| Android 核心实现 | https://github.com/wailsapp/wails/blob/3440ae554b8ae3c0fffb7f7a778ba778b6bbf1e5/v3/pkg/application/application_android.go |
| iOS 核心实现 | https://github.com/wailsapp/wails/blob/3440ae554b8ae3c0fffb7f7a778ba778b6bbf1e5/v3/pkg/application/application_ios.go |
| iOS Runtime | https://github.com/wailsapp/wails/blob/3440ae554b8ae3c0fffb7f7a778ba778b6bbf1e5/v3/pkg/application/ios_runtime_ios.go |
| Android 构建文档 | https://github.com/wailsapp/wails/blob/3440ae554b8ae3c0fffb7f7a778ba778b6bbf1e5/v3/ANDROID.md |
| iOS 构建文档 | https://github.com/wailsapp/wails/blob/3440ae554b8ae3c0fffb7f7a778ba778b6bbf1e5/v3/IOS.md |
| iOS 架构文档 | https://github.com/wailsapp/wails/blob/3440ae554b8ae3c0fffb7f7a778ba778b6bbf1e5/IOS_ARCHITECTURE.md |
| Android 示例 | https://github.com/wailsapp/wails/tree/3440ae554b8ae3c0fffb7f7a778ba778b6bbf1e5/v3/examples/android |
| iOS 示例 | https://github.com/wailsapp/wails/tree/3440ae554b8ae3c0fffb7f7a778ba778b6bbf1e5/v3/examples/ios |

---

## 7. 结论

### 7.1 Wails v3 移动端的真实定位

Wails v3 移动端**并非**原稿所称"生产级别的 first-class feature"，而是：

- ✅ **实现完整**——平台适配层文件齐全（Android 18 / iOS 8 个 .go 文件已核验）、build tags 已就位、官方文档完备
- ⚠️ **框架整体处于 Alpha**——v3.wails.io 首页与上游 README 在被引 commit 处明确标 "Alpha"；changelog 当前 `v3.0.0-alpha2.x`
- ⚠️ **移动端多项关键能力有硬缺陷**：
  - 文件保存对话框 **报错**（Android + iOS 均如此），需写应用沙箱
  - 多窗口 **仅第一窗显示**
  - 窗口几何 / 菜单 / 系统托盘 **intentional no-ops**
- ⚠️ **Wails 团队公开承认尚未 production-ready**——Discussion #5492："The core pipeline is functional, but to turn this into a production-ready framework, we need the community's help." 2026-01 仍有 Issue #4886 问"When Wails will officially support Android and iOS?"

可用证据矩阵：

| 项 | 状态 |
|----|------|
| Android 平台文件 18 个 / iOS 8 个（`v3/pkg/application/`，已核验） | ✅ |
| Android build tag `//go:build android && cgo && !server`（已核验） | ✅ |
| iOS build tag `//go:build ios && !server`（已核验） | ✅ |
| 文档 ANDROID.md / IOS.md / Taskfile.yaml / IOS_ARCHITECTURE.md（已核验存在） | ✅ |
| 111 / 123 个文件总数（未独立复现） | ⚠️ 待核验 |
| `v3/examples/android|ios|mobile/` 完整示例（librarian 报未找到，需复查） | ⚠️ 待核验 |
| 移动原生能力矩阵（基于源码分析，本项目未实测） | ⚠️ |
| "production-ready 一等公民"（与 Wails 官方 Alpha 表述矛盾） | ❌ 推翻 |

### 7.2 对 MikuMikuAR 的真实含义

- **Android**：本项目的 Android 支持**实际是"Wails v3 SDK 正规入口 + 自写 940 行 Java host + 自处理 SAF / 相机 / 前台服务"的重度集成产物**。它在工程上**已基本就绪并实验性可用**（见 status.md：Android 适配 ✅、SAF 文件导入 ✅），但**不是原稿所说的"零换血直接复用 Wails 框架"**——框架没覆盖的桥接工作（文件保存折中到沙箱、SAF 权限 UI、相机捕获与 HTTP Range 流放）都是项目自写的。
- **iOS**：尚未起步。**全仓零 iOS 代码 / 零 iOS 任务**。即便 Wails v3 iOS 在框架层"理论上可用"，扩展到 iOS 仍是独立立项，需要新增 iOS 构建链、Objective-C 桥接层、iOS 权限适配，并规避当前 Wails iOS 的 save dialog 报错缺陷。
- **可真正复用的面**：
  - ✅ Babylon.js / babylon-mmd 渲染管线（运行于 WebView 内，与平台无关）
  - ✅ Go binding 业务逻辑（`internal/app/*` 大部分平台无关）
  - ✅ Wails v3 跨平台 binding / events 抽象（已用于 Android）
  - ⚠️ Wails v3 mobile_features（本项目尚未调用，需评估逐项缺口后决定是否启用）

### 7.3 正确的后续行动

如果要继续移动路线，正确的路径是：

1. **Android**：把"实验性可用"打磨成稳定——梳理 `MainActivity.java` 中已经覆盖但与 Wails mobile_features 重叠的能力（如生物识别、网络/电池事件），评估是否迁移到框架标准化 API。
2. **iOS**：独立立项，做技术验证 spike——先跑通 Wails v3 iOS 最小示例（含 WKWebView + bindings + 一个 dialog），再评估与本项目 `app.go` binding 层能否对接。**不要假设"零换血"，先证明能跑**。
3. **文档债**：本调研文档保留作为"Wails v3 移动端的**源码地图**"，**不应作为决策依据**——定性章节（5、7）已按本审计修订，定量章节（1、4）待补核验后再升级。

---

### 附：本审计的依据

- 三路并行源码实证（2026-07-09）：
  - **librarian × 1**：GitHub API + raw.githubusercontent.com 验证上游 commit `3440ae5` 的源码事实（文件清单、行数、build tags、文档存在性）
  - **librarian × 1**：v3.wails.io 首页/changelog/Android/iOS 指南状态表、上游 README 版本表、Discussion #5492、Issue #4886 提取 Wails 团队对移动端成熟度的**官方表述原文**
  - **explore × 1**：本仓库 `main_android.gen.go` / `build/android/` / `build/android/MainActivity.java` (940 行) / `Taskfile.yml` / `internal/app/*` / iOS build tag 全仓搜索
- 对照原稿 220 行逐节核验，已修订结论与本项目关联两处硬伤；定量断言保留待核验标记。