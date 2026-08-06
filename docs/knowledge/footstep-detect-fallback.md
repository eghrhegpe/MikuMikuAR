---
tier: architecture
adr:
  - ADR-088
kind: footstep_detect_fallback
name: 脚部落地检测降级
category: scene
scope:
  - frontend/src/scene/motion/footstep-detect-fallback.ts
source_files:
  - frontend/src/scene/motion/footstep-detect-fallback.ts
symbols:
  - startFallbackDetection
  - stopFallbackDetection
invariants:
  - 仅在 feet-adjustment（ADR-085）未开启时作为降级路径
  - 每帧遍历所有模型，通过 IK 骨骼 Y 轴 + groundHeight 判定贴地
  - 复用 detectFootLanding 纯函数检测上升沿 + 去抖（120ms）
  - 临时坐标对象复用，避免每帧每脚分配
tests: []
use_when:
  - 脚部落地检测
---

# 脚部落地检测降级
