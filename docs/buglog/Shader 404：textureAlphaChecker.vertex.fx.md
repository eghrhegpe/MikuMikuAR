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
