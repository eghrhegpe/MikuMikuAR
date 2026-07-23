---
kind: quality_profile
name: 统一质量档位解析器
category: rendering
scope:
  - frontend/src/scene/render/quality-profile.ts
source_files:
  - frontend/src/scene/render/quality-profile.ts
adr:
  - ADR-130
  - ADR-174
---

## 系统概览
质量档位解析器（ADR-130，ADR-174 注册表驱动）。职责：`qualityProfile`（high/medium/low）→ 各域质量设置映射。性能系统写入 `qualityProfile` 作为单一聚合源，各域从此解析派生产出。

## 核心职责
- `QualityProfile = 'high' | 'medium' | 'low'`
- `QualityDimension<T>` — `{ key, default, mapping }`，`default` 必须与 `env-state-schema.ts` 对应字段 `default` 一致（文件末尾编译期校验）
- `QUALITY_DIMENSIONS` 注册表：新增维度只需追加一行，`resolveQualityProfile` / `inferQualityProfile` / `QualityProfileSettings` 自动派生
- `resolveQualityProfile(profile)` → 各 env 字段质量设置；`inferQualityProfile(state)` → 由当前 envState 反推档位

## 对外 API（节选）
- `resolveQualityProfile(profile: QualityProfile): QualityProfileSettings`
- `inferQualityProfile(state: EnvState): QualityProfile`
- `QualityProfileSettings` 类型

## 关键约定
- 注册表驱动：新增质量维度仅需 1 行，杜绝硬编码三组映射
- `default` 与 `env-state-schema` 编译期一致性校验，防止漂移

## 与其他子系统关系
- 被 `performance.ts`（写入 qualityProfile 聚合源）、`env-bridge.ts`、`renderer.ts` 引用
- 依赖 `core/env-state-schema.ts`（字段 default 来源）
