---
kind: quality_profile
name: 质量维度与配置系统
category: rendering
scope:
  - frontend/src/scene/render/**
source_files:
  - frontend/src/scene/render/quality-profile.ts
adr:
  - ADR-174
---

## 系统概览
定义渲染质量的**档位（profile）**与**维度（dimension）**模型，将「高/中/低」三档解析为各渲染子系统
（反射、阴影、水面细分、后期等）可读的具体参数。是 ADR-174「质量维度注册表」的落地层。

## 核心职责
- `quality-profile.ts` — 质量档位类型定义、维度接口、档位解析与推理。

## 对外 API（节选）
- `type QualityProfile = 'high' | 'medium' | 'low'` — 三档枚举。
- `interface QualityDimension<T>` — 单一质量维度的泛型定义（key / 取值 / 描述）。
- `type QualityProfileSettings` — 解析后的完整参数集合。
- `resolveQualityProfile(profile)` — 将档位名解析为具体 `QualityProfileSettings`。
- `inferQualityProfile(...)` — 依据运行环境（GPU / 分辨率）推断推荐档位。

## 与其他子系统关系
- 被 `env-reflection.ts` 的 `getQualityPreset(state)` 引用，按当前档位取反射质量预设。
- 是渲染子系统「按档位降级」的统一入口；新增维度需在 `QualityDimension` 注册并在 `resolve` 中分支。
