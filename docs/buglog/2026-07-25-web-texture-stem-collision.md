# 网页端不同目录同名 PMX 纹理键互相覆盖（静默错渲染）

> **状态**: 🟢 已修复
> **日期**: 2026-07-25
> **严重程度**: 🔴 P1
> **影响范围**: `frontend/src/core/backend/browser-adapter.ts`
> **发现方式**: 开发发现（代码审查）
> **修复提交**: `714e8508`（FSA 目录扫描路径）+ ADR-182 实现（ZIP 解压路径，本提交批次）

---

## 问题描述

用户在浏览器端通过 File System Access API 扫描模型根目录时，若两个不同子目录下存在**同名 PMX**（典型 MMD 场景：仓库里一堆都叫 `miku.pmx`，分布在 `A/`、`B/` 等不同文件夹），它们各自的伴生纹理会被写入**相同的 `dir:` 纹理键**，后写入者覆盖前者。

表现为：加载 A 目录的 `miku.pmx`，模型却贴上了 B 目录的 `face.png` / `toon.png`——**静默错渲染，极难排查**（无报错、无告警）。

## 复现步骤

1. FSA 扫描含 `A/miku.pmx`（纹理 `A/tex/face.png`）与 `B/miku.pmx`（纹理 `B/tex/face.png`）的根目录。
2. 加载 `A/miku.pmx`。
3. 观察：渲染出的贴图实为 `B/tex/face.png`（或反之，取决于扫描写入顺序）。

## 根因分析

`_scanDirIntoIDB` 写纹理键时用的是**裸文件名 stem**（`pmx.stem` 经 `split('/').pop()` 剥离路径），而 PMX 字节本身用的是含路径的 `relIdStem`：

- 纹理键：`dir:miku:tex/face.png`（`browser-adapter.ts` 旧 `_scanDirIntoIDB`）
- PMX 字节键：`file:A/miku`（`relIdStem` 含路径）

两套命名空间不一致 → 不同目录的同名 PMX 纹理键撞车。解析侧 `IsolateModelDir` 返回 `web://model/<stem>`、`ListDirRecursive`/`readFileBytes` 据 `dir:<stem>:` 前缀读取，stem 维度缺失即无法区分。

附带发现的更严重问题：`GetCacheStats` 浏览器实现返回 `{count,size}`，而 Go 侧与 UI（`settings-system.ts`）消费的 `CacheStats` 是 9 字段结构（含 `totalBytes/resourceBytes/...`），形状不符导致缓存面板直接渲染 `undefined`。

## 修复方案

1. **纹理键路径唯一化**：新增 `_encModelStem(stem) = encodeURIComponent(stem)`。
   - `_scanDirIntoIDB` 纹理键改为 `dir:${_encModelStem(pmx.stem)}:${relToPmx}/${name}`，使 `dir:A%2Fmiku:...` 与 `dir:B%2Fmiku:...` 互不碰撞。
   - `IsolateModelDir` 返回 `web://model/${_encModelStem(_extractStem(pmxPath))}`，编码 stem 在 `web://model/` 路径中为单 token（`/` 被编码为 `%2F`），`_classifyPath`/`_resolveIdbKey`/`ListDirRecursive`/`readFileBytes` 透传即可，无需改动。
   - 根级（裸文件名）模型编码后形态不变（`encodeURIComponent('miku')==='miku'`），向后兼容。
2. **GetCacheStats 真实结构**：返回对齐 Go 的 `CacheStats`（9 字段），遍历 `models`/`thumbnails`/`caches` store 累加 `Uint8Array.byteLength` 作为 `resourceBytes`/`thumbnailBytes`/`extractedBytes`，`serveBytes` 网页端恒 0，`totalBytes` 为三者之和。
3. 回归测试 `browser-adapter.test.ts`（4 项）+ 更新 `backend.test.ts` 过时断言（`IsolateModelDir` 现返回编码 stem）。
4. **ZIP 解压入口的同源碰撞**（`ExtractZip` 用裸 `mainPmxStem` 写 `file:`/`dir:`/`outfit:` 键，未覆盖上一轮修复）由 **ADR-182** 以 `zipStem/pmxStem` 命名空间 + `_encModelStem` 编码全链路解决：`dir:<enc(zipStem/miku)>:tex/face.png` 使不同 zip 内同名 PMX 互不碰撞，并配套 `IsolateModelDir` 幂等化。详见 `docs/adr/adr-182-web-zip-keyspace-namespacing.md`。

## 教训

1. 虚拟路径规约里，**同一资源的字节键与其元数据的命名空间维度必须一致**——本次纹理用裸名、PMX 用全路径，维度错位即埋雷。
2. 双实现（Go / browser-adapter）的**返回结构漂移**靠运行时才暴露：契约测试只锁了 139 个函数的「存在性 + FNV method ID」，未锁返回体字段。CacheStats 这类富结构应在 `BackendService` 接口里显式声明并加字段断言测试。
3. 编码边界：把可能含 `/` 的 stem 塞进 `web://model/<stem>/<rest>` 层级路径时，必须先编码，否则解析端无法区分 stem 与 rest 的 `/`。
