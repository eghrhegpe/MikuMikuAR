---
kind: audio_bus
name: 音频总线
category: core
scope:
  - frontend/src/core/audio-bus.ts
source_files:
  - frontend/src/core/audio-bus.ts
adr: []
symbols:
  - AudioBus
  - playSfx
  - getAudioContext
  - getSfxEnabled
  - getFootstepVolume
invariants:
  - 音频上下文单例
  - SFX 音量归一化
tests: []
use_when:
  - 音频总线
  - 音效
  - SFX
  - 脚步声音量
  - 音频上下文
---

## 系统概览
**音频总线**。管理 WebAudio 上下文、音效播放、SFX 音量控制，为脚步声等程序化音效提供播放接口。

## 核心职责
- `audio-bus.ts` — 音频上下文管理、音效播放、音量控制。

## 对外 API（节选）
- `getAudioContext()` — 取 WebAudio 上下文（单例）。
- `playSfx(buffer, options?)` — 播放音效。
- `getSfxEnabled()` — 查询 SFX 是否启用。
- `getFootstepVolume()` — 查询脚步声音量。

## 与其他子系统关系
- 脚步声：`../scene/motion/footstep.ts`。
- 音频同步：`@/outfit/audio`。

## 不变量
- 音频上下文单例：只创建一个 `AudioContext`。
- SFX 音量归一化：0..1 范围。
