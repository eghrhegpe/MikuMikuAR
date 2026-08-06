---
tier: architecture
adr: []
kind: sss_pbr_material
name: SSS PBR 材质
category: scene
scope:
  - frontend/src/scene/manager/sss-pbr-material.ts
source_files:
  - frontend/src/scene/manager/sss-pbr-material.ts
tests:
  - frontend/src/__tests__/scene/sss-pbr-material.test.ts
symbols:
  - SssPBRMaterial
invariants:
  - 基于 Babylon.js 9.19 PBRSubSurfaceConfiguration 原生插件
  - SSS 参数（power/color/distance/diffusion）通过 setter 同步到底层插件
  - clone 时需恢复 SSS 插件原型链
use_when:
  - 次表面散射材质
---

# SSS PBR 材质
