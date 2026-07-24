---
kind: lipsync_bridge
name: 口型同步桥
category: motion
scope:
  - frontend/src/scene/motion/lipsync-bridge.ts
source_files:
  - frontend/src/scene/motion/lipsync-bridge.ts
adr: []
symbols:
  - LipsyncBridge
  - applyLipsync
invariants:
  - 口型参数由音频信号驱动
  - 与 perception-lipsync 协作
tests: []
use_when:
  - 口型同步
  - lipsync
  - 音频驱动口型
---

## 系统概览
**口型同步桥**。将音频信号转换为口型参数，驱动模型的口部骨骼运动。与 `perception-lipsync`
协作实现更自然的口型同步效果。

## 核心职责
- `lipsync-bridge.ts` — 音频到口型的信号转换与骨骼驱动。

## 对外 API（节选）
- `class LipsyncBridge` — 口型同步桥实现。
- `applyLipsync(context, bones, audioSignal)` — 应用口型同步。

## 与其他子系统关系
- 音频信号：`@/outfit/audio`。
- 感知口型：`./perception-lipsync.ts`。
- 注册表：`./motion-modules/registry.ts`。

## 不变量
- 口型参数在 [-1, 1] 范围内。
- 音频信号驱动口型，非 VMD 动作覆盖。
