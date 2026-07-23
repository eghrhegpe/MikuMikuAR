---
kind: virtual_skirt
name: 虚拟裙骨物理控制器（ADR-084 Phase 2-3）
category: physics
scope:
  - frontend/src/scene/physics/**
source_files:
  - frontend/src/scene/physics/virtual-skirt.ts
adr:
  - ADR-084
  - ADR-081
---

## 系统概览
ADR-084 Phase 2-3：将 `skirt-analyzer` 得到的虚拟裙骨链注入 WASM Bullet 物理世界——链头 Kinematic 盒子锚定体（跟随腰骨）+ 链身 Dynamic 球体 + `Generic6DofSpringConstraint` 弹簧链，每帧读刚体位移按权重写回 mesh 顶点。遵循 ADR-081 教训：不被 `scene.ts` 启动期 eager 导入，仅由用户显式开启虚拟裙骨时按需 `await import()`。

## 核心职责
- `virtual-skirt.ts` — `VirtualSkirtController`（build 注入 / _update 每帧 / _writeBackVertices 顶点回写 / dispose 级联释放）

## 对外 API（节选）
- `VirtualSkirtController(model, scene, wasmRuntime, config)` — 控制器，生命周期 build→_update→dispose
- `build(): boolean` — 注入刚体/约束；中途异常安全释放半初始化资源
- `resolveVirtualSkirtQuality(quality, isAndroid)` — auto 按平台解析（Android→low，桌面→high），纯函数便于单测
- `QUALITY_PRESETS` — high/medium/low 的 LOD 上限 + 降频步长 + 顶点硬上限
- getter `effectiveQuality` / `effectiveChains` / `effectiveSegments` / `throttleEvery` — 状态读取

## 与其他子系统关系
- 依赖 `skirt-analyzer`（Phase 1）、`physics-bridge`（PerFrameUpdateRegistry / getBoneWorldPosition）
- 坐标转换纯函数 `localToWorld` / `worldDeltaToLocal` 处理 WASM 世界坐标 ↔ mesh 局部顶点（消除模型整体平移/旋转带来的裙摆漂移）
- 使用专用 `worldId`（不与 PMX 刚体同 world，规避坐标系/碰撞干扰）
- 释放顺序：removeConstraint → removeRigidBody → rb.dispose → constraint.dispose → info.dispose → shape.dispose
