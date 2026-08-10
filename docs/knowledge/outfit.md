---
tier: architecture
adr:
  - ADR-242
kind: outfit
name: 换装系统
category: scene
scope:
  - frontend/src/scene/manager/outfit.ts
source_files:
  - frontend/src/scene/manager/outfit.ts
tests:
  - frontend/src/__tests__/outfit.test.ts
symbols:
  - setSceneRef
  - loadOutfits
  - applyOutfitVariant
  - resetOutfit
invariants:
  - Scene 引用由 scene.ts 初始化后注入，破除 outfit → scene 循环依赖
  - 纹理通过 texture-lru 共享缓存，避免重复加载
  - 变体名 '默认' 为恢复标识，非 outfits.json 中定义
use_when:
  - 换装加载/应用/重置
---

# 换装系统
