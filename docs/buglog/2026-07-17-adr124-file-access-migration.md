# ADR-124 文件系统迁移踩坑记录

**日期**：2026-07-17
**关联**：ADR-124（HTTP 中转 → ArrayBuffer 直传）
**状态**：已修复

---

## Bug 1：Wails v3 `[]byte` 序列化为 base64 字符串

**现象**：`ReadFileBytes` 返回的不是 `Uint8Array`，直接传给 `ImportMeshAsync` 后二进制数据被 `.toString()` 后当作 URL 路径请求，报 `net::ERR_FAILED`。

**根因**：Go `[]byte` → JSON 序列化为 base64 字符串 → `response.json()` 返回 `string`。Go 注释 "automatically maps []byte to Uint8Array" 与实际行为不符。

**修复**：所有 `ReadFileBytes` 调用点需 `atob` 解码：
```typescript
function decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}
```

**影响范围**：`model-loader.ts`、`vmd-loader.ts`（3处）、`audio.ts`、`props.ts`、`outfit-overlay.ts`、`vmd-layers.ts`（3处）

---

## Bug 2：`ListDir` 仅返回顶层文件名

**现象**：PMX 纹理在子目录（如 `textures/body.png`）中，`ListDir` 只返回 `body.png`，与 PMX 内部引用的 `textures/body.png` 不匹配，材质全白。

**根因**：`ListDir` 用 `os.ReadDir` 只遍历一层，不递归。

**修复**：新增 `ListDirRecursive`（`filepath.WalkDir`），返回 `{name, relativePath}` 结构体，TS 侧 `collectTextureFiles` 使用。

---

## Bug 3：`ImportMeshAsync` 第一个参数语义

**现象**：`ImportMeshAsync(data, scene, opts)` 的第一个参数是 `meshNames`（网格名过滤器），不是文件数据。`Uint8Array` 被强转后当 URL 使用。

**根因**：babylon-mmd 的 `ImportMeshAsync` 实际接受 `ArrayBufferView` 作为第一个参数（绕过类型检查需 `as any`），但标准 Babylon.js `SceneLoader.ImportMeshAsync` 不支持此用法。

**修复**：`(ImportMeshAsync as any)(pmxBytes, scene, { pluginExtension: '.pmx', ... })`

---

## Bug 4：Outfit 纹理探测用 `ReadFileBytes` 极慢

**现象**：`outfit.ts` HEAD 探测改为 `ReadFileBytes` 后，每探一个纹理都读整个文件，大纹理文件导致扫描超时。

**根因**：`ReadFileBytes` 读全部内容，不适合做存在性检查。

**修复**：新增 `FileExists(path)` Go binding（仅 `os.Stat`），探测改用 `FileExists`。

---

## Bug 5：`resource_root` 配置污染

**现象**：广场下载时临时目录路径被写入 `config.json` 的 `resource_root`，导致 `ScanModelDir` 扫描错误目录，音乐库和道具列表为空。

**根因**：`resource_root` 被持久化为 `TestDownloadFromPlaza_SizeLimit3748633684/001`。之前的 HTTP 路径通过 `IsolateModelDir` 做了安全隔离，绕开了错误路径。直读文件系统后路径必须准确。

**修复**：设置里手动把 `resource_root` 改回正确路径。

**教训**：`resource_root` 写入前应校验目录存在性，避免临时路径污染。

---

## 设计决策

| 决策 | 原因 |
|------|------|
| 纹理保留 HTTP 加载 | `referenceFiles` 的 `relativePath` 需与 PMX 内部引用精确匹配（含 Shift-JIS），递归扫描 + basename fallback 成本高 |
| `resolveModelDir` 独立于 `resolveFileUrl` | `resolveFileUrl` 启动 HTTP 服务器有副作用，仅需目录路径时不应触发 |
| `FileExists` 独立于 `ReadFileBytes` | 存在性检查不应读全部文件内容 |
