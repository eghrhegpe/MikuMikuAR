---
tier: architecture
adr:
  - ADR-242
kind: outfit_overlay
name: 换装叠加层
category: scene
scope:
  - frontend/src/scene/manager/outfit-overlay.ts
source_files:
  - frontend/src/scene/manager/outfit-overlay.ts
symbols:
  - loadOverlay
  - hideMaterials
  - restoreMaterials
  - disposeOverlay
invariants:
  - FBX skeleton 重定向匹配率 < 50% 时降级为静态叠加
  - 每个模型实例的叠加层独立管理，dispose 时清理所有 mesh
tests: []
use_when:
  - 换装叠加层
---

# 换装叠加层
