---
kind: bridge_slot
name: 通用注入桥原语
tier: leaf
category: core
scope:
  - frontend/src/core/bridge-slot.ts
source_files:
  - frontend/src/core/bridge-slot.ts
adr:
  - ADR-265
symbols:
  - createActionBridge
  - createSlot
  - ActionBridge
  - Slot
invariants:
  - 纯叶子零依赖；破环三件套（scene/ui/e2e 桥）的机械部分唯一实现
  - register/set 返回 identity-based 注销 token：覆盖注册后旧 token 不得误删新注册（code_review P2 契约）
  - 缺失注册一次性告警，格式锁定 '[label] 'key' 未注册——调用将静默跳过'（存量日志引用不断链）
  - 新增跨层注入点一律用本原语，禁止手搓 Map/单槽（ADR-238 桥家族的收口约定）
tests:
  - frontend/src/core/__tests__/bridge-slot.test.ts
use_when:
  - 注入桥
  - 回调注册
  - 注销 token
  - 破环
  - 软环
  - bridge
---

# 通用注入桥原语

## 系统概览
**通用注入桥原语**（bridge-slot）。ADR-265 从 ADR-238 三座注入桥提炼的通用形状：软环（getter/setter 惰性，ADR-064 暂忍类）的标准载体。core 持注入点、上层模块启动时注册实现、方向单向，以此切断 core→scene/menus 反向静态依赖而不引入运行时框架。

## 核心职责
- `bridge-slot.ts` — 两种原语工厂：`createActionBridge<A>(label)`（多键动作桥，scene/ui 形态）、`createSlot<T>()`（单槽注入点，e2e 形态）。

## 对外 API
- `createActionBridge<A>(label)` — 返回 `{ register(key, fn) → token, get(key) → A[key]|undefined, unregister(key), has(key), snapshot() }`。
- `createSlot<T>()` — 返回 `{ set(value) → token, get() → T|null, reset() }`；reset 供测试隔离。
- token 语义三处一致：只删本实例注册，重复调用安全。

## 与其他子系统关系
- 立于此原语的桥：`core/scene-action-bridge.ts`、`core/ui-action-bridge.ts`、`core/e2e-state-bridge.ts`。
- 候选未迁移同构单槽：`core/ai/scene-snapshot.ts`（registerAiSnapshotBridge）、`core/auto-save.ts`（_triggerAutoSaveImpl）——各有测试钩子，按 ADR-265 另行并轨。

## 不变量
- **identity token**：新注册先于 dispose 的顺序下不得删错（历史 code_review P2：delete-by-key 致桥永久缺失、core 侧静默跳过）。
- **告警一次性**：缺失注册只 warn 一次后静默返回 undefined，调用方 `?.()` 兜底——既防刷屏，又防重构破坏导致功能静默消失。
- **导出面纪律**：桥迁移只动机械件，接口表与导出签名保持不变（约 90 个消费文件无感）。
