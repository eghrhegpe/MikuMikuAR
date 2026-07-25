# 网页端 ZIP 内子目录 PMX 贴图读取失配（多维 zip 加载不出贴图）

> **状态**: 🟢 已修复
> **日期**: 2026-07-25
> **严重程度**: 🔴 P1
> **影响范围**: `frontend/src/core/backend/browser-adapter.ts` `ExtractZip`
> **发现方式**: 用户反馈
> **修复提交**: 本提交批次（待 commit）

---

## 问题描述

网页端加载「PMX 在 zip 内子目录」的压缩包时，模型加载成功但**贴图读不到**（显示纯色/丢失）。典型触发场景：

- 一个 zip 内有多个模型分布在子目录：`A/Miku.pmx` + `A/tex/face.png`、`B/Miku.pmx` + `B/tex/face.png`
- PMX 在嵌套子目录中：`char/Miku.pmx` + `char/tex/face.png`

ADR-182 已修复「不同 zip 同名 PMX 纹理键碰撞」，但其测试用例只覆盖「PMX 在 zip 根目录」，未发现子目录 PMX 场景下的维度失配问题。

## 根因分析

`ExtractZip`（`browser-adapter.ts:885`）写 `dir:` 命名空间纹理键时，`relPath` 用的是**zip 内完整路径**：

```ts
const relPath = name.replace(/\\/g, '/');           // 'char/tex/face.png'
await idbSet('models', `dir:${nsStem}:${relPath}`); // dir:<ns>:char/tex/face.png
```

而读取侧（babylon-mmd 加载 PMX 时拼贴图 URL）：

1. PMX 内嵌贴图相对路径是**相对 PMX 文件**的，如 `tex/face.png`
2. `IsolateModelDir(filePath)` 返回 `web://model/<nsStem>`（不带 PMX 子目录前缀）
3. babylon-mmd 拼 `web://model/<nsStem>/tex/face.png`
4. `readFileBytes` 解析为 `dir:<nsStem>:tex/face.png`

写入 `dir:<ns>:char/tex/face.png`，读取 `dir:<ns>:tex/face.png` —— **维度失配**，贴图 miss。

`collectTextureFiles` 的 basename fallback（`model-loader.ts:291-302`）只生成 `face.png` 副本，而 PMX 引用的是 `tex/face.png`（带子目录），basename fallback 也不命中。

**多 PMX zip 还存在命名空间污染**：循环对所有文件无条件写 `dir:<nsStem>:<relPath>`，若 zip 内 `A/Miku.pmx` + `B/Miku.pmx` 同时存在，B 子目录的贴图被写到 A 的命名空间下（覆盖 A 的同 relPath 键）。

## 修复方案

1. **记录 mainPmx 完整路径**（`mainPmxFullPath`），推算 PMX 在 zip 内的目录前缀 `pmxPrefix`（如 `char/`，根目录为 `''`）。
2. **写 `dir:` 键时剥掉 `pmxPrefix`**，使 `relPath` 变为相对 PMX 的路径（`char/tex/face.png` → `tex/face.png`），与 babylon-mmd 拼接维度一致。
3. **仅处理 mainPmx 同子目录下的文件**（`relPath.startsWith(pmxPrefix)`），其他 PMX 子目录的文件只写 `file:<裸stem>` 扁平键（跨模型兜底），不污染 mainPmx 命名空间。
4. **outfits.json 同步限定**：仅当与 PMX 同子目录时写入 `outfit:<ns>`，避免其他 PMX 子目录的 outfits.json 污染。
5. **scene.json 保持原逻辑**：scene.json 是 zip 级别元数据，与 PMX 子目录无关，全量写 `bundle:<zipStem>`。

```diff
+ let mainPmxFullPath = ''; // 记录 PMX 在 zip 内的完整路径
  // ...第一遍扫描时 mainPmxFullPath = name.replace(/\\/g, '/');

+ const pmxPrefix = mainPmxFullPath.includes('/')
+     ? mainPmxFullPath.slice(0, mainPmxFullPath.lastIndexOf('/') + 1)
+     : '';

  // 第二遍循环：
  if (ASSET_RE.test(baseName)) {
      await idbSet('models', `file:${stem}`, bytes); // 扁平键保留
      if (nsStem) {
-         await idbSet('models', `dir:${nsStem}:${relPath}`, bytes);
-         if (baseName === mainPmxName) {
-             await idbSet('models', `file:${nsStem}`, bytes);
-         }
+         // 仅写同子目录文件，relPath 剥掉 pmxPrefix 使其相对 PMX
+         if (!pmxPrefix || relPath.startsWith(pmxPrefix)) {
+             const relToPmx = pmxPrefix ? relPath.slice(pmxPrefix.length) : relPath;
+             await idbSet('models', `dir:${nsStem}:${relToPmx}`, bytes);
+             if (baseName === mainPmxName) {
+                 await idbSet('models', `file:${nsStem}`, bytes);
+             }
+         }
      }
  }

- if (baseName.toLowerCase() === 'outfits.json' && nsStem) {
-     await idbSet('models', `outfit:${nsStem}`, bytes);
- }
+ if (baseName.toLowerCase() === 'outfits.json' && nsStem) {
+     if (!pmxPrefix || relPath.startsWith(pmxPrefix)) {
+         await idbSet('models', `outfit:${nsStem}`, bytes);
+     }
+ }
```

## 验证结果

新增 4 项回归测试（`backend.test.ts`）：

1. **PMX 在 zip 子目录时贴图能被正确读取**：`char/Miku.pmx` + `char/tex/face.png` + `char/tex/body.png`，全链路（IsolateModelDir + ListDirRecursive + readFileBytes）读到正确字节，且不残留旧 bug 形态的 `dir:<ns>:char/tex/face.png` 键。
2. **zip 内多个 PMX 在不同子目录，加载指定 PMX 只读对应子目录贴图**：`A/Miku.pmx` + `B/Miku.pmx`，通过 `innerPath='B/Miku.pmx'` 定位 B，B 的贴图被读、A 的贴图不污染命名空间；反向加载 A 同理。
3. **outfits.json 仅与 PMX 同子目录时写入命名空间**：`char/outfits.json` 写入、`other/outfits.json` 不污染。
4. **innerPath 用反斜杠分隔时同样能定位 PMX**：兼容 Windows `'char\\Miku.pmx'` 调用方。

测试结果：
- `npx vitest run src/core/backend/backend.test.ts`：66 通过（新增 4）
- `npm run check`（tsc --noEmit）：通过
- `npx vitest run` 全量：99 文件 / 2057 测试通过（无回归）

## 教训

1. **维度一致性**：写入键的 `relPath` 维度必须与读取侧拼接路径的维度一致。本次写入用「zip 内完整路径」、读取用「相对 PMX 路径」，维度错位即埋雷。`_resolveIdbKey` 把 `web://model/<stem>/<rest>` 映射为 `dir:<stem>:<rest>`，故 `<rest>` 必须是相对 stem 的路径——而 stem 是 PMX 命名空间，rest 自然应是相对 PMX 的路径。

2. **测试覆盖维度**：ADR-182 已写「同名 PMX 纹理键碰撞」测试，但只覆盖了「PMX 在 zip 根目录」的场景，未测「PMX 在 zip 子目录」与「多 PMX 多子目录」场景。新增资源路径维度时，需穷举「PMX 在 zip 内的位置 × 文件分布」组合（根目录 / 单子目录 / 多子目录嵌套）。

3. **多 PMX zip 的命名空间隔离**：仅靠 `zipStem/pmxStem` 编码不够——同 zip 内不同子目录的 PMX 共享同一个 `nsStem`（因为 mainPmxStem 取自当前选定的 PMX），其子目录的贴图仍会互相覆盖。需在写入时按 `pmxPrefix` 过滤，使命名空间真正隔离到「当前 PMX 的子目录」。

4. **basename fallback 救不了「带子目录的引用」**：`collectTextureFiles` 的 basename fallback 仅对裸文件名引用（`face.png`）生效，对 PMX 内嵌的带路径引用（`tex/face.png`）无效。修复时不能依赖 basename fallback 兜底，应保证主键路径维度一致。

## 关联

- ADR-182（网页端 ZIP 导入键规约命名空间化）—— 上一轮修复，未覆盖子目录 PMX 场景
- buglog `2026-07-25-web-texture-stem-collision.md` —— FSA 扫描路径同名碰撞（已修复）
- buglog `2026-07-15-path-override-ignored.md` —— 路径解析多入口问题（已修复）
