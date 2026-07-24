---
kind: pmx_meta
name: PMX 元数据提取
category: core
scope:
  - frontend/src/core/pmx-meta.ts
source_files:
  - frontend/src/core/pmx-meta.ts
adr: []
symbols:
  - PmxMeta
  - parsePmxComment
invariants:
  - 元数据提取不解析完整 PMX
tests: []
use_when:
  - PMX 元数据
  - 模型元数据
  - PMX 提取
---

## 系统概览
**PMX 元数据提取模块**。从 PMX 文件头部提取元数据（作者、标题、骨骼数等），不解析完整文件。

## 核心职责
- `pmx-meta.ts` — PMX 头部解析、元数据提取。

## 对外 API（节选）
- `interface PMXMeta` — PMX 元数据描述。
- `interface PmxMeta` — PMX 元数据描述。
- `parsePmxComment(bytes)` — 从 PMX 文件头部解析注释字段。

## 与其他子系统关系
- 被 `library-core.ts` 调用（资源索引）。
- PMX 加载：`../scene/manager/model-loader.ts`。

## 不变量
- 元数据提取只解析 PMX 头部，不解析完整文件。
- 提取失败时返回部分元数据，不抛异常。
