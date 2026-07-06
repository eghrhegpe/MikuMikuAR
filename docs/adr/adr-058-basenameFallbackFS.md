# ADR-058: 纹理路径字节级匹配 —— basenameFallbackFS 多编码兜底

> **状态**: 已实施（2026-07-06）
> **关联**: [ADR-057](adr-057-shift-jis-url-base64.md)（主文件 URL 编码，已实施）
> **背景**: ADR-057 解决了主 PMX/VMD 文件 URL 的 Shift-JIS 乱码，但纹理路径仍存在独立问题。本 ADR 单独锁定纹理路径链路的解决方案。

---

## 一、问题边界

### 1.1 链路 B 的根因

| 层 | 行为 | 结果 |
|----|------|------|
| PMX 内部 | 纹理路径用 Shift-JIS 存储（如 `肌.png` → `0x8B 0x96 0x2E 0x70 0x6E 0x67`） | 原始字节是 Shift-JIS |
| babylon-mmd | 按 **UTF-8** 解码这些字节 | 每个无效字节 → `U+FFFD`，`"肌.png"` → `"\uFFFD\uFFFD.png"` |
| 浏览器 | 自动 URL 编码 | `%EF%BF%BD%EF%BF%BD.png` |
| Go 侧 | `url.PathUnescape` 还原 | `"\uFFFD\uFFFD.png"` |
| basenameFallbackFS | 查 index（`d.Name()` = `"肌.png"`） | **不匹配 → 404** |

### 1.2 与 ADR-057 的关系

| 链路 | ADR | 可控性 | 状态 |
|------|-----|--------|------|
| A. 主文件 URL | ADR-057 | ✅ 前端完全可控 | 已实施 |
| **B. 纹理 URL** | **本 ADR** | ❌ 不走 `resolveFileUrl` | 待实施 |

本 ADR 是 ADR-057 的**自然延伸**，解决同类问题的不同链路。

---

## 二、方案设计

### 2.1 核心思路：损坏字符串映射

扫描目录时，对每个文件名预先计算「被 babylon-mmd 错误解码后的样子」，建立**损坏字符串 → 正确 relPath** 的映射。请求到达时，直接查这张表。

```
扫描时：
  正确文件名:  "肌.png"（UTF-8）
  ─────────────────────────────────────────────
  1. 编码为 Shift-JIS:     8B 96 2E 70 6E 67
  2. 按 UTF-8 解码 → 损坏: "\uFFFD\uFFFD.png"
  3. 建立映射: "\uFFFD\uFFFD.png" → "肌.png"

请求时：
  URL: .../%EF%BF%BD%EF%BF%BD.png
  PathUnescape → "\uFFFD\uFFFD.png"
  查损坏映射 → 命中 "肌.png"
```

### 2.2 多编码扩展

| 编码 | 适用场景 | 优先级 |
|------|---------|--------|
| **Shift-JIS** | 日文 PMX（主流） | P0 |
| **GBK** | 中文 PMX | P1 |
| **UTF-8** | 已经是 UTF-8 的文件名（标准匹配，现有逻辑） | P0 |

按优先级顺序尝试，命中即返回。

### 2.3 与现有 basenameFallbackFS 的集成点

`basenameFallbackFS` 当前：
- `index`：`basenameLower → relPath`（标准匹配）
- `fallbackOpen`：标准匹配失败后走 basename fallback

**本 ADR 新增**：
- `corruptIndex`：`corruptString → relPath`（损坏匹配）
- 在 `fallbackOpen` 中，标准匹配失败后、404 之前插入损坏匹配

```
请求到达
  ├─ 1. 标准 basename 匹配（现有）
  ├─ 2. 损坏映射匹配（本 ADR 新增） ← Shift-JIS / GBK 尝试
  ├─ 3. 原始路径直读（现有）
  └─ 4. 404
```

---

## 三、详细实现

### 3.1 架构形态说明

现有 `basenameFallbackFS` 是**函数 + 闭包**结构，不改为 struct。`index`、`corruptIndex`、`root`、`fs` 均为闭包变量，改动更小、风险更低。

### 3.2 扫描阶段（`basenameFallbackFS` 增强）

```go
func basenameFallbackFS(root string, logFn func(string, ...interface{})) http.Handler {
    index := make(map[string]string)
    corruptIndex := make(map[string]string)  // [doc:adr-058] 新增：损坏字符串 → relPath

    fileAccessor.WalkDir(root, func(walkPath string, d os.DirEntry, err error) error {
        if err != nil || d.IsDir() {
            return nil
        }
        rel, _ := filepath.Rel(root, walkPath)
        base := strings.ToLower(d.Name())
        if _, exists := index[base]; !exists {
            index[base] = rel
        }

        // [doc:adr-058] 预计算损坏字符串：模拟 babylon-mmd 将 Shift-JIS/GBK 按 UTF-8 错误解码
        for _, enc := range []encoding.Encoding{japanese.ShiftJIS, simplifiedchinese.GBK} {
            if corrupt := toCorruptString(base, enc); corrupt != "" && corrupt != base {
                if _, exists := corruptIndex[corrupt]; !exists {
                    corruptIndex[corrupt] = rel
                }
            }
        }
        return nil
    })
    // ... HandlerFunc 中插入损坏匹配
}
```

### 3.3 `toCorruptString`：模拟真实 UTF-8 解码行为

```go
func toCorruptString(s string, enc encoding.Encoding) string {
    // 1. UTF-8 → 目标编码（Shift-JIS/GBK）
    encoded, err := enc.NewEncoder().Bytes([]byte(s))
    if err != nil {
        return ""
    }
    // 2. 目标编码字节 → 按 UTF-8 解码（模拟 babylon-mmd 的错误解码）
    // 使用 utf8.DecodeRune 模拟真实 UTF-8 解码器行为
    var result strings.Builder
    i := 0
    for i < len(encoded) {
        r, size := utf8.DecodeRune(encoded[i:])
        if r == utf8.RuneError {
            // UTF-8 解码失败 → U+FFFD（替换字符）
            result.WriteRune('\uFFFD')
            i++
        } else {
            result.WriteRune(r)
            i += size
        }
    }
    return result.String()
}
```

**关键设计**：用 `utf8.DecodeRune` 而非简单逐字节判断。Shift-JIS 双字节（如 `0x8B 0x96`）作为 UTF-8 解码时，`0x8B` 不是合法起始字节 → `RuneError` → U+FFFD；`0x96` 同理 → U+FFFD。结果正确且符合真实解码器行为。

### 3.4 请求阶段（路径段 fallback 增强）

在**路径段 fallback**（第 624-650 行）中，标准 basename 匹配失败后、404 之前插入损坏匹配：

```go
// 404 — try basename fallback
decodedPath := r.URL.Path
if unescaped, err := url.PathUnescape(decodedPath); err == nil {
    decodedPath = unescaped
}
reqBase := strings.ToLower(path.Base(decodedPath))
relPath, ok := index[reqBase]

// [doc:adr-058] 标准匹配失败 → 尝试损坏映射匹配
if !ok {
    if relPath, ok = corruptIndex[reqBase]; ok {
        if logFn != nil {
            logFn("FS: corrupt match %q → %s", reqBase, relPath)
        }
    }
}

if !ok {
    bw.flush()
    if logFn != nil {
        logFn("FS: basename %q not found in index either", reqBase)
    }
    return
}
```

### 3.5 与 ADR-057 查询参数的关系

| 路由 | 损坏匹配 | 原因 |
|------|---------|------|
| `?f=` 查询参数（ADR-057） | 否 | 纹理 URL 不走 `resolveFileUrl`，由 babylon-mmd 内部 fetch |
| 路径段 fallback（本 ADR） | 是 | 纹理 URL 走路径段，需要损坏匹配 |

**损坏映射仅在路径段 fallback 中触发**，`?f=` 路由保持不变（未命中直接 404）。

### 3.6 Import 依赖

`golang.org/x/text/encoding/japanese` 和 `simplifiedchinese` 已在 `zipextract.go` 中 import（ADR-006 遗留），无需新增。

### 3.7 内存与性能考量

| 指标 | 估算 | 说明 |
|------|------|------|
| 额外索引条目 | = 文件数 × 编码数 | 假设 1000 个纹理，Shift-JIS + GBK → 2000 条额外条目 |
| 每条内存 | ~100B（key + value） | ~200KB 额外内存，可忽略 |
| 扫描开销 | 每文件 O(1) 编码 | 启动时一次性，与文件数线性 |
| 请求开销 | O(1) map 查找 | 无额外性能影响 |

---

## 四、决策对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 损坏映射（本 ADR）** | 扫描时建立损坏→正确映射 | 纯 Go 侧，不依赖 fork，O(1) 匹配 | 需假设 babylon-mmd 的错误解码行为 |
| B. 上游 PR babylon-mmd | 修正 PMX 纹理路径解码为 Shift-JIS | 根源解决 | 需维护 fork，时间线不可控 |
| C. 前端纹理拦截 | 在 Babylon.js 加载纹理前重写 URL | 前端可控 | 需深入 Babylon.js 纹理加载 hook，复杂度高 |

**选 A**：与 ADR-057 同层（Go 侧兜底），工程边界清晰，不引入外部依赖风险，匹配 O(1) 对性能无影响。

---

## 五、实施路标

### Phase 1: 核心实现（~1h）

- [ ] `internal/app/zipextract.go`: 在 `basenameFallbackFS` 中增加 `corruptIndex` 字段
- [ ] 增加 `toCorruptString` 方法，支持 Shift-JIS + GBK
- [ ] 修改 `scan()`，建立损坏映射
- [ ] 修改 `fallbackOpen()`，在标准匹配后插入损坏匹配
- [ ] 添加 `golang.org/x/text/encoding` 依赖

### Phase 2: 测试（~0.5h）

- [ ] 单元测试：`toCorruptString` 的编码转换正确性
- [ ] 单元测试：损坏匹配在含 U+FFFD 的请求路径上命中
- [ ] 单元测试：多编码优先级（Shift-JIS → GBK）
- [ ] 端到端：加载含 Shift-JIS 纹理路径的 PMX，纹理正常显示

### Phase 3: 文档闭环

- [ ] 本 ADR 状态改为「已实施」
- [ ] [ADR-054](adr-054-roadmap-next.md) §二「Shift-JIS URL 编码」项拆分为「ADR-057 已实施；ADR-058 已实施」
- [ ] [ADR-057](adr-057-shift-jis-url-base64.md) §「Phase 2 方向建议」更新为「ADR-058 已实施」

---

## 六、风险与边界

| 风险 | 等级 | 缓解 |
|------|------|------|
| babylon-mmd 实际解码行为与假设不符（按 UTF-16LE 而非 UTF-8） | 中 | Phase 2 测试验证；若不符，调整 `toCorruptString` 逻辑 |
| 文件名含 Shift-JIS 无法编码的字符 | 低 | 跳过该文件的损坏索引，标准匹配仍可工作 |
| 损坏映射误命中（不同文件名产生相同损坏字符串） | 低 | 概率极低；若发生，标准匹配优先且哈希冲突忽略 |
| `golang.org/x/text` 包增加二进制体积 | 低 | ~2MB，可接受 |
| 性能：扫描时编码所有文件 | 低 | 与文件数线性，启动时一次性，与 ADR-057 的 basename 扫描同量级 |

### 边界

- 本 ADR **不修改** babylon-mmd 源码
- 本 ADR **不涉及** 主 PMX/VMD 文件 URL（已由 ADR-057 解决）
- 本 ADR **不涉及** 查询参数路由（已由 ADR-057 解决）
- 仅处理 **纹理路径**（babylon-mmd 内部 fetch），不处理其他资源类型

---

## 七、验证方式

1. **准备测试 PMX**：纹理路径为 Shift-JIS 编码（如 `肌.png`），模型目录包含该纹理
2. **加载 PMX**：观察纹理是否正常显示（而非全白）
3. **检查日志**：`basenameFallbackFS` 应输出损坏匹配命中的日志（可选，debug 级别）
4. **对比**：与 ADR-057 修复前（404）和修复后（本 ADR）的行为

---

## 八、相关 ADR

- [ADR-057](adr-057-shift-jis-url-base64.md) — 主文件 URL 编码（本 ADR 的前置，已实施）
- [ADR-006](adr-006-scan-and-encoding.md) — Go 侧文件名多编码自动检测（本 ADR 复用了 `golang.org/x/text` 的思路）
