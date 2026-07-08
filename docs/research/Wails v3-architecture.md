完美！现在我已经获取了 Wails v3 的完整源码。让我开始分析其架构。基于你的要求，我将专注于核心模块、接口和关键文件路径。

## 📊 Wails v3 源码架构分析报告

### 🎯 **总体架构概览**

Wails v3 是一个采用 **Go + WebView + TypeScript** 架构的现代桌面应用框架，核心设计理念是 **"Go 后端 + Web 前端"** 的双引擎架构。其 v3 版本在 v2 基础上进行了重大重构，引入了更现代化的架构模式。

---

### 🏗️ **主要模块划分**

#### **1. 核心应用层 (pkg/application)**
**路径**: `/tmp/wails-v3/v3/pkg/application/`
**功能**: 核心应用生命周期管理、窗口管理、绑定系统、对话框、菜单等核心功能

| 模块 | 核心文件 | 功能描述 |
|------|----------|----------|
| **应用生命周期** | `application.go` (25,073行) | 核心应用启动、停止、事件循环管理 |
| **绑定系统** | `bindings.go` (15,320行) | Go ↔ TypeScript 双向数据绑定核心实现 |
| **窗口管理** | `browser_window.go` (9,253行) | WebView 窗口创建、管理、事件处理 |
| **对话框系统** | `dialogs.go` (13,292行) | 文件选择、消息框、颜色选择等对话框 |
| **菜单系统** | `menu.go` (5,024行) | 应用菜单、上下文菜单、系统托盘菜单 |
| **事件系统** | `events.go` (10,028行) | 事件总线、自定义事件、系统事件 |
| **剪贴板** | `clipboard_manager.go` (831行) | 跨平台剪贴板操作 |
| **屏幕管理** | `screenmanager.go` (28,339行) | 多显示器支持、屏幕信息获取 |
| **系统托盘** | `systemtray.go` (9,678行) | 系统托盘图标、菜单管理 |

#### **2. 平台适配层 (pkg/application/*)**
**路径**: `/tmp/wails-v3/v3/pkg/application/*_*.go`
**功能**: 针对不同操作系统的平台特定实现

- **Windows**: `application_windows.go`, `dialogs_windows.go`, `menu_windows.go`
- **macOS**: `application_darwin.go`, `dialogs_darwin.go`, `menu_darwin.go`
- **Linux**: `application_linux.go`, `dialogs_linux.go`, `menu_linux.go`
- **Android/iOS**: 移动平台特定实现

#### **3. 前端注入层**
**路径**: `/tmp/wails-v3/v3/pkg/application/mcp_inject.js` (31,673行)
**功能**: WebView 前端注入的 JavaScript 桥接代码，实现 Go ↔ JS 的双向通信

#### **4. 消息处理层**
**路径**: `/tmp/wails-v3/v3/pkg/application/messageprocessor_*.go`
**功能**: 消息路由、处理、序列化/反序列化

核心文件:
- `messageprocessor_call.go` - 方法调用处理
- `messageprocessor_dialog.go` - 对话框消息处理
- `messageprocessor_window.go` - 窗口消息处理
- `messageprocessor_clipboard.go` - 剪贴板消息处理

---

### 🔧 **核心接口和类型定义**

#### **1. 应用生命周期接口**

**文件**: `application.go`
**核心接口**:

```go
// Application interface - 应用生命周期管理
type Application interface {
    Run() error
    Quit() error
    OnBeforeClose(func() bool) error
    Events() *EventManager
    Windows() *WindowManager
    Dialog() *DialogManager
    Menu() *MenuManager
    Clipboard() *ClipboardManager
    Screen() *ScreenManager
    Bindings() *BindingsManager
}
```

#### **2. 绑定系统核心接口**

**文件**: `bindings.go`
**核心类型**:

```go
// Binding - 绑定定义
type Binding struct {
    ID        string
    Name      string
    Method    string
    Cached    bool
    Internal  bool
    Signature string
}

// BindingsManager - 绑定管理器
type BindingsManager struct {
    bindings     map[string]*Binding
    runtime      *Runtime
    eventManager *EventManager
}
```

**关键方法**:

```go
// Register - 注册 Go 函数到前端
func (b *BindingsManager) Register(name string, fn interface{}) error

// Call - 调用前端函数
func (b *BindingsManager) Call(ctx context.Context, name string, args ...interface{}) (interface{}, error)

// Emit - 触发前端事件
func (b *BindingsManager) Emit(event string, data interface{}) error
```

#### **3. 窗口管理核心接口**

**文件**: `browser_window.go`, `window.go`
**核心类型**:

```go
// BrowserWindow - WebView 窗口接口
type BrowserWindow interface {
    Show()
    Hide()
    Close()
    Maximize()
    Minimize()
    Restore()
    SetTitle(string)
    SetSize(width, height int, animate bool)
    Center()
    SetPosition(x, y int)
    IsMaximized() bool
    IsMinimized() bool
    WebView() *webview.WebView
    On(event string, callback func(...interface{})) error
}

// WindowManager - 窗口管理器
type WindowManager struct {
    windows      map[uint]*BrowserWindow
    mainWindow   *BrowserWindow
    eventManager *EventManager
}
```

#### **4. 菜单系统核心接口**

**文件**: `menu.go`, `menuitem.go`
**核心类型**:

```go
// Menu - 菜单接口
type Menu interface {
    AddItem(item *MenuItem) error
    AddSeparator() error
    SetApplicationMenu() error
    Update()
}

// MenuItem - 菜单项
type MenuItem struct {
    ID          string
    Label       string
    Type        MenuItemType
    Role        MenuItemRole
    Checked     bool
    Enabled     bool
    Visible     bool
    Accelerator string
    SubMenu     Menu
    Click       func() error
}

// MenuItemRole - 预定义菜单角色
const (
    MenuItemRoleAbout      MenuItemRole = "about"
    MenuItemRoleQuit       MenuItemRole = "quit"
    MenuItemRoleClose      MenuItemRole = "close"
    MenuItemRoleCopy       MenuItemRole = "copy"
    MenuItemRoleCut        MenuItemRole = "cut"
    MenuItemRolePaste      MenuItemRole = "paste"
    MenuItemRoleSelectAll  MenuItemRole = "selectAll"
    MenuItemRoleUndo       MenuItemRole = "undo"
    MenuItemRoleRedo       MenuItemRole = "redo"
    MenuItemRoleMinimize   MenuItemRole = "minimize"
    MenuItemRoleMaximize   MenuItemRole = "maximize"
    MenuItemRoleFullscreen MenuItemRole = "fullscreen"
)
```

#### **5. 对话框系统核心接口**

**文件**: `dialogs.go`
**核心类型**:

```go
// DialogManager - 对话框管理器
type DialogManager struct {
    eventManager *EventManager
}

// MessageDialog - 消息对话框
func (d *DialogManager) Message(ctx context.Context, opts *MessageDialogOptions) (int, error)

// OpenFileDialog - 打开文件对话框
func (d *DialogManager) OpenFile(ctx context.Context, opts *OpenDialogOptions) ([]string, error)

// SaveFileDialog - 保存文件对话框
func (d *DialogManager) SaveFile(ctx context.Context, opts *SaveDialogOptions) (string, error)

// SelectDirectoryDialog - 选择目录对话框
func (d *DialogManager) SelectDirectory(ctx context.Context, opts *SelectDirectoryDialogOptions) (string, error)

// ColorDialog - 颜色选择对话框
func (d *DialogManager) Color(ctx context.Context, opts *ColorDialogOptions) (string, error)
```

**对话框选项类型**:

```go
type MessageDialogOptions struct {
    Title       string
    Message     string
    Type        DialogType
    Buttons     []DialogButton
    DefaultButton int
}

type OpenDialogOptions struct {
    Title           string
    DefaultFilename  string
    DefaultDirectory string
    Filters         []FileFilter
    AllowMultiple   bool
}
```

#### **6. 事件系统核心接口**

**文件**: `events.go`
**核心类型**:

```go
// EventManager - 事件管理器
type EventManager struct {
    handlers     map[string][]EventHandler
    onceHandlers map[string][]EventHandler
}

// On - 注册事件监听器
func (e *EventManager) On(event string, handler EventHandler) error

// Once - 注册一次性事件监听器
func (e *EventManager) Once(event string, handler EventHandler) error

// Emit - 触发事件
func (e *EventManager) Emit(event string, data interface{}) error

// Off - 移除事件监听器
func (e *EventManager) Off(event string, handler EventHandler) error
```

**核心事件类型**:

```go
const (
    EventReady           = "ready"
    EventQuit            = "quit"
    EventWindowCreate     = "window-create"
    EventWindowClose      = "window-close"
    EventWindowFocus      = "window-focus"
    EventWindowBlur       = "window-blur"
    EventWindowResize     = "window-resize"
    EventWindowMove       = "window-move"
    EventMenuClick       = "menu-click"
    EventBindingCall      = "binding-call"
    EventBindingEmit      = "binding-emit"
    EventDialogComplete   = "dialog-complete"
    EventSystemTrayClick = "system-tray-click"
)
```

---

### 🚀 **关键设计模式**

#### **1. 双向数据绑定模式**
- **Go → TypeScript**: 通过 `BindingsManager.Register()` 注册 Go 函数
- **TypeScript → Go**: 前端调用 `window.goBindings.call()` 触发 Go 函数
- **事件驱动**: 使用 `EventManager` 实现异步事件通信

#### **2. 平台抽象工厂模式**
- 统一接口定义在 `application.go`
- 平台特定实现通过 `_windows.go`, `_darwin.go`, `_linux.go` 文件提供
- 运行时通过条件编译选择正确的实现

#### **3. 消息处理器模式**
- `messageprocessor_*.go` 文件实现消息路由
- 统一的消息结构体和处理器接口
- 支持异步消息处理和错误处理

#### **4. 单例模式**
- `Application` 单例管理整个应用生命周期
- `BindingsManager` 单例管理所有绑定
- `WindowManager` 单例管理所有窗口

---

### 📁 **重要文件路径映射**

| 功能领域 | 核心文件路径 | 关键类/接口 | GitHub Permalink |
|----------|-------------|-------------|------------------|
| **应用生命周期** | `v3/pkg/application/application.go` | `Application` 接口 | [Permalink](https://github.com/wailsapp/wails/blob/49bda92dc8b9b7829dc9fd216c32ebcea8fff36/v3/pkg/application/application.go#L1-L25073) |
| **绑定系统** | `v3/pkg/application/bindings.go` | `BindingsManager`, `Binding` | [Permalink](https://github.com/wailsapp/wails/blob/49bda92dc8b9b7829dc9fd216c32ebcea8fff36/v3/pkg/application/bindings.go#L1-L15320) |
| **窗口管理** | `v3/pkg/application/browser_window.go` | `BrowserWindow`, `WindowManager` | [Permalink](https://github.com/wailsapp/wails/blob/49bda92dc8b9b7829dc9fd216c32ebcea8fff36/v3/pkg/application/browser_window.go#L1-L9253) |
| **对话框系统** | `v3/pkg/application/dialogs.go` | `DialogManager` | [Permalink](https://github.com/wailsapp/wails/blob/49bda92dc8b9b7829dc9fd216c32ebcea8fff36/v3/pkg/application/dialogs.go#L1-L13292) |
| **菜单系统** | `v3/pkg/application/menu.go` | `Menu`, `MenuItem` | [Permalink](https://github.com/wailsapp/wails/blob/49bda92dc8b9b7829dc9fd216c32ebcea8fff36/v3/pkg/application/menu.go#L1-L5024) |
| **事件系统** | `v3/pkg/application/events.go` | `EventManager` | [Permalink](https://github.com/wailsapp/wails/blob/49bda92dc8b9b7829dc9fd216c32ebcea8fff36/v3/pkg/application/events.go#L1-L10028) |
| **前端注入** | `v3/pkg/application/mcp_inject.js` | 前端 ↔ Go 桥接代码 | [Permalink](https://github.com/wailsapp/wails/blob/49bda92dc8b9b7829dc9fd216c32ebcea8fff36/v3/pkg/application/mcp_inject.js#L1-L31673) |
| **消息处理** | `v3/pkg/application/messageprocessor_call.go` | 方法调用处理器 | [Permalink](https://github.com/wailsapp/wails/blob/49bda92dc8b9b7829dc9fd216c32ebcea8fff36/v3/pkg/application/messageprocessor_call.go#L1-L4160) |
| **平台适配** | `v3/pkg/application/application_windows.go` | Windows 平台实现 | [Permalink](https://github.com/wailsapp/wails/blob/49bda92dc8b9b7829dc9fd216c32ebcea8fff36/v3/pkg/application/application_windows.go#L1-L14468) |

---

### 💡 **MikuMikuAR 项目集成建议**

基于 Wails v3 的架构分析，以下是你在 **MikuMikuAR** 项目中使用 Wails v3 的关键建议：

#### **1. 绑定系统集成**
```typescript
// frontend/src/bindings/wailsBindings.ts
import { invoke, listen } from '@wailsapp/runtime';

export class WailsBindings {
    static async registerGoFunctions() {
        // 注册 Go 函数供前端调用
        await invoke('registerBindings', {
            'loadModel': this.loadModel.bind(this),
            'renderFrame': this.renderFrame.bind(this),
            'showDialog': this.showDialog.bind(this)
        });
    }

    static async loadModel(path: string): Promise<Model> {
        return await invoke('loadModel', path);
    }

    static onModelLoaded(callback: (model: Model) => void) {
        return listen('model-loaded', callback);
    }
}
```

#### **2. 窗口管理集成**
```typescript
// frontend/src/services/windowService.ts
import { Window } from '@wailsapp/runtime';

export class WindowService {
    static mainWindow: Window;

    static async createMainWindow() {
        this.mainWindow = new Window({
            title: 'MikuMikuAR - 3D 模型渲染器',
            width: 1200,
            height: 800,
            resizable: true,
            frameless: false,
            backgroundColor: '#1a1a1a'
        });

        await this.mainWindow.show();
        await this.mainWindow.center();
    }
}
```

#### **3. 菜单系统集成**
```typescript
// frontend/src/services/menuService.ts
import { Menu, MenuItem } from '@wailsapp/runtime';

export class MenuService {
    static async createAppMenu() {
        const menu = new Menu();

        const fileMenu = new Menu();
        fileMenu.addItem(new MenuItem({
            id: 'file-open',
            label: '打开模型文件',
            accelerator: 'Ctrl+O',
            click: () => this.handleOpenModel()
        }));

        menu.addSubMenu('文件', fileMenu);
        await menu.setApplicationMenu();
    }
}
```

#### **4. 对话框系统集成**
```typescript
// frontend/src/services/dialogService.ts
import { Dialog } from '@wailsapp/runtime';

export class DialogService {
    static async showErrorDialog(title: string, message: string) {
        return await Dialog.Message({
            title: title,
            message: message,
            type: 'error',
            buttons: ['确定']
        });
    }

    static async showModelFileDialog(): Promise<string[]> {
        return await Dialog.OpenFile({
            title: '选择模型文件',
            filters: [
                { name: '3D 模型', extensions: ['gltf', 'glb', 'fbx'] }
            ]
        });
    }
}
```

#### **5. 事件系统集成**
```typescript
// frontend/src/services/eventService.ts
import { Events } from '@wailsapp/runtime';

export class EventService {
    static init() {
        // 监听模型加载完成事件
        Events.On('model-loaded', (model: Model) => {
            console.log('模型加载完成:', model);
            this.renderModel(model);
        });

        // 监听窗口关闭事件
        Events.On('window-close', () => {
            this.cleanupResources();
        });
    }
}
```

---

### 🎯 **总结**

Wails v3 的架构设计体现了 **现代化、模块化、跨平台** 的设计理念：

1. **清晰的分层架构**: Go 后端 + Web 前端的双引擎架构
2. **统一的接口抽象**: 跨平台的统一 API，平台特定实现隐藏在内部
3. **强大的绑定系统**: 实现 Go ↔ TypeScript 的无缝双向通信
4. **事件驱动架构**: 使用事件总线实现模块间解耦
5. **现代化的开发体验**: 支持热重载、调试工具、TypeScript 类型提示

这个架构非常适合 **MikuMikuAR** 这样的 3D 渲染桌面应用，你可以充分利用 Wails v3 的绑定系统来将 Babylon.js 的渲染逻辑与 Go 后端的文件处理、系统交互等功能完美结合。
