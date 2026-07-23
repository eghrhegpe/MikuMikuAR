# ADR-006: 扫描简化 + 文件名多编码自动检测

> **日期**: 2026-07-16
> **状态**: 已完成 — bestDecode/cleanModelName + modelMetaCache 全链路上线

---

## 背景

扫描模型库时，`scanDirRecursive` 对每个 `.pmx` 文件和 zip 内的 `.pmx` 条目都调用了 `ParsePMXHeader`（读取前 2KB 解析 name_jp/name_en/comment）。这引入了不必要的 I/O 和解析失败风险：

- 用户只看文件名就能识别模型，PMX header 元数据绝大多数场景用不到
- PMX 头编码解析（UTF-16LE/UTF-8）对损坏的文件是出错源
- 扫描耗时与 PMX 文件数量成正比，大图书馆（2000+ 模型）明显慢

同时，zip 内部条目的文件名编码只尝试了 Shift-JIS（`decodeZipName`），但大量模型 zip 来自中文 Windows 用户，条目名实际上是 GBK 编码 → 解码后显示半角片假名乱码。

## 决定

### 1. 扫描只取文件名 + 目录结构

`scanDirRecursive` 中：

- `.pmx` 文件：`NameEn = cleanModelName(文件名不含扩展名)`，跳过 `ParsePMXHeader`
- `.vmd` 文件：同上
- zip 内条目：`NameEn = decodeZipName(内部条目名不含扩展名)`，跳过 header 读取

`ParsePMXHeader` / `parsePMXHeaderBytes` 保留为可调用状态，但不扫描时调用。

### 2. 按需解析（on-demand PMX header parsing）

新增 Go binding：

- `GetModelMeta(pmxPath string) → ModelMeta` — 单文件按需解析
- `GetModelMetaBatch(paths []string) → map[string]ModelMeta` — 批量解析

前端新增 `modelMetaCache`（`Map<string, {name_jp, name_en, comment}>`），在以下时机触发按需解析：

- 用户弹出搜索时，对匹配结果发起异步解析
- 用户切换显示优先级到 `name_jp`/`name_en` 时，解析所有 PMX 模型

### 3. zip 条目名多编码自动检测

新增 `bestDecode(raw string) string`：

- 同时尝试 Shift-JIS 和 GBK 解码
- 按 CJK 汉字数加分、半角片假名/RuneError 减分的评分机制
- 选评分最高的解码结果
- 取代原有的 `decodeZipName` 仅尝试 Shift-JIS 的逻辑

新增 `cleanModelName(name string) string`，对 Windows 返回的已损坏 Unicode 文件名：

- 检测半角片假名占比 > 50% → 逆向映射为 Shift-JIS 单字节 → 以 GBK 解码
- 用于 `d.Name()` 返回的普通文件名

### 4. 缓存版本号

`extractCacheVersion` 从 4 → 5，使旧编码下提取的缓存自动失效并重解压。

## 影响

### 正面

- 扫描耗时大幅降低：跳过所有 PMX header I/O，大图书馆从秒级降到亚秒级
- zip 文件名乱码问题基本消除：【卡拉彼丘】伊薇特-转角遇到熊 取代 ｡ｾｿｨﾀｭｱﾋﾇ
- 普通文件名也能修复部分损坏场景（半角片假名占优时）
- 按需解析不影响默认文件名模式，零开销

### 负面

- 搜索 / 切换显示名到 name_jp/name_en 时，需要等待批解析完成（数百个文件 ~1 秒）
- `cleanModelName` 对非 GBK→Shift-JIS 损坏模式的修复有限（如 Big5 编码的文件）

## 涉及文件

| 文件 | 改动 |
|------|------|
| `app.go` | `scanDirRecursive` 移除 ParsePMXHeader；新增 `GetModelMeta`/`GetModelMetaBatch` binding；`decodeZipName` 改为 `bestDecode` 多编码检测；新增 `cleanModelName`；`extractCacheVersion` 4→5 |
| `frontend/src/core/config.ts` | 新增 `modelMetaCache` 全局状态（后拆为 types/state/dom/utils，见 ADR-033） |
| `frontend/src/menus/library.ts` | `modelToRow` 从缓存取元数据；搜索 / 切换显示名时触发按需解析；新增 `ensureModelMeta` |
| `frontend/index.html` | 补回缺失的 `#loading` 和 `#scenePanel` 元素 |
| `frontend/src/app.css` | 新增场景面板样式 |
