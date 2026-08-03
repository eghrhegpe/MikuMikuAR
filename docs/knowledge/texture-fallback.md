---
kind: texture_fallback
name: 纹理路径 fallback 候选生成
tier: leaf
category: scene
scope:
  - frontend/src/scene/manager/texture-fallback.ts
source_files:
  - frontend/src/scene/manager/texture-fallback.ts
adr:
  - ADR-189
symbols:
  - textureFallbackCandidates
  - registerDeclaredAliases
  - expandFallbackCandidates
invariants:
  - 纯函数无依赖，便于单测
  - 候选规则固定：裸名 / 去首段路径 / 首段+裸名；已存在路径不重复注册，同文件重复候选自动去重
  - 候选与磁盘真实文件同名（hasCandidate 预置）时不生成重复条目，避免 referenceFiles 双条目导致 resolver 覆盖错配
  - registerDeclaredAliases 仅在磁盘存在同名（basename 一致）文件时注册声明别名，共享 data 引用
tests:
  - frontend/src/scene/manager/texture-fallback.test.ts
use_when:
  - 纹理路径 fallback
  - 纹理候选路径
  - PMX 声明别名
---

# 纹理路径 fallback 候选生成

## 系统概览
纹理路径 fallback 候选生成（ADR-189 纹理加载路径优化）。PMX 声明的纹理路径可能与磁盘实际位置不一致（模型打包常见问题），babylon-mmd 的 ReferenceFileResolver 按「声明路径」精确匹配，匹配不上则纹理加载失败。本模块为每个文件生成多个候选路径副本（共享同一 data），使声明路径能命中磁盘实际位置。

## 核心职责
- `texture-fallback.ts` — 纯函数生成 fallback 候选、按 PMX 声明路径反向注册别名、批量展开候选条目

## 对外 API（节选）
- `textureFallbackCandidates(rel)` — 生成相对路径的 fallback 候选列表（不含原始路径本身）
- `registerDeclaredAliases(files, declaredPaths)` — 按 PMX 声明路径反向注册别名（磁盘存在同名文件时，注册声明完整路径，共享 data）
- `expandFallbackCandidates(files)` — 批量展开候选条目（共享 data 引用），对「候选 vs 真实路径」冲突去重

## 与其他子系统关系
- 被 `model-loader.ts` 在加载模型纹理时调用（collectTextureFiles 注册候选路径）
- 引用 `pmx-texture-audit.ts` 的 `parsePmxTexturePaths`（声明路径来源）

## 不变量
- 纯函数无依赖，便于单测
- 候选规则固定：裸名 / 去首段路径 / 首段+裸名；已存在路径不重复注册，同文件重复候选自动去重
- 候选与磁盘真实文件同名时不生成重复条目，避免 referenceFiles 同 relativePath 双条目导致 resolver 覆盖错配贴图
- 声明别名仅在磁盘存在同名文件时注册（真缺失不注册）

## 验证入口
- 测试：`frontend/src/scene/manager/texture-fallback.test.ts`
- 命令：`cd frontend && npm run test -- scene/manager/texture-fallback.test.ts`
