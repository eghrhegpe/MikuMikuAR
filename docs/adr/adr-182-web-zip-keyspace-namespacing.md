# ADR-182: 网页端 ZIP 导入键规约命名空间化（消除同名 PMX 纹理碰撞）

> **状态**: 已批准
> **日期**: 2026-07-25
> **关联**: ADR-176（前端 Backend 适配器双实现）、ADR-177（Web Loader 与主应用统一路径 —— 确立 `file:`/`entry:`/`dir:`/`outfit:` 键规约地基）、ADR-180（FSA 句柄持久化）
> **前置**: 2026-07-25 上轮已修 `_scanDirIntoIDB`（FSA 目录扫描）纹理键碰撞（引入 `_encModelStem` + `IsolateModelDir` 编码 stem），见 `docs/buglog/2026-07-25-web-texture-stem-collision.md`。本 ADR 处理该修复未覆盖的 **ZIP 解压路径** 残留碰撞。

## 背景

ADR-177 为网页端确立的 IndexedDB 键规约以「stem 全局唯一」为**隐含地基假设**：

| 键 | 语义 | stem 来源 |
|----|------|-----------|
| `file:<stem>` | 资源字节（扁平存，`readFileBytes` 绝对路径兜底） | 文件名去扩展名 |
| `entry:<stem>` | 模型元数据（`_listModels` 列举） | 同上 |
| `dir:<stem>:<relPath>` | 归属某 PMX 的纹理组（`ListDirRecursive` 扫描） | 主 PMX 文件名 |
| `outfit:<stem>` | 伴生换装配置 | 主 PMX 文件名 |

上轮修复利用 `_classifyPath` 的 `web://model/([^/?#]+)` 正则（stem 限定单 token），把带路径的 stem 经 `encodeURIComponent` 编码为单 token（`A/miku` → `A%2Fmiku`），使 FSA 目录扫描路径的纹理键互不碰撞。

**但 ZIP 解压路径（`ExtractZip`）未被覆盖**，根本区别在于：

| 维度 | FSA 目录扫描（已修） | ZIP 解压（本 ADR） |
|------|---------------------|---------------------|
| stem 天然维度 | 有：扫描时路径带真实目录（`A/miku`），加载时 `IsolateModelDir` 能从相对路径还原 | **无**：`ExtractZip` 用 zip 内 PMX 裸文件名（`miku`），返回裸 `miku.pmx` 作加载路径 |
| 碰撞表现 | 已消除 | **两个不同 zip 内同名 `miku.pmx` → `dir:miku:tex/face.png` 互相覆盖 → 加载 A 却贴 B 的纹理，静默错渲染** |

`ExtractZip`（`browser-adapter.ts:826-897`）写 `file:${stem}`（:874）、`dir:${mainPmxStem}:${relPath}`（:877）、`outfit:${mainPmxStem}`（:883），三处 stem 均为裸文件名；返回 `file_path: mainPmxName`（裸 `miku.pmx`）。裸 `miku.pmx` 经 `_classifyPath` 落 `absolute` 分支（:211），`_baseName` 会**吃掉任何路径前缀**——因此无法靠"返回带前缀路径"简单修复。

## 决策

**给 ZIP 导入的键引入 `zipStem/pmxStem` 命名空间，全链路经 `_encModelStem` 编码为单 token。** zip 文件名（`zipStem`）作为天然来源标识，使不同 zip 内同名 PMX 的键互不碰撞。

### 键规约（新旧对照）

| 键 | 旧（裸 stem） | 新（命名空间编码） |
|----|--------------|---------------------|
| PMX 字节 | `file:miku` | `file:<enc(zipStem/miku)>`（如 `file:packA%2Fmiku`） |
| 纹理组 | `dir:miku:tex/face.png` | `dir:<enc(zipStem/miku)>:tex/face.png` |
| 换装配置 | `outfit:miku` | `outfit:<enc(zipStem/miku)>` |
| 返回加载路径 | `file_path: 'miku.pmx'` | `file_path: 'web://model/<enc(zipStem/miku)>'` |

- `enc = encodeURIComponent`，`/` → `%2F`，使 `zipStem/miku` 成为 `web://model/<token>` 的合法单 token。
- 返回 `web://model/<enc>` 形式（而非裸 `miku.pmx`）绕开 `absolute` 分支的 `_baseName` 吞前缀问题。
- **纹理的独立扁平键 `file:<纹理裸stem>` 保留**（向后兼容 + 跨模型兜底）；纹理主读路径是 `dir:` 组（已隔离），`file:` 仅在 `dir:` 未命中时兜底，退化影响可接受。

### 加载链路自洽性验证

`ExtractZip` 返回 `file_path: 'web://model/packA%2Fmiku'`，下游：

1. **PMX 字节**：`readFileBytes('web://model/packA%2Fmiku')` → `_resolveIdbKey` model-stem 分支原样 → idbGet miss → **兜底2**（:763-767）`_baseName` = `packA%2Fmiku`（enc 后无 `/`）→ `file:packA%2Fmiku` **命中** ✓
2. **虚拟目录**：`IsolateModelDir('web://model/packA%2Fmiku')` → **须幂等**（见下）→ `web://model/packA%2Fmiku` ✓
3. **纹理**：babylon 拼 `web://model/packA%2Fmiku/tex/face.png` → `_resolveIdbKey` model-dir，stem=`packA%2Fmiku`，rest=`tex/face.png` → `dir:packA%2Fmiku:tex/face.png` **命中** ✓
4. **换装**：`LoadOutfitFile` 经 `_extractStem` → `packA%2Fmiku` → `outfit:packA%2Fmiku` ✓

### 配套修复：`IsolateModelDir` 幂等

`IsolateModelDir`（:1319-1325）当前对已编码输入 `web://model/A%2Fmiku` 会 `_extractStem`（得 `A%2Fmiku`）后再 `_encModelStem` → **双重编码** `A%252Fmiku`，导致 `ListDirRecursive` 扫 `dir:A%252Fmiku:` 与写入的 `dir:A%2Fmiku:` 失配。

**修法**：输入已是 `web://model/<stem>`（model-stem，无 rest）时直接原样返回，仅对裸/绝对路径编码。使函数幂等，兼容"上游已给 `web://model/` 加载路径"的新 ZIP 路径。

## 影响面

| 文件:函数 | 改动 | 风险 |
|-----------|------|------|
| `browser-adapter.ts` `ExtractZip` | mainPmxStem → `zipStem/pmxStem` 命名空间；`file:`/`dir:`/`outfit:` 键编码；返回 `web://model/<enc>` | 🟡 改返回契约，但消费方（drop-import/library-actions/scene-bundle）只透传给 loadManager，`getBaseName` UI 反馈仍取到 `miku.pmx` 语义无碍 |
| `browser-adapter.ts` `IsolateModelDir` | 幂等化 | 🟢 纯健壮性增强，裸路径行为不变 |
| `readFileBytes` / `ListDirRecursive` / `_resolveIdbKey` | 无需改，兜底2 + model-dir/model-stem 已自洽 | 🟢 |

### 不在本 ADR 范围（已知限制）

**FSA 多文件选择（`_writeModelWithTextures:352`）** 无天然来源标识——用户一批多选的 handle 无目录信息（FSA 安全限制），加载 filePath 是裸名，系统无处记录"哪批选择"。强行命名空间化会使 `IsolateModelDir` 从裸 filePath 推不出前缀而失配。且该路径的 `entry` 未写 `dir`/`file_path` 字段，会被 `_listModels:269` 守卫过滤，本身即半成品。故 FSA 多选同名碰撞记为**已知限制**，待其 entry 链路完善后单独评估（建议方向：导入期同名 `entry` 冲突检测 + 序号后缀）。

**同名 ZIP 文件名（补充已知限制）** `nsStem` 来源为 zip **文件名**（`_extractStem(zipPath)` 裸名，见 `ExtractZip:864`），不同目录下的同名 zip（如 `A/MikuPack.zip` 与 `B/MikuPack.zip`）在 `nsStem` 维度仍会撞车。该撞车与既有 `file:<zipStem>` 裸名存储同源——zip 层即已无目录维度——**非本 ADR 引入的回归**，记已知限制。彻底消除需引入"导入批次 ID"作为额外命名空间维度，超出本 ADR 地基级修复范围，留待后续评估。

## 回归策略

新增 `browser-adapter.test.ts` 用例：
1. 两个不同 zip（`packA.zip`/`packB.zip`）内同名 `miku.pmx` + 同名 `tex/face.png`，解压后纹理键 `dir:packA%2Fmiku:...` 与 `dir:packB%2Fmiku:...` 互不碰撞，各自 `readFileBytes` 取回**正确**字节。
2. `ExtractZip` 返回 `file_path` 可经 `readFileBytes` 读回 PMX 字节（兜底2 路径）。
3. `IsolateModelDir` 幂等：`web://model/packA%2Fmiku` 输入不双重编码。
4. 根级裸名 zip（无子目录）向后兼容：`zipStem/pmxStem` 编码后仍能正确读写。

全量 `tsc --noEmit` + `vitest run` 确认无回归。

## 向后兼容

- 旧数据（`dir:miku:...` 裸键）在库中仍可读——`ListDirRecursive` 第一轮精确前缀 + 第二轮 bare stem fallback 覆盖；新导入才走命名空间键。无破坏性迁移。
- 根级模型（zip 内 PMX 在根目录）：`zipStem/pmxStem` 仍编码，键形态从 `dir:miku:` 变为 `dir:packA%2Fmiku:`，但读写同源自洽，加载正确。
