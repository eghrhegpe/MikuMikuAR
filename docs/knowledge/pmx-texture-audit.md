---
kind: pmx_texture_audit
name: PMX 声明纹理缺失审计
tier: leaf
category: scene
scope:
  - frontend/src/scene/manager/pmx-texture-audit.ts
source_files:
  - frontend/src/scene/manager/pmx-texture-audit.ts
adr:
  - ADR-189
symbols:
  - parsePmxTexturePaths
  - auditMissingTextures
invariants:
  - 匹配规则与 babylon-mmd ReferenceFileResolver 一致（反斜杠→斜杠、大小写不敏感）
  - 解析失败 / 异常一律返回空数组，绝不阻塞模型加载主流程
  - 接受 AbortSignal：加载取消后丢弃审计结果，避免对新场景误报缺失
tests:
  - frontend/src/scene/manager/pmx-texture-audit.test.ts
use_when:
  - 纹理缺失提示
  - PMX 纹理清单
  - 纹理差集审计
---

# PMX 声明纹理缺失审计

## 系统概览
PMX 声明纹理 vs 实际提供纹理的差集审计。复用 babylon-mmd 的 `PmxReader` 解析 PMX 头部与纹理清单，与 `collectTextureFiles` 提供的相对路径集合做规范化差集，找出「PMX 引用但模型目录中缺失」的纹理，供上层提示用户。

## 核心职责
- `pmx-texture-audit.ts` — 解析 PMX 声明纹理路径清单、计算缺失纹理差集

## 对外 API（节选）
- `parsePmxTexturePaths(pmxBytes)` — 解析 PMX 声明的纹理路径清单（相对路径原样保留）；失败返回空数组
- `auditMissingTextures(pmxBytes, availableRelativePaths, signal?)` — 识别 PMX 声明但目录中缺失的纹理；失败/取消返回空数组

## 与其他子系统关系
- 被 `model-loader.ts` 在加载模型时调用（缺失提示）
- 被 `texture-fallback.ts` 的声明别名注册逻辑引用（`[fix:decl-alias]` 以声明为准注册别名）

## 不变量
- 匹配规则与 babylon-mmd ReferenceFileResolver 一致（PathNormalize + toUpperCase）
- 解析失败 / 异常一律返回空数组，绝不阻塞模型加载主流程
- AbortSignal 已中止时返回空数组，避免加载取消后对新场景误报缺失

## 验证入口
- 测试：`frontend/src/scene/manager/pmx-texture-audit.test.ts`
- 命令：`cd frontend && npm run test -- scene/manager/pmx-texture-audit.test.ts`
