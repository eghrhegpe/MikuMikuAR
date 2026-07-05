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
- `app.go` — `StartFileServer`（HTTP 文件服务器）
- `frontend/src/core/main.ts` — `loadPMXFile`（HTTP URL 加载）

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
- `app.go` — `corsMiddleware` 函数

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
- `frontend/vite.config.ts`

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
- `app.go` — `StartFileServer`（含日志）
- `frontend/src/core/main.ts` — `init()` 中加载器注册

---

## 骨骼变换覆写无效（视线追踪 / 程序化骨骼旋转）

**日期**：2026-07-02

### 故障现象
- 直接写 `runtimeBone.worldMatrix` 后，骨骼视觉上不动
- 或骨骼只有旋转变化，位置留在原地（子骨骼不跟随父骨骼）
- WASM 版 `MmdWasmRuntime` 下尤其明显

### 诊断方法

**步骤 1：afterRender readback 验证**

在 `onAfterRenderObservable` 中读回 `worldMatrix`，与 `onBeforeRender` 写入值对比：

```typescript
scene.onBeforeRenderObservable.add(() => {
    // 写入 worldMatrix
    bone.worldMatrix[0] = newValue;
    console.log('[verify] write=', bone.worldMatrix[0]);
});
scene.onAfterRenderObservable.add(() => {
    console.log('[verify] readback=', bone.worldMatrix[0]);
});
```

| 结果 | 结论 |
|------|------|
| readback == write | 写入生效，问题在别处（如骨骼层级、权重） |
| readback == 旧值 | WASM 双缓冲覆盖，需切到 JS 版运行时 |

**步骤 2：子骨骼位置验证**

如果写入生效但子骨骼不跟随父骨骼移动，说明绕过了骨骼层级。检查是否直接写 `worldMatrix` 而非 `linkedBone.rotationQuaternion`。

### 根因

| 层 | 机制 | 后果 |
|----|------|------|
| WASM 双缓冲 | `MmdWasmRuntime` 的 `worldTransformMatrices` 有前后缓冲，`update()` 用后缓冲覆盖前缓冲 | 直接写 `worldMatrix` 在下一帧被还原 |
| 渲染数据源 | 渲染读 `_computeTransformMatrices` 输出的 `targetMatrix`，不直接读 `worldMatrix` | `_markAsDirty` 在 `update()` 末尾已执行，之后不重跑 |
| 骨骼层级 | `worldMatrix = localMatrix × parentWorldMatrix`，直接写 `worldMatrix` 不影响子骨骼的 `parentWorldMatrix` | 子骨骼位置不更新 |

### 正确做法

改 `linkedBone.rotationQuaternion`（局部旋转），手动触发 `updateWorldMatrix` 重算骨骼链，最后 `_markAsDirty` 刷新渲染矩阵。详见 `docs/architecture.md` §10.1。

### 涉及文件
- `frontend/src/scene/scene-proc-motion.ts` — gaze observer 实现
- `frontend/src/scene/scene.ts` — 运行时切换（`VITE_MMD_RUNTIME=js`）

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
- `frontend/vite.config.ts` — `optimizeDeps.exclude`
- `frontend/src/core/main.ts` — 删除 workaround，保留静态 import

---

## VMD 播放无反应

### 当前状态
✅ 已修复。链路：`VmdLoader.loadFromBufferAsync()` → `MmdWasmAnimation` → `createRuntimeAnimation()` → `setRuntimeAnimation()` → `seekAnimation()` → `playAnimation()`。

### 涉及文件
- `frontend/src/core/main.ts` — `loadVMDMotion` 函数

---

## 渲染管线遗留 Bug（Phase 2 审核遗留，均已修复 ✅）

> 来源：`docs/plans/渲染调参审核结果.txt`（已归档至 `docs/changelog/`）
> 修复日期：2026-06-28

### ✅ reattachPipeline 位置错误（#1）

**修复**：`camera.ts:286-291` — `switchCameraMode` 末尾已加 `reattachPipeline()` 调用，`scene-menu.ts` 中无重复调用。

### ✅ 切相机后 FOV 丢失（#2）

**修复**：`camera.ts:289-290` — `switchCameraMode` 重挂管线后立即读取 `getRenderState().fov` 并应用到新相机。

### ✅ getRenderState() outlineEnabled 硬编码（#3）

**修复**：`scene.ts:280-281` — 模块级 `_outlineEnabled` / `_outlineColor` 变量；`getRenderState` 读取，`setRenderState` 更新。

### ✅ reattachPipeline 相机累积（#4）

**修复**：`scene.ts:371-380` — 改为先 `removeCamera` 旧相机再 `addCamera` 新相机，用 `_pipelineCamera` 追踪。

### ✅ 用户预设保存失败时状态不一致（#5）

**修复**：`scene-menu.ts:661` — 改为先调用 `SaveRenderPreset` 持久化，成功后再写内存 `userPresets`，无需回滚。

### 涉及文件
- `frontend/src/scene/camera.ts` — `switchCameraMode`（#1 #2）
- `frontend/src/scene/scene.ts` — `getRenderState`/`reattachPipeline`（#3 #4）
- `frontend/src/menus/scene-menu.ts` — `showPresetSaveDialog`（#5）


