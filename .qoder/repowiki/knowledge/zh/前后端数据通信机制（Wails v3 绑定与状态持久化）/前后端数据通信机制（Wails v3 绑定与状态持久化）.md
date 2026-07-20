---
kind: frontend_backend_communication
name: 前后端数据通信机制（Wails v3 绑定与状态持久化）
category: frontend_backend_communication
scope:
    - frontend/bindings/
    - frontend/src/core/state.ts
    - frontend/src/core/ui-state.ts
    - frontend/src/scene/env/env-bridge.ts
    - frontend/src/core/i18n/goerr.ts
    - frontend/src/core/safe-call.ts
    - internal/i18nerr/
    - internal/util/safecall.go
---

## 通信架构概览

MikuMikuAR 采用 Wails v3 的 **绑定（Binding）机制** 实现 Go ↔ TypeScript 双向通信。前端通过自动生成的 `$Call.ByID(FNV1a_ID)` 调用 Go 方法，底层走 JSON-RPC over HTTP（127.0.0.1 本地端口）。

## 绑定生成与调用链路

### Go 端暴露方法

```go
// internal/app/app.go — App 结构体方法自动暴露给前端
func (a *App) GetConfig() Config { ... }
func (a *App) SetEnvState(state EnvState) { ... }
```

### 前端自动生成绑定

`frontend/bindings/mikumikuar/internal/app/app.ts`（1024 行）由 Wails CLI 生成，每个 Go 方法对应一个导出函数：

```typescript
export function GetConfig(): Promise<Config> {
    return $Call.ByID(0x3A2F7B1C, ...) as Promise<Config>;
}
```

- **路由方式**：FNV-1a 哈希算法为每个 `结构体.方法` 生成 32 位 ID
- **取消支持**：返回 `$CancellablePromise`，可传入 `AbortSignal` 取消
- **类型映射**：Go struct → TypeScript interface（同名生成）

## 状态持久化链路

### EnvState（场景环境状态）

```
UI 操作 → envState.xxx = value
  → reactive Proxy 拦截 set
  → 防抖 500ms（schedulePersistEnvState）
  → persistEnvState()
  → SetEnvState(binding) → Go 写 config.json
```

关键文件：
- `frontend/src/core/state.ts` — `envState: EnvState = reactive<EnvState>(...)`
- `frontend/src/scene/env/env-bridge.ts` — `setEnvState()` 合并 + 分发 + 持久化
- `frontend/src/core/env-state-schema.ts` — 全部字段类型 + 默认值

### UIState（界面状态）

```
UI 操作 → setUIState(partial)
  → Object.assign(uiState, partial)
  → _uiPersistCb?.() → schedulePersistUI()
  → 防抖 500ms → SetUIState(binding) → Go 端 json.Unmarshal 合并写盘
```

**合并语义**：Go 端 `json.Unmarshal` 做 partial merge，非全量替换。

## 错误信封机制（@@GOERR@@）

Go 端错误通过 Wails 桥接后丢失结构化信息，项目采用 **哨兵 + JSON 信封** 方案：

```go
// Go 端：internal/i18nerr/errors.go
EnvelopeMarker = "@@GOERR@@"
func (e *UserError) Error() string {
    return fmt.Sprintf("%s\n@@GOERR@@{\"code\":\"%s\",\"params\":%s,\"msg\":\"%s\"}",
        e.Message, e.Code, paramsJSON, e.Message)
}
```

```typescript
// 前端：frontend/src/core/i18n/goerr.ts
export function translateGoError(e: unknown): string {
    // 1. 从 Error.message 提取 @@GOERR@@ 后的 JSON
    // 2. 尝试 i18n key 翻译
    // 3. 回退：信封内 msg → 原始错误文本
}
```

## 安全调用模式（safe-call 三件套）

```typescript
// frontend/src/core/safe-call.ts
safeCall(tag, msg, fn)       // 同步，返回 T | undefined
safeCallVoid(tag, msg, fn)   // 同步，无返回值
safeCallAsync(tag, msg, fn)  // 异步，返回 Promise<T | undefined>
```

统一吞错模式：捕获异常后 `console.warn` 输出上下文，返回 undefined 而非抛出。

## 二进制数据传输

大文件（纹理、PMX 模型）通过 base64 编码传输：

```typescript
// 前端调用
const base64Data = await ReadFileBase64(path);
const binary = atob(base64Data);
```

## 开发者规则

| 规则 | 说明 |
|------|------|
| 新增 Go 方法后 | 运行 `wails generate bindings` 重新生成 |
| 跨桥错误处理 | 始终用 `translateGoError()` 解包，不直接 `.catch(e => e.message)` |
| 状态持久化 | 不要绕过防抖直接调 binding（除非 `flushEnvState()`） |
| 大文件传输 | 使用 base64 binding，不要拼接 JSON |
