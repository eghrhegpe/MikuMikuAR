# ADR-184: 网页端 ZIP 嵌套识别能力补齐（多编码检测 + 炸弹防护对齐 Go 端）

> **状态**: 已完成
> **日期**: 2026-07-26
> **关联**: ADR-006（Go 端扫描简化 + 文件名多编码自动检测 —— 本 ADR 是其 Web 端落地）、ADR-176（前端 Backend 适配器双实现）、ADR-177（Web Loader 与主应用统一路径）、ADR-182（Web 端 ZIP 导入键规约命名空间化）

## 背景

ADR-006 为 Go 端确立了 zip 条目名多编码检测（`bestDecode`，SJIS/GBK/Big5 评分）与 ZIP 炸弹防护（`expandZipEntries` 三道阈值：500MB 文件大小 / 10000 条目数 / 2GB 总未压缩大小）。

ADR-176/177 为 Web 端建立了 `BackendService` 双实现，`_scanDirIntoIDB`（FSA 目录扫描）与 `ExtractZip`（按需解压）均用 JSZip 展开 zip。但 Web 端实现存在两个缺陷：

### 缺陷 1：条目名按 UTF-8 硬解码 → 嵌套识别失败

`JSZip.loadAsync(bytes)` 未传 `decodeFileName` 选项，JSZip 默认按 UTF-8 解码非 UTF-8 条目名。MMD 圈**部分/历史上** zip 条目名可能用 Shift-JIS（日文）或 GBK（中文 Windows）编码（zip 规范未强制 UTF-8）；**但本仓库实测的两个 CJK 模型 zip（【阿卡夏之眼】/【少女前线2】）内部条目名均为纯 ASCII，无高位字节，不存在 Shift-JIS/GBK 条目名乱码**——非 UTF-8 编码 zip 在本仓库无真实素材佐证。UTF-8 硬解码后：

1. 条目名出现 `U+FFFD` 替换字符或乱码字节
2. `.pmx` 扩展名字节被破坏
3. `INNER_RE = /\.(pmx|vmd|...)$/i` 正则匹配失败
4. `innerFiles` 为空 → 走 else 分支作为整体 entry 保留（`format: 'zip'`、`zip_inner: ''`）
5. UI 层显示为空文件夹，点击无内容

**表现（实测校正 · 2026-07-27）**：本仓库 `text-model/PMX/分类1/` 下真实模型 zip（【阿卡夏之眼】/【少女前线2】）经剥包核验，内部条目名**全部为纯 ASCII**（如 `data/xxx.png`、`normalmap/c_Nikketa...png`），`utf8_flag=False` 但无高位字节——**不存在 Shift-JIS/GBK 条目名乱码**。故原"用户截图空文件夹"复现叙事**不成立**：这两个 zip 在修复前后均能正常展开（ASCII 经 UTF-8 解码保持不变）。本 ADR 的多编码检测属**防御性增强**（行业确有非 UTF-8 条目名 zip），其必要性由下方"缺陷 2 炸弹防护"与"缺陷 3 扫描/解压期解码一致性"两条**真实收益**支撑，而非由本仓库具体复现佐证。实测脚本：`scripts/probe-zip-encoding.py`。

### 缺陷 2：无 ZIP 炸弹防护

Go 端 `expandZipEntries`（`library.go:139-186`）有三道防护：文件大小预判、条目数上限、总未压缩大小上限。Web 端 `_scanDirIntoIDB` 直接 `JSZip.loadAsync(bytes)` 把整个 zip 读入内存，恶意/损坏大 zip 可致 OOM。

### 缺陷 3：扫描期与解压期解码不一致

`ExtractZip`（`browser-adapter.ts` 按需解压）同样未传 `decodeFileName`。扫描期乱码的条目名与解压期乱码的条目名**可能不同**（JSZip 内部 fallback 路径差异），导致 `n === _inner_path` 比较失败 → 找不到用户点击的目标 pmx。

## 决策

**完全对齐 Go 端 `bestDecode` 评分逻辑与 `expandZipEntries` 三道防护阈值，用浏览器原生 `TextDecoder` 实现 Web 端版本。**

### 1. `bestDecodeZipName(bytes: Uint8Array): string`

对齐 Go 端 `bestDecode`（`zipextract.go:428-496`）的评分机制：

| 维度 | Go 端 | Web 端 |
|------|-------|--------|
| 编码尝试 | Shift-JIS / GBK / Big5（`transform.String`） | `'shift_jis' / 'gbk' / 'big5'`（`new TextDecoder(enc, { fatal: false })`） |
| 无错奖励 | `err == nil` → +10 | 无 `U+FFFD` → +10 |
| SJIS 偏置 | +3（MMD 主流编码） | +3 |
| CJK 汉字 | `0x4E00-0x9FFF` → +2 | 同 |
| 假名 | `0x3040-0x30FF` → +1 | 同 |
| CJK 标点 | `0x3000-0x303F` → +1 | 同 |
| 全角/半角 | `0xFF00-0xFFEF` → -1 | 同 |
| 替换字符 | `RuneError` → -5 | `U+FFFD` → -5 |

选评分最高者返回；全编码失败兜底 UTF-8。

### 2. 扫描期 `_scanDirIntoIDB` 的 zip 分支

```ts
// 防护 1：文件大小预判
if (bytes.byteLength > MAX_ZIP_FILE_SIZE) continue;
// 传入 decodeFileName
const zip = await JSZip.loadAsync(bytes, { decodeFileName: bestDecodeZipName });
// 防护 2：条目数
if (allEntries.length > MAX_ZIP_ENTRY_COUNT) continue;
// 防护 3：总未压缩大小（JSZip 内部字段 _data.uncompressedSize）
if (totalUncompressed > MAX_ZIP_TOTAL_BYTES) continue;
```

### 3. 解压期 `ExtractZip` 同步传入

```ts
const zip = await JSZip.loadAsync(buf, { decodeFileName: bestDecodeZipName });
```

保证扫描期写入的 `zip_inner` 与解压期 `n === _inner_path` 比较两端解码一致。

### 4. 阈值常量对齐 Go 端

```ts
const MAX_ZIP_FILE_SIZE = 500 * 1024 * 1024;      // 对齐 maxZipEntryFileSize
const MAX_ZIP_ENTRY_COUNT = 10000;                 // 对齐 maxZipEntryCount
const MAX_ZIP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 对齐 maxZipTotalBytes
```

## 影响面

| 文件:函数 | 改动 | 风险 |
|-----------|------|------|
| `browser-adapter.ts` `bestDecodeZipName`（新增） | SJIS/GBK/Big5 评分检测，对齐 Go `bestDecode` | 🟢 纯新增函数，无副作用 |
| `browser-adapter.ts` `MAX_ZIP_*` 常量（新增） | 三道防护阈值 | 🟢 纯新增常量 |
| `browser-adapter.ts` `_scanDirIntoIDB` zip 分支 | 加三道防护 + 传 `decodeFileName` | 🟡 之前展开失败的 zip 现在能展开，entry 数量可能增加（预期行为） |
| `browser-adapter.ts` `ExtractZip` | 传 `decodeFileName` | 🟢 解码一致性增强，`n === _inner_path` 比更可靠 |

### 不在本 ADR 范围

- **Go 端 `cleanModelName`**（修复 Windows 已损坏 Unicode 文件名）：Web 端 FSA 返回的文件名已是合法 Unicode，无需对齐。
- **Go 端 `isGarbageModelName`**（识别使用条款写在 name_jp 的反模式）：Web 端扫描期不解析 PMX header，无 name_jp 字段，无需对齐。
- **Go 端 `basenameFallbackFS` 的 `corruptIndex`**（ADR-058，babylon-mmd 错误解码纹理路径兜底）：Web 端纹理加载链路不同（Blob URL vs HTTP FileServer），不适用。
- **Web 端目录监听**（`watchDir: false`）：FSA 无监听能力，属于 ADR-176 能力降级，与本 ADR 无关。

## 回归策略

- 既有 80 个 `browser-adapter.test.ts` + `backend.test.ts` 测试全通过（含 ADR-182 的 zip 命名空间用例）
- 全量 `vitest run` 2057 个测试通过
- `tsc --noEmit` 类型检查通过

编码检测的核心评分逻辑对齐 Go 端 `bestDecode`（Go 端已有测试覆盖），Web 端 `bestDecodeZipName` 的正确性由"与 Go 端评分一致"保证。

## 向后兼容

- **UTF-8 编码的 zip**：行为不变。`bestDecodeZipName` 对 UTF-8 合法字节流，三种编码解码都会产生 `U+FFFD` 或低分结果，最终兜底 UTF-8 解码（与 JSZip 默认行为一致）。
- **非 UTF-8 编码的 zip（行业真实存在，本仓库无素材）**：理论上之前会因 UTF-8 硬解码而展开失败（显示空文件夹），修复后正确展开。本仓库实测的 CJK 模型 zip 内部条目名均为 ASCII，不触发此路径；该分支属**防御性修复**。
- **IndexedDB 键**：无变化。`entry:` 键的 `zip_inner` 字段从乱码变为正确解码后的条目名，但键名本身是 `${relIdStem}__${innerPath.replace(...)}`
  ，`relIdStem` 不依赖 zip 内条目名，`innerPath` 变化只影响 entry 内容不影响键碰撞。
