# ADR-124: 文件服务架构审计 —— 从 HTTP 中转到 ArrayBuffer 直传

> **日期**: 2026-07-17
> **状态**: 已完成（Phase 1-3 全部落地；HTTP 文件服务保留作 fallback）
> **背景**: 现有桌面版模型加载依赖 Go `StartFileServer` 启动本地 HTTP 服务来喂文件。`web-loader/main.ts` 已验证 `IArrayBufferFile[]` 绕过 HTTP 走内存直传的可行性。本 ADR 审计现有文件服务架构，评估分阶段去除 HTTP 中转层的路径。

---

## 一、现状审计

### 1.1 数据流全链路

```
磁盘文件
  → Go IsolateModelDir（安全隔离：信任目录直传，外部文件拷贝到 temp）
    → Go StartFileServer（按目录启动 127.0.0.1:{port} HTTP 服务 + basenameFallbackFS）
      → TS resolveFileUrl（normPath → IsolateModelDir → StartFileServer → 构造 ?f= URL）
        → ImportMeshAsync(url) / new Texture(url) / fetch(url)
          → Babylon.js / babylon-mmd 通过 HTTP GET 获取文件
```

### 1.2 关键模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| `fileservice.ts` | frontend/src/core/ | 统一 URL 构造：`resolveFileUrl` / `fetchArrayBuffer` / `encodeFileRef` |
| `httpserver.go` | internal/app/ | `IsolateModelDir`（安全隔离）+ `trustedRoots` |
| `zipextract.go:799` | internal/app/ | `StartFileServer` / `StopFileServer` + `basenameFallbackFS` HTTP handler |
| `fileaccess.go` | internal/app/ | `FileAccessor` 接口 + `ReadTextFile`（仅文本） |
| `web-loader/main.ts` | frontend/src/ | POC：`IArrayBufferFile[]` 零 HTTP 加载路径 |

### 1.3 消费者矩阵

| 消费者 | 文件 | 传输机制 | 改造难度 |
|--------|------|----------|----------|
| PMX 模型加载 | model-loader.ts:232 | `resolveFileUrl → ImportMeshAsync(url)` | **低** |
| 场景道具 | props.ts:73 | `resolveFileUrl → ImportMeshAsync(url)` | **低** |
| 换装纹理 | outfit.ts:588-666 | `http://127.0.0.1:${inst.port}/?f=... → new Texture(url)` | **高** |
| 换装叠加层 | outfit-overlay.ts:225 | `http://127.0.0.1:${inst.port}/?f=... → ImportMeshAsync(url)` | **中** |
| VMD 动作 | vmd-loader.ts:207 | `fetchArrayBuffer → ArrayBuffer` | **中** |
| 音频文件 | audio.ts:248 | `resolveFileUrl → fetch → arrayBuffer` | **中** |

### 1.4 Go 侧现状

- `ReadTextFile(path) → (string, error)` — 仅文本，无二进制读取
- `StartFileServer(dir) → (int, error)` — 按目录启动 HTTP，惰性复用
- `StopFileServer(dir) → error` — 关闭指定目录的 HTTP 服务
- `IsolateModelDir(path) → (string, error)` — 安全隔离：信任目录直传，外部文件拷贝
- **无 `ReadFileBytes` binding**

---

## 二、核心障碍分析

### 2.1 `inst.port` 深度耦合

`ModelInstance.port`（types.ts:96）被以下系统直接拼接 URL 使用：

| 使用方 | 行号 | 用途 |
|--------|------|------|
| outfit.ts | 588-666 | 纹理替换 5 个 slot（diffuse/toon/sphere/bump/emissive） |
| outfit.ts | 180 | 换装扫描目录内纹理 |
| outfit.ts | 279 | 纹理路径重写 |
| outfit-overlay.ts | 225 | FBX 叠加层加载 |

这些调用直接拼接 `http://127.0.0.1:${inst.port}/?f=...` URL。若去掉 HTTP 层，**纹理加载路径全部断裂**。

### 2.2 babylon-mmd 内部纹理解析

PMX 加载时，babylon-mmd 的 `PmxLoader` 内部：
1. 解析 PMX 中的纹理路径引用（可能含 Shift-JIS 编码）
2. 通过 `ReferenceFileResolver` 匹配（需要 `File[]` 或 `IArrayBufferFile[]`）
3. **按需 fetch 这些路径**（走 HTTP）

web-loader 通过 `pluginOptions.mmdmodel.referenceFiles` 传入 `IArrayBufferFile[]` 绕过了 HTTP，但主应用的 `ImportMeshAsync` 调用**未传递此选项**。

### 2.3 basenameFallbackFS 的 Shift-JIS 修复

Go 侧 `basenameFallbackFS`（zipextract.go:642-761）解决两个问题：
- `?f=base64url` 绕过 URL 编码歧义（ADR-057）
- corrupt-name index 修复 babylon-mmd 内部 Shift-JIS 纹理 URL（ADR-058）

若走 ArrayBuffer 路径，需在 TS 侧实现等价的 basename fallback。

### 2.4 内存开销评估

| 文件类型 | 典型大小 | 一次性读入风险 |
|----------|----------|----------------|
| PMX 模型 | ~2MB | ✅ 无风险 |
| 单张纹理 | ~1MB | ✅ 无风险 |
| 20 张 4K 贴图 | ~80MB | ⚠️ 需评估 |

StartFileServer 当前是惰性按需加载（纹理按需 HTTP GET），ReadFileBytes 则是一次性全量读入内存。大纹理集需考虑分批或按需。

### 2.5 referenceFiles 传递路径验证

web-loader 验证了 `pluginOptions.mmdmodel.referenceFiles` 能传递到 `PmxLoader._buildMaterialAsync`，前提：
- `ImportMeshAsync` 的 source 是 `ArrayBufferView`
- Babylon 走 `loadDataAsync > createPlugin > new PmxLoader(pluginOptions.mmdmodel) > loadFile` 路径
- `referenceFiles` 能正确传递

若改用 `SceneLoader.ImportMeshAsync`（类静态方法），pluginOptions 的传递路径不同，**需验证**。

---

## 三、决策：分阶段迁移

### Phase 1 — PMX + VMD + 音频走 ArrayBuffer（低风险高收益）

**范围**：新增 Go binding + 改 model-loader / vmd-loader / audio

**Go 侧**：
```go
// fileaccess.go — 新增二进制读取
func (a *App) ReadFileBytes(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }
    return data, nil
}
```

**TS 侧**：
- `model-loader.ts`：`ReadFileBytes → ImportMeshAsync(Uint8Array, { pluginOptions: { mmdmodel: { referenceFiles } } })`
- `vmd-loader.ts`：`ReadFileBytes` 替代 `fetchArrayBuffer`
- `audio.ts`：`ReadFileBytes` 替代 `resolveFileUrl → fetch`

**保留**：HTTP 文件服务作为 fallback（纹理等 babylon-mmd 内部 fetch）。

**收益**：
- PMX 加载省去 HTTP roundtrip
- Android 消除 `MIXED_CONTENT_ALWAYS_ALLOW` 安全风险（ADR-017 A0-01）
- 架构简化：主加载路径不再依赖 HTTP

### Phase 2 — 换装纹理走 ArrayBuffer（中风险）

**范围**：收集模型目录下所有纹理 → 批量 ReadFileBytes → 构建 `IArrayBufferFile[]`

**关键变更**：
- `resolveFileUrl` 返回值扩展：`{ url, port, dir, arrayBuffer?, textures? }`
- `loadPMXFile` 传递 `referenceFiles` 给 ImportMeshAsync
- 纹理通过 `referenceFiles` 由 babylon-mmd 内部消费，不再走 HTTP

**验证点**：
- `ReferenceFileResolver` 对主应用是否生效
- Shift-JIS 纹理路径的 basename fallback 在 TS 侧实现

### Phase 3 — HTTP 层清理（已实施）

**完成项**：
- `inst.port` 从 `ModelInstance` / `PropInstance` 移除
- 所有消费者迁移到 ArrayBuffer 路径（model-loader / vmd-loader / audio / props / outfit / outfit-overlay / vmd-layers）
- `resolveModelDir` 新增（仅获取隔离目录，不启动 HTTP）
- Go `ListDirRecursive` 新增（递归扫描 + `relativePath`）
- 测试更新（audio.test / app.contract.test）

**保留**：`resolveFileUrl` / `StartFileServer` / `StopFileServer` 保留作 fallback（测试依赖 + 未来可能需要）。

---

## 四、不推荐的方案

### 4.1 一次性去掉 HTTP 层

**理由**：纹理加载是 babylon-mmd 内部行为，改造风险高且收益有限（纹理文件小，HTTP 开销可忽略）。换装纹理 5 个 slot 的 URL 拼接散布在 outfit.ts 多处，改造面大。

### 4.2 ReadFileBytes 全量预加载所有纹理

**理由**：大纹理集（20 张 4K ≈ 80MB）一次性读入内存有 OOM 风险。应保持按需加载语义，仅在 Phase 2 验证后评估批量加载。

---

## 五、受影响文件

### Phase 1
- `internal/app/fileaccess.go` — 新增 `ReadFileBytes`
- `frontend/bindings/` — 重新生成 bindings
- `frontend/src/scene/manager/model-loader.ts` — 改用 ArrayBuffer 加载
- `frontend/src/scene/motion/vmd-loader.ts` — 改用 ReadFileBytes
- `frontend/src/outfit/audio.ts` — 改用 ReadFileBytes

### Phase 2
- `frontend/src/core/fileservice.ts` — `resolveFileUrl` 返回值扩展
- `frontend/src/scene/manager/model-loader.ts` — 传递 referenceFiles
- `frontend/src/outfit/outfit.ts` — 纹理加载改为 ArrayBuffer

---

## 六、测试策略

- Phase 1：现有 `env-water.test.ts`、`model-loader` 相关测试不回归；新增 `ReadFileBytes` 单元测试
- Phase 2：新增纹理 ArrayBuffer 加载集成测试；验证 Shift-JIS 纹理路径的 basename fallback
- E2E：Playwright 验证模型加载 + 换装纹理完整流程

---

## 七、实施记录（2026-07-17）

### Phase 1 完成项

| 模块 | 变更 | 文件 |
|------|------|------|
| Go `ReadFileBytes` | 新增二进制读取 binding | `fileaccess.go` |
| Go `ListDirRecursive` | 递归目录扫描（返回 `{name, relativePath}`） | `fileaccess.go` |
| `model-loader.ts` | PMX 用 ArrayBuffer 直传 + referenceFiles 纹理 | `model-loader.ts` |
| `vmd-loader.ts` | ReadFileBytes 替代 fetchArrayBuffer | `vmd-loader.ts` |
| `audio.ts` | ReadFileBytes + Blob URL 替代 HTTP | `audio.ts` |

### 踩坑记录

#### Wails v3 `[]byte` 序列化为 base64 字符串

**现象**：`ReadFileBytes` 的 TS 绑定返回类型为 `string | null`（非 `Uint8Array`），直接传给 `ImportMeshAsync` 导致二进制数据被 `.toString()` 后当作 URL 路径请求。

**根因**：Wails v3 将 Go `[]byte` 序列化为 JSON 中的 base64 字符串（通过 `response.json()` 返回），而非直接映射为 `Uint8Array`。Go 注释 "automatically maps []byte to Uint8Array" 与实际行为不符。

**修复**：所有 `ReadFileBytes` 调用点需显式 base64 解码：
```typescript
function decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}
```

#### `ListDir` 仅返回顶层文件名

**现象**：PMX 纹理在子目录（如 `textures/body.png`）中，`ListDir` 只返回 `body.png`，与 PMX 内部引用的 `textures/body.png` 不匹配。

**修复**：新增 `ListDirRecursive`，使用 `filepath.WalkDir` 递归遍历，返回完整相对路径（`filepath.ToSlash` 统一为 `/` 分隔符）。

#### `ImportMeshAsync` 第一个参数语义

**现象**：`ImportMeshAsync(data, scene, opts)` 的第一个参数是 `meshNames`（网格名过滤器），不是文件数据。

**修复**：babylon-mmd 的 `ImportMeshAsync` 实际接受 `ArrayBufferView` 作为第一个参数（绕过类型检查需 `as any`），与 web-loader 行为一致。

### Phase 2 部分完成

model-loader 的 referenceFiles 已实现（递归扫描 + ReadFileBytes + decodeBase64）。outfit.ts 的 5 个纹理 slot 改造暂缓，原因：
- 改造面大（`_applySlot` 函数、HEAD 探测逻辑、URL 拼接散布多处）
- 纹理文件小，HTTP 开销可忽略
- 需 outfit.ts 完成后才能推进 Phase 3（移除 `inst.port`）

### Phase 3 完成（2026-07-17）

| 模块 | 变更 | 文件 |
|------|------|------|
| `ModelInstance` | 移除 `port` 字段 | `types.ts` |
| `PropInstance` | 移除 `port` / `modelDir` 字段 | `types.ts` |
| `model-loader.ts` | `resolveModelDir` 替代 `resolveFileUrl`；移除 `port` 赋值 | `model-loader.ts` |
| `outfit.ts` | `_applySlot` 改用 `ReadFileBytes` + Blob URL；HEAD 探测改用文件读取 | `outfit.ts` |
| `outfit-overlay.ts` | FBX 加载改用 `ReadFileBytes` + Blob URL | `outfit-overlay.ts` |
| `props.ts` | 道具加载改用 `ReadFileBytes` + Blob URL | `props.ts` |
| `vmd-layers.ts` | `fetchArrayBuffer` → `ReadFileBytes` + base64 解码（3 处） | `vmd-layers.ts` |
| `fileservice.ts` | 新增 `resolveModelDir`（仅隔离目录，不启动 HTTP） | `fileservice.ts` |
