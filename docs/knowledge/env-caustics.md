---
kind: env_caustics
name: 共享焦散纹理系统
category: env
scope:
  - frontend/src/scene/env/env-caustics.ts
source_files:
  - frontend/src/scene/env/env-caustics.ts
adr:
  - ADR-115
symbols:
  - causticsController
  - isCausticsHost
  - CausticsScrollConfig
  - CausticsHostMat
invariants:
  - 焦散纹理场景内只生成一次（单实例），由 causticsController 集中维护 UV 滚动
  - 消费者（水面 Shader / 地面 emissiveTexture）共享同一张纹理的 uOffset/vOffset，水底光斑与水波光纹严格同步
  - 旧场景失效时 dispose 旧纹理（_scene 不匹配即重建）
  - causticScrollX/Y/scale/color/intensity 可由 envState 配置覆盖
tests: []
use_when:
  - 焦散
  - 水底光斑
  - 焦散纹理
  - caustics
---

## 系统概览
**共享焦散纹理系统**（ADR-115 P5 跨场景复用）。水面与水底地面共用同一张 Voronoi 焦散纹理与同一组 UV 滚动状态，解决此前焦散在 `env-water.ts` 私有、且重建条件耦合 `waterColor` 造成"颜色微变就重建"的问题。滚动由 `causticsController` 每帧集中推进一次。

## 核心职责
- `env-caustics.ts` — Voronoi 焦散纹理生成（`_drawCausticCanvas`）、单实例控制（`CausticsControllerImpl`）、材质类型守卫（`isCausticsHost`）。

## 对外 API（节选）
- `causticsController.getTexture(scene)` — 获取/重建共享焦散纹理（按 scene 判定单实例）。
- `causticsController.setConfig(cfg)` — 覆盖滚动/缩放/颜色/强度配置。
- `causticsController.update(dt)` — 每帧推进 UV offset 并返回 `{ offsetU, offsetV, cfg }`。
- `causticsController.dispose()` — 释放纹理资源。
- `isCausticsHost(mat)` — 类型守卫，判断材质是否支持 `emissiveTexture`（PBRMaterial | StandardMaterial）。

## 与其他子系统关系
- 被 `env-underwater-fog.ts`（[水下视觉系统](./env-underwater-fog.md)）消费：`getTexture` 注入地面 `emissiveTexture`。
- 被 `env-water.ts`（[水面系统](./env-water.md)）消费：水面 Shader 读取 `uOffset/vOffset`。
- 纹理生成委托 `scene/env/_shared/env-texture`（`createCanvasTexture`）。
- 噪声算法依赖 `core/math/hash-noise`（`hash2v`）。

## 不变量
- 单实例：场景内只生成一次，`getTexture` 内部判定 `_scene === scene`，旧场景失效先 `dispose` 旧纹理。
- 滚动一致性：所有消费者读取同一 `texture.uOffset/vOffset`，水底与地面焦散方向/速度严格一致。
- 缩放解耦：地面材质通过 `causticTex.uScale/vScale`（=8）控制密度；水面 Shader 用自家 `uCausticScale` uniform，互不干扰。
- 切换即时无渐变：用户明确"不搞入水动画"，水下视觉切换即时生效（见 `env-underwater-fog.ts`）。
