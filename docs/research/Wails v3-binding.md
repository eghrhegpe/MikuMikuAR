现在我已经收集了足够的信息。让我为你总结 Wails v3 bindings 系统的实现细节：

## 📋 Wails v3 Bindings 系统深度解析

### 🎯 **核心架构概览**

Wails v3 使用 **双向 RPC 通信机制** 实现 Go backend ↔ TypeScript frontend 的函数调用。核心组件：

```
Frontend (TypeScript) ←→ Runtime (WebView Bridge) ←→ Go Backend
```

---

### 🔧 **1. Bindings 生成机制**

**文件位置：**
- **前端 bindings**: `frontend/bindings/mikumikuar/internal/app/app.ts` (867 行)
- **前端 models**: `frontend/bindings/mikumikuar/internal/app/models.ts` (623 行)
- **Go 后端**: `internal/app/app.go` (620 行)

**生成方式：**
- 使用 Wails v3 CLI 自动生成 TypeScript bindings
- Go 方法通过 `application.Service` 接口自动暴露
- TypeScript 端通过 `Call.ByID()` 调用 Go 方法

---

### 📡 **2. 通信协议与调用机制**

#### **前端调用模式** (`frontend/src/core/wails-bindings.ts`)

```typescript
// 统一导出所有 bindings
export * from '@bindings/mikumikuar/internal/app/app';
export type {
  BuildInfo, Config, DanceSet, EnvState,
  ExtractResult, ModelEntry, ModelMeta, UIState
} from '@bindings/mikumikuar/internal/app/models';
```

#### **Runtime Call 实现** (`@wailsio/runtime/dist/calls.js`)

```javascript
// 核心调用函数
export function ByID(methodID: number, ...args: any[]): CancellablePromise<any>

// 调用流程：
// 1. 生成唯一 call-id (nanoid)
// 2. 创建 CancellablePromise
// 3. 通过 WebView Bridge 发送 { methodID, args }
// 4. Go 后端处理请求并返回结果
// 5. 前端 Promise resolve/reject
```

#### **Go 后端注册机制** (`main.go`)

```go
wailsApp := application.New(application.Options{
  Name: "MikuMikuAR",
  Description: "PMX Player with physics simulation",
  Services: []application.Service{
    application.NewService(myApp), // Go App 结构体自动注册为 bindings
  },
  // ...
})
```

**关键点：** Go 的 `*App` 结构体方法自动成为 Wails bindings，无需手动注册！

---

### 🏗️ **3. 核心接口定义**

#### **Go 后端接口** (`internal/app/app.go`)

```go
type App struct {
  wailsApp *application.App  // Wails 应用引用
  appVersion string          // 版本号
  buildTime string           // 构建时间
  commitHash string          // 提交哈希
  httpServers map[string]*httpServerInfo  // HTTP 服务管理
  // ... 状态管理
}

// 所有 public 方法自动暴露为 bindings
func (a *App) GetAppVersion() string { return a.appVersion }
func (a *App) GetBuildInfo() *BuildInfo { ... }
func (a *App) GetConfig() (*Config, error) { ... }
// 共 80+ 个公开方法
```

#### **数据类型定义** (`internal/app/app.go` + `frontend/bindings/mikumikuar/internal/app/models.ts`)

**核心类型：**
- `BuildInfo` - 构建信息 (版本、时间、commit)
- `Config` - 用户配置 (UI、路径、预设等)
- `ModelEntry` - 模型库条目 (PMX/VMD 扫描结果)
- `ModelMeta` - PMX 头部元数据
- `EnvState` - 环境状态 (天空、地面、粒子等)
- `UIState` - UI 首选项 (缩放、主题、性能模式)

---

### 🔄 **4. 方法 ID 生成机制**

**关键发现：** 每个方法调用使用 **FNV-1a 32-bit 哈希** 作为 methodID

```typescript
// 示例：GetAppVersion() 的 methodID = 3698795868
export function GetAppVersion(): $CancellablePromise<string> {
  return $Call.ByID(3698795868);  // FNV-1a("mikumikuar/internal/app.App.GetAppVersion")
}

// 其他示例：
// ExtractZip: 1743254715
// GetModelMeta: 4247543483
// SetEnvState: 4283504689
```

**验证方法：** 前端有自动化测试验证 ID 正确性
```bash
npm run test -- src/__tests__/bindings/app.contract.test.ts
```

---

### 🚀 **5. 使用模式说明**

#### **前端调用 Go 函数的完整流程：**

```typescript
// 1. 导入 bindings
import {
  GetAppVersion,
  GetConfig,
  SetEnvState,
  ExtractZip
} from '@bindings/mikumikuar/internal/app/app';

// 2. 调用方法 (返回 CancellablePromise)
const version = await GetAppVersion();
const config = await GetConfig();

// 3. 处理错误
GetAppVersion()
  .then(version => console.log('Version:', version))
  .catch(err => console.error('Error:', err));

// 4. 取消长时间运行的调用
const promise = GetModelMeta('/path/to/model.pmx');
promise.cancel(); // 取消请求
```

#### **Go 方法暴露规则：**

```go
// ✅ 会暴露为 bindings 的方法：
// - 首字母大写的公开方法
// - 返回 (result, error) 或 (result) 或 error
func (a *App) PublicMethod() (Result, error) { ... }

// ❌ 不会暴露：
// - 首字母小写的私有方法
// - 嵌入的未导出字段
// - 结构体方法 (必须是指针接收器)
```

---

### 🔍 **6. 关键实现模式**

#### **模式 1：配置管理**
```go
// GetConfig() - 读取配置 (带读锁保护)
func (a *App) GetConfig() (*Config, error) {
  a.configMu.RLock()
  defer a.configMu.RUnlock()
  if a.cachedCfg != nil {
    return a.cachedCfg, nil
  }
  // 从磁盘读取
}

// SetUIState() - 写入配置 (带写锁保护)
func (a *App) SetUIState(ui UIState) error {
  a.configMu.Lock()
  defer a.configMu.Unlock()
  a.cachedCfg.UIState = ui
  return writeConfig(a.cachedCfg)
}
```

#### **模式 2：文件操作**
```go
// IsolateModelDir() - 安全文件隔离
func (a *App) IsolateModelDir(filePath string) (string, error) {
  // 信任目录：返回原路径
  // 外部文件：复制到临时目录 + 启动 HTTP 服务
  // 返回可访问的 URL
}
```

#### **模式 3：批量操作**
```go
// GetModelMetaBatch() - 批量获取 PMX 元数据
func (a *App) GetModelMetaBatch(paths []string) (map[string]ModelMeta, error) {
  results := make(map[string]ModelMeta)
  var wg sync.WaitGroup
  mu := sync.Mutex{}

  for _, path := range paths {
    wg.Add(1)
    go func(p string) {
      defer wg.Done()
      meta, _ := parsePMXHeader(p) // 忽略错误
      mu.Lock()
      results[p] = meta
      mu.Unlock()
    }(path)
  }

  wg.Wait()
  return results, nil
}
```

---

### 📊 **7. 性能与并发模式**

#### **并发安全：**
- `configMu` - 读写锁保护配置访问
- `httpSrvMu` - HTTP 服务管理锁
- `watchMu` - 文件监听锁

#### **资源管理：**
- HTTP 服务在 `ServiceShutdown()` 时并行关闭 (5s 超时)
- 文件句柄使用 `defer` 确保释放
- 缓存有 TTL 机制

#### **错误处理：**
- 所有错误通过 `RuntimeError` 传递到前端
- 网络错误、类型错误、应用错误都有对应的错误类型
- 前端可以通过 `.catch()` 处理错误

---

### 🔗 **8. 与前端的集成模式**

#### **前端使用示例：**
```typescript
// src/scene/scene.ts - 场景管理
import { SetEnvState, GetConfig } from '@bindings/mikumikuar/internal/app/app';

export async function applyEnvironmentSettings(env: Partial<EnvState>) {
  const config = await GetConfig();
  const newEnv = { ...(config?.env || {}), ...env };
  await SetEnvState(newEnv);
}

// src/core/main.ts - 应用初始化
import { ServiceShutdown, SetWailsApp } from '@bindings/mikumikuar/internal/app/app';

SetWailsApp(wailsApp); // 注册 Wails 应用引用

// 监听前端事件
Events.On('model:loaded', (modelPath) => {
  AddRecentModel(modelPath);
});
```

---

### 📝 **9. 最佳实践总结**

#### **✅ 正确使用模式：**
1. **使用 CancellablePromise** - 支持取消长时间运行的操作
2. **错误处理** - 总是使用 `.catch()` 或 `try/catch`
3. **并发操作** - 使用批量方法 (GetModelMetaBatch, GetThumbnailBatch)
4. **配置读写** - 使用 GetConfig/SetUIState 等原子操作
5. **资源清理** - 使用 StopFileServer 释放 HTTP 服务

#### **⚠️ 避坑指南：**
1. **不要手动调用 `wails3 generate bindings`** - 会破坏 TypeScript 类型系统
2. **新增 Go 方法后** - 手动在 `app.ts` 和 `models.ts` 添加对应的 TypeScript 定义
3. **文件路径处理** - 使用 `IsolateModelDir()` 确保安全访问
4. **Android 平台** - 文件选择、监听等功能受限，需要特殊处理

---

### 📚 **10. 关键文件路径总结**

| 文件 | 路径 | 作用 |
|------|------|------|
| **Go 后端** | `internal/app/app.go` | 核心业务逻辑 + bindings 实现 |
| **前端 bindings** | `frontend/bindings/mikumikuar/internal/app/app.ts` | 自动生成的 TypeScript bindings |
| **前端 models** | `frontend/bindings/mikumikuar/internal/app/models.ts` | TypeScript 类型定义 |
| **前端入口** | `frontend/src/core/wails-bindings.ts` | 统一导出 bindings |
| **Wails 启动** | `main.go` | 注册 Go App 为 Wails Service |
| **Runtime** | `frontend/node_modules/@wailsio/runtime/dist/calls.js` | WebView Bridge 实现 |

---

### 💡 **核心价值总结**

Wails v3 的 bindings 系统提供了：

1. **🔌 即插即用** - Go 方法自动成为 bindings，无需手动注册
2. **📡 双向通信** - 前端可以调用 Go，Go 也可以通过 Events 通知前端
3. **🛡️ 类型安全** - TypeScript 类型定义与 Go 方法签名对齐
4. **⚡ 高性能** - 使用 FNV-1a ID + WebView Bridge，调用延迟低
5. **🔄 可取消** - 支持取消长时间运行的操作
6. **📊 批量操作** - 批量方法提升并发性能

**这就是为什么 MikuMikuAR 能够在 Wails v3 上实现如此丰富的功能！** 🎉
