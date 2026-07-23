# ADR-057: Shift-JIS URL 乱码修复 —— Base64 查询参数方案（链路 A）

> **日期**: 2026-07-06
> **状态**: 已实施（2026-07-06）
> **背景**: ADR-054 将「Shift-JIS URL 编码 (`%EF%BF%BD`)」列为 🔴 P0 稳定性硬伤。本 ADR 解决**前端可控的主文件加载链路（链路 A）**；纹理路径乱码（链路 B，由 babylon-mmd 内部 fetch 触发）留 ADR-058 另立。

---

## 一、问题边界

### 1.1 两条独立链路

| 链路 | 入口 | 前端可控 | 乱码来源 | 后果 |
|------|------|---------|---------|------|
| **A. 主文件 URL** | `resolveFileUrl` + `outfit-overlay._encodePath` + `vmd-loader._tryLoadCompanionAudio` | ✅ 是 | UTF-8 字符串中的 U+FFFD 被 `encodeURIComponent` 编码为 `%EF%BF%BD` | PMX/VMD/音频 加载 404 |
| **B. 纹理 URL** | Babylon.js `ImportMeshAsync` 内部自动 fetch | ❌ 否 | PMX header 中 Shift-JIS 纹理路径被 babylon-mmd 错误解析为 UTF-8，产生 U+FFFD | 模型加载后纹理全白/404 |

### 1.2 链路 A 根因

`resolveFileUrl` 用 `encodeURIComponent(fileName)` 构造 URL 路径段：

```ts
const url = `http://127.0.0.1:${port}/${encodeURIComponent(fileName)}`;
```

当 `fileName` 含 U+FFFD（来自 Go 侧 `bestDecode` 无法还原的 Shift-JIS 字节）时：

1. 前端 `encodeURIComponent('\uFFFD')` → `%EF%BF%BD`（UTF-8 字节编码）
2. Go 侧 `url.PathUnescape("%EF%BF%BD")` → `\uFFFD`（还原回 U+FFFD）
3. 但 Windows 文件系统实际文件名是正确解码后的日文/中文字符串（经 `bestDecode`/`cleanModelName` 修复），index 用 `d.Name()` 建表也是正确字符串
4. `\uFFFD` ≠ 正确字符串 → 404

**关键洞察**：`encodeURIComponent` → `PathUnescape` 的字节级往返虽语义无损，但前端持有的字符串本身可能已含 U+FFFD，与 Go 侧 `d.Name()` 不一致。Base64 在查询参数中绕开 URL 路径段归一化，但**前提是前端编码的字符串与 Go 侧 index 字符串一致**。

### 1.3 为何 `basenameFallbackFS` 没兜住

- index 用 `d.Name()` 建表（Windows UTF-16→UTF-8，正确日文）
- 请求路径含 `%EF%BF%BD` → PathUnescape 还原 U+FFFD → 与 index 不匹配 → 404
- basename fallback 也用 `path.Base(decodedPath)` 查 index，仍是 U+FFFD → 仍 404

---

## 二、决策：Base64 + 查询参数（方案 A1）

### 2.1 URL 形态

```
旧: http://127.0.0.1:39989/<encodeURIComponent(fileName)>
新: http://127.0.0.1:39989/?f=<base64url(fileName-UTF8)>
```

### 2.2 编码内容选择

| 选项 | 内容 | 选用 |
|------|------|------|
| **A1** | 编码前端现有的 UTF-8 字符串（可能含 U+FFFD） | ✅ |
| A2 | 编码原始 Shift-JIS 字节（需 Go 额外提供字节接口） | ❌ 改动大，且 PMX/VMD 加载不经过 `resolveFileUrl`（链路 B 用不上） |

**选 A1**：链路 A 的乱码本质是 URL **路径段**的语义歧义，Base64 在**查询参数**中彻底绕开。编码内容只需与 Go 侧 `d.Name()` 字符串一致即可匹配。

### 2.3 Base64 变体

- 前端：`base64url`（`-`/`_` 替换 `+`/`/`，无 `=` 填充）
- Go：`base64.RawURLEncoding`（无填充，与前端对齐）

无填充变体避免 URL 中 `=` 被额外编码的歧义。

---

## 三、实施

### 3.1 前端改动

| 文件 | 改动 |
|------|------|
| `frontend/src/core/fileservice.ts` | 新增 `encodeFileRef(fileName)` 公共函数；`resolveFileUrl` 改用 `?f=` |
| `frontend/src/outfit/outfit-overlay.ts` | `_encodePath` 替换为 `encodeFileRef`（仅单文件名，不再需要路径分段编码） |
| `frontend/src/scene/motion/vmd-loader.ts` | `_tryLoadCompanionAudio` 的 `baseUrl + encodeURIComponent(audioName)` 改用 `?f=` |

### 3.2 Go 改动

`internal/app/zipextract.go` 的 `basenameFallbackFS` HandlerFunc 顶部新增查询参数路由：

```go
return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    // 1. 优先处理查询参数 ?f=<base64url>
    if enc := r.URL.Query().Get("f"); enc != "" {
        if decoded, err := base64.RawURLEncoding.DecodeString(enc); err == nil {
            reqBase := strings.ToLower(string(decoded))
            if relPath, ok := index[reqBase]; ok {
                http.ServeFile(w, r, filepath.Join(root, relPath))
                return
            }
            // ?f= 未命中 → 直接 404，不兜底（避免歧义）
            http.NotFound(w, r)
            return
        }
    }
    // 2. 兜底：走原路径段 + basename fallback（向后兼容旧 URL）
    // ... 原有逻辑
})
```

### 3.3 关键技术点

- `basenameFallbackFS` 是 `http.Handler`，不是 `http.FileSystem`。查询参数在 `r.URL.RawQuery`，`http.FileServer` 内部只用 `r.URL.Path` 查文件，**忽略查询参数**。所以拦截必须在 `HandlerFunc` 顶部，先于 `fs.ServeHTTP`。
- `?f=` 命中后 `return`，不走 `fs.ServeHTTP`；未命中走原逻辑保持兼容。
- 新增 `encoding/base64` import。

### 3.4 兼容性

- 旧 URL（路径段）仍能工作（兜底逻辑保留）
- 新 URL（查询参数）优先匹配，未命中直接 404（避免与路径段兜底产生歧义）
- 场景序列化存的是 `filePath`，不是 URL，无迁移负担

---

## 四、不在范围

- **链路 B（纹理路径乱码）**：已由 [ADR-058](adr-058-basenameFallbackFS.md) 解决，通过损坏字符串映射实现字节级匹配。

---

## 五、验证

- 用 Shift-JIS 文件名的 PMX/VMD/音频测试加载
- 用含 U+FFFD 的文件名测试 URL 构造与 Go 路由
- `npm run check && npm run test`
- `go build ./...`

---

## 六、相关

- [ADR-054](adr-054-roadmap-next.md) — 路线图（列出本项为 P0）
- [ADR-006](adr-006-scan-and-encoding.md) — 文件名多编码自动检测（Go 侧 `bestDecode`/`cleanModelName`，与本 ADR 互补）
- ADR-058（待创建）— 纹理路径字节级匹配（链路 B）
