---
kind: skirt_analyzer
name: 裙摆拓扑分析（ADR-084 Phase 1）
category: physics
scope:
  - frontend/src/scene/physics/**
source_files:
  - frontend/src/scene/physics/skirt-analyzer.ts
adr:
  - ADR-084
---

## 系统概览
纯几何模块（无 Babylon.js / babylon-mmd / WASM 依赖），输入 mesh 顶点+索引，输出虚拟裙骨链结构。是 ADR-084 虚拟裙骨方案的 Phase 1：识别裙摆区域 → 生成骨节链与顶点权重，供 `virtual-skirt.ts` 注入 WASM Bullet。

## 核心职责
- `skirt-analyzer.ts` — 已有裙骨检测、包围盒/Y 阈值、boundary edge 连通分量（Union-Find）、角度聚类分链、顶点→骨节全局最近 2 骨节距离反比权重

## 对外 API（节选）
- `analyzeSkirt(positions, indices, options?)` — 返回 `SkirtAnalysisResult`（chains / totalSegments / skirtVertexCount / boundaryEdgeCount / method / hasExistingSkirtBones）
- `SkirtAnalyzerOptions` — chains(4-32) / segmentsPerChain(4-16) / skirtYRatio / boneNames / collisionRadius
- 导出类型 `SkirtSegment` / `SkirtChain` / `SkirtAnalysisResult`

## 与其他子系统关系
- `virtual-skirt.ts` 调用 `analyzeSkirt` 得到拓扑后注入物理世界
- 防误判：多底部环（裤子/连体衣）安全跳过自动生成，避免对腿部误注入虚拟裙骨
- 全局顶点映射（跨链最近 2 骨节）消除相邻链独立位移导致的撕裂
