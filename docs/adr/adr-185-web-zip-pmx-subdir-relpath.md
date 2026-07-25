# ADR-185: 网页端 ZIP 内子目录 PMX 贴图路径维度对齐

> **状态**: 已完成
> **日期**: 2026-07-26
> **关联**: ADR-177（Web Loader 与主应用统一路径 —— 确立 `file:`/`entry:`/`dir:`/`outfit:` 键规约地基）、ADR-182（Web 端 ZIP 导入键规约命名空间化）、ADR-184（Web 端 ZIP 嵌套识别能力补齐）
> **前置**: 2026-07-25 ADR-182 已消除「不同 zip 同名 PMX 纹理键碰撞」，但其测试用例只覆盖「PMX 在 zip 根目录」，未发现子目录 PMX 场景下的路径维度失配问题。见 `docs/buglog/2026-07-25-web-zip-pmx-subdir-textures.md`。

## 背景

ADR-182 为 ZIP 导入引入 `zipStem/pmxStem` 命名空间 + `_encModelStem` 编码，使不同 zip 内同名 PMX 的 `dir:`/`outfit:` 键互不碰撞。其规约：

| 键 | 形态 | relPath 维度 |
|----|------|--------------|
| `dir:<nsStem>:<relPath>` | 命名空间纹理组 | **未明确**（隐含 zip 内完整路径） |
| `outfit:<nsStem>` | 伴生换装配置 | — |

ADR-184 进一步补齐嵌套识别（zip 内多个 PMX 在不同子目录），让扫描期能正确展开为多个独立 entry。

**但两个 ADR 都未覆盖 PMX 在 zip 子目录时的「路径维度对齐」问题**——这是用户实测「zip 内多个模型加载不出贴图」的根因。

### 缺陷：写入侧与读取侧的 relPath 维度失配

`ExtractZip`（`browser-adapter.ts:885`）写 `dir:` 命名空间纹理键时，`relPath` 取自 zip 内条目名：

```ts
const relPath = name.replace(/\\/g, '/');           // 'char/tex/face.png'
await idbSet('models', `dir:${nsStem}:${relPath}`); // dir:<ns>:char/tex/face.png
```

而读取侧（babylon-mmd 加载 PMX 时拼贴图 URL）：

1. PMX 内嵌贴图相对路径**相对 PMX 文件**（如 `tex/face.png`，不带 PMX 在 zip 内的子目录前缀）
2. `IsolateModelDir(filePath)` 返回 `web://model/<nsStem>`（不带 PMX 子目录前缀）
3. babylon-mmd 拼 `web://model/<nsStem>/tex/face.png`
4. `readFileBytes` 经 `_resolveIdbKey` 映射为 `dir:<nsStem>:tex/face.png`

**写入** `dir:<ns>:char/tex/face.png`，**读取** `dir:<ns>:tex/face.png` —— 维度失配，贴图 miss，模型显示纯色/贴图丢失。

### 多 PMX zip 的命名空间污染

ADR-184 让 zip 内多个 PMX 在不同子目录时各自成为独立 entry，但 `ExtractZip` 加载其中任一 PMX 时仍**无条件**循环写入所有文件的 `dir:<nsStem>:<relPath>` 键。若 zip 内 `A/Miku.pmx` + `B/Miku.pmx` 同时存在：

- 加载 A 时，B 子目录的 `B/tex/face.png` 也被写到 A 的命名空间 `dir:<ns>:B/tex/face.png`
- 加载 B 时，A 子目录的 `A/tex/face.png` 也被写到 B 的命名空间 `dir:<ns>:A/tex/face.png`

`outfit:<ns>` 键同理被其他子目录的 `outfits.json` 覆盖。

### basename fallback 救不了

`collectTextureFiles`（`model-loader.ts:291-302`）的 basename fallback 仅对裸文件名引用（`face.png`）生效，对 PMX 内嵌的带路径引用（`tex/face.png`）无效。修复时不能依赖 basename fallback 兜底，必须保证主键路径维度一致。

## 决策

**记录 PMX 在 zip 内的完整路径，推算子目录前缀 `pmxPrefix`；写 `dir:`/`outfit:` 键时剥掉前缀使 `relPath` 相对 PMX 文件，且仅处理 mainPmx 同子目录下的文件，避免多 PMX 子目录互相污染。**

### 1. 记录 mainPmx 完整路径

第一遍扫描时同时记录 `mainPmxFullPath`（PMX 在 zip 内的完整路径，如 `char/Miku.pmx`），用于推算子目录前缀。

```ts
let mainPmxFullPath = '';
// ...第一遍扫描时 mainPmxFullPath = name.replace(/\\/g, '/');
```

### 2. 推算 pmxPrefix

```ts
const pmxPrefix = mainPmxFullPath.includes('/')
    ? mainPmxFullPath.slice(0, mainPmxFullPath.lastIndexOf('/') + 1)
    : '';
```

- 根目录 PMX（`Miku.pmx`）→ `pmxPrefix = ''`，行为与 ADR-182 完全一致（向后兼容）
- 子目录 PMX（`char/Miku.pmx`）→ `pmxPrefix = 'char/'`

### 3. 写 dir: 键时剥掉前缀 + 限定同子目录

```ts
if (!pmxPrefix || relPath.startsWith(pmxPrefix)) {
    const relToPmx = pmxPrefix ? relPath.slice(pmxPrefix.length) : relPath;
    await idbSet('models', `dir:${nsStem}:${relToPmx}`, bytes);
    if (baseName === mainPmxName) {
        await idbSet('models', `file:${nsStem}`, bytes);
    }
}
// 不属于 mainPmx 子目录的文件（其他 PMX 子目录的贴图）：
// 仅写 file:<裸stem> 扁平键（跨模型兜底），不写 dir: 命名空间键避免污染。
```

### 4. outfit: 同步限定同子目录

```ts
if (baseName.toLowerCase() === 'outfits.json' && nsStem) {
    if (!pmxPrefix || relPath.startsWith(pmxPrefix)) {
        await idbSet('models', `outfit:${nsStem}`, bytes);
    }
}
```

### 5. scene.json 保持原逻辑

`scene.json` 是 zip 级别元数据，与 PMX 子目录无关（一个 zip 一个 scene.json），保持原逻辑全量写 `bundle:<zipStem>`。

### 加载链路自洽性验证

`ExtractZip('MultiPack.zip', 'B/Miku.pmx')` 返回 `file_path: 'web://model/<enc(MultiPack/Miku)>'`：

1. **PMX 字节**：`readFileBytes('web://model/<ns>')` → model-stem 分支原样 → miss → 兜底2 `_baseName = '<ns>'`（enc 后无 `/`）→ `file:<ns>` **命中**（仅 B/Miku.pmx 字节）✓
2. **虚拟目录**：`IsolateModelDir` 幂等返回 `web://model/<ns>` ✓
3. **B 子目录贴图**：babylon-mmd 拼 `web://model/<ns>/tex/face.png` → model-dir 分支 → `dir:<ns>:tex/face.png` **命中**（B/tex/face.png 字节，已剥掉 B/ 前缀）✓
4. **A 子目录贴图不污染**：A/tex/face.png 因 `relPath.startsWith('B/')` 为 false，不写入 `dir:<ns>:...`，仅写 `file:face` 扁平键 ✓
5. **换装配置**：仅 B/outfits.json（若存在）写入 `outfit:<ns>` ✓

## 影响面

| 文件:函数 | 改动 | 风险 |
|-----------|------|------|
| `browser-adapter.ts` `ExtractZip` | 新增 `mainPmxFullPath`/`pmxPrefix`；`dir:`/`outfit:` 键按子目录过滤 + 剥前缀 | 🟡 写入键的 relPath 形态从「zip 内完整路径」变为「相对 PMX 路径」，旧数据若存在子目录 PMX 解压记录需重新解压（用户感知：重新加载一次） |
| `browser-adapter.ts` 其他函数 | 无需改，`_resolveIdbKey`/`IsolateModelDir`/`ListDirRecursive`/`readFileBytes` 透传即可 | 🟢 |
| `model-loader.ts` `collectTextureFiles` | 无需改，basename fallback 保留（仍对裸文件名引用有效） | 🟢 |

### 不在本 ADR 范围

- **PMX 引用其他子目录的贴图**（如 PMX 内嵌 `../shared/tex/face.png` 跨目录引用）：`relPath.startsWith(pmxPrefix)` 过滤会排除这类文件，babylon-mmd 拼接的 `../shared/tex/face.png` 仍 miss。MMD 圈极少出现跨目录引用，记已知限制；如需支持，可在 `pmxPrefix` 同级下也写入 `../shared/` 前缀的键。
- **FSA 多文件选择同名碰撞**：ADR-182 已声明为已知限制（无天然来源标识），本 ADR 不涉及。
- **同名 ZIP 文件名碰撞**：ADR-182 已声明为已知限制，本 ADR 不涉及。

## 回归策略

新增 `backend.test.ts` 4 项测试：

1. **PMX 在 zip 子目录时贴图能被正确读取**：`char/Miku.pmx` + `char/tex/face.png` + `char/tex/body.png`，全链路（IsolateModelDir + ListDirRecursive + readFileBytes）读到正确字节，且不残留旧 bug 形态的 `dir:<ns>:char/tex/face.png` 键。
2. **zip 内多个 PMX 在不同子目录，加载指定 PMX 只读对应子目录贴图**：`A/Miku.pmx` + `B/Miku.pmx`，通过 `innerPath='B/Miku.pmx'` 定位 B，B 的贴图被读、A 的贴图不污染命名空间；反向加载 A 同理。
3. **outfits.json 仅与 PMX 同子目录时写入命名空间**：`char/outfits.json` 写入、`other/outfits.json` 不污染。
4. **innerPath 用反斜杠分隔时同样能定位 PMX**：兼容 Windows `'char\\Miku.pmx'` 调用方。

测试结果：
- `npx vitest run src/core/backend/backend.test.ts`：66 通过（新增 4）
- `npm run check`（tsc --noEmit）：通过
- `npx vitest run` 全量：99 文件 / 2057 测试通过（无回归）

## 向后兼容

- **根目录 PMX**（`pmxPrefix = ''`）：行为与 ADR-182 完全一致。`!pmxPrefix || relPath.startsWith(pmxPrefix)` 短路为 true，`relToPmx = relPath`，键形态 `dir:<ns>:tex/face.png` 不变。
- **子目录 PMX**：之前贴图读不到（bug 形态），修复后能正确读取。是**修复**而非破坏——这些模型之前对用户不可用，现在可用。
- **旧 IndexedDB 数据**：若用户之前解压过子目录 PMX 的 zip，残留的 `dir:<ns>:char/tex/face.png` 旧键不会被读取（读取侧拼 `dir:<ns>:tex/face.png`），属于无害残留。重新解压会写入正确键，旧键被同 `dir:<ns>:` 前缀的 ListDirRecursive 列出但不影响 babylon-mmd 加载（其 relativePath 含 `char/` 前缀，与 PMX 引用的 `tex/face.png` 不匹配，被 model-loader 跳过）。

## 教训

1. **路径维度一致性是命名空间规约的隐性合约**：ADR-182 确立了 `dir:<nsStem>:<relPath>` 键形态，但未显式声明 `relPath` 的维度（zip 内完整路径 vs 相对 PMX 路径）。读取侧 `readFileBytes` 经 `_resolveIdbKey` 把 `web://model/<stem>/<rest>` 映射为 `dir:<stem>:<rest>`，`<rest>` 自然是相对 stem 的路径——而 stem 是 PMX 命名空间，rest 应是相对 PMX 的路径。写入侧用 zip 内完整路径是隐性违约。**新键规约落地时，需显式声明 relPath 维度并加测试覆盖。**

2. **测试覆盖维度需穷举「资源在容器内的位置」**：ADR-182 测试只覆盖「PMX 在 zip 根目录」，未测「PMX 在 zip 子目录」与「多 PMX 多子目录」场景。新增资源路径维度时，需穷举「PMX 在 zip 内的位置 × 文件分布」组合（根目录 / 单子目录 / 多子目录嵌套）。

3. **basename fallback 不是主键修复手段**：`collectTextureFiles` 的 basename fallback 仅对裸文件名引用生效，对带路径的引用（`tex/face.png`）无效。修复路径维度问题时，必须保证主键路径维度一致，不能依赖 fallback 兜底。

4. **多 PMX zip 的命名空间隔离需要双层防护**：仅靠 `zipStem/pmxStem` 编码（ADR-182）不够——同 zip 内不同子目录的 PMX 共享同一个 `nsStem`（因为 mainPmxStem 取自当前选定的 PMX）。需在写入时按 `pmxPrefix` 过滤，使命名空间真正隔离到「当前 PMX 的子目录」。
