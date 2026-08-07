---
tier: leaf
kind: env_underwater_fog
name: 水下视觉系统
category: env
scope:
  - frontend/src/scene/env/env-underwater-fog.ts
source_files:
  - frontend/src/scene/env/env-underwater-fog.ts
adr: []
symbols:
  - underwaterFogController
invariants:
  - 仅在"穿越水面边界"（isUnderwater 状态翻转）时切换一次材质/fogMode，绝不每帧赋值（避免 Babylon 着色器重编译）
  - 焦散动感由 causticsController.update(dt) 推进纹理 uOffset 提供（改 offset 不触发重编译）
  - 出水时按缓存 origEmissiveTex/origEmissiveColor 还原地面材质
  - 切换即时无渐变（用户明确不搞入水动画）
  - reset() 必须还原 emissive 并关闭 fog，防 HMR/场景销毁残留
tests: []
use_when:
  - 水下
  - 潜水
  - 水下雾
  - 水底光斑
  - 焦散水面
---

# 水下视觉系统

## 系统概览
**水下视觉系统**（场景雾 + 焦散投影）。解决"水下视角直接看到地面"和"水底没有白蓝交替泳池光斑"两个体验问题。入水时给地面材质注入焦散 `emissive`（不依赖光照，天然附加水底光斑）并启用 `scene.fog`（LINEAR 蓝色），出水时按缓存还原。用户明确"不搞入水动画"：所有切换即时无渐变。

## 核心职责
- `env-underwater-fog.ts` — 水面穿越检测、地面材质焦散注入/还原、场景雾开关、雾色随天空色混合。

## 对外 API（节选）
- `underwaterFogController.setWaterLevel(level)` — 通知水面 Y（env-impl 在 `state.waterLevel` 变化时调用）。
- `underwaterFogController.install(mat)` — 给地面材质注册水下修饰（幂等：同一 mat 只存一次，缓存原 `emissiveTexture`/`emissiveColor`）。
- `underwaterFogController.uninstall(mat)` — 材质销毁前摘除注册条目（与 `install` 成对；`applyTerrainMaterial` / 地面重建路径调用），避免 `update` 对已 dispose 材质写 emissive。
- `underwaterFogController.update(dt, scene)` — 每帧按相机 Y 与水面关系切换雾 + 焦散；受 `waterEnabled && underwaterEnabled` 门控，状态未变直接返回。
- `underwaterFogController.reset(scene?)` — 还原 emissive、关闭 fog、清空注册表。

> 注：`computeUnderwaterFogColor()` 为模块私有辅助函数（`env-underwater-fog.ts:43` 无 `export`），仅 `update` 内部调用，不列入对外 API。

## 与其他子系统关系
- 消费 `env-caustics.ts`（[共享焦散纹理系统](./env-caustics.md)）：`getTexture` 注入地面 `emissiveTexture`，并按 `envState.groundSize * CAUSTIC_WORLD_SCALE` 派生地面 `uScale`/`vScale`（旧版写死常量 8 不随 groundSize 变，已改为世界空间锚定，与水面焦散同尺度）。
- 联动 `env-water.ts`（[水面系统](./env-water.md)）：`setUnderwaterFog` 手动注入水面 ShaderMaterial（水面不参与 Babylon `scene.fog`）。
- 读取 `envState.skyColorBot` 计算雾色。
- 被 `env-impl.ts` 驱动：`setWaterLevel` + 每帧 `update`。

## 不变量
- 边界驱动：仅 `isUnderwater` 翻转那一刻改材质/fogMode，绝不每帧赋值（否则 Babylon 因脏标记每帧重编译着色器）。
- 焦散动感来源：由 `causticsController.update(dt)` 推进纹理 `uOffset`（改 offset 不触发重编译），故 `update` 本身不推进动画。
- fogMode 语义：使用 `FOGMODE_LINEAR`，`fogStart=40unit(4m)` 无雾阈值、`fogEnd=500unit(50m)` 满雾阈值（坐标用 babymmd unit，1 unit=0.1m，见 AGENTS.md）。
- 还原安全：`reset`/`update` 出水分支按 `origEmissiveTex/origEmissiveColor` 还原，避免焦散 emissive 永久残留。
