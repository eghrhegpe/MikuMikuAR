---
kind: ground_material_spec
name: 地面材质单一事实源（GroundMaterialSpec）
tier: architecture
category: env
scope:
  - frontend/src/scene/env/env-ground-spec.ts
source_files:
  - frontend/src/scene/env/env-ground-spec.ts
tests:
  - frontend/src/__tests__/scene/env-ground-spec.contract.test.ts
adr:
  - ADR-226
symbols:
  - GroundGeometryKind
  - GroundSourceKind
  - GroundStructuralSpec
  - GroundAppearanceSpec
  - GroundMaterialSpec
  - buildGroundMaterialSpec
  - specKey
  - groundSpecNeedsRebuild
  - applyGroundMaterialSpec
  - createGroundMeshFromSpec
invariants:
  - 重建与原地两条材质路径必须从同一份 spec 派生，禁止各自手拼 typeKey / 平行逻辑
  - specKey 由 structural 子集自动序列化，取代手拼 typeKey 作为重建判定依据
  - terrain 与 flat/infinite 同走 spec 单源，createGroundMeshFromSpec 内部分支，无 legacy 特例
  - terrain 分支必须 setGroundActualSize(state.groundSize)，否则原地纹理密度/滚动用陈旧尺寸
  - isElevation 守卫下 spec 不覆盖 albedo/法线/涟漪，高程着色由 applyTerrainMaterial 全权负责
use_when:
  - 地面材质
  - GroundMaterialSpec
  - 地面重建
  - 地面材质单一来源
  - 地面 typeKey
  - ADR-226
---

# 地面材质单一事实源（GroundMaterialSpec）

## 系统概览

把「地面材质应该长什么样」描述为**纯数据结构 `GroundMaterialSpec`**，由单一 `buildGroundMaterialSpec(state)` 生成；`applyGround` 的重建路径与原地路径都从这份 spec 派生，杜绝 `env-ground.ts` 中手拼 `typeKey` + 双路径平行逻辑导致的「加功能即材质错乱」脆弱性（ADR-226，已落地）。

## 核心职责

- `buildGroundMaterialSpec(state)` — 从 `EnvState` 单一生成 `GroundMaterialSpec`（structural + appearance 两层）
- `specKey(spec)` — 由 `structural` 子集自动序列化得到稳定 key，取代手拼 `typeKey`
- `groundSpecNeedsRebuild(prev, next)` — `specKey` 比较，判定是否需重建地面（结构性变化才重建）
- `applyGroundMaterialSpec(mat, state, scene, isRebuild)` — 按 spec 填材质（不改网格结构）。`isRebuild=true` 由各 source 分支自设 uScale；`false` 走原地增量，UV 密度按 `groundTextureScale` 统一覆盖
- `createGroundMeshFromSpec` — 重建路径：按 spec 创建地面网格与材质，三种几何（flat / infinite / terrain）全在此收口

## 对外 API（节选）

- `GroundGeometryKind = 'flat' | 'infinite' | 'terrain'` — 几何类型
- `GroundSourceKind = 'solid' | 'canvas' | 'texture' | 'procedural'` — 材质来源
- `GroundMaterialSpec` — structural（geometry/source 等触发重建字段）+ appearance（颜色/透明度等仅应用字段）复合结构

## 与其他子系统关系

- 被 [`env-ground`](./env-ground.md) 的 `applyGround` 消费（重建 + 原地双路径），并复用其材质原语（`_setAlbedoTex` / `_syncGroundNormalTexture` / `_syncPbrProperties` / `applyGroundEdgeFade` 等）
- 依赖 [`env-terrain`](./env-terrain.md) 的 `createHeightmapGround` / `applyTerrainMaterial` 完成地形几何与高程着色
- 依赖 `env-water` 的 `hasActiveGroundRipples` 决定涟漪 sync 或 disable
- 依赖 `core/config` 的 `EnvState`、babylon 材质/纹理系统；与 `underwaterFogController` 协作（先 `install` 再填材质，避免水下重建时误捕获焦散快照）
- 关联 ADR-226（已落地：Phase 1 重建路径 → Phase 2 原地路径 → Phase 3 合约测试 → Phase 4 terrain 收敛 + 删除旧双路径与手拼 typeKey）

## 不变量

- terrain 与 flat/infinite 一律经本模块派生：`createGroundMeshFromSpec` 内部按 `spec.structural.geometry` 分支，`env-ground.ts` 侧不得再存在任何 legacy 重建块或 `_applyGroundInplaceLegacy` 式原地特例（ADR-226 Phase 4）。
- terrain 分支创建后必须调用 `setGroundActualSize(state.groundSize)`，否则后续原地路径的 UV 密度与滚动会按陈旧尺寸计算。
- `isElevation = groundType === 'terrain' && groundElevationColoringEnabled` 为守卫：为真时 `applyGroundMaterialSpec` 跳过 albedo 四来源分支（procedural/canvas/texture/solid）、`_syncGroundNormalTexture` 与涟漪 sync/disable——该材质与顶点色已由 `applyTerrainMaterial` 落定，spec 侧不得覆盖。
- 程序化来源自带法线：`sourceKind === 'procedural'` 且用户未显式提供 `groundNormalTexture` 时不调 `_syncGroundNormalTexture`，否则其 else 分支会清掉程序化 normal。
- alpha、PBR 属性、边缘淡出与自发光为外观项，不进入 `specKey`，仅走原地应用不触发重建。

## UI 入口

无独立 UI 入口（纯逻辑模块）；通过场景菜单 → 地面的参数变更触发 `applyGround` 间接调用。
