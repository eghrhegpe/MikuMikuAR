---
kind: motion_footstep
name: 脚步声控制器
category: motion
scope:
  - frontend/src/scene/motion/footstep.ts
source_files:
  - frontend/src/scene/motion/footstep.ts
adr:
  - ADR-088
symbols:
  - GroundSfxKind
  - SynthCfg
  - SYNTH_CFG
  - _synthCache
invariants:
  - 合成 buffer 缓存按音色 kind → 3 个变体
  - 每步随机选变体 + detune 音高随机化
tests: []
use_when:
  - 脚步声
  - 落地音效
  - 程序化音效
  - 地面材质音色
---

## 系统概览
**脚步声控制器（ADR-088）**。消费 `feet-adjustment` 的落地事件（`FootLandEvent`），
程序化合成音效（零音频资源）通过 SFX 总线发声。状态为全局配置（uiState），
一套脚步声配置作用于所有模型。

## 核心职责
- `footstep.ts` — 落地事件消费、程序化音效合成、地面材质音色微调、降级检测。

## 对外 API（节选）
- `type GroundSfxKind` — 地面音色类型（concrete/grass/wood/water/default）。
- `interface SynthCfg` — 合成参数（cutoff/noiseAmt/thump）。
- `SYNTH_CFG` — 各地面材质的合成配置表。
- `startFallbackDetection()` / `stopFallbackDetection()` — 未开脚部跟随时降级检测。

## 与其他子系统关系
- 落地事件来源：`./feet-adjustment.setOnFootLand`。
- 音频总线：`@/core/audio-bus.playSfx`。
- 全局配置：`@/core/state.uiState`。
- 地面类型：`@/core/state.envState`。

## 不变量
- 合成 buffer 缓存 `_synthCache`：按 kind 缓存 3 个变体，避免每步重建。
- 音量归一化：`impactSpeed / REF_IMPACT_SPEED (6)` → 0..1 音量。
- 全局配置：uiState 中的脚步声配置作用于所有模型。
