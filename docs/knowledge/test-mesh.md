---
kind: test_mesh_factory
name: 程序化测试 Mesh 工厂 — E2E 与单测共享
tier: leaf
category: core
scope:
  - frontend/src/core/test-mesh.ts
source_files:
  - frontend/src/core/test-mesh.ts
tests:
  - frontend/src/__tests__/mesh-lifecycle-headless.test.ts
invariants:
  - TEST_MESH_PREFIX = "e2e-test-" 作为测试网格命名空间
  - createTestMesh 先清理所有既有 e2e-test-* 网格，再新建红色 box + StandardMaterial
  - 生产代码真回归时单测自动捕获（P1 fix：消灭 dev-hooks.ts 与测试的双份实现）
  - Babylon 实现用动态 import 避免模块加载即拉渲染器链
---

# 程序化测试 Mesh 工厂 — E2E 与单测共享
