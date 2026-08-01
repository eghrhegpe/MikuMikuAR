---
tier: architecture
kind: orbit_state
name: 轨道相机键盘输入状态叶子
category: core
scope:
  - frontend/src/core/orbit-state.ts
source_files:
  - frontend/src/core/orbit-state.ts
adr: []
symbols:
  - orbitInput
invariants:
  - 零 import 纯叶子：camera-behaviors（读，每帧积分）与 events（写，WSAD keydown/keyup）两侧同源引入，打断 camera↔events 循环依赖
  - orbitInput 为共享可变标记对象，唯一实例，写入点仅键盘事件处理
tests:
  - frontend/src/__tests__/orbit.test.ts
use_when:
  - 轨道相机键盘
  - WSAD 环绕控制
  - 相机键位
  - orbit input
---

## 系统概览
轨道相机的键盘输入状态叶子（仿 freefly-state）。持有 WSAD + 缩放的按键标记，供 `camera-behaviors` 每帧连续积分、`events` 在键盘事件中置位。零 import 设计打断 camera↔events 循环依赖。

## 核心职责
- `orbit-state.ts` — 导出共享可变对象 `orbitInput`：`left`/`right`（环绕 alpha）、`up`/`down`（仰角 beta）、`zoomIn`/`zoomOut`（radius）

## 对外 API（节选）
- `orbitInput` — 布尔标记对象，两侧同源读写

## 与其他子系统关系
- 读：`../scene/camera/camera-behaviors.ts`（orbit render observer 每帧积分）
- 写：`events.ts`（WSAD keydown/keyup 置标记）

## 不变量
- 见 frontmatter `invariants`

## 验证入口
- 测试：`frontend/src/__tests__/orbit.test.ts`
- 命令：`cd frontend && npm run test -- src/__tests__/orbit.test.ts`
