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
- `applyGroundMaterialSpec` — 原地路径：按 spec 应用材质（不改网格结构）
- `createGroundMeshFromSpec` — 重建路径：按 spec 创建地面网格（flat / infinite / terrain）

## 对外 API（节选）

- `GroundGeometryKind = 'flat' | 'infinite' | 'terrain'` — 几何类型
- `GroundSourceKind = 'solid' | 'canvas' | 'texture' | 'procedural'` — 材质来源
- `GroundMaterialSpec` — structural（geometry/source 等触发重建字段）+ appearance（颜色/透明度等仅应用字段）复合结构

## 与其他子系统关系

- 被 `env-ground.ts` 的 `applyGround` 消费（重建 + 原地双路径）
- 依赖 `core/config` 的 `EnvState`、babylon 材质/纹理系统
- 关联 ADR-226（已落地：Phase 1 重建路径 → Phase 2 原地路径 → Phase 3 合约测试 → Phase 4 删除旧双路径 + 手拼 typeKey）

## UI 入口

无独立 UI 入口（纯逻辑模块）；通过场景菜单 → 地面的参数变更触发 `applyGround` 间接调用。
