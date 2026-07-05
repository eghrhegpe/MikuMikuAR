# ADR-011: Wails 版本策略 — 继续使用 v2，Android 路径待定

**日期**：2026-07-03（更新）
**初版**：2026-07-16
> **状态**: 部分完成 — 路线 B（v2 + 抽象层）在用，v3 迁移待其稳定

---

## 背景

当前项目使用 Wails v2.12.0（稳定版）作为桌面壳。有两个需求触发了对 Wails v3 的评估：

1. **下载功能** — 先前尝试用 WebView2 内嵌模之屋实现"下载即导入"，但因 Wails v2 不暴露 `ICoreWebView2.DownloadStarting` 事件受阻（详见 ADR-003）。需确认 v3 是否解除此限制。
2. **Android 端适配** — 项目路线图有 Phase 10 Android 适配，v2 不支持移动端，v3 宣称支持 Android/iOS。

## 调查结果

### Wails v3 状态（2026-07-03 实测）

| 维度 | 情况 |
|------|------|
| 最新版本 | **v3.0.0-alpha2.111**（2026-06-28） |
| 发布节奏 | 几乎每天一个 alpha release，开发非常活跃 |
| 稳定度 | **Alpha** — README 标 Alpha，官方称"API 基本稳定，已有生产应用在用" |
| 稳定版 ETA | **无** — 维护者未给出 beta 时间表 |
| 迁移成本 | **高** — API 全量重写：`wails.Run()` → `application.New()`，模块路径 `v2` → `v3`，CLI `wails` → `wails3` |
| Go 版本要求 | **Go 1.25+**（当前项目 1.23） |

### 下载功能 — v3 不解决问题

- v3 底层仍使用 `github.com/wailsapp/wails/webview2`（fork 自 `go-webview2`），与 v2 相同
- v3 的 `Window` 接口仍**不暴露** `ICoreWebView2` COM 对象
- GitHub issue [#4685](https://github.com/wailsapp/wails/issues/4685) 请求的是 `WebResourceRequested`（网络请求拦截），非 `DownloadStarting`，且仍在 backlog
- ADR-003 已选的方案 B（fsnotify 目录监听 + 自动导入）仍然是最佳路径

### Android 适配 — v3 可以解决，但有已知问题

**好消息：Android 路径已打通**

v3 通过 JNI bridge + Android WebViewAssetLoader 支持 Android，同一份 main.go + 前端代码零修改直接跑 Android：

```bash
wails3 task android:run      # Android Emulator
wails3 task android:package  # 打 APK
```

底层原理：Go 编译为 `libwails.so`（通过 NDK），前端用 Android WebView + `WebViewAssetLoader` 渲染。

**坏消息：已知 P1/P2 issue 未解**

| Issue | 状态 | 严重度 | 描述 |
|-------|------|--------|------|
| [#5020](https://github.com/wailsapp/wails/issues/5020) | Open / investigating | **P1** | Android example crashing on Greet（Hello World 都崩） |
| [#5489](https://github.com/wailsapp/wails/issues/5489) | Open | P2 | Android APK failed to run |
| [#5606](https://github.com/wailsapp/wails/issues/5606) | Open | 低 | gradlew 脚本权限问题 |

P1 级别的基础示例崩溃还在调查中，说明 Android 路径**还没完全稳**。

**移动端功能限制**

| 功能 | iOS | Android |
|------|-----|---------|
| Service bindings (JS→Go) | ✅ | ✅ |
| Events（双向） | ✅ | ✅ |
| 文件对话框 | ✅ | ✅（SAF） |
| 多窗口 | ❌ | ❌ |
| 菜单/托盘 | no-op | no-op |
| 保存对话框 | ❌ 沙箱写入 | ❌ 沙箱写入 |
| Haptics | ✅ | ✅ |
| 剪贴板 | ✅ | ✅ |

### 迁移成本详细评估

官方声称"典型应用 1-4 小时"，但那是针对简单应用。MikuMikuAR 的实际迁移工作量：

| 项目 | 工作量 | 说明 |
|------|--------|------|
| Go 版本升级 1.23→1.25 | 0.5 天 | `go.mod` + 测试验证 |
| `main.go` 重写 | 1 天 | `wails.Run()` → `application.New()` + Window 创建 |
| `app.go` binding 迁移 | 2-3 天 | 50+ 个 binding，`ctx` → `app`，Service 模式重构 |
| 前端 import 重写 | 1 天 | `wailsjs/go/main/App` → `bindings/myservice/` |
| `wails.json` 格式变更 | 0.5 天 | 新格式适配 |
| `runtime.*` 调用替换 | 1 天 | `runtime.EventsEmit` → `app.Event.Emit` 等 |
| 平台条件编译保护 | 0.5 天 | `//go:build linux` → `//go:build linux && !android` |
| 测试 + 修复 | 2-3 天 | 回归测试 + alpha 坑 |
| **合计** | **7-9 天** | — |

### 迁移关键变化对照

**Go 端：**

```go
// v2
err := wails.Run(&options.App{
    Title: "My App",
    Bind: []interface{}{&App{}},
})

// v3
app := application.New(application.Options{
    Name: "My App",
    Services: []application.Service{
        application.NewService(&GreetService{}),
    },
})
window := app.Window.NewWithOptions(...)
app.Run()
```

**前端：**

```javascript
// v2
import { Greet } from '../wailsjs/go/main/App'
import { EventsOn } from '../wailsjs/runtime/runtime'

// v3
import { Greet } from './bindings/changeme/greetservice'
import { Events } from '@wailsio/runtime'
```

## 决定

**继续使用 Wails v2，Android 路径分两阶段推进。**

### 1. 下载功能 — 坚持 ADR-003 方案 B

不因下载需求升级 v3（v3 无帮助）。继续推进 fsnotify 下载目录监听 + 自动导入链路：
- 将 `MMDDownloader/` 骨架合并回主项目
- 实现 `StartWatchDir` / `StopWatchDir` / `SetDownloadWatchDir` Go bindings
- 前端 toast 通知 + 一键导入按钮

### 2. Android 适配 — 两阶段策略

**阶段 A（现在）：前端抽象层**

在 v2 上先做一步无论走哪条路都有价值的工作——将 Wails binding 调用抽象为纯 TS 接口层：

```
当前：menus/*.ts → 直接 import { ScanModelDir } from '../../wailsjs/go/main/App'
目标：menus/*.ts → import { libraryService } from '../core/service-layer'
                       libraryService.scanModelDir()
```

这步收益：
- 降低未来迁 v3 时前端 import 重写的工作量（从 1 天降到半天）
- 为 Capacitor 独立方案铺路（换壳只需改 service-layer 实现）
- 不影响当前桌面端功能

**阶段 B（待定）：选择 Android 路径**

根据 v3 Android issues 解决进度选择：

| 条件 | 路径 |
|------|------|
| #5020 关闭 + v3 进 beta | 迁 v3，桌面/移动统一代码 |
| v3 长期不稳 | Capacitor 独立 Android 壳 |
| 需要尽快出 Android | Capacitor 先行，v3 迁移后合并 |

## 备选方案对比（更新）

| 方案 | 下载问题 | Android | 迁移成本 | 风险 | 推荐 |
|------|---------|---------|---------|------|------|
| A. 立即迁 v3 | ❌ 不解决 | ✅ 可解决 | 7-9 天 | Alpha 坑多，P1 issue 未解 | ⚠️ 激进 |
| B. 继续 v2 + 抽象层 | ✅ 已选路径 | ⬜ 铺路中 | 2-3 天（抽象层） | 零 | ✅ **当前** |
| C. Capacitor 独立 Android | ✅ | ✅ 零耦合 | 5-8 天 | 维护两套壳 | ⬜ 候补 |
| D. 等 v3 稳定再动 | ✅ | ✅ | 0（当前） | 不确定等多久 | ⬜ 被动 |

## 影响

**正面**
- 保持稳定构建环境，不引入 alpha 风险
- 下载功能按 ADR-003 既定方向推进，不因框架限制绕路
- 桌面端功能可继续打磨，不受迁移干扰
- 前端抽象层为未来任何迁移路径铺路

**负面或风险**
- Android 端需等 v3 稳定或选择 Capacitor 方案
- 未来从 v2 迁移 v3 需要一次性重写整个后端 binding 层（约 50+ 个函数）
- 前端抽象层引入一层间接调用，有微量性能开销（可忽略）

## 相关文档

- [ADR-003](adr-003-download-strategy.md) — 下载策略决策（完整方案 A-E 枚举，确认方案 C + E）
- [ADR-008](adr-008-download-watch-spec.md) — 下载目录监听规范
- [Wails v3 Docs](https://v3.wails.io) — v3 官方文档
- [Wails v3 Mobile Guide](https://v3.wails.io/guides/mobile) — 移动端指南
- [Wails v2→v3 Migration](https://v3.wails.io/migration/v2-to-v3) — 迁移指南
- [Wails #5020: Android crashing](https://github.com/wailsapp/wails/issues/5020) — Android P1 issue
- [Wails #4685: Network Request Interception](https://github.com/wailsapp/wails/issues/4685) — 下载相关
