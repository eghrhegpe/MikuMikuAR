# ADR-172 — 湿身效果：雨天角色材质湿润感

> **状态**: 已完成
> **日期**: 2026-07-22
> **关联**: ADR-160（gaze 指数衰减）、ADR-114（地面反射增强）、ADR-026（环境系统增强）

## 1. 问题陈述

雨天时角色材质应呈现湿润感——表面反光增强、漫反射微暗，模拟水膜覆盖效果。

## 2. 实现方案

### 2.1 材质适配策略

| 材质类型 | 修改属性 | 算法 |
|----------|---------|------|
| `PBRMaterial` | `roughness` | `*= 0.5`（最低 0.1） |
| `StandardMaterial`（含 `MmdStandardMaterial`） | `specularPower` | `*= 2.0`（更集中的高光） |
| | `specularColor` | `*= 1.3`（高光更亮） |
| | `diffuseColor` | `*= 0.85`（表面微暗） |

- 原始值保存在 `_originalMaterialState` Map（key = `material.uniqueId`），通过 `uniqueId` 去重避免共享材质重复衰减
- 退出雨天时恢复原始值

### 2.2 触发时机

- 进入 rain 粒子类型 → `applyWetnessToAllModels()` 遍历 `modelRegistry`
- 离开 rain → `removeWetnessFromAllModels()`
- 新模型注册后 → `applyWetnessToInst(inst)` 由 `ModelManager.register()` 调用

### 2.3 文件结构

| 文件 | 职责 |
|------|------|
| `env-wetness.ts` | 湿身效果核心逻辑（轻量模块，仅依赖 `scene-state` + Babylon 材质类型） |
| `env-particles.ts` | 粒子类型切换时触发湿身；re-export `isWetnessActive` / `applyWetnessToInst` |
| `model-manager.ts` | 模型注册后调用 `applyWetnessToInst` |

### 2.4 模块拆分动机

湿身效果抽出为独立 `env-wetness.ts`（无 `env-impl` / `env-context` 依赖），使 `model-manager.ts` 可轻量导入，避免测试环境中因导入链触发 `transform-gizmo.ts` 等 Babylon 模块初始化问题。

## 3. 已知限制

| 限制 | 说明 | 缓解 |
|------|------|------|
| 仅 roughness/specular 修改 | 无屏幕空间雨滴、无水渍贴图 | 视觉上够用，竞品 DXR 有 screen-space 雨滴 |
| StandardMaterial 与编辑器冲突 | 若用户在雨激活时通过材质编辑器修改 specular/diffuse，恢复时 snap 到旧值 | 材质编辑器当前仅操作 StandardMaterial，与 wetness 操作相同类型，潜在冲突。可通过在材质编辑时同步 `_originalMaterialState` 解决（当前未实现） |
| 无 UI 反馈 | 用户无法直接判断湿身是否激活 | 可通过状态栏图标增强（当前未实现） |

## 4. 未来扩展

- ADR-114 第 604 行已规划「动态湿润效果 — 地面 roughness 自动降低 + 反射增强」，当前为手动切换
- Puddle 系统 — 低洼区域积水（ADR-114 第 605 行）
- 屏幕空间雨滴滑落效果（DXR 竞品参考）
- 材质编辑器修改时同步 `_originalMaterialState` 以消除恢复冲突
