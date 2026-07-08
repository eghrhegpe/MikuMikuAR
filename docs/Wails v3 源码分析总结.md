## Wails v3 源码分析总结

### 🎯 核心可用模块

| 模块 | 核心文件 | 功能 |
|------|----------|------|
| **Bindings** | `v3/pkg/application/bindings.go` | Go ↔ TS 双向 RPC，方法自动暴露 |
| **Events** | `v3/pkg/application/events.go` | 事件总线，Go/JS 双向通信 |
| **Window** | `v3/pkg/application/browser_window.go` | 窗口控制（全屏/最大化/置顶等） |
| **Dialog** | `v3/pkg/application/dialogs.go` | 文件选择/消息框/颜色选择 |
| **Menu** | `v3/pkg/application/menu.go` | 应用菜单/上下文菜单/系统托盘 |
| **Clipboard** | `v3/pkg/application/clipboard_manager.go` | 剪贴板读写 |
| **Screen** | `v3/pkg/application/screenmanager.go` | 多显示器支持 |

---

### ⚡ 对 MikuMikuAR 有用的功能

#### 1. **Bindings** — 前端调用 Go
```go
// Go 端：公开方法自动成为 binding
func (a *App) GetModelMeta(path string) (*ModelMeta, error) { ... }

// TS 端：直接调用
import { GetModelMeta } from '@bindings/mikumikuar/internal/app/app';
const meta = await GetModelMeta('/path/to/model.pmx');
```

#### 2. **Events** — Go → JS 通知
```go
// Go 端
app.Event.Emit("model-loaded", map[string]interface{}{
    "path": path, "name": name,
})

// TS 端
import { Events } from '@wailsio/runtime';
Events.On('model-loaded', (e) => console.log(e.data));
```

#### 3. **Window** — 窗口控制
```go
window.SetAlwaysOnTop(true)
window.SetSize(1920, 1080)
window.Center()
window.SetTitle("MikuMikuAR - Playing...")
```

#### 4. **Dialog** — 文件操作
```go
// 打开 PMX/VMD 文件
path, _ := runtime.OpenFile(ctx, runtime.OpenDialogOptions{
    Filters: []runtime.FileFilter{
        {Name: "MMD模型", Pattern: "*.pmx;*.pmd"},
    },
})
```

#### 5. **Menu** — 自定义菜单
```go
appMenu.AddText("打开模型", "Ctrl+O", func() error { ... })
appMenu.AddCheckbox("全屏模式", false, "F11", func(checked bool) error { ... })
```

---

### 📁 关键源码路径

```
github.com/wailsapp/wails/v3/
├── v3/pkg/application/
│   ├── application.go          # 核心 App 类
│   ├── bindings.go            # 绑定系统
│   ├── events.go               # 事件系统
│   ├── browser_window.go       # 窗口管理
│   ├── dialogs.go              # 对话框
│   ├── menu.go                 # 菜单
│   ├── clipboard_manager.go    # 剪贴板
│   └── mcp_inject.js           # 前端桥接代码 (31KB)
└── v3/pkg/runtime/
    └── runtime.go              # 运行时工具
```

---

### 🔧 MikuMikuAR 可直接复制的模式

1. **文件隔离** → `IsolateModelDir()` 已在用
2. **事件通知** → Go 加载完模型通知前端渲染
3. **窗口标题动态化** → 播放时显示当前模型名
4. **右键菜单** → 3D 场景上下文菜单
5. **快捷键** → 菜单 accelerator 已支持
6. **全屏/窗口化切换** → Window API 可实现 F11 全屏

需要深入了解某个模块的实现细节吗？
