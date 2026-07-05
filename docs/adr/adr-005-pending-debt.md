# ADR-005: 待修复项 — 已知技术债务

**日期**：2026-07-16

> **状态**: 已完成 — #1 HTTP 目录隔离（IsolateModelDir）+ #2 HasThumb 扫描检测 + #3 失败进度条 auto-hide

---

## 1. HTTP 服务器可能暴露用户目录

### 背景

`ImportLocalFile` 对非 zip 文件（PMX/VMD）返回 `filepath.Dir(path)`，前端将其传给 `StartFileServer` 启动 HTTP 文件服务。如果文件在 `C:\Users\xxx\Downloads`，HTTP 服务器会暴露整个下载目录的索引和文件。

实际风险有限：
- 服务器绑定 `127.0.0.1:随机端口`，仅本地可访问
- Wails WebView 的 origin 限制
- `basenameFallbackFS` 只按 basename 索引文件，不列出目录

但隐私上不理想：用户不会预期打开一个文件会导致整个 Downloads 目录被 HTTP 服务。

### 解决方案选项

**方案 A：仅在 LibraryRoot 下启 HTTP 服务（推荐）**

`ImportLocalFile` 对于库外的文件，将文件 copy 到 `%LOCALAPPDATA%/MikuMikuAR/temp_serve/` 目录，在该目录下启 HTTP 服务。

- 优点：隔离性最强，不会意外暴露用户目录
- 难点：PMX 纹理路径依赖原始目录结构（`../textures/`），copy 后路径链会断
- 缓解：copy 时保留相对路径树，或在 copy 后的目录重建 basename fallback 索引

**方案 B：文件原位服务，但限定 serving 范围**

`StartFileServer` 增加一个 `maxDepth` 参数，只索引文件所在目录及指定深度的子目录，不索引上级。

- 优点：不改文件位置，纹理路径链保留
- 缺点：`basenameFallbackFS` 按 basename 匹配，如果纹理在上级目录则匹配不到

**方案 C：保持现状，增加文档说明**

- 优点：零改动
- 缺点：隐私问题将长期存在

### 当前状态

✅ **方案 A 已选定** — `ImportLocalFile` 对库外文件 copy 到 `%LOCALAPPDATA%/MikuMikuAR/temp_serve/`，保留相对路径树。待实施。

---

## 2. `HasThumb` 字段永为 false

### 背景

`ModelEntry.HasThumb`（`app.go:168`）注释写着"always false for now"，目前确实从未被设为 `true`。

原因：
- `ScanModelDir` 遍历文件系统时生成 `ModelEntry`，此时缩略图还不存在
- 缩略图在模型加载后由 `captureThumbnail`（`scene.ts`）生成并通过 `SaveThumbnail` 保存
- 所以扫描时无法知道缩略图是否存在

### 修复路径

在 `scanDirRecursive` 中，对每个 PMX 条目计算 `sha256Hex(pmxPath)`，然后 `os.Stat` 检查 `{thumbnailDir}/{hash}.png` 是否存在。

**技术约束**：
- `scanDirRecursive` 是纯函数（无 `App` receiver），不直接访问 `thumbnailDir()`
- 需将 `thumbnailDir` 作为依赖传入函数参数，或改为 method
- `thumbnailDir()` 创建目录的副作用在扫描中不需要（只是读）

### 影响范围

- 改动约 5 行
- `scanDirRecursive` 签名需调整（加一个 `thumbDirFunc func() (string, error)` 参数）
- 测试用例不变（新参数不影响已有逻辑）

### 当前状态

✅ 已修复：`scanDirRecursive` 新增 `thumbDir` 参数，扫描时检查 `{thumbnailDir}/{sha256(path)}.png` 是否存在。

文件 PMX 和 zip PMX 条目均支持。`scanSingleRoot` 计算 thumbDir 后传给所有调用。

---

## 3. 自动导入失败进度条不消失

### 背景

`confirmImport`（`download.ts:182`）失败时设置 `dom.dlPct.textContent = "✗ 导入失败"`，但进度条不会自动隐藏（成功时 2 秒后自动 `hideDownloadBar(2000)`）。

### 修复

一行改动：

```ts
} catch (err) {
    dom.dlPct.textContent = "✗ 导入失败";
    dom.dlFill.style.width = "0%";
    console.error("Import failed:", err);
    hideDownloadBar(5000);  // 5 秒后自动消失
}
```

### 当前状态

✅ 已修复：catch 块添加 `hideDownloadBar(5000)`，导入失败 5 秒后进度条自动消失。

---

## 优先级建议

| # | 问题 | 复杂度 | 建议优先级 |
|---|------|--------|-----------|
| 3 | 自动导入失败 auto-hide | 极简（1 行） | 随手下一次修复 |
| 2 | `HasThumb` 永远 false | 低（5 行 + 函数签名调整） | 下次代码质量轮 |
| 1 | HTTP 目录暴露 | 高（需方案决策） | 待讨论 |
