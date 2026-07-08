基于我收集的信息，现在为你整理 Wails v3 的系统级 API 文档。由于代码库较大，我将重点提供核心接口定义和使用方式：

## 📋 Wails v3 系统级 API 完整指南

### 🪟 **1. Window Management API** (窗口管理)

#### **核心接口定义**
**文件位置**: `/v3/pkg/application/window.go`

```go
type Window interface {
    // 窗口状态控制
    Show() error
    Hide() error
    Maximise() error
    Unmaximise() error
    Minimise() error
    Unminimise() error
    Fullscreen() error
    Unfullscreen() error

    // 窗口属性设置
    SetTitle(title string) error
    SetSize(width, height int) error
    GetSize() (int, int, error)
    SetPosition(x, y int) error
    GetPosition() (int, int, error)
    SetMinSize(width, height int) error
    SetMaxSize(width, height int) error
    SetAlwaysOnTop(b bool) error

    // 窗口信息查询
    IsFullscreen() (bool, error)
    IsMaximised() (bool, error)
    IsMinimised() (bool, error)
    IsNormal() (bool, error)

    // 窗口操作
    Center() error
    ExecJS(js string) error
    Reload() error
    ReloadApp() error

    // 多窗口支持
    NewWindow(options WindowOptions) (Window, error)
}
```

#### **WindowOptions 配置结构**
**文件位置**: `/v3/pkg/application/window_options.go`

```go
type WindowOptions struct {
    Title            string
    Width            int
    Height           int
    X                int
    Y                int
    MinWidth         int
    MinHeight        int
    MaxWidth         int
    MaxHeight        int
    Resizable        bool
    AlwaysOnTop      bool
    Fullscreen       bool
    Maximised        bool
    Minimised        bool
    BackgroundColour string
    Debug            bool
    LogLevel         string
    StartHidden      bool
    Bind []struct {
        // 事件绑定
        Event string
        Handler func() error
    }
}
```

#### **使用场景示例**

**场景1: 创建自定义窗口**
```go
app := wails.NewApplication(options.App{
    Title:  "我的应用",
    Width:  1200,
    Height: 800,
    Bind: []struct{
        Event string
        Handler func() error
    }{
        {Event: "window.close", Handler: onWindowClose},
    },
})

// 创建主窗口
mainWindow := app.NewWindow(options.Window{
    Title: "主窗口",
    Width: 1024,
    Height: 768,
    MinWidth: 800,
    MinHeight: 600,
})

// 窗口控制
mainWindow.SetTitle("新标题")
mainWindow.Center()
mainWindow.SetAlwaysOnTop(true)
```

**场景2: 多窗口管理**
```go
// 创建第二个窗口
settingsWindow, err := mainWindow.NewWindow(options.Window{
    Title: "设置",
    Width: 600,
    Height: 400,
    X: 200,
    Y: 200,
})

settingsWindow.On(events.Window.Close, func() {
    log.Println("设置窗口关闭")
})

// 切换窗口
mainWindow.Hide()
settingsWindow.Show()
```

**场景3: 窗口状态监控**
```go
// 监控窗口状态变化
go func() {
    for {
        isFullscreen, _ := mainWindow.IsFullscreen()
        isMaximised, _ := mainWindow.IsMaximised()
        log.Printf("窗口状态 - 全屏: %v, 最大化: %v", isFullscreen, isMaximised)
        time.Sleep(1 * time.Second)
    }
}()
```

---

### 💬 **2. Dialog API** (对话框系统)

#### **核心对话框类型**

**文件位置**: `/v3/pkg/application/dialogs.go`

```go
type DialogType int

const (
    InfoDialog DialogType = iota
    WarningDialog
    ErrorDialog
    QuestionDialog
)
```

#### **文件对话框接口**

```go
// 打开文件对话框
OpenFile(options OpenDialogOptions) (string, error)

// 保存文件对话框
SaveFile(options SaveDialogOptions) (string, error)

// 选择目录对话框
OpenDirectory(options OpenDialogOptions) (string, error)
```

#### **消息对话框接口**

```go
// 消息对话框
MessageDialog(options MessageDialogOptions) (string, error)
```

#### **对话框选项结构**

**文件位置**: `/v3/pkg/application/dialog_options.go`

```go
type OpenDialogOptions struct {
    DefaultDirectory string
    DefaultFilename  string
    Title           string
    Filters         []FileFilter
    ShowHiddenFiles  bool
    CanCreateDirectories bool
    ResolvesAliases  bool
    TreatPackagesAsDirectories bool
}

type SaveDialogOptions struct {
    DefaultDirectory string
    DefaultFilename  string
    Title           string
    Filters         []FileFilter
    ShowHiddenFiles  bool
    CanCreateDirectories bool
    TreatPackagesAsDirectories bool
}

type MessageDialogOptions struct {
    Type        DialogType
    Title       string
    Message     string
    Buttons     []MessageDialogButton
    DefaultButton string
    CancelButton  string
}

type MessageDialogButton struct {
    Label      string
    IsDefault  bool
    IsCancel   bool
}
```

#### **使用场景示例**

**场景1: 文件选择**
```go
// 打开文件
filePath, err := runtime.OpenFile(runtime.OpenDialogOptions{
    DefaultDirectory: "/Users/Downloads",
    Title: "选择模型文件",
    Filters: []runtime.FileFilter{
        {Name: "MMD模型", Pattern: "*.pmx;*.pmd"},
        {Name: "所有文件", Pattern: "*"},
    },
})

if err != nil {
    log.Println("文件选择取消:", err)
    return
}

// 保存文件
savePath, err := runtime.SaveFile(runtime.SaveDialogOptions{
    DefaultDirectory: "/Users/Documents",
    DefaultFilename: "导出模型.pmx",
    Title: "保存模型文件",
    Filters: []runtime.FileFilter{
        {Name: "MMD模型", Pattern: "*.pmx"},
    },
})
```

**场景2: 消息对话框**
```go
// 信息对话框
result, err := runtime.MessageDialog(runtime.MessageDialogOptions{
    Type:    runtime.InfoDialog,
    Title:   "操作成功",
    Message: "模型导出完成！",
    Buttons: []runtime.MessageDialogButton{
        {Label: "确定", IsDefault: true},
    },
})

// 警告对话框
result, err := runtime.MessageDialog(runtime.MessageDialogOptions{
    Type:    runtime.WarningDialog,
    Title:   "警告",
    Message: "确定要删除此模型吗？",
    Buttons: []runtime.MessageDialogButton{
        {Label: "取消", IsCancel: true},
        {Label: "删除", IsDefault: true},
    },
})

// 错误对话框
result, err := runtime.MessageDialog(runtime.MessageDialogOptions{
    Type:    runtime.ErrorDialog,
    Title:   "错误",
    Message: "导入文件格式不正确！",
    Buttons: []runtime.MessageDialogButton{
        {Label: "确定", IsDefault: true},
    },
})
```

**场景3: 目录选择**
```go
// 选择工作目录
dirPath, err := runtime.OpenDirectory(runtime.OpenDialogOptions{
    DefaultDirectory: os.Getenv("HOME"),
    Title: "选择工作目录",
    CanCreateDirectories: true,
})

if err != nil {
    log.Println("目录选择取消:", err)
    return
}
```

---

### 🍽️ **3. Menu API** (菜单系统)

#### **核心菜单接口**

**文件位置**: `/v3/pkg/application/menu.go`

```go
type Menu interface {
    // 菜单项添加
    AddText(label, accelerator string, click func() error) *MenuItem
    AddSeparator() *MenuItem
    AddCheckbox(label string, checked bool, accelerator string, click func(checked bool) error) *MenuItem
    AddRadio(label string, selected bool, accelerator string, click func() error) *MenuItem
    AddSubMenu(label string, menu *Menu) *MenuItem

    // 菜单管理
    SetApplicationMenu() error
    Update() error
}

type MenuItem struct {
    Label       string
    Type        MenuItemType
    Checked     bool
    Disabled    bool
    Hidden      bool
    Accelerator string
    Role        MenuItemRole
    SubMenu     *Menu
    Click       func() error
}
```

#### **菜单项类型**

```go
type MenuItemType int

const (
    TextMenuItem MenuItemType = iota
    SeparatorMenuItem
    CheckboxMenuItem
    RadioMenuItem
    SubMenuItem
)
```

#### **菜单项角色** (平台特定)

```go
type MenuItemRole int

const (
    // 标准菜单项角色
    AboutRole MenuItemRole = iota
    PreferencesRole
    HideRole
    HideOthersRole
    ShowAllRole
    QuitRole
    CopyRole
    CutRole
    PasteRole
    SelectAllRole
    UndoRole
    RedoRole
    MinimizeRole
    MaximizeRole
    FullscreenRole
    CloseRole
    HelpRole
)
```

#### **菜单工具函数**

**文件位置**: `/v3/pkg/application/menu_helpers.go`

```go
// 菜单项创建工具
func Text(label string, accelerator string, click func() error) *MenuItem
func Separator() *MenuItem
func Checkbox(label string, checked bool, accelerator string, click func(checked bool) error) *MenuItem
func Radio(label string, selected bool, accelerator string, click func() error) *MenuItem
func SubMenu(label string, menu *Menu) *MenuItem

// 标准菜单构建器
func NewFileMenu() *Menu
func NewEditMenu() *Menu
func NewViewMenu() *Menu
func NewWindowMenu() *Menu
func NewHelpMenu() *Menu
```

#### **使用场景示例**

**场景1: 创建应用菜单**
```go
// 创建主菜单
appMenu := wails.NewMenu()

// 文件菜单
fileMenu := wails.NewMenu()
fileMenu.AddText("新建", "Ctrl+N", func() error {
    log.Println("新建文件")
    return nil
})
fileMenu.AddText("打开", "Ctrl+O", func() error {
    // 打开文件逻辑
    return nil
})
fileMenu.AddSeparator()
fileMenu.AddText("退出", "Ctrl+Q", func() error {
    app.Quit()
    return nil
})

// 编辑菜单
editMenu := wails.NewMenu()
editMenu.AddText("撤销", "Ctrl+Z", func() error {
    // 撤销逻辑
    return nil
})
editMenu.AddText("重做", "Ctrl+Y", func() error {
    // 重做逻辑
    return nil
})
editMenu.AddSeparator()
editMenu.AddText("复制", "Ctrl+C", func() error {
    // 复制逻辑
    return nil
})

// 查看菜单
viewMenu := wails.NewMenu()
viewMenu.AddCheckbox("显示工具栏", true, "", func(checked bool) error {
    // 切换工具栏显示
    return nil
})
viewMenu.AddCheckbox("显示状态栏", true, "", func(checked bool) error {
    // 切换状态栏显示
    return nil
})

// 帮助菜单
helpMenu := wails.NewMenu()
helpMenu.AddText("关于", "", func() error {
    runtime.MessageDialog(runtime.MessageDialogOptions{
        Type:    runtime.InfoDialog,
        Title:   "关于",
        Message: "MikuMikuAR - 基于Wails v3的3D模型查看器",
    })
    return nil
})

// 添加菜单到应用
appMenu.AddSubMenu("文件", fileMenu)
appMenu.AddSubMenu("编辑", editMenu)
appMenu.AddSubMenu("查看", viewMenu)
appMenu.AddSubMenu("帮助", helpMenu)

app.SetApplicationMenu(appMenu)
```

**场景2: 上下文菜单**
```go
// 创建3D场景上下文菜单
sceneMenu := wails.NewMenu()

sceneMenu.AddText("聚焦模型", "", func() error {
    // 聚焦逻辑
    return nil
})
sceneMenu.AddText("隐藏模型", "", func() error {
    // 隐藏逻辑
    return nil
})
sceneMenu.AddSeparator()
sceneMenu.AddText("导出截图", "", func() error {
    // 导出截图逻辑
    return nil
})

// 绑定到3D场景
mainWindow.BindContextMenu(sceneMenu)
```

**场景3: 系统托盘菜单**
```go
// 创建系统托盘菜单
trayMenu := wails.NewMenu()

trayMenu.AddText("显示主窗口", "", func() error {
    mainWindow.Show()
    return nil
})
trayMenu.AddSeparator()
trayMenu.AddText("设置", "", func() error {
    // 打开设置窗口
    return nil
})
trayMenu.AddText("关于", "", func() error {
    runtime.MessageDialog(runtime.MessageDialogOptions{
        Type:    runtime.InfoDialog,
        Title:   "关于",
        Message: "MikuMikuAR v1.0",
    })
    return nil
})
trayMenu.AddSeparator()
trayMenu.AddText("退出", "", func() error {
    app.Quit()
    return nil
})

// 设置系统托盘菜单
app.SetSystemTrayMenu(trayMenu)
```

---

### 🎯 **使用场景总结**

#### **1. 窗口控制场景**
- **主窗口管理**: 创建、显示、隐藏、最大化/还原、最小化/还原
- **多窗口架构**: 独立窗口、对话框窗口、工具窗口
- **窗口状态监控**: 全屏状态、最大化状态、位置和大小变化
- **窗口个性化**: 自定义标题、背景色、窗口级别

#### **2. 文件操作场景**
- **模型文件导入**: 支持PMX/PMD格式选择
- **场景文件保存**: 自动添加扩展名、文件类型过滤
- **工作目录选择**: 确保目录存在、支持创建新目录
- **批量文件选择**: 多文件选择、目录选择

#### **3. 系统交互场景**
- **应用菜单**: 标准化菜单结构、平台特定角色
- **上下文菜单**: 3D场景右键菜单、对象特定操作
- **系统托盘**: 最小化到托盘、快速访问功能
- **快捷键支持**: 菜单项加速器、全局快捷键

#### **4. 用户反馈场景**
- **信息提示**: 操作成功、状态更新
- **警告确认**: 删除确认、危险操作提醒
- **错误通知**: 文件格式错误、网络错误
- **问题询问**: 确认对话框、多选项选择

---

### 📁 **文件路径索引**

| API类型 | 核心文件 | 关键接口 |
|--------|----------|----------|
| **Window** | `/v3/pkg/application/window.go` | `Window` interface |
| **WindowOptions** | `/v3/pkg/application/window_options.go` | `WindowOptions` struct |
| **Dialog** | `/v3/pkg/application/dialogs.go` | `OpenFile`, `SaveFile`, `MessageDialog` |
| **DialogOptions** | `/v3/pkg/application/dialog_options.go` | `OpenDialogOptions`, `SaveDialogOptions` |
| **Menu** | `/v3/pkg/application/menu.go` | `Menu` interface, `MenuItem` struct |
| **MenuHelpers** | `/v3/pkg/application/menu_helpers.go` | `Text`, `Separator`, `Checkbox`, `Radio` |

---

### 🔧 **最佳实践建议**

#### **1. 窗口管理最佳实践**
```go
// ✅ 推荐: 使用WindowOptions预配置
mainWindow := app.NewWindow(options.Window{
    Title: "主窗口",
    Width: 1200,
    Height: 800,
    MinWidth: 800,
    MinHeight: 600,
    Resizable: true,
    BackgroundColour: "#222222",
})

// ✅ 推荐: 监控窗口状态变化
go func() {
    for {
        if isFullscreen, _ := window.IsFullscreen(); isFullscreen {
            // 全屏模式下禁用某些功能
            disableUIElements()
        }
        time.Sleep(500 * time.Millisecond)
    }
}()
```

#### **2. 对话框使用最佳实践**
```go
// ✅ 推荐: 统一文件过滤器
fileFilters := []runtime.FileFilter{
    {Name: "MMD模型文件", Pattern: "*.pmx;*.pmd"},
    {Name: "FBX模型文件", Pattern: "*.fbx;*.dae"},
    {Name: "所有文件", Pattern: "*"},
}

// ✅ 推荐: 错误处理
filePath, err := runtime.OpenFile(runtime.OpenDialogOptions{
    DefaultDirectory: getLastUsedDirectory(),
    Filters: fileFilters,
})

if err != nil {
    if err.Error() != "user cancelled" {
        runtime.MessageDialog(runtime.MessageDialogOptions{
            Type: runtime.ErrorDialog,
            Title: "错误",
            Message: "文件选择失败: " + err.Error(),
        })
    }
    return
}
```

#### **3. 菜单系统最佳实践**
```go
// ✅ 推荐: 使用菜单工具函数
fileMenu := wails.NewMenu()
fileMenu.AddText("新建", "Ctrl+N", newFileHandler)
fileMenu.AddText("打开", "Ctrl+O", openFileHandler)
fileMenu.AddSeparator()
fileMenu.AddText("退出", "Ctrl+Q", func() error {
    return app.Quit()
})

// ✅ 推荐: 处理平台特定角色
helpMenu := wails.NewMenu()
helpMenu.AddText("关于", "", showAboutHandler) // macOS会自动显示在"关于本应用"

// ✅ 推荐: 更新菜单状态
func updateMenuStates() {
    editMenu := app.MenuByID("edit")
    undoItem := editMenu.ItemByID("undo")
    undoItem.SetDisabled(!canUndo)
}
```

---

### 🚀 **快速开始代码模板**

```go
package main

import (
    "github.com/wailsapp/wails/v3/pkg/application"
    "github.com/wailsapp/wails/v3/pkg/runtime"
)

func main() {
    // 创建应用
    app := application.New(application.Options{
        Title:  "MikuMikuAR",
        Width:  1200,
        Height: 800,
        Bind: []struct{
            Event string
            Handler func() error
        }{
            {Event: "app.quit", Handler: onQuit},
        },
    })

    // 创建主窗口
    mainWindow := app.NewWindow(application.WebviewWindowOptions{
        Title: "MikuMikuAR - 3D模型查看器",
        Width: 1200,
        Height: 800,
        MinWidth: 800,
        MinHeight: 600,
        BackgroundColour: "#1a1a1a",
    })

    // 设置应用菜单
    setupApplicationMenu(app)

    // 设置系统托盘
    setupSystemTray(app)

    // 运行应用
    app.Run()
}

func setupApplicationMenu(app *application.App) {
    // 创建菜单结构...
}

func setupSystemTray(app *application.App) {
    // 创建托盘菜单...
}

func onQuit() error {
    // 清理资源...
    return nil
}
```

---

**📝 总结**: Wails v3 提供了完整的系统级 API，包括窗口管理、对话框系统和菜单系统。这些 API 设计简洁、类型安全，并且支持跨平台（Windows、macOS、Linux）。你可以基于这些 API 实现复杂的桌面应用功能，包括多窗口架构、文件操作、系统交互等。
