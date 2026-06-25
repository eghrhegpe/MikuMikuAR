# 故障排查记录

## PMX 加载失败：`is not pmx file`

### 错误信息
```
✗ 加载失败: Unable to load from binary data: is not pmx file
```

### 根因（已通过 HTTP 服务器方案消除）

~~Wails v2 将 Go `[]byte` 序列化为 base64 传给前端，JS 侧解码后得到 `Uint8Array`。但 Wails 底层可能使用**共享池 buffer**，导致 `Uint8Array.buffer` 指向整个池（而非文件数据的实际起始位置）。~~

现已改用 Go HTTP 文件服务器 + `ImportMeshAsync(url)`，不走桥接传递二进制，该问题不再出现。

### 涉及文件
- `MikuMikuAR/app.go` — `StartFileServer`（HTTP 文件服务器）
- `MikuMikuAR/frontend/src/main.ts` — `loadPMXFile`（HTTP URL 加载）

---

## CORS：Wails WebView 跨域被拦

### 错误信息
```
Access to XMLHttpRequest at 'http://127.0.0.1:39989/model.pmx' 
from origin 'http://wails.localhost:34115' has been blocked by CORS policy
```

### 根因
`wails dev` 使用 `http://wails.localhost:34115` 作为页面源，Go HTTP 服务器在 `127.0.0.1:PORT`，浏览器视为跨域。

### 修复
`app.go:StartFileServer` 中的 `corsMiddleware` 给所有响应加 `Access-Control-Allow-Origin: *`。

### 涉及文件
- `MikuMikuAR/app.go` — `corsMiddleware` 函数

---

## WASM 404：`index_bg.wasm` 无法加载

### 错误信息
```
Failed to load resource: the server responded with a status of 404 (Not Found)
...node_modules/.vite/deps/index_bg.wasm
```

### 根因
Vite 预打包 babylon-mmd 时，`new URL('index_bg.wasm', import.meta.url)` 指向 `.vite/deps/` 下的路径，但 WASM 文件不在那里。

### 修复
`vite.config.ts` 添加 `optimizeDeps.exclude: ['babylon-mmd']`，让 Vite 跳过预打包，保持原始 import.meta.url 指向源文件位置。

### 涉及文件
- `MikuMikuAR/frontend/vite.config.ts`

---

## 纹理不显示：模型白色/无颜色

### 错误信息
无 404，无报错，仅控制台有 `FS: GET` 日志。

### 可能原因
1. PMX 内部贴图路径与实际文件路径不匹配（如 `../tex/xxx.bmp` vs `textures/xxx.bmp`）
2. 贴图路径含中文字符导致 URL 编码/解码不一致
3. 文件扩展名大小写（`.BMP` vs `.bmp`）
4. PMX 使用 TGA/BMP 但加载器注册不完整

### 已采取的修复
- 注册 `RegisterDxBmpTextureLoader()` — 处理 BMP alpha 通道
- 导入 `@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader` — TGA 支持
- 设置 `MmdRuntimeShared.MaterialProxyConstructor = MmdStandardMaterialProxy`
- Go HTTP 服务器添加 `FS: GET` 请求日志用于诊断

### 诊断方法
`wails dev` 控制台搜索 `FS: GET /` 开头的日志，看贴图文件是否被请求及结果状态码。

### 涉及文件
- `MikuMikuAR/app.go` — `StartFileServer`（含日志）
- `MikuMikuAR/frontend/src/main.ts` — `init()` 中加载器注册

---

## Shader 404：`textureAlphaChecker.vertex.fx` / `.fragment.fx`

**日期**：2025-07-16

### 错误信息
```
GET http://wails.localhost:34115/src/Shaders/textureAlphaChecker.vertex.fx 404 (Not Found)
GET http://wails.localhost:34115/src/Shaders/textureAlphaChecker.fragment.fx 404 (Not Found)
```
模型加载后纹理全白，材质构建链中断。

### 根因
**Vite 预打包导致模块双实例**。

babylon-mmd 的 shader 模块通过 side-effect 写入 `ShaderStore.ShadersStore`：
```javascript
ShaderStore.ShadersStore["textureAlphaCheckerVertexShader"] = Shader;
```
Babylon.js 渲染时从同一 `ShaderStore` 读取。但 Vite 只 exclude 了 `babylon-mmd`，`@babylonjs/core` 仍被预打包到 `.vite/deps/`。结果：
- `main.ts` import `@babylonjs/core` → 预打包实例 A 的 `ShaderStore`
- `babylon-mmd`（源码形态）import `@babylonjs/core/Engines/shaderStore` → 源码实例 B 的 `shaderStore.js`

shader 写入 B，渲染读取 A → 读不到 → fallback HTTP 请求 `.fx` 文件 → 404。

### 修复
`vite.config.ts` 的 `optimizeDeps.exclude` 同时排除两者，保证共享同一模块图：

```typescript
optimizeDeps: {
  exclude: ['babylon-mmd', '@babylonjs/core'],
}
```

同时删除 `main.ts` `init()` 中的 `Promise.all` 动态 import workaround，静态 import 保留作为双保险。

### 验证方法
控制台执行：
```js
console.log(BABYLON.ShaderStore.ShadersStore["textureAlphaCheckerVertexShader"])
```
有值即单实例确认。不应再出现 `.fx` 404。

### 涉及文件
- `MikuMikuAR/frontend/vite.config.ts` — `optimizeDeps.exclude`
- `MikuMikuAR/frontend/src/main.ts` — 删除 workaround，保留静态 import

---

## VMD 播放无反应

### 当前状态
✅ 已修复。链路：`VmdLoader.loadFromBufferAsync()` → `MmdWasmAnimation` → `createRuntimeAnimation()` → `setRuntimeAnimation()` → `seekAnimation()` → `playAnimation()`。

### 涉及文件
- `MikuMikuAR/frontend/src/main.ts` — `loadVMDMotion` 函数


