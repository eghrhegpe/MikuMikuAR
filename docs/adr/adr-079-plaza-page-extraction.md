# ADR-079: 模型广场 · 页面语义提取（结构化数据）

> **状态**: 提案
> **关联**: ADR-075（模型广场基础架构）、ADR-078（下载拦截）
> **来源**: 2026-07-09 广场增强讨论

---

## 背景

内嵌 iframe 体验受限于目标站的前端实现：加载慢、交互卡顿、无法与应用内功能联动（如直接预览模型、查看材质信息）。部分目标站有公开 API 或结构化 HTML，可提取为原生列表。

---

## 决策

在代理层增加 **语义提取**能力：代理拿到响应后，解析 HTML/JSON 提取结构化数据，返回给前端渲染原生 UI。

### 架构

```
Go 代理
  ├─ 透明模式：当前行为，透传 HTML 给 iframe
  └─ 提取模式：解析响应 → 返回结构化 JSON

前端
  ├─ iframe 模式：现有行为
  └─ 列表模式：原生渲染提取的数据
```

### 提取规则（按站点配置）

```go
type ExtractionRule struct {
    SitePattern string            // URL 正则，如 `pixiv.net/artworks/`
    Selector    string            // CSS 选择器（HTML）或 JSONPath
    Fields      map[string]string // 字段映射：{ "name": ".title", "thumbnail": "img[src]", "downloadUrl": "a[href]" }
}
```

### 首批目标

| 站点 | 提取内容 | 数据源 |
|------|---------|--------|
| Pixiv 作品页 | 标题 / 作者 / 缩略图 / PMX 下载链接 | HTML meta + 结构化 data |
| Booth 商品页 | 商品名 / 价格 / 预览图 / 下载链接 | HTML + JSON-LD |
| 模之屋帖子 | 模型名 / 截图 / 附件链接 | HTML + 附件列表 |

### 前端渲染

提取结果通过 `postMessage` 发送到父窗口，前端用 `ResourcePanel` 组件（已有虚拟滚动）渲染卡片列表，每个卡片含：

```
┌─────────────────────────┐
│ [缩略图]                │
│ 模型名                  │
│ 作者 · 标签             │
│ [预览] [下载] [在浏览器打开] │
└─────────────────────────┘
```

点击「下载」走 ADR-078 的 `DownloadFromPlaza` 链路。

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `internal/app/proxy.go` | `ExtractPage(url, rule) (PlazaItem, error)` |
| `internal/app/proxy_extract.go` | 提取规则引擎 + 站点解析器 |
| `frontend/src/menus/plaza.ts` | 双模式切换（iframe / 列表） |
| `frontend/src/menus/plaza-items.ts` | 卡片列表渲染 |

---

## 风险

- **站点改版**：选择器失效 → 提取规则需维护，可配置化降低耦合
- **反爬**：频繁请求可能触发风控 → 代理层加限速（1 req/s per site）
- **覆盖率**：并非所有页面都有结构化数据 → 降级回 iframe 模式
